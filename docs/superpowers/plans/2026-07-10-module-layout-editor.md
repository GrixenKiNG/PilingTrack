# Module Layout Editor (Stage 0+1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One shared layout-editor engine + surface registry; monitoring migrated onto it (no visible change); new template-driven equipment tile view on `/admin/equipment` alongside the untouched old list.

**Architecture:** Generalize `MonitoringTileTemplate` → `ModuleLayoutTemplate(tenantId, surfaceId)`; new `src/modules/layout/` service + `/api/layout/[surfaceId]` route (old monitoring route stays as alias); move the monitoring editor components into `src/components/piling/layout-editor/` parameterized by a per-surface block catalog; register two surfaces: `monitoring-equipment-tile` (existing) and `equipment-card` (new toggle view).

**Tech Stack:** Next.js 16 / Prisma 7 / PostgreSQL (FORCE RLS) / vitest.

**Spec:** `docs/superpowers/specs/2026-07-10-module-layout-editor-design.md`

## Global Constraints

- ADMIN-only writes; tenant fail-closed (throw on missing tenantId).
- Only registered surfaceIds are servable; unknown → 404.
- Validator caps: ≤200 blocks, id ≤100, text ≤2000, alt ≤300, colors ≤200 chars.
- Old `/api/monitoring/template` route keeps working (alias, one release).
- Old `EquipmentTile` list is NOT modified; new tile view is additive.
- One migration = one logical change. RLS fail-open policy pattern preserved.
- All existing tests keep passing (imports updated where files moved).

---

### Task 1: Schema + migration `ModuleLayoutTemplate`

**Files:**
- Modify: `prisma/schema.prisma` (model `MonitoringTileTemplate` → `ModuleLayoutTemplate`)
- Create: `prisma/migrations/20260710190000_module_layout_template/migration.sql`

**Interfaces:**
- Produces: Prisma model `moduleLayoutTemplate` with `@@unique([tenantId, surfaceId])`.

- [ ] **Step 1: schema.prisma**

```prisma
model ModuleLayoutTemplate {
  id        String   @id @default(cuid())
  tenantId  String
  surfaceId String
  template  Json
  updatedBy String
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  @@unique([tenantId, surfaceId])
  @@index([tenantId])
}
```

- [ ] **Step 2: migration.sql** (rename + backfill; RLS policies survive a table rename — verify)

```sql
ALTER TABLE "MonitoringTileTemplate" RENAME TO "ModuleLayoutTemplate";
ALTER TABLE "ModuleLayoutTemplate" RENAME CONSTRAINT "MonitoringTileTemplate_pkey" TO "ModuleLayoutTemplate_pkey";
ALTER TABLE "ModuleLayoutTemplate" ADD COLUMN "surfaceId" TEXT NOT NULL DEFAULT 'monitoring-equipment-tile';
ALTER TABLE "ModuleLayoutTemplate" ALTER COLUMN "surfaceId" DROP DEFAULT;
DROP INDEX "MonitoringTileTemplate_tenantId_key";
CREATE UNIQUE INDEX "ModuleLayoutTemplate_tenantId_surfaceId_key" ON "ModuleLayoutTemplate"("tenantId", "surfaceId");
ALTER INDEX "MonitoringTileTemplate_tenantId_idx" RENAME TO "ModuleLayoutTemplate_tenantId_idx";
```

- [ ] **Step 3: apply + verify** — `npx prisma migrate deploy && npx prisma generate`; then psql: existing row has `surfaceId='monitoring-equipment-tile'`; `\d "ModuleLayoutTemplate"` shows RLS enabled + policy present.
- [ ] **Step 4: Commit** `feat(layout): generalize MonitoringTileTemplate to ModuleLayoutTemplate(surfaceId)`

### Task 2: Server surface config + layout service + API

