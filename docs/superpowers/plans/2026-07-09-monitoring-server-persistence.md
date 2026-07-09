# Monitoring Server-Side Persistence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the `/monitoring` tile template per-tenant on the server and store equipment photos via the existing `Media` infrastructure, so an ADMIN configures the dashboard once and everyone in the tenant sees the same cards + photos on every device.

**Architecture:** New tenant-scoped `MonitoringTileTemplate` table (JSON template, one row/tenant) behind `GET`/`PUT /api/monitoring/template` (ADMIN-only write). Equipment photos reuse `Media` (`entityType='equipment'`); `getFleetSnapshot` resolves each equipment's latest completed photo into `FleetCard.photoUrl`. The client hook switches its source from `localStorage` to the server (localStorage kept only as a one-time migration seed); the `image` tile block renders `card.photoUrl`; photo upload goes through the existing `/api/media` flow.

**Tech Stack:** Next.js 16 (App Router), Prisma 7 + PostgreSQL (FORCE RLS), `withApi`/`withMutation` wrappers, vitest, existing S3/MinIO media service.

**Reference spec:** `docs/superpowers/specs/2026-07-09-monitoring-server-persistence-design.md`

## Global Constraints

- **Wrappers:** every route uses `withApi` (GET) or `withMutation` (POST/PUT); never inline CSRF/rate-limit (CLAUDE.md).
- **Tenant fail-closed:** never `IS NULL OR tenantId`; throw on missing tenant, strict equality (CLAUDE.md pitfalls; `pilingtrack-change-control`).
- **Migrations:** one migration = one logical change; run the destructive-statement guard; on deploy rebuild the `migrate` image (`create-migration` skill / runbook 008).
- **RLS:** new tenant tables get FORCE RLS consistent with `prisma/migrations/20260701020000_force_row_level_security`.
- **Tests lean:** extend existing `__tests__` where possible; only add safety-relevant tests (auth gating, tenant scoping, photo resolution). No sprawling new files (`pilingtrack-testing-and-evidence`).
- **ADMIN-only writes:** template `PUT` and equipment-photo upload assert ADMIN **server-side**, not just in UI.
- **Deploy:** operator-driven only; no autonomous prod actions (`pilingtrack-run-and-operate`).
- **DB conventions:** cuid ids, camelCase, `@db.Timestamptz(3)` for timestamps (ADR-0008).

---

### Task 1: `MonitoringTileTemplate` model + migration

**Files:**
- Modify: `prisma/schema.prisma` (add model)
- Create: `prisma/migrations/<timestamp>_monitoring_tile_template/migration.sql`

**Interfaces:**
- Produces: Prisma model `MonitoringTileTemplate { id, tenantId (unique), template Json, updatedBy, createdAt, updatedAt }` and table `MonitoringTileTemplate` with FORCE RLS.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`** (place near other tenant-scoped operational models)

```prisma
model MonitoringTileTemplate {
  id        String   @id @default(cuid())
  tenantId  String   @unique
  template  Json
  updatedBy String
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  @@index([tenantId])
}
```

- [ ] **Step 2: Generate the migration WITHOUT applying, then inspect** (per `create-migration` skill)

Run: `npx prisma migrate dev --name monitoring_tile_template --create-only`
Expected: a new folder `prisma/migrations/<ts>_monitoring_tile_template/migration.sql` containing `CREATE TABLE "MonitoringTileTemplate" (...)` and a unique index on `tenantId`. Confirm there are **no** `DROP`/`ALTER ... DROP` statements (additive only).

- [ ] **Step 3: Append FORCE RLS to the generated `migration.sql`** (mirror the pattern in `20260701020000_force_row_level_security/migration.sql`)

```sql
-- Tenant isolation: FORCE RLS, policy keyed on app.current_tenant (defense in depth)
ALTER TABLE "MonitoringTileTemplate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MonitoringTileTemplate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "MonitoringTileTemplate"
  USING ("tenantId" = current_setting('app.current_tenant', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));
