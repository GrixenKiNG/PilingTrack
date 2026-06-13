# Reports evidence-base (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the report evidence pane's hardcoded "change history" with the real `ReportAudit`/`ReportVersion` provenance, rendered as a timeline with human-readable diffs, plus a status badge and a real photo count.

**Architecture:** A new server service resolves a report's audit trail and *humanizes* each diff server-side (where the DB and dictionaries live) into `{ label, before, after }` rows — this is the centerpiece, since the raw `computeDiff` output (`{ field: { old, new } }` with cuid ids) is unreadable. A thin `GET /api/reports/[id]/history` endpoint exposes it; a hook fetches it; the existing `ReportEvidencePreview` renders it (replacing the fabricated `auditItems`, which currently misrepresents provenance).

**Tech Stack:** Next.js 16 route handler (`withApi`), Prisma, Vitest, React.

---

## Key facts (verified against the code)

- `ReportAudit.diff` is produced by `computeDiff` and is a **flat** map `{ field: { old, new } }` (NOT `{added,removed,changed}` — the schema comment is stale).
- `ReportAudit.reportId` and `ReportVersion.reportId` both key on the **business `reportId`** (`input.reportId`/`state.reportId`), which the frontend has as `report.reportId`.
- Diff fields include domain arrays `piles: [{ pileGradeId, count }]`, `drillings: [{ typeId, count, meters }]`, `downtimes: [{ reasonId, duration }]`, plus scalars `status`, `shiftStart`, `shiftEnd`, `date`, `siteId`, `equipmentId`, `userId`, and noise (`version`, `updatedAt`, `createdAt`, `vectorClock`, `lastEditedById/Name/Role`, `id`, `reportId`).
- Dynamic route params are async: `(request, { params }: { params: Promise<{ id: string }> })`, `const { id } = await params`.
- `assertCan(user, 'reports.read_all')` → ADMIN/DISPATCHER; throwing `ServiceError` is mapped to HTTP by `withApi`.

## File Structure

- Create `src/services/reports/report-history-service.ts` — `getReportHistory`, `actionLabel`, `statusLabel`, `humanizeDiff`, exported types.
- Create `src/app/api/reports/[id]/history/route.ts` — GET handler.
- Create `src/components/piling/admin-reports/use-report-history.ts` — fetch hook.
- Modify `src/components/piling/admin-reports/admin-reports.tsx` — wire real history into `ReportEvidencePreview`, add status badge, real photo count.
- Tests: `src/services/reports/__tests__/report-history-service.test.ts`, `src/app/api/reports/[id]/history/__tests__/route.test.ts`.

Shared types (in `report-history-service.ts`):

```ts
export interface HistoryChange { label: string; before: string; after: string }
export interface ReportHistoryEvent {
  id: string;
  action: string;
  actionLabel: string;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  changes: HistoryChange[];
}
export interface ReportHistoryVersion { version: number; actorId: string; createdAt: string }
export interface ReportHistory { events: ReportHistoryEvent[]; versions: ReportHistoryVersion[] }
```

---

## Task 1: Label mappers + humanizeDiff (the centerpiece)