**Files:**
- Create: `src/modules/layout/domain/surfaces.ts` (server-safe registry: id → default template + allowed dataKeys)
- Create: `src/modules/layout/application/layout-service.ts`
- Create: `src/modules/layout/index.ts` (facade)
- Create: `src/app/api/layout/[surfaceId]/route.ts`
- Modify: `src/modules/monitoring/application/template-service.ts` → thin wrappers over layout-service with `surfaceId='monitoring-equipment-tile'` (old route untouched otherwise)
- Test: `tests/contract/layout-template.spec.ts`

**Interfaces:**
- Consumes: generic validator from Task 3's `layout-template.ts` — to avoid ordering problems, Task 3's pure template module is extracted FIRST within this task as `src/components/piling/layout-editor/layout-template.ts` (types + `createTemplateValidator(dataKeys: readonly string[])` + no React).
- Produces:
  - `getLayout(tenantId: string, surfaceId: string): Promise<LayoutTemplate>` (unknown surface → throws `UnknownSurfaceError`)
  - `saveLayout(tenantId: string, surfaceId: string, template: unknown, updatedBy: string): Promise<LayoutTemplate>`
  - `LAYOUT_SURFACES: Record<string, { defaultTemplate: LayoutTemplate; dataKeys: readonly string[] }>` with keys `monitoring-equipment-tile`, `equipment-card`.
  - Route: `GET/PUT /api/layout/[surfaceId]` (GET any role, PUT ADMIN, 404 unknown surface, 400 invalid template/JSON, tenant fail-closed 400).

- [ ] Extract generic `layout-template.ts` (copy of `equipment-tile-template.ts` with `EquipmentTile*` names → `Layout*`, `DATA_KEYS` becomes a parameter of `createTemplateValidator`; `DEFAULT_EQUIPMENT_TILE_TEMPLATE` stays in the monitoring surface file). Monitoring's `equipment-tile-template.ts` becomes re-exports: its data-key list, default template, and `validateEquipmentTileTemplate = createTemplateValidator(EQUIPMENT_TILE_DATA_KEYS)`.
- [ ] Write contract tests (GET default for equipment-card; PUT+GET roundtrip as ADMIN; PUT 403 as OPERATOR; GET/PUT 404 for `surfaceId='nope'`), run → fail.
- [ ] Implement surfaces.ts, layout-service.ts (port of template-service with `surfaceId` in where/upsert on `tenantId_surfaceId` unique), facade, route (same auth pattern as `src/app/api/monitoring/template/route.ts`). Rewire monitoring template-service to call layout-service.
- [ ] Run contract tests (new + existing `monitoring-template.spec.ts`) → pass. `npx tsc --noEmit` clean.
- [ ] **Commit** `feat(layout): layout service + /api/layout/[surfaceId] (monitoring route aliases it)`

### Task 3: Stage 0 — move editor engine to `layout-editor/`

**Files:**
- Create (moved+parameterized from `src/components/piling/monitoring/`):
  - `src/components/piling/layout-editor/layout-renderer.tsx` (from equipment-tile-renderer)
  - `src/components/piling/layout-editor/layout-canvas.tsx` (from equipment-tile-canvas)
  - `src/components/piling/layout-editor/layout-inspector.tsx` (from equipment-tile-inspector)
  - `src/components/piling/layout-editor/layout-block-library.tsx` (from equipment-tile-block-library)
  - `src/components/piling/layout-editor/layout-editor.tsx` (from equipment-tile-editor)
  - `src/components/piling/layout-editor/use-layout-template.ts` (from use-equipment-tile-template; parameterized by `surfaceId`; localStorage seed only when surface config provides `legacySeedKey`)
  - `src/components/piling/layout-editor/registry.tsx` (client registry: `CardBlocksSurface<TData>` = server config + `blockCatalog: {key,label}[]` + `renderBlockContent(block, data)`)
- Modify: monitoring files become thin wrappers passing the monitoring surface descriptor (block content renderer stays in `equipment-tile-block.tsx`); `fleet-dashboard.tsx` imports updated.
- Test: existing `src/components/piling/monitoring/__tests__/*` updated imports; must pass unchanged in behavior.

