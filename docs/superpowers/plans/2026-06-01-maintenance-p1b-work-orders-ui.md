# Модуль ТО — План P1b: Интерфейс нарядов (Work Orders UI)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать видимый интерфейс нарядов — глобальная доска `/admin/maintenance`, страница наряда `/admin/maintenance/[id]`, переиспользуемый диалог создания/правки, фото, и приведение существующей вкладки ТО к новым полям/статусам.

**Architecture:** Тонкие Next.js client-компоненты (self-fetch через `authFetch`), бизнес-логика и лейблы вынесены в чистые модули с юнит-тестами. Два небольших backend-эндпоинта (`GET /api/maintenance/[id]`, `GET /api/maintenance/assignees`). Мутации идут через существующий per-equipment maintenance API. Зеркалируем существующие паттерны (`EquipmentPhotos`, `EquipmentMaintenance`, диалоги shadcn).

**Tech Stack:** Next.js App Router (client components), React, Tailwind + shadcn/ui, lucide-react, sonner, Vitest. Backend: Prisma, Zod, `withApi`.

**Связанный спек:** `docs/superpowers/specs/2026-06-01-maintenance-p1b-work-orders-ui-design.md`.

**Vibro:** `equipment-detail.tsx:83` всё ещё содержит `VIBRO_HAMMER` — НЕ трогать в P1b (отдельная задача).

---

## Структура файлов

Backend (новое/изменяемое):
- Modify `src/modules/equipment/application/queries/equipment-query.service.ts` — `getMaintenanceById`
- Modify `src/modules/equipment/index.ts` — экспорт
- Modify `src/services/users/user-service.ts` — `listAssignableUsers`
- Modify `src/modules/users/index.ts` — реэкспорт
- Create `src/app/api/maintenance/[id]/route.ts`
- Create `src/app/api/maintenance/assignees/route.ts`

UI (новое):
- `src/components/piling/maintenance/maintenance-labels.ts` — лейблы/стили/типы (чистый)
- `src/components/piling/maintenance/maintenance-helpers.ts` — `buildMaintenanceQuery`, `resolveAssigneeName`, `nextStatusActions` (чистые)
- `src/components/piling/maintenance/work-order-form-dialog.tsx`
- `src/components/piling/maintenance/work-order-photos.tsx`
- `src/components/piling/maintenance/maintenance-board.tsx`
- `src/components/piling/maintenance/work-order-detail.tsx`
- `src/app/(app)/admin/maintenance/page.tsx`
- `src/app/(app)/admin/maintenance/[id]/page.tsx`

UI (изменяемое):
- `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx` — рефактор на общие лейблы/диалог
- `src/app/(app)/layout.tsx` — пункт меню «Обслуживание»

---

## Task 1: Query `getMaintenanceById`

**Files:**
- Test: `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts` (дополнить)
- Modify: `src/modules/equipment/application/queries/equipment-query.service.ts`

- [ ] **Step 1: Failing test** — добавить describe-блок (мок `db.maintenanceRecord.findUnique` — добавить `findUniqueRecMock` в существующий `vi.hoisted` и в `maintenanceRecord: {...}` мока `@/lib/db`):