**Files:**
- Create: `src/services/reports/report-history-service.ts`
- Test: `src/services/reports/__tests__/report-history-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { actionLabel, statusLabel, humanizeDiff, type NameLookups } from '../report-history-service';

const lookups: NameLookups = {
  pileGrade: { g1: 'С120-30', g2: 'С100-25' },
  drillingType: { t1: 'd=620 мм' },
  downtimeReason: { r1: 'Поломка копра' },
  site: { s1: 'Объект А', s2: 'Объект Б' },
  user: { u1: 'Иванов', u2: 'Петров' },
  equipment: { e1: 'Установка-1' },
};

describe('actionLabel / statusLabel', () => {
  it('maps known actions and falls back to raw', () => {
    expect(actionLabel('created')).toBe('Создан');
    expect(actionLabel('updated')).toBe('Изменён');
    expect(actionLabel('submitted')).toBe('Отправлен');
    expect(actionLabel('deleted')).toBe('Удалён');
    expect(actionLabel('weird')).toBe('weird');
  });
  it('maps statuses and falls back to raw', () => {
    expect(statusLabel('draft')).toBe('Черновик');
    expect(statusLabel('submitted')).toBe('Отправлен');
    expect(statusLabel('mystery')).toBe('mystery');
  });
});

describe('humanizeDiff', () => {
  it('renders pile changes by grade name and count', () => {
    const diff = { piles: { old: [{ pileGradeId: 'g1', count: 5 }], new: [{ pileGradeId: 'g1', count: 10 }, { pileGradeId: 'g2', count: 2 }] } };
    const changes = humanizeDiff(diff, lookups);
    expect(changes).toEqual([
      { label: 'Сваи', before: 'С120-30: 5 шт', after: 'С120-30: 10 шт; С100-25: 2 шт' },
    ]);
  });

  it('renders status via statusLabel', () => {
    const changes = humanizeDiff({ status: { old: 'draft', new: 'submitted' } }, lookups);
    expect(changes).toEqual([{ label: 'Статус', before: 'Черновик', after: 'Отправлен' }]);
  });

  it('resolves site changes by name', () => {
    const changes = humanizeDiff({ siteId: { old: 's1', new: 's2' } }, lookups);
    expect(changes).toEqual([{ label: 'Объект', before: 'Объект А', after: 'Объект Б' }]);
  });

  it('skips noise fields (version, updatedAt, lastEditedBy*)', () => {
    const diff = {
      version: { old: 1, new: 2 },
      updatedAt: { old: 'x', new: 'y' },
      lastEditedByName: { old: null, new: 'Иванов' },
    };
    expect(humanizeDiff(diff, lookups)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/reports/__tests__/report-history-service.test.ts`
Expected: FAIL — module/exports do not exist.

- [ ] **Step 3: Implement the mappers + humanizeDiff**

Create `src/services/reports/report-history-service.ts`:

```ts
import { db } from '@/lib/db';

export interface HistoryChange { label: string; before: string; after: string }
export interface ReportHistoryEvent {
  id: string;
  action: string;
  actionLabel: string;
  actorName: string | null;
  actorRole: string | null;
  createdAt: string;
  changes: HistoryChange[];
}
export interface ReportHistoryVersion { version: number; actorId: string; createdAt: string }
export interface ReportHistory { events: ReportHistoryEvent[]; versions: ReportHistoryVersion[] }

export interface NameLookups {
  pileGrade: Record<string, string>;
  drillingType: Record<string, string>;
  downtimeReason: Record<string, string>;
  site: Record<string, string>;
  user: Record<string, string>;
  equipment: Record<string, string>;
}

const ACTION_LABELS: Record<string, string> = {
  created: 'Создан', updated: 'Изменён', submitted: 'Отправлен', deleted: 'Удалён',
};
export function actionLabel(action: string): string { return ACTION_LABELS[action] ?? action; }

const STATUS_LABELS: Record<string, string> = { draft: 'Черновик', submitted: 'Отправлен' };
export function statusLabel(status: string): string { return STATUS_LABELS[status] ?? status; }

// Fields that change on every save but carry no evidentiary meaning.
const NOISE = new Set(['version', 'updatedAt', 'createdAt', 'vectorClock', 'lastEditedById', 'lastEditedByName', 'lastEditedByRole', 'id', 'reportId']);

function fmtPiles(arr: unknown, names: Record<string, string>): string {
  if (!Array.isArray(arr)) return '—';
  return arr.map((p) => `${names[p.pileGradeId] ?? p.pileGradeId}: ${p.count} шт`).join('; ') || '—';
}
function fmtDrillings(arr: unknown, names: Record<string, string>): string {
  if (!Array.isArray(arr)) return '—';
  return arr.map((d) => `${names[d.typeId] ?? d.typeId}: ${d.count ?? 1} шт, ${d.meters} м`).join('; ') || '—';
}
function fmtDowntimes(arr: unknown, names: Record<string, string>): string {
  if (!Array.isArray(arr)) return '—';
  return arr.map((d) => `${names[d.reasonId] ?? d.reasonId}: ${d.duration} ч`).join('; ') || '—';
}
function scalar(v: unknown): string { return v === null || v === undefined || v === '' ? '—' : String(v); }

export function humanizeDiff(diff: Record<string, unknown>, lookups: NameLookups): HistoryChange[] {
  const out: HistoryChange[] = [];
  for (const [field, value] of Object.entries(diff)) {
    if (NOISE.has(field)) continue;
    const { old: oldVal, new: newVal } = (value as { old: unknown; new: unknown });
    switch (field) {
      case 'piles':
        out.push({ label: 'Сваи', before: fmtPiles(oldVal, lookups.pileGrade), after: fmtPiles(newVal, lookups.pileGrade) }); break;
      case 'drillings':
        out.push({ label: 'Бурение', before: fmtDrillings(oldVal, lookups.drillingType), after: fmtDrillings(newVal, lookups.drillingType) }); break;
      case 'downtimes':
        out.push({ label: 'Простои', before: fmtDowntimes(oldVal, lookups.downtimeReason), after: fmtDowntimes(newVal, lookups.downtimeReason) }); break;
      case 'status':
        out.push({ label: 'Статус', before: statusLabel(scalar(oldVal)), after: statusLabel(scalar(newVal)) }); break;
      case 'siteId':
        out.push({ label: 'Объект', before: lookups.site[scalar(oldVal)] ?? scalar(oldVal), after: lookups.site[scalar(newVal)] ?? scalar(newVal) }); break;
      case 'userId':
        out.push({ label: 'Оператор', before: lookups.user[scalar(oldVal)] ?? scalar(oldVal), after: lookups.user[scalar(newVal)] ?? scalar(newVal) }); break;
      case 'equipmentId':
        out.push({ label: 'Установка', before: lookups.equipment[scalar(oldVal)] ?? scalar(oldVal), after: lookups.equipment[scalar(newVal)] ?? scalar(newVal) }); break;
      case 'shiftStart':
        out.push({ label: 'Начало смены', before: scalar(oldVal), after: scalar(newVal) }); break;
      case 'shiftEnd':
        out.push({ label: 'Окончание смены', before: scalar(oldVal), after: scalar(newVal) }); break;
      case 'date':
        out.push({ label: 'Дата', before: scalar(oldVal), after: scalar(newVal) }); break;
      case 'shiftType':
        out.push({ label: 'Тип смены', before: scalar(oldVal), after: scalar(newVal) }); break;
      default:
        out.push({ label: field, before: scalar(oldVal), after: scalar(newVal) });
    }
  }
  return out;
}
```