```
> Verify the exact policy/`current_setting` form against the referenced RLS migration and copy it verbatim if it differs.

- [ ] **Step 4: Run the migration guard + apply locally**

Run: `npm run db:check-migrations` (destructive-statement guard) then `npx prisma migrate dev`
Expected: guard passes (no destructive statements); migration applies; `prisma generate` runs.

- [ ] **Step 5: Verify the table + RLS exist**

Run: `docker compose exec postgres psql -U piling -d pilingtrack -c "\d+ \"MonitoringTileTemplate\""` (local DB)
Expected: table present, `tenantId` unique, RLS enabled+forced.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(monitoring): add MonitoringTileTemplate table (tenant-scoped, RLS)"
```

---

### Task 2: Template service + `GET`/`PUT /api/monitoring/template`

**Files:**
- Create: `src/modules/monitoring/application/template-service.ts`
- Create: `src/app/api/monitoring/template/route.ts`
- Modify: `src/modules/monitoring/index.ts` (re-export)
- Test: `tests/contract/monitoring-template.test.ts` (or extend an existing contract test file if one covers monitoring)

**Interfaces:**
- Consumes: `db` from `@/lib/db`; `validateEquipmentTileTemplate`, `DEFAULT_EQUIPMENT_TILE_TEMPLATE`, `cloneEquipmentTileTemplate`, `type EquipmentTileTemplate` from `@/components/piling/monitoring/equipment-tile-template` (pure module, no DOM deps — safe server-side).
- Produces:
  - `getTemplate(tenantId: string): Promise<EquipmentTileTemplate>` — the tenant row's template or the default.
  - `saveTemplate(tenantId: string, template: unknown, updatedBy: string): Promise<EquipmentTileTemplate>` — validates + upserts.
  - Route exports `GET`, `PUT`.

- [ ] **Step 1: Write the failing service test**

```ts
// tests/contract/monitoring-template.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db', () => ({
  db: { monitoringTileTemplate: { findUnique: vi.fn(), upsert: vi.fn() } },
}));

import { db } from '@/lib/db';
import { getTemplate, saveTemplate } from '@/modules/monitoring/application/template-service';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '@/components/piling/monitoring/equipment-tile-template';

describe('monitoring template service', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the default template when no row exists', async () => {
    (db.monitoringTileTemplate.findUnique as any).mockResolvedValue(null);
    const t = await getTemplate('orion');
    expect(t.version).toBe(DEFAULT_EQUIPMENT_TILE_TEMPLATE.version);
    expect(Array.isArray(t.blocks)).toBe(true);
  });

  it('rejects an invalid template on save', async () => {
    await expect(saveTemplate('orion', { nope: true }, 'user1')).rejects.toThrow();
  });

  it('upserts a valid template', async () => {
    (db.monitoringTileTemplate.upsert as any).mockImplementation(async ({ create }: any) => ({ template: create.template }));
    const res = await saveTemplate('orion', DEFAULT_EQUIPMENT_TILE_TEMPLATE, 'user1');
    expect(res.version).toBe(1);
    expect(db.monitoringTileTemplate.upsert).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`template-service` not found)

Run: `npx vitest run tests/contract/monitoring-template.test.ts`
Expected: FAIL — cannot resolve `template-service`.

- [ ] **Step 3: Implement the service**

```ts
// src/modules/monitoring/application/template-service.ts
import { db } from '@/lib/db';
import {
  cloneEquipmentTileTemplate,
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  validateEquipmentTileTemplate,
  type EquipmentTileTemplate,
} from '@/components/piling/monitoring/equipment-tile-template';

export async function getTemplate(tenantId: string): Promise<EquipmentTileTemplate> {
  if (!tenantId) throw new Error('getTemplate: tenantId is required'); // fail closed
  const row = await db.monitoringTileTemplate.findUnique({ where: { tenantId } });
  if (!row) return cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  return validateEquipmentTileTemplate(row.template) ?? cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
}

