# Справочники registry (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the dictionaries module into an admin registry with usage-aware archive/delete, restore and rename.

**Architecture:** Extend `dictionary-service` with batch usage counts + archive/restore/rename/guarded-delete. Add `GET` (admin feed) and `PATCH` verbs to the `dictionary/manage` route; change `DELETE` to a guarded hard delete. Rebuild `admin-dictionaries.tsx` as a tabbed table (search, status filter, per-row actions). Operator hot path `GET /api/dictionary/all` is untouched.

**Tech Stack:** Next.js 16 route handlers (`withApi`/`withMutation`), Prisma (`groupBy`/`distinct`/`count`), Vitest, React + shadcn `Tabs`/`Dialog`/`Select`.

---

## File Structure

- `src/services/dictionaries/dictionary-service.ts` — add usage + archive/restore/rename/guarded-delete + `listDictionaries`.
- `src/app/api/dictionary/manage/route.ts` — add `GET` feed + `PATCH`; change `DELETE` to guarded hard delete.
- `src/components/piling/admin-dictionaries.tsx` — full rebuild (tabs/table/filter/search/actions).
- Tests: `src/services/dictionaries/__tests__/dictionary-service.test.ts`, `src/app/api/dictionary/manage/__tests__/route.test.ts`.

Shared types (define in `dictionary-service.ts`, import where needed):

```ts
export type DictType = 'pileGrade' | 'drillingType' | 'downtimeReason';
export interface UsageCount { reportCount: number; planCount: number }
export type UsageMap = Record<string, UsageCount>;
export interface DictionaryUsage { pileGrade: UsageMap; drillingType: UsageMap; downtimeReason: UsageMap }
```

The three line-tables and their FK column to a dictionary id:
- `pileGrade` → `pileWork.pileGradeId` (reports) + `sitePilePlan.pileGradeId` (plans)
- `drillingType` → `leaderDrilling.typeId`
- `downtimeReason` → `reportDowntime.reasonId`

---

## Task 1: Per-item usage helper + guarded delete service

**Files:**
- Modify: `src/services/dictionaries/dictionary-service.ts`
- Test: `src/services/dictionaries/__tests__/dictionary-service.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    pileWork: { findMany: vi.fn(), groupBy: vi.fn() },
    leaderDrilling: { findMany: vi.fn(), groupBy: vi.fn() },
    reportDowntime: { findMany: vi.fn(), groupBy: vi.fn() },
    sitePilePlan: { count: vi.fn(), groupBy: vi.fn() },
    pileGrade: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    drillingType: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
    downtimeReason: { findUnique: vi.fn(), update: vi.fn(), delete: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('@/lib/db', () => ({ db: dbMock }));

import { deleteDictionaryItem } from '../dictionary-service';

describe('deleteDictionaryItem (guarded hard delete)', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('throws 409 when the pile grade is used in reports', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([{ reportId: 'r1' }, { reportId: 'r2' }]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);

    await expect(deleteDictionaryItem('pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('throws 409 when the pile grade is used only in site plans', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(3);

    await expect(deleteDictionaryItem('pileGrade', 'g1')).rejects.toMatchObject({ status: 409 });
    expect(dbMock.pileGrade.delete).not.toHaveBeenCalled();
  });

  it('hard-deletes an unused item', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileWork.findMany.mockResolvedValue([]);
    dbMock.sitePilePlan.count.mockResolvedValue(0);
    dbMock.pileGrade.delete.mockResolvedValue({ id: 'g1' });

    await expect(deleteDictionaryItem('pileGrade', 'g1')).resolves.toEqual({ success: true });
    expect(dbMock.pileGrade.delete).toHaveBeenCalledWith({ where: { id: 'g1' } });
  });

  it('throws 404 when the item does not exist', async () => {
    dbMock.drillingType.findUnique.mockResolvedValue(null);
    await expect(deleteDictionaryItem('drillingType', 'x')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`
Expected: FAIL — `deleteDictionaryItem` currently soft-deletes (no 409 path, no `.delete`).

- [ ] **Step 3: Implement the per-item usage helper + guarded delete**

Add to `dictionary-service.ts` (replace the existing `deleteDictionaryItem`):

