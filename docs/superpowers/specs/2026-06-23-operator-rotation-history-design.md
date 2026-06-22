# Operator Rotation History (Ротация машинистов) — Phase 1

**Date:** 2026-06-23
**Status:** Approved (design)
**Scope:** Read-only view of operator rotation per rig, derived from existing reports. No schema change.

## Context & decisions

This is "point 6b" from the crews review — originally imagined as a full
shift/period/substitution **model**. Brainstorming collapsed it to a much
smaller feature:

- **How shifts work at Orion:** crews change over time; the **rig/site is stable
  and the operator (машинист) rotates** on it, with substitutions. (Q1=C, Q2=C.)
- **What's needed:** to **SEE the rotation history**, not to plan/schedule it.
  (Q3 = "ВИДЕТЬ историю", not "ПЛАНИРОВАТЬ".)
- **Key realization:** the temporal record of "who operated which rig when"
  **already exists in reports** (`Report.userId`, `equipmentId`, `siteId`,
  `date`, `shiftType`, and now `crewId`). No new temporal model is required.
- **Lens chosen:** **by rig** — a section on the equipment detail screen that
  collapses the rig's report stream into operator runs with explicit
  substitutions. (Approach A.)

This validates the earlier decision to defer the heavy model: it was not the
real need.

## Goal

On the equipment detail screen, show a **"Ротация машинистов"** section that
turns the rig's report timeline into operator **segments**:

```
Установка «Копёр №3» — Ротация машинистов
Иванов И.   01.06–07.06   6 смен   ●
Петров П.   08.06–09.06   2 смены  ⇄ подмена
Иванов И.   10.06–…        4 смены  ●
Объект: Куст 12 · день/ночь
```

## Architecture

Read-only transform over already-fetched data. No new API, no schema, no migration.

### 1. Data
Source: `getEquipmentDetails().timeline` (`equipment-query.service.ts`), already
fetched for the detail screen (up to 1000 of the rig's reports). The only data
change: add **`operatorId`** to `TimelineRow` and to the server-side timeline
mapping (the underlying query already selects `user.id`). Grouping must key on
`operatorId`, not `operatorName`, to be correct for namesakes.

### 2. Logic — pure, unit-tested
New module `src/components/piling/admin-equipment/detail/operator-rotation.ts`
(same "pure logic + test" pattern as `fleet-filter.ts`, `to-stats.ts`,
`dashboard-kpis.ts`).

```
computeOperatorRotation(rows: TimelineRow[]): RotationSegment[]
```

- **Sort:** by `date` ascending, then by shift (`DAY` before `NIGHT`) so
  same-day day/night reports order deterministically.
- **Segment:** a maximal consecutive run (in that sort order) of reports with
  the same `operatorId`. A change of `operatorId` starts a new segment and flags
  it `isSubstitution = true` (the first/earliest segment is not a substitution).
  Date gaps within the same operator stay one segment.
- **Segment shape:**
  `{ operatorId, operatorName, startDate, endDate, shiftCount, siteNames: string[], isSubstitution }`.
- **Order returned:** most recent first (for display).

**Substitution definition (decision):** a substitution is **any operator change
on the rig**, regardless of site. The rig is the anchor; the point is operator
rotation. (Not scoped to same-site only.)

### 3. UI
A new card/section "Ротация машинистов" on the equipment detail screen
(`equipment-detail.tsx`), rendered next to the existing `HistoryTable`. Each
segment is a row: operator name · date range · shift count · site(s) ·
`⇄` marker on substitutions. Reuses existing card/table styling. Empty state
when the rig has no reports.

### 4. Tests
Unit tests for `computeOperatorRotation`:
- single operator across several days → one segment, no substitution;
- A → B → A → two A-segments + one B-segment, substitutions flagged on the 2nd+;
- same operator day+night on one date → one segment, `shiftCount = 2`;
- day A / night B on the same date → intra-day substitution (two segments);
- empty input → `[]`.

## Files touched
- `src/modules/equipment/application/queries/equipment-query.service.ts` — add `operatorId` to the timeline mapping.
- `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx` — add `operatorId` to `TimelineRow`; (optionally) the rotation section render.
- `src/components/piling/admin-equipment/detail/operator-rotation.ts` — **new** pure module.
- `src/components/piling/admin-equipment/detail/__tests__/operator-rotation.test.ts` — **new** tests.
- `src/components/piling/admin-equipment/detail/equipment-detail.tsx` — render the section.

## Explicitly OUT of scope (YAGNI)
- No new crew-membership / shift / period table; no migration.
- No planning/scheduling (assigning operators ahead of time).
- No fleet-wide rotation board (possible Phase 2) and no per-operator lens
  (possible Phase 3).
- Substitutions are **derived** (operator change), not a manually-entered entity.

## Non-goals confirmed
KPIs of operator efficiency and HR features remain out until there is a proven
need (council "Не делать"). This phase only surfaces existing data.