export async function saveTemplate(
  tenantId: string,
  template: unknown,
  updatedBy: string,
): Promise<EquipmentTileTemplate> {
  if (!tenantId) throw new Error('saveTemplate: tenantId is required'); // fail closed
  const validated = validateEquipmentTileTemplate(template);
  if (!validated) throw new TypeError('Invalid equipment tile template');
  await db.monitoringTileTemplate.upsert({
    where: { tenantId },
    create: { tenantId, template: validated as object, updatedBy },
    update: { template: validated as object, updatedBy },
  });
  return validated;
}
```

- [ ] **Step 4: Run the service test — expect PASS**

Run: `npx vitest run tests/contract/monitoring-template.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Add the route (ADMIN-only PUT)**

```ts
// src/app/api/monitoring/template/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getTemplate, saveTemplate } from '@/modules/monitoring/application/template-service';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  return NextResponse.json(await getTemplate(tenantId));
}, { domain: 'monitoring' });

export const PUT = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  let body: unknown;
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  try {
    const saved = await saveTemplate(tenantId, body, user!.id);
    return NextResponse.json(saved);
  } catch {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }
}, { domain: 'monitoring' });
```

- [ ] **Step 6: Re-export from the module facade** — add to `src/modules/monitoring/index.ts`:

```ts
export { getTemplate, saveTemplate } from './application/template-service';
```

- [ ] **Step 7: Typecheck + tests**

Run: `npx vitest run tests/contract/monitoring-template.test.ts` then `npx tsc --noEmit` (or defer full typecheck to the verify gate)
Expected: tests PASS; no new type errors in the touched files.

- [ ] **Step 8: Commit**

```bash
git add src/modules/monitoring src/app/api/monitoring/template tests/contract/monitoring-template.test.ts
git commit -m "feat(monitoring): server-persisted tile template API (ADMIN-only write)"
```

---

### Task 3: Resolve equipment `photoUrl` in `getFleetSnapshot`

**Files:**
- Modify: `src/modules/monitoring/application/queries/fleet-monitoring.service.ts`
- Modify: `src/components/piling/admin-equipment/fleet-types.ts` (add `photoUrl` to `FleetCard`)
- Test: `src/modules/monitoring/application/queries/__tests__/fleet-monitoring.service.test.ts` (extend existing)

**Interfaces:**
- Consumes: `db.media` (Prisma `Media` model).
- Produces: `FleetCard.photoUrl: string | null` — served URL of the latest completed, non-deleted `Media` for `entityType='equipment', entityId=<equipmentId>`, else `null`.