```typescript
describe('getMaintenanceById', () => {
  it('returns the record when tenant matches', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'orion', equipmentId: 'eq_1' });
    const { getMaintenanceById } = await import('../equipment-query.service');
    const rec = await getMaintenanceById('rec_1', 'orion');
    expect(rec.id).toBe('rec_1');
  });
  it('throws 404 for cross-tenant record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', tenantId: 'other', equipmentId: 'eq_1' });
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('rec_1', 'orion')).rejects.toThrow('Maintenance record not found');
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('rec_1', '')).rejects.toThrow();
  });
  it('throws 404 when not found', async () => {
    findUniqueRecMock.mockResolvedValue(null);
    const { getMaintenanceById } = await import('../equipment-query.service');
    await expect(getMaintenanceById('missing', 'orion')).rejects.toThrow('Maintenance record not found');
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** — `npx vitest run src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts -t getMaintenanceById` → FAIL (not exported).

- [ ] **Step 3: Implement** in `equipment-query.service.ts` (ServiceError already imported):

```typescript
export async function getMaintenanceById(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)
  const record = await db.maintenanceRecord.findUnique({
    where: { id },
    include: { equipment: { select: { id: true, name: true, model: true } } },
  });
  if (!record || record.tenantId !== tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  return record;
}
```

- [ ] **Step 4: Run, confirm PASS.** Then run the whole file to confirm no regressions.

- [ ] **Step 5: Export** — in `src/modules/equipment/index.ts` add `getMaintenanceById` to the queries export line.

- [ ] **Step 6: Commit**
```bash
git add src/modules/equipment/application/queries/equipment-query.service.ts src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts src/modules/equipment/index.ts
git commit -m "feat(maintenance): add getMaintenanceById query"
```
(End every commit message in this plan with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 2: Route `GET /api/maintenance/[id]`

**Files:**
- Create: `src/app/api/maintenance/[id]/route.ts`

- [ ] **Step 1: Create** (mirror `src/app/api/maintenance/route.ts` conventions):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getMaintenanceById } from '@/modules/equipment';
import { withApi } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const { id } = await params;
    try {
      const record = await getMaintenanceById(id, tenantId);
      return NextResponse.json({ record });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
```

- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit**
```bash
git add "src/app/api/maintenance/[id]/route.ts"
git commit -m "feat(maintenance): add GET /api/maintenance/[id] endpoint"
```

---

## Task 3: Service `listAssignableUsers`

**Files:**
- Read first: `src/services/users/user-service.ts` (find `listUsers`, the db import, the User select shape).
- Test: `src/services/users/__tests__/user-service.test.ts` (create if absent, else extend; mirror existing user-service test if present).
- Modify: `src/services/users/user-service.ts`
- Modify: `src/modules/users/index.ts`

- [ ] **Step 1: Failing test** (mock `@/lib/db` `user.findMany`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyUserMock } = vi.hoisted(() => ({ findManyUserMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { user: { findMany: findManyUserMock } } }));
import { listAssignableUsers } from '../user-service';

