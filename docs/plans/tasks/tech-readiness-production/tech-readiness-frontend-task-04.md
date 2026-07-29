# Tech Readiness Frontend Task 04 — Shift and handover vertical slice

**Work-plan coverage:** TR-402. **Goal:** production shift schedule/detail/actions with real mobile geometry and conflict recovery.

## Target files

- Create `src/components/piling/to/readiness/shifts/{shifts-route,shift-queries,shift-schedule,shift-bar,handover-queue,shift-detail-route,shift-command-dialogs,shift-controller}.tsx`.
- Create `src/components/piling/to/readiness/shifts/__tests__/*`.
- Edit `tech-readiness-module.tsx`, `api/{contracts,query-keys}.ts`, `shared/tenant-date.tsx`.

## Prerequisites and steps

1. Backend Task 04.
2. Bind server display interval, list/detail/start/cancel/handover/accept/rework.
3. Render current actor/time/state after 409 and remove stale action; switch critical tables to vertical cards at 1024/390.
4. Preserve per-tab fallback until parity.

## Tests and validation

- Add role/state/command/conflict/component geometry tests.
- Activate second-dispatcher conflict, blocker and dispatcher handover E2E segments only after deterministic reset.
- Run focused Vitest; typecheck; Playwright 1440/1280/1024/390 and keyboard smoke.

## GitNexus gate

- Upstream `impact`: legacy `ShiftsScreen`, `ToModule`, shared chart/timeline and tenant-date symbols before edit. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; listed shifts/shared/tests only.

## Acceptance, rollback, exclusions

- Acceptance: concurrent accept loser sees who/when/current state and no accept action; unresolved planned end is supplied by server read model; no mobile overlap/X-scroll.
- Rollback: shift-tab flag falls back; commands disabled independently.
- Forbidden: client interval/readiness/permission inference, unrelated charts/shared controls/tabs.