- [ ] **Step 1: Add `photoUrl` to the `FleetCard` type** — in `fleet-types.ts` add `photoUrl: string | null;` to the `FleetCard` interface (mirror the field in `fleet-monitoring.service.ts`'s own `FleetCard` if it is defined there too — keep both in sync).

- [ ] **Step 2: Write the failing test** (extend the existing suite) — asserts photo resolution picks the newest completed media and yields `null` when none:

```ts
it('resolves photoUrl from the latest completed equipment media', async () => {
  // arrange: mock db.media.findMany to return one completed media for eq id
  // (follow the existing test's mocking style for db.* in this file)
  // assert: snapshot.equipment[0].photoUrl === expected served url
  // assert: an equipment with no media has photoUrl === null
});
```
> Fill the arrange/assert bodies using the existing test file's established `db` mock pattern (do not invent a new mocking approach).

- [ ] **Step 3: Run it — expect FAIL**

Run: `npx vitest run src/modules/monitoring/application/queries/__tests__/fleet-monitoring.service.test.ts`
Expected: FAIL (photoUrl undefined / query not made).

- [ ] **Step 4: Implement photo resolution** in `getFleetSnapshot` — after `equipmentIds` is computed, add:

```ts
// Latest completed, non-deleted photo per equipment (entityType='equipment').
const photoRows = equipmentIds.length
  ? await db.media.findMany({
      where: {
        entityType: 'equipment',
        entityId: { in: equipmentIds },
        tenantId: opts.tenantId,
        uploadStatus: 'completed',
        isDeleted: false,
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, entityId: true, cdnUrl: true },
    })
  : [];
const photoByEquipment = new Map<string, string>();
for (const m of photoRows) {
  if (m.entityId && !photoByEquipment.has(m.entityId)) {
    photoByEquipment.set(m.entityId, m.cdnUrl ?? `/api/media/${m.id}/download`);
  }
}
```
Then in the `cards` map, set `photoUrl: photoByEquipment.get(eq.id) ?? null,` on each returned card.

- [ ] **Step 5: Run the test — expect PASS**

Run: `npx vitest run src/modules/monitoring/application/queries/__tests__/fleet-monitoring.service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/monitoring/application/queries src/components/piling/admin-equipment/fleet-types.ts
git commit -m "feat(monitoring): resolve per-equipment photoUrl from Media in fleet snapshot"
```

---

### Task 4: Render the `image` block from `card.photoUrl` + ADMIN equipment-photo upload

**Files:**
- Modify: `src/components/piling/monitoring/equipment-tile-block.tsx` (render server photo)
- Modify: `src/core/media/media-auth.ts` (tighten `entityType='equipment'` to ADMIN)
- Modify: `src/components/piling/monitoring/use-equipment-tile-template.ts` (`addImage`/`replaceImage` → media upload)
- Create: `src/components/piling/monitoring/equipment-photo-upload.ts` (client helper: presign → PUT → confirm)
- Test: `src/core/media/__tests__/media-auth.test.ts` (extend if present; else add a focused test)

**Interfaces:**
- Consumes: `FleetCard.photoUrl` (Task 3); `POST /api/media`, `POST /api/media/[id]/confirm` (existing).
- Produces: `uploadEquipmentPhoto(file: File, equipmentId: string): Promise<void>` in `equipment-photo-upload.ts`.

- [ ] **Step 1: Render the image block from the server photo** — in `equipment-tile-block.tsx`, replace the `block.kind === 'image'` branch:

```tsx
if (block.kind === 'image') {
  if (!card.photoUrl) return <span className="text-xs text-slate-400">Фото не загружено</span>;
  return <img src={card.photoUrl} alt={block.alt ?? card.name} className="h-full w-full" style={{ objectFit: block.imageFit ?? 'cover' }} />;
}
```
Remove the now-unused `EquipmentTileImageBlock` / `getEquipmentTileImageAssetId` imports **only if** no other code path uses them (grep first: `grep -rn EquipmentTileImageBlock src`).

- [ ] **Step 2: Tighten media auth for equipment to ADMIN** — in `media-auth.ts` `assertCanAccessMediaEntity`, before the generic operator rejection, add an explicit equipment branch so only ADMIN manages equipment media (privileged currently includes DISPATCHER):

```ts
if (entityType === 'equipment') {
  if (actor.role !== 'ADMIN') throw new ServiceError('Only admins can manage equipment photos', 403);
  return;
}
```
> Place this AFTER the `isPrivilegedRole` early-return is removed for equipment, or before it — ensure the net effect is: equipment media write requires `role === 'ADMIN'`. Adjust the early `isPrivilegedRole` return if it would let DISPATCHER through for equipment.

- [ ] **Step 3: Write the failing media-auth test**

```ts
it('allows ADMIN to manage equipment media and rejects DISPATCHER', async () => {
  await expect(assertCanAccessMediaEntity({ id:'u', role:'ADMIN' } as any, 'equipment', 'eq1')).resolves.toBeUndefined();
  await expect(assertCanAccessMediaEntity({ id:'u', role:'DISPATCHER' } as any, 'equipment', 'eq1')).rejects.toThrow();
});
```

- [ ] **Step 4: Run — expect FAIL, then PASS after Step 2 is in place**

Run: `npx vitest run src/core/media/__tests__/media-auth.test.ts`
Expected: FAIL first (if written before impl), PASS after.

- [ ] **Step 5: Add the client upload helper**

```ts
// src/components/piling/monitoring/equipment-photo-upload.ts
import { authFetch } from '@/lib/api';
import { validateEquipmentTileImageFile } from './equipment-tile-asset-storage';

export async function uploadEquipmentPhoto(file: File, equipmentId: string): Promise<void> {
  const err = validateEquipmentTileImageFile(file);
  if (err) throw new TypeError(err);
  const presign = await authFetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName: file.name, contentType: file.type, fileSize: file.size, entityType: 'equipment', entityId: equipmentId }),
  });
  if (!presign.ok) throw new Error(`Не удалось начать загрузку (${presign.status})`);
  const { id, uploadUrl } = await presign.json(); // confirm field names against getPresignedUrl's return shape
  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('Загрузка в хранилище не удалась');
  const confirm = await authFetch(`/api/media/${id}/confirm`, { method: 'POST' });
  if (!confirm.ok) throw new Error('Не удалось подтвердить загрузку');
}
```
> Verify the exact `POST /api/media` response field names (`id`, `uploadUrl`) against `getMediaService().getPresignedUrl` before finalizing; adjust destructuring to match.

- [ ] **Step 6: Retarget the editor's image upload to the server** — in `use-equipment-tile-template.ts`, change `addImage`/`replaceImage` to call `uploadEquipmentPhoto(file, equipmentId)` instead of `assetStorage.put(...)`. The template still gains/keeps the `image` block (layout, shared); the photo bytes now live in Media, not IndexedDB. Drop `assetRevision`-based IndexedDB bookkeeping for equipment photos. After a successful upload, trigger a fleet refetch so the new `photoUrl` appears (expose a callback or invalidate via the existing fetch path in `fleet-dashboard.tsx`).

- [ ] **Step 7: Tests + verify touched units**

Run: `npx vitest run src/core/media/__tests__/media-auth.test.ts src/components/piling/monitoring/__tests__`
Expected: PASS (existing monitoring tests still green — update any that asserted IndexedDB rendering of image blocks to assert `card.photoUrl` rendering instead).

- [ ] **Step 8: Commit**

```bash
git add src/components/piling/monitoring src/core/media
git commit -m "feat(monitoring): equipment photos via Media (render photoUrl, ADMIN upload)"
```

---

### Task 5: Switch the template hook to the server (with localStorage migration seed)

**Files:**
- Modify: `src/components/piling/monitoring/use-equipment-tile-template.ts`
- Test: `src/components/piling/monitoring/__tests__/` (extend the existing hook/template test)

**Interfaces:**
- Consumes: `GET`/`PUT /api/monitoring/template` (Task 2); `authFetch` from `@/lib/api`.
- Produces: hook now loads/saves the template server-side; `saveDraft` becomes async (PUT). Keep the same `EquipmentTileTemplateController` surface; `saveDraft` shows a toast on failure.

- [ ] **Step 1: Load from server on mount, seed from localStorage once** — replace the load `useEffect` so it: (a) `GET /api/monitoring/template`; (b) if the server returns a template that deep-equals `DEFAULT_EQUIPMENT_TILE_TEMPLATE` (no saved row) AND `loadEquipmentTileTemplate(localStorage)` differs from default, use the local one as the initial editable value (migration seed) — otherwise use the server template. Fall back to `DEFAULT` on fetch error (page must still render).

- [ ] **Step 2: `saveDraft` → PUT to server** — replace `saveEquipmentTileTemplate(localStorage, draft)` with:

```ts
const res = await authFetch('/api/monitoring/template', {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(draft),
});
if (!res.ok) { toast.error(res.status === 403 ? 'Только администратор может сохранять шаблон' : 'Не удалось сохранить шаблон'); return; }
setTemplate(cloneEquipmentTileTemplate(draft));
setEditing(false);
```
Keep writing to `localStorage` too as a harmless local cache is optional — prefer NOT to, to avoid two sources of truth (server is authoritative). Remove `resetEquipmentTileTemplate`/local reset in favor of a PUT of the default (or a small DELETE later — out of scope; for v1 `reset` PUTs the default template).

- [ ] **Step 3: Gate Save/edit controls to ADMIN in the editor UI** — in the tile editor component, hide/disable Save + image-upload for non-ADMIN (`usePilingStore` role), matching the server 403. (Read-only users never see the editor affordances.)

- [ ] **Step 4: Update/extend the hook test** — assert: server template is used when present; localStorage seed is used when server is empty and local differs; `saveDraft` issues a PUT and updates `template` on success; a 403 leaves `template` unchanged.

- [ ] **Step 5: Run tests — expect PASS**

Run: `npx vitest run src/components/piling/monitoring/__tests__`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/piling/monitoring
git commit -m "feat(monitoring): load/save tile template from server (localStorage = one-time seed)"
```

---

### Task 6: Verify end-to-end locally, then operator-driven deploy

**Files:** none (verification + release)

- [ ] **Step 1: Full gate** — `npm run verify` (`db:check-migrations` → lint → typecheck → test:unit → build → smoke). Expected: all green. Fix anything red before proceeding (`qa-checklist`).

- [ ] **Step 2: Local prod-build browser check** — `npm run build && npm start`; log in as ADMIN (`admin@orionpiling.ru` / `admin123`, local dev only):
  - Open `/monitoring`, open the editor, confirm the current layout seeded from localStorage; click Save → reload → template persists (served from server).
  - Upload a photo for an equipment → reload → photo persists and shows via `photoUrl`.
  - Open a second browser / incognito (same origin), log in → **same** template + photos appear (proves server persistence, not per-browser).
  - Confirm a non-ADMIN user sees the dashboard read-only (no Save/upload) and still sees the shared template + photos.
  Expected: all of the above hold; no console errors beyond the known unrelated CSP lucide-chunk noise (`pilingtrack-csp-monitoring-campaign`).

- [ ] **Step 3: detect_changes / impact sanity** — per CLAUDE.md GitNexus gate, confirm the change set touches only expected symbols.

- [ ] **Step 4: Deploy (OPERATOR-DRIVEN)** — this task set **includes a new migration**, so use the `deploy` skill's Case B: build `migrate app workers` (sequential, watch `df -h /`), verify the migration landed (`SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1;`), then `up -d`. The human operator drives every step (`pilingtrack-run-and-operate`). Do NOT run this autonomously.

- [ ] **Step 5: Post-deploy one-time migration of the real setup** — on prod, ADMIN opens `/monitoring`, saves the template once, and re-uploads each equipment photo. Verify from a second device that everyone sees the screenshot state.

- [ ] **Step 6: Record outcome** — update `docs/audit.md` if this closes/adds a tracked item; note the feature in the relevant skill provenance if behavior a skill documents changed (`report-evidence-model` / monitoring notes). Commit any doc updates.

---

## Self-Review

**Spec coverage:** template per-tenant (Task 1–2 ✓), photos via Media (Task 3–4 ✓), ADMIN-only writes (Task 2 role check + Task 4 media-auth ✓), manual replace (Task 4 upload ✓), localStorage one-time seed (Task 5 ✓), RLS/tenant fail-closed (Task 1 + services ✓), lean tests (extend existing ✓), operator-driven deploy w/ migrate rebuild (Task 6 ✓). Out-of-scope items (auto-rotation, multi-image, per-user) are not implemented — correct.

**Placeholder scan:** two steps carry explicit "verify against actual signature" notes (RLS policy exact form; `getPresignedUrl` response field names) — these are verification instructions, not deferred work; the executor confirms one line before finalizing. The `fleet-monitoring` test arrange/assert body defers to the existing mock pattern in that file (intentional — reuse, don't invent).

**Type consistency:** `getTemplate`/`saveTemplate` signatures match between Task 2 service, route, and Task 5 hook usage. `FleetCard.photoUrl: string | null` defined in Task 3 and consumed in Task 4 render. `uploadEquipmentPhoto(file, equipmentId)` defined in Task 4 and used in the hook (Task 4 Step 6).

**Open verification points for the executor (confirm before finalizing the step):**
1. Exact FORCE-RLS policy syntax from the reference migration.
2. `POST /api/media` (`getPresignedUrl`) response field names (`id`, `uploadUrl`).
3. Whether `FleetCard` is declared once (fleet-types.ts) or duplicated in the service — keep both in sync if duplicated.