describe('listAssignableUsers', () => {
  beforeEach(() => { findManyUserMock.mockReset(); findManyUserMock.mockResolvedValue([]); });
  it('scopes to active users of the tenant', async () => {
    await listAssignableUsers('orion');
    const arg = findManyUserMock.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 'orion', isActive: true });
    expect(arg.select).toEqual({ id: true, name: true, role: true });
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    await expect(listAssignableUsers('')).rejects.toThrow();
  });
});
```
> If `@/lib/db` is already mocked elsewhere in this test file, extend that mock with `user.findMany` instead of redeclaring.

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** in `user-service.ts` (use the same `db` import the file already uses; if it throws domain errors via `ServiceError`, reuse that; otherwise a plain `Error` is acceptable here as this service file's convention dictates — match the file):

```typescript
export async function listAssignableUsers(tenantId: string) {
  if (!tenantId) throw new Error('tenantId is required'); // fail-closed
  return db.user.findMany({
    where: { tenantId, isActive: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
}
```
> Match the file's existing error idiom: if `listUsers`/siblings throw `ServiceError`, use `new ServiceError('tenantId is required', 400)` instead of `Error`. Read the file and be consistent.

- [ ] **Step 4: Run, confirm PASS.**

- [ ] **Step 5: Re-export** — in `src/modules/users/index.ts` add `listAssignableUsers` to the export list from `@/services/users/user-service`.

- [ ] **Step 6: Commit**
```bash
git add src/services/users/user-service.ts src/services/users/__tests__/user-service.test.ts src/modules/users/index.ts
git commit -m "feat(maintenance): add listAssignableUsers for assignee picker"
```

---

## Task 4: Route `GET /api/maintenance/assignees`

**Files:**
- Create: `src/app/api/maintenance/assignees/route.ts`

- [ ] **Step 1: Create:**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listAssignableUsers } from '@/modules/users';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const users = await listAssignableUsers(tenantId);
    return NextResponse.json({ users });
  },
  { domain: 'equipment.maintenance' }
);
```

- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit**
```bash
git add src/app/api/maintenance/assignees/route.ts
git commit -m "feat(maintenance): add assignee list endpoint gated by maintenance.manage"
```

---

## Task 5: `maintenance-labels.ts` (single source of labels/types)

**Files:**
- Create: `src/components/piling/maintenance/maintenance-labels.ts`
- Test: `src/components/piling/maintenance/__tests__/maintenance-labels.test.ts`

- [ ] **Step 1: Failing test:**

```typescript
import { describe, it, expect } from 'vitest';
import { STATUS_LABEL, STATUS_STYLE, PRIORITY_LABEL, TYPE_LABEL } from '../maintenance-labels';

describe('maintenance-labels', () => {
  it('covers all 6 statuses with label + style', () => {
    const keys = ['PLANNED','ASSIGNED','IN_PROGRESS','ON_HOLD','DONE','CANCELLED'] as const;
    for (const k of keys) { expect(STATUS_LABEL[k]).toBeTruthy(); expect(STATUS_STYLE[k]).toBeTruthy(); }
  });
  it('covers all 4 priorities and 4 types', () => {
    for (const k of ['LOW','NORMAL','HIGH','CRITICAL'] as const) expect(PRIORITY_LABEL[k]).toBeTruthy();
    for (const k of ['SCHEDULED','REPAIR','FAULT','INSPECTION'] as const) expect(TYPE_LABEL[k]).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run, confirm FAIL** (module missing).

- [ ] **Step 3: Implement:**

```typescript
import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from '@/modules/equipment';

export type { MaintenanceStatus, MaintenancePriority, MaintenanceType };

export const TYPE_LABEL: Record<MaintenanceType, string> = {
  SCHEDULED: 'Плановое ТО', REPAIR: 'Ремонт', FAULT: 'Неисправность', INSPECTION: 'Осмотр',
};
export const STATUS_LABEL: Record<MaintenanceStatus, string> = {
  PLANNED: 'Запланировано', ASSIGNED: 'Назначено', IN_PROGRESS: 'В работе',
  ON_HOLD: 'Приостановлено', DONE: 'Выполнено', CANCELLED: 'Отменено',
};
export const STATUS_STYLE: Record<MaintenanceStatus, string> = {
  PLANNED: 'bg-slate-100 text-slate-600',
  ASSIGNED: 'bg-sky-100 text-sky-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700',
  ON_HOLD: 'bg-orange-100 text-orange-700',
  DONE: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-400 line-through',
};
export const PRIORITY_LABEL: Record<MaintenancePriority, string> = {
  LOW: 'Низкий', NORMAL: 'Обычный', HIGH: 'Высокий', CRITICAL: 'Критичный',
};
export const PRIORITY_STYLE: Record<MaintenancePriority, string> = {
  LOW: 'bg-slate-100 text-slate-500',
  NORMAL: 'bg-slate-100 text-slate-600',
  HIGH: 'bg-amber-100 text-amber-700',
  CRITICAL: 'bg-rose-100 text-rose-700',
};
```
> The `MaintenanceStatus`/`MaintenancePriority`/`MaintenanceType` types must be exported from `@/modules/equipment`. `MaintenanceStatus`/`Type` already are (from P1a). `MaintenancePriority` may NOT be — if `tsc` errors on the import, add `MaintenancePriority` to the `export type { ... }` line in `src/modules/equipment/index.ts` (it originates in `application/commands/equipment-maintenance.ts`). Make that one-line export fix if needed and include it in this task's commit.

- [ ] **Step 4: Run, confirm PASS** + `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/components/piling/maintenance/maintenance-labels.ts src/components/piling/maintenance/__tests__/maintenance-labels.test.ts src/modules/equipment/index.ts
git commit -m "feat(maintenance): shared work order labels and types"
```

---

## Task 6: `maintenance-helpers.ts` (pure UI logic)

**Files:**
- Create: `src/components/piling/maintenance/maintenance-helpers.ts`
- Test: `src/components/piling/maintenance/__tests__/maintenance-helpers.test.ts`

- [ ] **Step 1: Failing test:**

```typescript
import { describe, it, expect } from 'vitest';
import { buildMaintenanceQuery, resolveAssigneeName, nextStatusActions } from '../maintenance-helpers';

describe('buildMaintenanceQuery', () => {
  it('omits empty filters', () => {
    expect(buildMaintenanceQuery({})).toBe('');
    expect(buildMaintenanceQuery({ status: 'PLANNED', assigneeId: '' })).toBe('?status=PLANNED');
  });
  it('includes multiple filters', () => {
    const q = buildMaintenanceQuery({ status: 'DONE', priority: 'HIGH' });
    expect(q.startsWith('?')).toBe(true);
    expect(q).toContain('status=DONE');
    expect(q).toContain('priority=HIGH');
  });
});

describe('resolveAssigneeName', () => {
  const map = new Map([['u1', 'Иванов']]);
  it('returns name when known', () => expect(resolveAssigneeName('u1', map)).toBe('Иванов'));
  it('returns dash when null/unknown', () => {
    expect(resolveAssigneeName(null, map)).toBe('—');
    expect(resolveAssigneeName('u9', map)).toBe('—');
  });
});

describe('nextStatusActions', () => {
  it('PLANNED can start and cancel', () => {
    expect(nextStatusActions('PLANNED')).toEqual(['IN_PROGRESS', 'CANCELLED']);
  });
  it('IN_PROGRESS can hold, done, cancel', () => {
    expect(nextStatusActions('IN_PROGRESS')).toEqual(['ON_HOLD', 'DONE', 'CANCELLED']);
  });
  it('DONE and CANCELLED are terminal', () => {
    expect(nextStatusActions('DONE')).toEqual([]);
    expect(nextStatusActions('CANCELLED')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement:**

```typescript
import type { MaintenanceStatus, MaintenancePriority, MaintenanceType } from './maintenance-labels';

export interface MaintenanceFilter {
  status?: MaintenanceStatus | '';
  priority?: MaintenancePriority | '';
  assigneeId?: string;
  type?: MaintenanceType | '';
}

export function buildMaintenanceQuery(filter: MaintenanceFilter): string {
  const sp = new URLSearchParams();
  if (filter.status) sp.set('status', filter.status);
  if (filter.priority) sp.set('priority', filter.priority);
  if (filter.assigneeId) sp.set('assigneeId', filter.assigneeId);
  if (filter.type) sp.set('type', filter.type);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export function resolveAssigneeName(id: string | null, names: Map<string, string>): string {
  if (!id) return '—';
  return names.get(id) ?? '—';
}

const TRANSITIONS: Record<MaintenanceStatus, MaintenanceStatus[]> = {
  PLANNED: ['IN_PROGRESS', 'CANCELLED'],
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['ON_HOLD', 'DONE', 'CANCELLED'],
  ON_HOLD: ['IN_PROGRESS', 'CANCELLED'],
  DONE: [],
  CANCELLED: [],
};

export function nextStatusActions(status: MaintenanceStatus): MaintenanceStatus[] {
  return TRANSITIONS[status] ?? [];
}
```

- [ ] **Step 4: Run, confirm PASS** + tsc clean.
- [ ] **Step 5: Commit**
```bash
git add src/components/piling/maintenance/maintenance-helpers.ts src/components/piling/maintenance/__tests__/maintenance-helpers.test.ts
git commit -m "feat(maintenance): pure helpers for query, assignee, status transitions"
```

---

## Task 7: `work-order-form-dialog.tsx` (reusable create/edit)

**Files:**
- Read first (mirror): `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx` (its Dialog/form), and confirm the equipment-catalog list endpoint by reading `src/app/api/equipment/route.ts` (GET) — used only when no `equipmentId` prop is given.
- Create: `src/components/piling/maintenance/work-order-form-dialog.tsx`

**Interface (must match exactly — consumed by Tasks 9, 10, 11):**
```typescript
interface WorkOrderFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentId?: string;           // fixed when launched from an equipment context; omitted on the global board
  editingId?: string | null;      // when set, dialog loads/edits that record
  initial?: Partial<WorkOrderFormValues>;  // prefill for edit
  onSaved: () => void;            // caller refreshes its list after save
}
```

- [ ] **Step 1: Build the dialog** mirroring the existing maintenance dialog form (`equipment-maintenance.tsx` lines ~277-364), extended with:
  - `type` (TYPE_LABEL), `status` (STATUS_LABEL — all 6), `priority` (PRIORITY_LABEL) selects from `maintenance-labels`.
  - `assigneeId` select: fetch `GET /api/maintenance/assignees` on open, options = users `{id,name}` + a "— не назначен —" (empty) option.
  - When `equipmentId` prop is absent: a required equipment select, options from `GET /api/equipment` (read that route for the exact response shape; it backs `/admin/equipment`). When `equipmentId` present: no equipment select.
  - Text fields: `title*`, `faultCause`, `partsUsedText`, `description`; number fields `engineHoursAtService`, `laborHours`, `cost`; date fields `scheduledAt`, `completedAt`, `startedAt`.
  - Submit: POST `/api/equipment/${eqId}/maintenance` (create) or PUT `/api/equipment/${eqId}/maintenance/${editingId}` (edit). Payload maps empty strings → null exactly like the current form's `submit()` (lines 144-154), plus the new fields. `toast` success/error, then `onSaved()` + close.
  - Reuse `authFetch`, shadcn `Dialog/Input/Label/Textarea/Select/Button`, `Loader2`. Match Tailwind/orange-button styling of the existing form.

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx eslint src/components/piling/maintenance/work-order-form-dialog.tsx` no errors.
- [ ] **Step 3: Commit**
```bash
git add src/components/piling/maintenance/work-order-form-dialog.tsx
git commit -m "feat(maintenance): reusable work order create/edit dialog"
```

---

## Task 8: `work-order-photos.tsx`

**Files:**
- Read first (mirror almost verbatim): `src/components/piling/admin-equipment/detail/equipment-photos.tsx`.
- Create: `src/components/piling/maintenance/work-order-photos.tsx`

- [ ] **Step 1: Implement** a copy of `EquipmentPhotos` with these differences only:
  - Props: `{ recordId: string }`.
  - All `entityType='equipment'` / `entityId=equipmentId` → `entityType='maintenance'` / `entityId=recordId` (in the `/api/media` list fetch and the presign POST body).
  - Caption text adjusted (e.g. «Фото по наряду: до/после, дефекты»).
  - Everything else (presign→PUT→confirm, gallery, delete, 10 МБ limit) identical.

- [ ] **Step 2:** tsc clean; eslint no errors.
- [ ] **Step 3: Commit**
```bash
git add src/components/piling/maintenance/work-order-photos.tsx
git commit -m "feat(maintenance): work order photo gallery (entityType=maintenance)"
```

---

## Task 9: Board component + page (`/admin/maintenance`)

**Files:**
- Create: `src/components/piling/maintenance/maintenance-board.tsx`
- Create: `src/app/(app)/admin/maintenance/page.tsx`

- [ ] **Step 1: Board component.** Client component, self-fetch:
  - On mount and on filter change: `GET /api/maintenance${buildMaintenanceQuery(filter)}` → `{ records }`. `toast.error` on failure; loading/empty states like `EquipmentMaintenance`.
  - On mount: `GET /api/maintenance/assignees` → build `Map<id,name>` for `resolveAssigneeName` and for the assignee filter + (later) the dialog.
  - Filter bar: 4 shadcn Selects (status/priority/type from labels, assignee from users) each with an "Все" empty option; selecting updates `filter` state.
  - Rows: render each record as a `Link` to `/admin/maintenance/${r.id}` showing priority dot (`PRIORITY_STYLE`), title, `r.equipment?.name`, `STATUS_LABEL`/`STATUS_STYLE` badge, `resolveAssigneeName(r.assigneeId, names)`, scheduled/completed date. Match the list styling of `EquipmentMaintenance` rows.
  - Header: "Наряды ТО" + «Новый наряд» button → `WorkOrderFormDialog` (no `equipmentId` → equipment select shown); `onSaved` re-fetches the list.
  - Use the record shape returned by `/api/maintenance` (includes `equipment {id,name,model}` per `listAllMaintenance`). Define a local `WorkOrderRow` interface for the fields used.

- [ ] **Step 2: Page** `src/app/(app)/admin/maintenance/page.tsx` (mirror equipment page.tsx pattern):
```typescript
import { MaintenanceBoard } from '@/components/piling/maintenance/maintenance-board';
export default function MaintenancePage() {
  return <MaintenanceBoard />;
}
```
(Add `'use client'` only if the board is imported as client; the board itself is `'use client'`, so the page can stay a server component that renders it. Match how `admin/equipment/page.tsx` does it — read that file.)

- [ ] **Step 3:** tsc clean; eslint no errors on both files.
- [ ] **Step 4: Commit**
```bash
git add src/components/piling/maintenance/maintenance-board.tsx "src/app/(app)/admin/maintenance/page.tsx"
git commit -m "feat(maintenance): work order board page with filters"
```

---

## Task 10: Detail component + page (`/admin/maintenance/[id]`)

**Files:**
- Create: `src/components/piling/maintenance/work-order-detail.tsx`
- Create: `src/app/(app)/admin/maintenance/[id]/page.tsx`

- [ ] **Step 1: Detail component.** Props `{ recordId: string }`. Client component:
  - Fetch `GET /api/maintenance/${recordId}` → `{ record }`; also `GET /api/maintenance/assignees` for the name map and the assignee quick-edit. loading/error states.
  - Header: title, priority badge (`PRIORITY_STYLE`/`PRIORITY_LABEL`), `record.equipment.name` as a `Link` to `/admin/equipment/${record.equipmentId}`, `TYPE_LABEL[record.type]`.
  - Status block: current `STATUS_LABEL`; render a button per `nextStatusActions(record.status)` (label from `STATUS_LABEL`), each doing `PUT /api/equipment/${record.equipmentId}/maintenance/${recordId}` with `{ status }`, then re-fetch. `toast` on result.
  - Quick fields (inline edit → PUT same endpoint): `assigneeId` (select from assignees), `laborHours`, `cost`, `faultCause`, `partsUsedText`, `startedAt`, `engineHoursAtService`. Keep it simple: editable inputs with a «Сохранить» action that PUTs changed fields (you may PUT the whole editable set).
  - «Полное редактирование» button → `WorkOrderFormDialog` with `equipmentId={record.equipmentId}` and `editingId={recordId}`; `onSaved` re-fetches.
  - Photos: `<WorkOrderPhotos recordId={recordId} />`.
  - BackLink to `/admin/maintenance` (mirror the `BackLink` pattern in `equipment-detail.tsx`).
  - Use `formatRuDate`-style helpers (copy the small formatter, or import if one is shared — do not add a new shared util just for this).

- [ ] **Step 2: Page** `src/app/(app)/admin/maintenance/[id]/page.tsx` (mirror `admin/equipment/[id]/page.tsx` exactly):
```typescript
'use client';
import { use } from 'react';
import { WorkOrderDetail } from '@/components/piling/maintenance/work-order-detail';
export default function WorkOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <WorkOrderDetail recordId={id} />;
}
```

- [ ] **Step 3:** tsc clean; eslint no errors.
- [ ] **Step 4: Commit**
```bash
git add src/components/piling/maintenance/work-order-detail.tsx "src/app/(app)/admin/maintenance/[id]/page.tsx"
git commit -m "feat(maintenance): work order detail page with lifecycle, photos, edit"
```

---

## Task 11: Refactor `equipment-maintenance.tsx` onto shared parts

**Files:**
- Modify: `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx`

- [ ] **Step 1: Refactor (surgical):**
  - Remove the local `MaintenanceType`/`MaintenanceStatus` types and the local `TYPE_LABEL`/`STATUS_LABEL`/`STATUS_STYLE` maps; import them from `@/components/piling/maintenance/maintenance-labels`. This makes ASSIGNED/ON_HOLD render correctly.
  - Add a priority badge (`PRIORITY_LABEL`/`PRIORITY_STYLE`) and assignee name (fetch `/api/maintenance/assignees`, `resolveAssigneeName`) to each row's meta line.
  - Wrap each row's title in a `Link` to `/admin/maintenance/${r.id}`.
  - Replace the inline create/edit `Dialog` (lines ~277-364) and its `form`/`submit` plumbing with `<WorkOrderFormDialog equipmentId={equipmentId} editingId={editing?.id ?? null} ... onSaved={load} />`. Keep the existing quick status buttons (or switch them to use `nextStatusActions`). Remove now-unused state/helpers left orphaned by the dialog removal (only those YOUR change orphaned).

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx eslint` on the file no errors; run the equipment module tests to ensure nothing imports a removed symbol: `npx vitest run src/modules/equipment` (should still pass — this is a component, but confirms no broken type re-exports).
- [ ] **Step 3: Commit**
```bash
git add src/components/piling/admin-equipment/detail/equipment-maintenance.tsx
git commit -m "refactor(maintenance): equipment tab uses shared labels, dialog, links to work order page"
```

---

## Task 12: Navigation entry + final verification

**Files:**
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Add nav item** — in `roleNavigation`, add to BOTH the `ADMIN` and `DISPATCHER` arrays, right after the `{ label: 'Установки', href: '/admin/equipment' }` line:
```typescript
    { label: 'Обслуживание', href: '/admin/maintenance' },
```
(Add to both role arrays. Do not add to OPERATOR/ASSISTANT.)

- [ ] **Step 2: Full verification:**
  - `npx vitest run` → all pass.
  - `npx tsc --noEmit` → clean.
  - `npx eslint src/components/piling/maintenance src/app/api/maintenance "src/app/(app)/admin/maintenance"` → 0 errors.
- [ ] **Step 3: Manual smoke (dev server running):** open `/admin/maintenance` → filter → «Новый наряд» (pick equipment, save) → click row → change status → upload a photo → «Полное редактирование» → save. Confirm no console errors and the equipment tab still renders maintenance with correct status badges.
- [ ] **Step 4: Commit**
```bash
git add "src/app/(app)/layout.tsx"
git commit -m "feat(maintenance): add Обслуживание nav entry for admin and dispatcher"
```

---

## Self-Review (выполнено автором плана)

- **Покрытие спека:** §2 маршруты+нав → T9,T10,T12; §3.1 getMaintenanceById+route → T1,T2; §3.2 assignees → T3,T4; §4.1 labels → T5; §4.2 board → T9; §4.3 detail → T10; §4.4 form dialog → T7; §4.5 photos → T8; §5 рефактор вкладки → T11; §6 тесты → backend/logic в T1,T3,T5,T6, ручной прогон в T12. ✔
- **Плейсхолдеры:** backend и чистая логика (T1–T6, T12) — полный код/тесты/команды. UI-компоненты (T7–T11) задают точный интерфейс, контракты эндпоинтов и файл-образец для зеркалирования; вся тестируемая логика вынесена в T5/T6 — это осознанная граница (UI рисуется по образцу соседних компонентов, не выдумывается). Не плейсхолдеры, а делегирование идиоматичного JSX исполнителю с точным образцом.
- **Консистентность типов:** `MaintenanceStatus/Priority/Type` идут из `@/modules/equipment` через `maintenance-labels` (T5) и используются везде; `WorkOrderFormDialogProps` объявлен в T7 и потребляется T9/T10/T11 одинаково; `buildMaintenanceQuery/resolveAssigneeName/nextStatusActions` объявлены в T6 и используются в T9/T10; эндпоинты `/api/maintenance`, `/api/maintenance/[id]`, `/api/maintenance/assignees` согласованы между backend-задачами и потребителями.
- **Зависимости:** T1–T6 фундамент; T7 зависит от T3/T5; T8 самостоятелен; T9 от T5/T6/T7; T10 от T1/T5/T6/T7/T8; T11 от T5/T6/T7; T12 финал. Порядок исполнения = номера задач.
