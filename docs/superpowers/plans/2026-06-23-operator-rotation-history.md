# Operator Rotation History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only "Ротация машинистов" section to the equipment detail screen that collapses a rig's report stream into operator segments with derived substitutions.

**Architecture:** Pure transform over the already-fetched `timeline` data on the equipment detail screen. Add `operatorId` to the timeline rows, compute segments in a pure unit-tested function, render a card. No schema, no migration, no new API.

**Tech Stack:** TypeScript, React, Vitest. Spec: `docs/superpowers/specs/2026-06-23-operator-rotation-history-design.md`.

---

## File Structure

- `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx` — `TimelineRow` type gains `operatorId`; new `OperatorRotationCard` component (lives next to `HistoryTable`, same file).
- `src/modules/equipment/application/queries/equipment-query.service.ts` — timeline mapping emits `operatorId`.
- `src/components/piling/admin-equipment/detail/operator-rotation.ts` — **new** pure logic: `computeOperatorRotation` + `RotationSegment`.
- `src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts` — **new** unit tests.
- `src/components/piling/admin-equipment/detail/equipment-detail.tsx` — render `OperatorRotationCard` in the history tab and the main history section.

---

## Task 1: Plumb `operatorId` through the timeline data

**Files:**
- Modify: `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:110-121`
- Modify: `src/modules/equipment/application/queries/equipment-query.service.ts:130-136`

- [ ] **Step 1: Add `operatorId` to the `TimelineRow` type**

In `equipment-detail-parts.tsx`, change the interface (currently lines 110-121):

```ts
export interface TimelineRow {
  reportId: string;
  date: string;
  shiftType: string;
  status: string;
  siteName: string | null;
  operatorId: string | null;
  operatorName: string | null;
  updatedAt: string;
  piles: number | null;
  drillingMeters: number | null;
  downtimeHours: number | null;
}
```

- [ ] **Step 2: Emit `operatorId` from the server timeline mapping**

In `equipment-query.service.ts`, the `timeline` map (currently lines 130-136) — add `operatorId` (the query already selects `user: { select: { id, name } }`):

```ts
    return {
      reportId: r.reportId, date: r.date, shiftType: r.shiftType, status: r.status,
      siteName: r.site?.name ?? null,
      operatorId: r.user?.id ?? null, operatorName: r.user?.name ?? null,
      updatedAt: r.updatedAt.toISOString(),
      piles: a?.totalPiles ?? null, drillingMeters: a?.totalDrilling ?? null,
      downtimeHours: a?.totalDowntime ?? null,
    };
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "^\.next/" | head`
Expected: no output (no errors).

- [ ] **Step 4: Commit**

```bash
git add src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx src/modules/equipment/application/queries/equipment-query.service.ts
git commit -m "feat(equipment): expose operatorId on rig timeline rows"
```

---

## Task 2: Pure rotation function (TDD)