```ts
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';

export type DictType = 'pileGrade' | 'drillingType' | 'downtimeReason';
export interface UsageCount { reportCount: number; planCount: number }

const MODEL = {
  pileGrade: db.pileGrade,
  drillingType: db.drillingType,
  downtimeReason: db.downtimeReason,
} as const;

export async function getItemUsage(type: DictType, id: string): Promise<UsageCount> {
  if (type === 'pileGrade') {
    const [reports, planCount] = await Promise.all([
      db.pileWork.findMany({ where: { pileGradeId: id }, select: { reportId: true }, distinct: ['reportId'] }),
      db.sitePilePlan.count({ where: { pileGradeId: id } }),
    ]);
    return { reportCount: reports.length, planCount };
  }
  if (type === 'drillingType') {
    const reports = await db.leaderDrilling.findMany({ where: { typeId: id }, select: { reportId: true }, distinct: ['reportId'] });
    return { reportCount: reports.length, planCount: 0 };
  }
  const reports = await db.reportDowntime.findMany({ where: { reasonId: id }, select: { reportId: true }, distinct: ['reportId'] });
  return { reportCount: reports.length, planCount: 0 };
}

export async function deleteDictionaryItem(type: DictType, id: string) {
  if (!type || !id) throw new ServiceError('type and id required', 400);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);

  const item = await model.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);

  const usage = await getItemUsage(type, id);
  if (usage.reportCount > 0 || usage.planCount > 0) {
    throw new ServiceError('Элемент используется и не может быть удалён', 409);
  }

  await model.delete({ where: { id } });
  return { success: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/dictionaries/dictionary-service.ts src/services/dictionaries/__tests__/dictionary-service.test.ts
git commit -m "feat(dictionaries): guarded hard delete + per-item usage helper"
```

---

## Task 2: Archive / restore / rename service functions

**Files:**
- Modify: `src/services/dictionaries/dictionary-service.ts`
- Test: `src/services/dictionaries/__tests__/dictionary-service.test.ts`

- [ ] **Step 1: Add failing tests**

Append to the test file:

```ts
import { archiveDictionaryItem, restoreDictionaryItem, renameDictionaryItem } from '../dictionary-service';

describe('archive/restore/rename', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('archive sets isActive false', async () => {
    dbMock.pileGrade.findUnique.mockResolvedValue({ id: 'g1', isActive: true });
    dbMock.pileGrade.update.mockResolvedValue({ id: 'g1', isActive: false });
    await archiveDictionaryItem('pileGrade', 'g1');
    expect(dbMock.pileGrade.update).toHaveBeenCalledWith({ where: { id: 'g1' }, data: { isActive: false } });
  });

  it('restore sets isActive true', async () => {
    dbMock.downtimeReason.findUnique.mockResolvedValue({ id: 'd1', isActive: false });
    dbMock.downtimeReason.update.mockResolvedValue({ id: 'd1', isActive: true });
    await restoreDictionaryItem('downtimeReason', 'd1');
    expect(dbMock.downtimeReason.update).toHaveBeenCalledWith({ where: { id: 'd1' }, data: { isActive: true } });
  });

  it('rename trims and updates the name', async () => {
    dbMock.drillingType.findUnique.mockResolvedValue({ id: 't1', name: 'old' });
    dbMock.drillingType.update.mockResolvedValue({ id: 't1', name: 'new' });
    await renameDictionaryItem('drillingType', 't1', '  new  ');
    expect(dbMock.drillingType.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { name: 'new' } });
  });

  it('rename rejects an empty name', async () => {
    await expect(renameDictionaryItem('drillingType', 't1', '   ')).rejects.toMatchObject({ status: 400 });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Add to `dictionary-service.ts`:

```ts
async function setActive(type: DictType, id: string, isActive: boolean) {
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);
  const item = await model.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  return model.update({ where: { id }, data: { isActive } });
}

export function archiveDictionaryItem(type: DictType, id: string) { return setActive(type, id, false); }
export function restoreDictionaryItem(type: DictType, id: string) { return setActive(type, id, true); }