(Type note: the `p.pileGradeId`/`d.typeId`/`d.reasonId` accesses are on `unknown[]` items — add `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and type the map callback param as `any`, or define a minimal row type. Keep it simple: `arr.map((p: any) => ...)` is acceptable in this presentational formatter.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/reports/__tests__/report-history-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/reports/report-history-service.ts src/services/reports/__tests__/report-history-service.test.ts
git commit -m "feat(reports): humanize report-audit diffs for the history view"
```

---

## Task 2: getReportHistory (load + resolve + humanize)

**Files:**
- Modify: `src/services/reports/report-history-service.ts`
- Test: `src/services/reports/__tests__/report-history-service.test.ts`

- [ ] **Step 1: Add the failing test**

```ts
import { vi, beforeEach } from 'vitest';
import { getReportHistory } from '../report-history-service';

vi.mock('@/lib/db', () => ({
  db: {
    reportAudit: { findMany: vi.fn() },
    reportVersion: { findMany: vi.fn() },
    pileGrade: { findMany: vi.fn() },
    drillingType: { findMany: vi.fn() },
    downtimeReason: { findMany: vi.fn() },
    site: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    equipment: { findMany: vi.fn() },
  },
}));

import { db } from '@/lib/db';

describe('getReportHistory', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns humanized events (newest first) and versions', async () => {
    (db.reportAudit.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { id: 'a1', action: 'updated', actorName: 'Админ', actorRole: 'ADMIN', createdAt: new Date('2026-05-02'), diff: { status: { old: 'draft', new: 'submitted' } } },
      { id: 'a0', action: 'created', actorName: 'Иванов', actorRole: 'OPERATOR', createdAt: new Date('2026-05-01'), diff: null },
    ]);
    (db.reportVersion.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([
      { version: 2, actorId: 'u1', createdAt: new Date('2026-05-02') },
    ]);
    for (const m of [db.pileGrade, db.drillingType, db.downtimeReason, db.site, db.user, db.equipment]) {
      (m.findMany as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    }

    const res = await getReportHistory('rep-1');
    expect(db.reportAudit.findMany).toHaveBeenCalledWith({ where: { reportId: 'rep-1' }, orderBy: { createdAt: 'desc' } });
    expect(res.events[0]).toMatchObject({ id: 'a1', actionLabel: 'Изменён', actorName: 'Админ' });
    expect(res.events[0].changes).toEqual([{ label: 'Статус', before: 'Черновик', after: 'Отправлен' }]);
    expect(res.events[1].changes).toEqual([]); // null diff → no changes
    expect(res.versions).toEqual([{ version: 2, actorId: 'u1', createdAt: '2026-05-02T00:00:00.000Z' }]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/reports/__tests__/report-history-service.test.ts -t getReportHistory`
Expected: FAIL — `getReportHistory` not defined.

- [ ] **Step 3: Implement**

Append to `report-history-service.ts`:

```ts
function toMap(rows: Array<{ id: string; name: string }>): Record<string, string> {
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

export async function getReportHistory(reportId: string): Promise<ReportHistory> {
  const [auditRows, versionRows, pileGrades, drillingTypes, downtimeReasons, sites, users, equipment] = await Promise.all([
    db.reportAudit.findMany({ where: { reportId }, orderBy: { createdAt: 'desc' } }),
    db.reportVersion.findMany({ where: { reportId }, orderBy: { version: 'desc' }, select: { version: true, actorId: true, createdAt: true } }),
    db.pileGrade.findMany({ select: { id: true, name: true } }),
    db.drillingType.findMany({ select: { id: true, name: true } }),
    db.downtimeReason.findMany({ select: { id: true, name: true } }),
    db.site.findMany({ select: { id: true, name: true } }),
    db.user.findMany({ select: { id: true, name: true } }),
    db.equipment.findMany({ select: { id: true, name: true } }),
  ]);

  const lookups: NameLookups = {
    pileGrade: toMap(pileGrades), drillingType: toMap(drillingTypes), downtimeReason: toMap(downtimeReasons),
    site: toMap(sites), user: toMap(users), equipment: toMap(equipment),
  };

  const events: ReportHistoryEvent[] = auditRows.map((row) => ({
    id: row.id,
    action: row.action,
    actionLabel: actionLabel(row.action),
    actorName: row.actorName ?? null,
    actorRole: row.actorRole ?? null,
    createdAt: row.createdAt.toISOString(),
    changes: row.diff ? humanizeDiff(row.diff as Record<string, unknown>, lookups) : [],
  }));

  const versions: ReportHistoryVersion[] = versionRows.map((v) => ({
    version: v.version, actorId: v.actorId, createdAt: v.createdAt.toISOString(),
  }));

  return { events, versions };
}
```

(Verify `db.user` has a `name` field and `db.equipment` exists with `name` — confirmed in schema. If `user.name` is nullable, `toMap` still works; null names map to `undefined` and fall back to the id.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/reports/__tests__/report-history-service.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add src/services/reports/
git commit -m "feat(reports): getReportHistory loads + resolves audit trail and versions"
```

---

## Task 3: GET /api/reports/[id]/history route

**Files:**
- Create: `src/app/api/reports/[id]/history/route.ts`
- Test: `src/app/api/reports/[id]/history/__tests__/route.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { requireAuthMock, getHistoryMock } = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  getHistoryMock: vi.fn(),
}));
vi.mock('@/lib/auth', () => ({ requireAuth: requireAuthMock }));
vi.mock('@/services/reports/report-history-service', () => ({ getReportHistory: getHistoryMock }));