**Files:**
- Create: `src/components/piling/admin-equipment/detail/operator-rotation.ts`
- Test: `src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/operator-rotation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeOperatorRotation } from '../operator-rotation';
import type { TimelineRow } from '../equipment-detail-parts';

function row(p: Partial<TimelineRow> & { date: string; operatorId: string | null }): TimelineRow {
  return {
    reportId: `r-${p.date}-${p.operatorId}-${p.shiftType ?? 'DAY'}`,
    date: p.date,
    shiftType: p.shiftType ?? 'DAY',
    status: 'submitted',
    siteName: p.siteName ?? 'Куст 12',
    operatorId: p.operatorId,
    operatorName: p.operatorName ?? (p.operatorId ? `Op ${p.operatorId}` : null),
    updatedAt: '2026-06-01T00:00:00.000Z',
    piles: null, drillingMeters: null, downtimeHours: null,
  };
}

describe('computeOperatorRotation', () => {
  it('returns [] for no rows', () => {
    expect(computeOperatorRotation([])).toEqual([]);
  });

  it('groups a single operator across days into one segment', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a' }),
      row({ date: '2026-06-02', operatorId: 'a' }),
      row({ date: '2026-06-03', operatorId: 'a' }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({
      operatorId: 'a', startDate: '2026-06-01', endDate: '2026-06-03',
      shiftCount: 3, isSubstitution: false,
    });
  });

  it('marks substitutions on A -> B -> A and returns newest first', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a' }),
      row({ date: '2026-06-02', operatorId: 'b' }),
      row({ date: '2026-06-03', operatorId: 'a' }),
    ]);
    // newest first
    expect(segs.map((s) => s.operatorId)).toEqual(['a', 'b', 'a']);
    expect(segs.map((s) => s.isSubstitution)).toEqual([true, true, false]);
    expect(segs[2]).toMatchObject({ startDate: '2026-06-01', endDate: '2026-06-01' });
  });

  it('counts day+night by the same operator on one date as one segment, two shifts', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a', shiftType: 'NIGHT' }),
      row({ date: '2026-06-01', operatorId: 'a', shiftType: 'DAY' }),
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ shiftCount: 2, startDate: '2026-06-01', endDate: '2026-06-01' });
  });

  it('detects an intra-day substitution: day A, night B on the same date', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'b', shiftType: 'NIGHT' }),
      row({ date: '2026-06-01', operatorId: 'a', shiftType: 'DAY' }),
    ]);
    // sorted DAY(a) before NIGHT(b); newest-first reverses to [b, a]
    expect(segs.map((s) => s.operatorId)).toEqual(['b', 'a']);
    expect(segs.map((s) => s.isSubstitution)).toEqual([true, false]);
  });

  it('collects distinct site names per segment', () => {
    const segs = computeOperatorRotation([
      row({ date: '2026-06-01', operatorId: 'a', siteName: 'Куст 12' }),
      row({ date: '2026-06-02', operatorId: 'a', siteName: 'Куст 4' }),
    ]);
    expect(segs[0].siteNames).toEqual(['Куст 12', 'Куст 4']);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts`
Expected: FAIL — `Failed to resolve import "../operator-rotation"` / `computeOperatorRotation is not a function`.

- [ ] **Step 3: Write the implementation**

Create `operator-rotation.ts`:

```ts
/**
 * Operator rotation — pure transform over a rig's report timeline.
 *
 * Collapses the report stream into maximal consecutive runs by operator
 * (a "segment"). A change of operator starts a new segment flagged as a
 * substitution. Read-only; no persistence. See the spec:
 * docs/superpowers/specs/2026-06-23-operator-rotation-history-design.md
 */

import type { TimelineRow } from './equipment-detail-parts';

export interface RotationSegment {
  operatorId: string | null;
  operatorName: string | null;
  startDate: string;
  endDate: string;
  shiftCount: number;
  siteNames: string[];
  isSubstitution: boolean;
}

// Same-day ordering so a day shift precedes a night shift deterministically.
const SHIFT_ORDER: Record<string, number> = { DAY: 0, NIGHT: 1 };

export function computeOperatorRotation(rows: TimelineRow[]): RotationSegment[] {
  if (rows.length === 0) return [];

  const sorted = [...rows].sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return (SHIFT_ORDER[a.shiftType] ?? 0) - (SHIFT_ORDER[b.shiftType] ?? 0);
  });

  const segments: RotationSegment[] = [];
  for (const r of sorted) {
    const last = segments[segments.length - 1];
    if (last && last.operatorId === r.operatorId) {
      last.endDate = r.date;
      last.shiftCount += 1;
      if (r.siteName && !last.siteNames.includes(r.siteName)) {
        last.siteNames.push(r.siteName);
      }
    } else {
      segments.push({
        operatorId: r.operatorId,
        operatorName: r.operatorName,
        startDate: r.date,
        endDate: r.date,
        shiftCount: 1,
        siteNames: r.siteName ? [r.siteName] : [],
        isSubstitution: segments.length > 0,
      });
    }
  }

  // Newest first for display.
  return segments.reverse();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/components/piling/admin-equipment/detail/operator-rotation.ts src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts
git commit -m "feat(equipment): computeOperatorRotation pure logic + tests"
```

---

## Task 3: Render the "Ротация машинистов" section

**Files:**
- Modify: `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx` (add `OperatorRotationCard`)
- Modify: `src/components/piling/admin-equipment/detail/equipment-detail.tsx:448-453` and `:508-515`

