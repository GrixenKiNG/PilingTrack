# Tech Readiness Backend Task 04 — Shifts and handovers

**Work-plan coverage:** TR-400, TR-401. **Goal:** implement shift/handover invariants and authoritative synchronous start decision.

## Target files

- `prisma/schema.prisma`; amend only this task’s hunk in `prisma/migrations/*_readiness_workflows/migration.sql`.
- Create `src/modules/readiness/domain/shifts/{types,shift,handover,transitions,tenant-production-date}.ts`.
- Create `src/modules/readiness/application/shifts/{commands,queries,start-decision,schemas}.ts`.
- Create `src/modules/readiness/infrastructure/shifts/{shift-repository,handover-repository}.ts`.
- Create routes under `src/app/api/readiness/shifts/**` and `src/app/api/readiness/handovers/**`.
- Edit owned cases in domain/contract/integration scaffolds.

## Prerequisites and steps

1. Backend/Frontend Task 03.
2. Enforce one active shift/equipment, one live handover/shift, DAY/NIGHT and tenant-timezone production date at DB/application/conditional-update layers.
3. Add create/update/start/cancel/handover/accept/rework/list/detail commands.
4. Start uses authoritative rows plus latest published rules inside serializable transaction; persist `SHIFT_START_DECISION`; conflict includes safe current resource/actor/time.

## Tests and validation

- Activate shift/handover terminal cases, ETag/precondition, mechanic RBAC, stale handover conflict, explainable block and authoritative start integration cases.
- Add 20 parallel starts (one winner), two concurrent accepts (one winner), serializable retry and atomic audit/outbox/idempotency tests.
- Run focused domain/API/integration; Prisma checks/generate; `npx.cmd tsc --noEmit`.

## GitNexus gate

- Upstream `impact`: readiness evaluator integration, tenant-date utility, equipment lookup, `computeReadinessScore`, `blockerTriggered`, `readiness-facts`, command pipeline. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; shift/handover/schema/test allowlist only.

## Acceptance, rollback, exclusions

- Acceptance: stale snapshot never authorizes start; 422 names blocker/correcting action; DB predicate and error mapping agree; all commands persist aggregate/audit/outbox/idempotency atomically.
- Rollback: disable `readiness_shifts_v1` writes by tenant allowlist; retain reads/history.
- Forbidden: client clock/timezone, snapshot-as-authority, destructive workflow rollback, unrelated equipment/rules code.