export async function renameDictionaryItem(type: DictType, id: string, name: string) {
  const trimmed = name?.trim();
  if (!trimmed) throw new ServiceError('Название обязательно', 400);
  if (trimmed.length > 100) throw new ServiceError('Название слишком длинное', 400);
  const model = MODEL[type];
  if (!model) throw new ServiceError('Invalid type', 400);
  const item = await model.findUnique({ where: { id } });
  if (!item) throw new ServiceError('Элемент не найден', 404);
  return model.update({ where: { id }, data: { name: trimmed } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/dictionaries/
git commit -m "feat(dictionaries): archive/restore/rename service functions"
```

---

## Task 3: Registry feed — `listDictionaries` + `getDictionaryUsage`

**Files:**
- Modify: `src/services/dictionaries/dictionary-service.ts`
- Test: `src/services/dictionaries/__tests__/dictionary-service.test.ts`

- [ ] **Step 1: Add failing tests**

```ts
import { getDictionaryUsage, listDictionaries } from '../dictionary-service';

describe('getDictionaryUsage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('counts distinct reports per item and plan counts for pile grades', async () => {
    // groupBy by [fk, reportId] → one row per distinct (item, report) pair
    dbMock.pileWork.groupBy.mockResolvedValue([
      { pileGradeId: 'g1', reportId: 'r1' }, { pileGradeId: 'g1', reportId: 'r2' }, { pileGradeId: 'g2', reportId: 'r1' },
    ]);
    dbMock.leaderDrilling.groupBy.mockResolvedValue([{ typeId: 't1', reportId: 'r1' }]);
    dbMock.reportDowntime.groupBy.mockResolvedValue([]);
    dbMock.sitePilePlan.groupBy.mockResolvedValue([{ pileGradeId: 'g3', _count: { _all: 4 } }]);

    const usage = await getDictionaryUsage();
    expect(usage.pileGrade.g1).toEqual({ reportCount: 2, planCount: 0 });
    expect(usage.pileGrade.g2).toEqual({ reportCount: 1, planCount: 0 });
    expect(usage.pileGrade.g3).toEqual({ reportCount: 0, planCount: 4 });
    expect(usage.drillingType.t1).toEqual({ reportCount: 1, planCount: 0 });
  });
});