- [ ] **Step 1: Add the `OperatorRotationCard` component**

In `equipment-detail-parts.tsx`, add the import at the top (next to existing imports):

```ts
import { computeOperatorRotation } from './operator-rotation';
```

Then add this component immediately after the `HistoryTable` function:

```tsx
// Operator rotation: the rig's report stream collapsed into operator runs,
// with substitutions (operator changes) marked. Derived from the same timeline.
export function OperatorRotationCard({ rows }: { rows: TimelineRow[] }) {
  const segments = computeOperatorRotation(rows);
  if (segments.length === 0) {
    return <p className="text-sm text-slate-500">Нет данных о ротации машинистов.</p>;
  }
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-left text-xs text-slate-500">
          <tr>
            <th className="px-3 py-2">Машинист</th>
            <th className="px-3 py-2">Период</th>
            <th className="px-3 py-2">Смен</th>
            <th className="px-3 py-2">Объект</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((s, i) => (
            <tr key={`${s.operatorId ?? 'none'}-${s.startDate}-${i}`} className="border-t border-slate-100">
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  {s.isSubstitution && (
                    <span title="подмена" className="text-amber-600">⇄</span>
                  )}
                  {s.operatorName ?? '—'}
                </span>
              </td>
              <td className="px-3 py-2 text-slate-600">
                {s.startDate === s.endDate ? s.startDate : `${s.startDate} – ${s.endDate}`}
              </td>
              <td className="px-3 py-2">{s.shiftCount}</td>
              <td className="px-3 py-2 text-slate-600">{s.siteNames.join(', ') || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2: Render the card in the history tab**

In `equipment-detail.tsx`, replace the `tab === 'history'` block (currently lines 448-453):

```tsx
          {tab === 'history' &&
            (details.timeline.length > 0 ? (
              <div className="space-y-4">
                <OperatorRotationCard rows={details.timeline} />
                <HistoryTable rows={details.timeline} />
              </div>
            ) : (
              <EmptyState message="Отчётов по этой установке пока нет." />
            ))}
```

- [ ] **Step 3: Render the card in the main history section**

In `equipment-detail.tsx`, add a section immediately before the `<Section icon={History} title="История работ">` block (currently around line 508):

```tsx
      {/* Operator rotation */}
      <Section icon={Users} title="Ротация машинистов">
        {details.timeline.length > 0 ? (
          <OperatorRotationCard rows={details.timeline} />
        ) : (
          <EmptyState message="Отчётов по этой установке пока нет." />
        )}
      </Section>
```

- [ ] **Step 4: Add `OperatorRotationCard` to the import from `equipment-detail-parts`**

In `equipment-detail.tsx`, find the existing import block that pulls `HistoryTable` and `type TimelineRow` from `./equipment-detail-parts` (around line 35) and add `OperatorRotationCard` to its named imports:

```ts
import {
  // ...existing named imports (HistoryTable, TimelineRow, etc.)...
  OperatorRotationCard,
} from './equipment-detail-parts';
```

No other imports are needed: `Section`, `EmptyState`, and the `Users` / `History` icons are already imported and in use elsewhere in this file (lines ~452, ~474, ~509).

- [ ] **Step 5: Typecheck and run the detail tests**

Run: `npx tsc --noEmit 2>&1 | grep -v "^\.next/" | head`
Expected: no output.

Run: `npx vitest run src/components/piling/admin-equipment`
Expected: PASS (existing equipment tests + the new rotation test).

- [ ] **Step 6: Lint**

Run: `npx eslint src/components/piling/admin-equipment/detail/operator-rotation.ts src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx src/components/piling/admin-equipment/detail/equipment-detail.tsx`
Expected: clean (exit 0).

- [ ] **Step 7: Commit**

```bash
git add src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx src/components/piling/admin-equipment/detail/equipment-detail.tsx
git commit -m "feat(equipment): render operator rotation section on rig detail"
```

---

## Verification (after all tasks)

- [ ] `npx tsc --noEmit` clean (ignoring `.next/`).
- [ ] `npx vitest run src/components/piling/admin-equipment` green.
- [ ] Manual: open a rig with several reports from different operators → "Ротация машинистов" shows operator segments newest-first, substitutions marked `⇄`.