import { GET } from '../route';

function req(): NextRequest { return new NextRequest('http://localhost/api/reports/rep-1/history'); }
const ctx = () => ({ params: Promise.resolve({ id: 'rep-1' }) });

describe('GET /api/reports/[id]/history', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('returns 401 when unauthenticated', async () => {
    requireAuthMock.mockResolvedValue({ user: null, error: new Response(null, { status: 401 }) });
    expect((await GET(req(), ctx())).status).toBe(401);
  });

  it('returns 403 for an OPERATOR', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'o', role: 'OPERATOR' }, error: null });
    expect((await GET(req(), ctx())).status).toBe(403);
    expect(getHistoryMock).not.toHaveBeenCalled();
  });

  it('returns history for an ADMIN keyed on the [id] param', async () => {
    requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN' }, error: null });
    getHistoryMock.mockResolvedValue({ events: [{ id: 'a1' }], versions: [] });
    const res = await GET(req(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ id: 'a1' }], versions: [] });
    expect(getHistoryMock).toHaveBeenCalledWith('rep-1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/api/reports/[id]/history/__tests__/route.test.ts`
Expected: FAIL — route does not exist.

- [ ] **Step 3: Implement the route**

Create `src/app/api/reports/[id]/history/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getReportHistory } from '@/services/reports/report-history-service';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'reports.read_all');
  const { id } = await params;
  const history = await getReportHistory(id);
  return NextResponse.json(history);
}, { domain: 'reports' });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/api/reports/[id]/history/__tests__/route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/reports/
git commit -m "feat(reports): GET /api/reports/[id]/history endpoint"
```

---

## Task 4: useReportHistory hook

**Files:**
- Create: `src/components/piling/admin-reports/use-report-history.ts`

- [ ] **Step 1: Implement the hook** (no unit test — thin fetch wrapper, covered by manual verification in Task 6)

Create `src/components/piling/admin-reports/use-report-history.ts`:

```ts
'use client';

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/api';
import type { ReportHistory } from '@/services/reports/report-history-service';

interface UseReportHistoryState {
  data: ReportHistory | null;
  loading: boolean;
  error: boolean;
}

export function useReportHistory(reportId: string | null | undefined): UseReportHistoryState {
  const [state, setState] = useState<UseReportHistoryState>({ data: null, loading: false, error: false });

  useEffect(() => {
    if (!reportId) { setState({ data: null, loading: false, error: false }); return; }
    const controller = new AbortController();
    setState({ data: null, loading: true, error: false });
    void (async () => {
      try {
        const res = await authFetch(`/api/reports/${encodeURIComponent(reportId)}/history`, { signal: controller.signal });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as ReportHistory;
        setState({ data, loading: false, error: false });
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        setState({ data: null, loading: false, error: true });
      }
    })();
    return () => controller.abort();
  }, [reportId]);

  return state;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/piling/admin-reports/use-report-history.ts
git commit -m "feat(reports): useReportHistory fetch hook"
```

---

## Task 5: Wire real history + status badge + photo count into the pane

**Files:**
- Modify: `src/components/piling/admin-reports/admin-reports.tsx`

- [ ] **Step 1: Lift the history hook and pass it to the preview**

In `AdminReports` (after `previewReport` state is established, near the other hooks ~line 168), add:

```tsx
  const reportHistory = useReportHistory(previewReport?.reportId);
```

Add the import at the top with the other local imports:

```tsx
import { useReportHistory } from './use-report-history';
import { statusLabel } from '@/services/reports/report-history-service';
```

Change the `<ReportEvidencePreview ... />` usage (~line 449) to pass history:

```tsx
          <ReportEvidencePreview
            report={previewReport}
            history={reportHistory}
            formatDate={formatDate}
            onClose={() => setPreviewReport(null)}
            onEdit={(r) => { setEditReport(r); setShowCreateDialog(true); }}
            onPreviewPdf={handlePreviewPdf}
            onPrint={() => window.print()}
          />
```

- [ ] **Step 2: Replace the fabricated history block in `ReportEvidencePreview`**

Update the `ReportEvidencePreview` signature to accept `history` and import the type. Add to its props type:

```tsx
import type { ReportHistory } from '@/services/reports/report-history-service';
```

Props (extend the existing inline prop type):

```tsx
  history,
```
```tsx
  history: { data: ReportHistory | null; loading: boolean; error: boolean };
```

Delete the hardcoded `auditItems` array (the `const auditItems = [ ... ]` block, ~lines 707-711) and replace the entire "История изменений" block (the `<div>` with `<h3>История изменений</h3>` and its hardcoded `.map`) with:

```tsx
        <div>
          <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-slate-900">
            <History className="h-4 w-4 text-slate-400" />
            История изменений
          </h3>
          <div className="rounded-md border border-slate-200">
            {history.loading ? (
              <div className="px-2.5 py-3 text-2xs text-slate-400">Загрузка истории…</div>
            ) : history.error ? (
              <div className="px-2.5 py-3 text-2xs text-red-500">Не удалось загрузить историю изменений</div>
            ) : !history.data || history.data.events.length === 0 ? (
              <div className="px-2.5 py-3 text-2xs text-slate-400">Событий пока нет</div>
            ) : (
              history.data.events.map((event) => (
                <div key={event.id} className="border-b border-slate-100 px-2.5 py-2 last:border-b-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-slate-700">{event.actionLabel}</span>
                    <span className="text-3xs text-slate-400">{formatIsoDateTime(event.createdAt)}</span>
                  </div>
                  <p className="mt-0.5 text-2xs text-slate-500">
                    {event.actorName || 'Неизвестный'}{event.actorRole ? ` · ${roleLabel(event.actorRole)}` : ''}
                  </p>
                  {event.changes.length > 0 && (
                    <ul className="mt-1 space-y-0.5">
                      {event.changes.map((change, i) => (
                        <li key={i} className="text-2xs text-slate-600">
                          <span className="text-slate-400">{change.label}:</span>{' '}
                          <span className="line-through decoration-slate-300">{change.before}</span>
                          {' → '}
                          <span className="font-medium text-slate-800">{change.after}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
```

Add a `roleLabel` helper near the other module-level helpers (top of file, ~line 117):

```tsx
function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Администратор';
  if (role === 'DISPATCHER') return 'Диспетчер';
  if (role === 'ASSISTANT') return 'Помощник';
  return 'Оператор';
}
```

- [ ] **Step 3: Add a status badge**

In the `ReportEvidencePreview` header (the block with `<h2>Отчёт #{report.reportId}</h2>`), add under the subtitle line:

```tsx
            <span className={cn(
              'mt-1 inline-block rounded px-2 py-0.5 text-3xs font-medium',
              report.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
            )}>{statusLabel(report.status)}</span>
```

In `EvidenceReportRow`, add a status badge under the operator cell (after the `formatLastEditor` line, ~line 613):

```tsx
        <div className="mt-0.5">
          <span className={cn(
            'inline-block rounded px-1.5 py-0.5 text-3xs font-medium',
            report.status === 'submitted' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
          )}>{statusLabel(report.status)}</span>
        </div>
```

(`statusLabel` is imported at top in Step 1. `EvidenceReportRow` already receives `report`.)

- [ ] **Step 4: Real photo count**

The component already tracks `photoReportIds: Record<string, boolean>`. Replace the placeholder "Фото" card. In `AdminReports`, compute the count from `filteredReports` and pass it down:

```tsx
  const photoCount = useMemo(
    () => filteredReports.filter((r) => photoReportIds[r.reportId] === true).length,
    [filteredReports, photoReportIds],
  );
```

Pass it to `EvidenceSummary`:

```tsx
            <EvidenceSummary reportCount={filteredReports.length} totals={totals} photoCount={photoCount} />
```

Update `EvidenceSummary` to accept `photoCount` and use it for the Фото item, replacing `value: '-'` / `detail: 'счётчик нужен из API'`:

```tsx
function EvidenceSummary({ reportCount, totals, photoCount }: { reportCount: number; totals: ReportTotals; photoCount: number }) {
```
```tsx
    { label: 'Фото', value: String(photoCount), icon: ImageIcon, detail: 'отчётов с фото', tone: 'emerald' },
```

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: tsc exit 0; lint 0 errors. (Remove the now-unused `getReportTotals(report).photoCount` usage if it triggers an unused warning — it is still used elsewhere, leave it.)

- [ ] **Step 6: Manual verification**

`npm run dev`, open `/admin/reports`, select a report that has been edited:
- "История изменений" shows real events newest-first: action label, actor + role, timestamp.
- An `updated` event expands to readable changes, e.g. `Сваи: С120-30: 5 шт → С120-30: 10 шт` and `Статус: Черновик → Отправлен` (not raw cuids/JSON).
- A report with no audit rows shows "Событий пока нет"; a failed fetch shows the error line.
- Status badge appears in rows and the pane.
- The "Фото" stat shows a real number.

- [ ] **Step 7: Commit**

```bash
git add src/components/piling/admin-reports/admin-reports.tsx
git commit -m "feat(reports): real provenance history, status badge, photo count in evidence pane"
```

---

## Task 6: Full regression gate

- [ ] **Step 1: Run suite + tsc + lint + build**

Run: `npm run test:unit && npx tsc --noEmit && npm run lint && npm run build`
Expected: all green; `/api/reports/[id]/history` appears in the build route list.

- [ ] **Step 2: Commit any fixups**

```bash
git add -A -- src/
git commit -m "test(reports): evidence-base phase 1 green (suite + lint + build)"
```

---

## Notes for the implementer

- This replaces a screen that currently shows **fabricated** provenance — correctness, not polish. Do not ship the new history block until it renders real data; if a sub-step is incomplete, the "Событий пока нет"/error states are the safe fallback, never the old hardcoded `auditItems`.
- The readable diff (`humanizeDiff`, Task 1) is the heart of the feature. If pile/drilling/downtime changes render as raw cuids or JSON, the task is not done.
- `withApi` maps thrown `ServiceError` to HTTP — no try/catch in the route.
- Do NOT touch the operator hot path or add acceptance/status-change logic (Phase 2).