describe('listDictionaries', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('filters by archived', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    await listDictionaries('archived');
    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { isActive: false } }));
  });

  it('does not filter for "all"', async () => {
    dbMock.pileGrade.findMany.mockResolvedValue([]);
    dbMock.drillingType.findMany.mockResolvedValue([]);
    dbMock.downtimeReason.findMany.mockResolvedValue([]);
    await listDictionaries('all');
    expect(dbMock.pileGrade.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement**

Add to `dictionary-service.ts`:

```ts
export type DictFilter = 'active' | 'archived' | 'all';
export type UsageMap = Record<string, UsageCount>;
export interface DictionaryUsage { pileGrade: UsageMap; drillingType: UsageMap; downtimeReason: UsageMap }

function countDistinctReports(rows: Array<Record<string, string>>, fk: string): UsageMap {
  const m: UsageMap = {};
  for (const r of rows) {
    const id = r[fk];
    if (!m[id]) m[id] = { reportCount: 0, planCount: 0 };
    m[id].reportCount += 1;
  }
  return m;
}

export async function getDictionaryUsage(): Promise<DictionaryUsage> {
  const [pileRows, drillRows, downtimeRows, planRows] = await Promise.all([
    db.pileWork.groupBy({ by: ['pileGradeId', 'reportId'] }),
    db.leaderDrilling.groupBy({ by: ['typeId', 'reportId'] }),
    db.reportDowntime.groupBy({ by: ['reasonId', 'reportId'] }),
    db.sitePilePlan.groupBy({ by: ['pileGradeId'], _count: { _all: true } }),
  ]);

  const pileGrade = countDistinctReports(pileRows as Array<Record<string, string>>, 'pileGradeId');
  for (const p of planRows as Array<{ pileGradeId: string; _count: { _all: number } }>) {
    if (!pileGrade[p.pileGradeId]) pileGrade[p.pileGradeId] = { reportCount: 0, planCount: 0 };
    pileGrade[p.pileGradeId].planCount = p._count._all;
  }

  return {
    pileGrade,
    drillingType: countDistinctReports(drillRows as Array<Record<string, string>>, 'typeId'),
    downtimeReason: countDistinctReports(downtimeRows as Array<Record<string, string>>, 'reasonId'),
  };
}

export async function listDictionaries(filter: DictFilter) {
  const where = filter === 'all' ? {} : { isActive: filter === 'active' };
  const opts = { where, orderBy: { name: 'asc' as const } };
  const [pileGrades, drillingTypes, downtimeReasons] = await Promise.all([
    db.pileGrade.findMany(opts),
    db.drillingType.findMany(opts),
    db.downtimeReason.findMany(opts),
  ]);
  return { pileGrades, drillingTypes, downtimeReasons };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/dictionaries/
git commit -m "feat(dictionaries): registry feed (listDictionaries + getDictionaryUsage)"
```

---

## Task 4: Route — GET feed + PATCH + guarded DELETE

**Files:**
- Modify: `src/app/api/dictionary/manage/route.ts`
- Test: `src/app/api/dictionary/manage/__tests__/route.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, svc } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  svc: {
    listDictionaries: vi.fn(),
    getDictionaryUsage: vi.fn(),
    createDictionaryItem: vi.fn(),
    archiveDictionaryItem: vi.fn(),
    restoreDictionaryItem: vi.fn(),
    renameDictionaryItem: vi.fn(),
    deleteDictionaryItem: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/lib/csrf-protection', () => ({ withCsrf: () => null }));
vi.mock('@/services/dictionaries/dictionary-service', () => svc);

import { GET, PATCH, DELETE } from '../route';

const admin = { user: { id: 'a', role: 'ADMIN' }, error: null };
function req(method: string, body?: unknown, qs = ''): NextRequest {
  return new NextRequest(`http://localhost/api/dictionary/manage${qs}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('dictionary/manage route', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('GET returns 403 for non-admin', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'o', role: 'OPERATOR' }, error: null });
    expect((await GET(req('GET', undefined, '?filter=all'))).status).toBe(403);
  });

  it('GET returns items merged with usage counts', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.listDictionaries.mockResolvedValue({
      pileGrades: [{ id: 'g1', name: 'С120', isActive: true, updatedAt: '2026-05-01' }],
      drillingTypes: [], downtimeReasons: [],
    });
    svc.getDictionaryUsage.mockResolvedValue({
      pileGrade: { g1: { reportCount: 42, planCount: 0 } }, drillingType: {}, downtimeReason: {},
    });
    const res = await GET(req('GET', undefined, '?filter=active'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pileGrades[0]).toMatchObject({ id: 'g1', reportCount: 42, planCount: 0 });
    expect(svc.listDictionaries).toHaveBeenCalledWith('active');
  });

  it('PATCH renames when name is present', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.renameDictionaryItem.mockResolvedValue({ id: 'g1', name: 'X' });
    const res = await PATCH(req('PATCH', { type: 'pileGrade', id: 'g1', name: 'X' }));
    expect(res.status).toBe(200);
    expect(svc.renameDictionaryItem).toHaveBeenCalledWith('pileGrade', 'g1', 'X');
  });

  it('PATCH archives when isActive=false', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.archiveDictionaryItem.mockResolvedValue({ id: 'g1' });
    await PATCH(req('PATCH', { type: 'pileGrade', id: 'g1', isActive: false }));
    expect(svc.archiveDictionaryItem).toHaveBeenCalledWith('pileGrade', 'g1');
  });

  it('PATCH returns 400 with neither name nor isActive', async () => {
    requireAuthMock.mockResolvedValue(admin);
    expect((await PATCH(req('PATCH', { type: 'pileGrade', id: 'g1' }))).status).toBe(400);
  });

  it('DELETE maps the service 409 to HTTP 409', async () => {
    requireAuthMock.mockResolvedValue(admin);
    const { ServiceError } = await import('@/services/service-error');
    svc.deleteDictionaryItem.mockRejectedValue(new ServiceError('используется', 409));
    expect((await DELETE(req('DELETE', { type: 'pileGrade', id: 'g1' }))).status).toBe(409);
  });

  it('DELETE returns 200 when unused', async () => {
    requireAuthMock.mockResolvedValue(admin);
    svc.deleteDictionaryItem.mockResolvedValue({ success: true });
    expect((await DELETE(req('DELETE', { type: 'pileGrade', id: 'g1' }))).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/dictionary/manage/__tests__/route.test.ts`
Expected: FAIL — `GET`/`PATCH` not exported; `DELETE` still soft-deletes.

- [ ] **Step 3: Implement the route**

Replace `src/app/api/dictionary/manage/route.ts` with:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createDictionaryItem, deleteDictionaryItem, archiveDictionaryItem,
  restoreDictionaryItem, renameDictionaryItem, listDictionaries, getDictionaryUsage,
  type DictFilter, type UsageMap,
} from '@/services/dictionaries/dictionary-service';
import { withApi, withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

const typeEnum = z.enum(['pileGrade', 'drillingType', 'downtimeReason']);
const createSchema = z.object({ type: typeEnum, name: z.string().min(1).max(100) });
const deleteSchema = z.object({ type: typeEnum, id: z.string().min(1) });
const patchSchema = z.object({
  type: typeEnum, id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  isActive: z.boolean().optional(),
}).refine((v) => v.name !== undefined || v.isActive !== undefined, { message: 'name or isActive required' });

function withUsage<T extends { id: string }>(items: T[], usage: UsageMap) {
  return items.map((it) => ({ ...it, reportCount: usage[it.id]?.reportCount ?? 0, planCount: usage[it.id]?.planCount ?? 0 }));
}

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'dictionary.manage');

  const filterParam = request.nextUrl.searchParams.get('filter');
  const filter: DictFilter = filterParam === 'archived' || filterParam === 'all' ? filterParam : 'active';

  const [{ pileGrades, drillingTypes, downtimeReasons }, usage] = await Promise.all([
    listDictionaries(filter),
    getDictionaryUsage(),
  ]);

  return NextResponse.json({
    pileGrades: withUsage(pileGrades, usage.pileGrade),
    drillingTypes: withUsage(drillingTypes, usage.drillingType),
    downtimeReasons: withUsage(downtimeReasons, usage.downtimeReason),
  });
}, { domain: 'dictionary' });

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'dictionary.manage');
  const validated = createSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });
  const item = await createDictionaryItem(validated.data.type, validated.data.name);
  return NextResponse.json({ item });
}, { domain: 'dictionary' });

export const PATCH = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'dictionary.manage');
  const validated = patchSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });

  const { type, id, name, isActive } = validated.data;
  if (name !== undefined) await renameDictionaryItem(type, id, name);
  if (isActive === true) await restoreDictionaryItem(type, id);
  if (isActive === false) await archiveDictionaryItem(type, id);
  return NextResponse.json({ success: true });
}, { domain: 'dictionary' });

export const DELETE = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'dictionary.manage');
  const validated = deleteSchema.safeParse(await request.json());
  if (!validated.success) return NextResponse.json({ error: 'Validation error', details: validated.error.flatten() }, { status: 400 });
  const result = await deleteDictionaryItem(validated.data.type, validated.data.id);
  return NextResponse.json(result);
}, { domain: 'dictionary' });
```

(`ServiceError` thrown by the service is mapped to its HTTP status by `withApi`/`withMutation` automatically — no try/catch needed.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/dictionary/manage/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/dictionary/manage/
git commit -m "feat(dictionaries): GET feed + PATCH (rename/archive/restore) + guarded DELETE route"
```

---

## Task 5: Frontend rebuild — admin registry

**Files:**
- Modify (full rewrite): `src/components/piling/admin-dictionaries.tsx`
- Reference: `src/components/ui/tabs.tsx` (Tabs/TabsList/TabsTrigger/TabsContent), `dialog.tsx`, `badge.tsx`. The status filter uses a native `<select>` (styled inline) — no `Select` primitive needed.

- [ ] **Step 1: Confirm UI primitives exist + their exports**

Run: `ls src/components/ui/tabs.tsx src/components/ui/dialog.tsx src/components/ui/badge.tsx`
Then check `tabs.tsx` exports `Tabs, TabsList, TabsTrigger, TabsContent` (shadcn default). The status filter uses a native `<select>` — no `Select` primitive required.

- [ ] **Step 2: Rewrite the component**

Replace the entire `src/components/piling/admin-dictionaries.tsx` with:

```tsx
'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Clock, Drill, HardHat, Loader2, Pencil, Plus, RotateCcw, Settings, Trash2, Archive, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type DictionaryKind = 'pileGrade' | 'drillingType' | 'downtimeReason';
type StatusFilter = 'active' | 'archived' | 'all';

interface RegistryItem {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  reportCount: number;
  planCount: number;
}

interface FormState { mode: 'create' | 'rename'; kind: DictionaryKind; id?: string; value: string }

const KINDS: Array<{ kind: DictionaryKind; title: string; icon: typeof HardHat; placeholder: string }> = [
  { kind: 'pileGrade', title: 'Сваи', icon: HardHat, placeholder: 'Новая марка, например С120-30' },
  { kind: 'drillingType', title: 'Бурение', icon: Drill, placeholder: 'Новый тип, например d=620 мм' },
  { kind: 'downtimeReason', title: 'Простои', icon: Clock, placeholder: 'Новая причина, например Поломка копра' },
];

function usageLabel(it: RegistryItem): { text: string; used: boolean } {
  if (it.reportCount > 0) return { text: `${it.reportCount} отч.`, used: true };
  if (it.planCount > 0) return { text: `${it.planCount} план.`, used: true };
  return { text: '—', used: false };
}

export function AdminDictionaries() {
  const [data, setData] = useState<Record<DictionaryKind, RegistryItem[]>>({ pileGrade: [], drillingType: [], downtimeReason: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: DictionaryKind; item: RegistryItem } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/dictionary/manage?filter=${filter}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData({ pileGrade: d.pileGrades || [], drillingType: d.drillingTypes || [], downtimeReason: d.downtimeReasons || [] });
    } catch {
      toast.error('Ошибка загрузки справочников');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void loadData(); }, [loadData]);

  const filtered = useCallback((kind: DictionaryKind) => {
    const q = search.trim().toLowerCase();
    return data[kind].filter((it) => !q || it.name.toLowerCase().includes(q));
  }, [data, search]);

  const submitForm = async () => {
    if (!form || !form.value.trim()) { toast.error('Введите название'); return; }
    setSaving(true);
    try {
      if (form.mode === 'create') {
        const res = await authFetch('/api/dictionary/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: form.kind, name: form.value.trim() }) });
        if (!res.ok) throw new Error();
        toast.success('Элемент добавлен');
      } else {
        const res = await authFetch('/api/dictionary/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: form.kind, id: form.id, name: form.value.trim() }) });
        if (!res.ok) throw new Error();
        toast.success('Переименовано');
      }
      setForm(null);
      await loadData();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (kind: DictionaryKind, item: RegistryItem, isActive: boolean) => {
    try {
      const res = await authFetch('/api/dictionary/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: kind, id: item.id, isActive }) });
      if (!res.ok) throw new Error();
      toast.success(isActive ? 'Восстановлено' : 'Архивировано');
      await loadData();
    } catch {
      toast.error('Не удалось изменить статус');
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await authFetch('/api/dictionary/manage', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: confirmDelete.kind, id: confirmDelete.item.id }) });
      if (res.status === 409) { toast.error('Элемент используется — удаление недоступно'); setConfirmDelete(null); return; }
      if (!res.ok) throw new Error();
      toast.success('Элемент удалён');
      setConfirmDelete(null);
      await loadData();
    } catch {
      toast.error('Не удалось удалить');
    }
  };

  if (loading) {
    return <div className="space-y-4 p-4 lg:p-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Settings className="h-5 w-5 text-orange-500" />Справочники</h1>
        <p className="mt-1 text-sm text-slate-500">Реестр марок свай, типов бурения и причин простоя</p>
      </div>

      <Tabs defaultValue="pileGrade">
        <TabsList>
          {KINDS.map(({ kind, title, icon: Icon }) => (
            <TabsTrigger key={kind} value={kind}><Icon className="mr-1.5 h-4 w-4" />{title}</TabsTrigger>
          ))}
        </TabsList>

        <div className="my-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию" className="pl-8" />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm">
            <option value="active">Активные</option>
            <option value="archived">Архив</option>
            <option value="all">Все</option>
          </select>
        </div>

        {KINDS.map(({ kind, title, placeholder }) => (
          <TabsContent key={kind} value={kind}>
            <div className="mb-2 flex justify-end">
              <Button size="sm" className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => setForm({ mode: 'create', kind, value: '' })}>
                <Plus className="mr-1 h-4 w-4" />Добавить
              </Button>
            </div>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="p-2.5 font-medium">Название</th>
                      <th className="p-2.5 font-medium">Статус</th>
                      <th className="p-2.5 font-medium">Используется</th>
                      <th className="p-2.5 font-medium">Обновлено</th>
                      <th className="p-2.5 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered(kind).length === 0 ? (
                      <tr><td colSpan={5} className="py-6 text-center text-xs text-slate-400">{title}: ничего не найдено</td></tr>
                    ) : filtered(kind).map((item) => {
                      const usage = usageLabel(item);
                      return (
                        <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className={`p-2.5 font-medium ${item.isActive ? 'text-slate-800' : 'text-slate-400'}`}>{item.name}</td>
                          <td className="p-2.5">
                            <Badge variant={item.isActive ? 'default' : 'secondary'} className="text-3xs">{item.isActive ? 'Активен' : 'Архив'}</Badge>
                          </td>
                          <td className={`p-2.5 ${usage.used ? 'text-blue-600' : 'text-slate-300'}`}>{usage.text}</td>
                          <td className="p-2.5 text-slate-500">{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
                          <td className="p-2.5">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => setForm({ mode: 'rename', kind, id: item.id, value: item.name })} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Переименовать"><Pencil className="h-3.5 w-3.5" /></button>
                              {item.isActive ? (
                                <button onClick={() => setStatus(kind, item, false)} className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100" title="Архивировать"><Archive className="h-3.5 w-3.5" />Архив</button>
                              ) : (
                                <button onClick={() => setStatus(kind, item, true)} className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100" title="Восстановить"><RotateCcw className="h-3.5 w-3.5" />Вернуть</button>
                              )}
                              <button
                                onClick={() => setConfirmDelete({ kind, item })}
                                disabled={usage.used}
                                title={usage.used ? `Используется (${usage.text}) — удаление недоступно` : 'Удалить навсегда'}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 enabled:hover:bg-red-100 enabled:hover:text-red-500 disabled:opacity-40"
                              ><Trash2 className="h-3.5 w-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.mode === 'create' ? 'Добавить элемент' : 'Переименовать'}</DialogTitle></DialogHeader>
          <Input value={form?.value || ''} onChange={(e) => setForm((f) => f && { ...f, value: e.target.value })} placeholder={KINDS.find((k) => k.kind === form?.kind)?.placeholder} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void submitForm(); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Отмена</Button>
            <Button onClick={submitForm} disabled={saving || !form?.value.trim()} className="bg-orange-500 text-white hover:bg-orange-600">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Удалить навсегда?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Элемент «{confirmDelete?.item.name}» будет удалён без возможности восстановления.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Отмена</Button>
            <Button onClick={doDelete} className="bg-red-500 text-white hover:bg-red-600">Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit`
Expected: exit 0. (If `Badge` has no `default` variant, use `variant={item.isActive ? undefined : 'secondary'}`; if `Tabs` exports differ, adjust the import to match `src/components/ui/tabs.tsx`.)

- [ ] **Step 4: Manual verification**

Run the app (`npm run dev`), open `/admin/dictionaries`:
- Tabs switch between Сваи/Бурение/Простои.
- Search filters by name; filter dropdown reloads Активные/Архив/Все.
- An item with reports shows a blue count and a disabled trash (tooltip explains).
- Archive → item leaves the active list; switch filter to Архив → it appears with "Вернуть".
- An unused item: trash → confirm dialog → deletes.
- Pencil → rename dialog → name updates.

- [ ] **Step 5: Commit**

```bash
git add src/components/piling/admin-dictionaries.tsx
git commit -m "feat(dictionaries): rebuild admin UI as tabbed usage-aware registry"
```

---

## Task 6: Full regression gate

- [ ] **Step 1: Run the whole suite + lint + typecheck**

Run: `npm run test:unit && npx tsc --noEmit && npm run lint`
Expected: all green (new service + route tests included), lint exit 0.

- [ ] **Step 2: Commit any fixups**

```bash
git add -A
git commit -m "test(dictionaries): registry phase 1 green (suite + lint + typecheck)"
```

---

## Notes for the implementer

- `withApi`/`withMutation` map a thrown `ServiceError` to its HTTP status automatically — never add try/catch in the route for the 409/404 paths.
- The operator hot path `GET /api/dictionary/all` (`listActiveDictionaries`) MUST stay untouched — do not add usage counts there.
- `distinct: ['reportId']` in Prisma `findMany` returns one row per distinct reportId; `.length` is the distinct report count.
- Phase 2 (where-used drawer) is out of scope — do not add it.