**Interfaces:**
- Consumes: `createTemplateValidator`, `LayoutTemplate` (Task 2); `LAYOUT_SURFACES` defaults.
- Produces: `<LayoutEditor surface={...} items={TData[]} controller={...}/>`, `<LayoutRenderer surface={...} data={TData} template={...}/>`, `useLayoutTemplate(surface)` controller (same API as today's `EquipmentTileTemplateController`).

- [ ] Move files with `git mv`-style content transfer; rename generic prop `card: FleetCard` → `data: TData` + `renderBlockContent` from the surface descriptor (text/divider stay generic inside).
- [ ] Monitoring surface descriptor `src/components/piling/monitoring/monitoring-surface.tsx`: id, title «Редактор плитки установки», block catalog (current 12 dataKeys + labels from block-library), `renderBlockContent` → `EquipmentTileBlockContent`, `legacySeedKey='monitoring-equipment-tile-template-v1'`.
- [ ] Update all monitoring imports/tests; run `npx vitest run src/components/piling/monitoring tests/contract` → pass; `tsc` clean.
- [ ] Manual: `/monitoring` renders identically; editor opens/saves (PUT hits `/api/layout/monitoring-equipment-tile` via hook).
- [ ] **Commit** `refactor(layout): extract shared layout-editor engine; monitoring runs on it`

### Task 4: Stage 1 — `equipment-card` surface + tile view toggle

**Files:**
- Create: `src/components/piling/admin-equipment/equipment-card-surface.tsx` (descriptor: dataKeys `brandLogo | identity | status | site | operator | engineHours | todayPiles | todayDrilling | todayDowntime | maintenanceAlert | quickLinks`; renderer reuses `EquipmentTileBlockContent` for shared keys, adds `brandLogo` (centered `brand.logoSrc`, respects `logoBg`/`compact`) and `quickLinks` (the 3 links from the old card); default template mirrors the current card: logo 12×5 top, identity 12×2, status 6×2 + site 6×2, operator/engineHours 6×2, metrics 4×2 ×3, maintenanceAlert 12×2, quickLinks 12×2)
- Create: `src/components/piling/admin-equipment/equipment-tile-grid.tsx` (tile view: maps `FleetCard[]` → `LayoutRenderer` per card + `LayoutEditor` mount for ADMIN)
- Modify: the `/admin/equipment` page component (view toggle «Список | Плитки», persisted in `localStorage['equipment-view-mode']`, default `list`; old list branch untouched)
- Modify: `src/modules/layout/domain/surfaces.ts` — register `equipment-card` default template + dataKeys (server side)
- Test: `src/components/piling/admin-equipment/__tests__/equipment-card-surface.test.tsx` (default template validates; renderer shows name/status for a fixture FleetCard; quickLinks hrefs point to `/admin/equipment/{id}`)

**Interfaces:**
- Consumes: `LayoutRenderer`, `useLayoutTemplate`, `LayoutEditor`, `FleetCard`.
- Produces: user-visible toggle; `PUT /api/layout/equipment-card` persists.

- [ ] Test first (surface validates + renders fixture) → fail → implement → pass.
- [ ] Wire toggle into the equipment page (locate the component rendering `EquipmentTile` grid; add mode state + conditional render; do not touch `EquipmentTile` itself).
- [ ] `tsc` clean; full `npx vitest run` green.
- [ ] Manual (browser): toggle shows tiles matching old card content; ADMIN edits → save → reload persists; OPERATOR sees no edit button; «Список» identical to before.
- [ ] **Commit** `feat(equipment): template-driven tile view (equipment-card surface) alongside list`

### Task 5: Full verification + ledger

- [ ] `npx vitest run` (full suite) green; `npx tsc --noEmit` clean; `npx next lint` no new warnings.
- [ ] `gitnexus detect_changes` — affected scope sanity check.
- [ ] Update `.superpowers/sdd/progress.md` with stage 0+1 ledger entry.
- [ ] **Commit** `chore(layout): stage 0+1 verification ledger`
