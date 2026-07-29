# Tech Readiness Backend Task 03 — Work permits

**Work-plan coverage:** TR-300, TR-301. **Goal:** implement tenant-safe permit state machine and production command/query API before shifts.

## Target files

- `prisma/schema.prisma`; `prisma/migrations/*_readiness_workflows/migration.sql`; `prisma/seed.ts`.
- Create `src/modules/readiness/domain/permits/{types,work-permit,transitions,approval-policy}.ts`.
- Create `src/modules/readiness/application/permits/{commands,queries,schemas}.ts`.
- Create `src/modules/readiness/infrastructure/permits/work-permit-repository.ts`.
- Create routes below `src/app/api/readiness/work-permits/`: `route.ts`, `[id]/route.ts`, `[id]/{submit,approve,revoke}/route.ts`.
- Add feature-local tests; edit relevant cases in production domain, contract and integration scaffolds.

## Prerequisites and steps

1. Backend Task 02 and Frontend Task 02.
2. Add permit/approval tables, composite tenant keys, partial indexes/checks and typed `VALID_WORK_PERMIT_REQUIRED`.
3. Implement NORMAL/ELEVATED transitions, edit invalidation/versioning, expiry/revoke and self-approval prohibition.
4. Wire list/detail/create/update/submit/approve/revoke through ETag/idempotency/audit/outbox; seed isolated states through services only.

## Tests and validation

- Activate permit transitions, approval and self-approval domain cases; real-route spoof-context/idempotency contract cases.
- Add NORMAL/ELEVATED, edit/approval race, cross-tenant FK and 20-way race tests.
- Run focused domain/contract/integration; `npm.cmd run db:check-migrations`; `npm.cmd run db:generate`; `npx.cmd tsc --noEmit`.

## GitNexus gate

- Upstream `impact`: `READINESS_CRITERION_KEYS`, `DEFAULT_READINESS_RULES`, capability mapper, mutation wrapper, rules service integration. Stop on HIGH/CRITICAL.
- Run `detect_changes(scope:"all")`; allow only listed permit/schema/migration/seed/test paths.

## Acceptance, rollback, exclusions

- Acceptance: substantive edit invalidates approvals and increments version; author cannot approve; NORMAL requires one non-author dispatcher; ELEVATED requires distinct dispatcher+admin in either order; every mutation is atomic with audit/outbox/idempotency.
- Rollback: disable `readiness_permits_v1`; preserve rows/audit/outbox and reads.
- Forbidden: shift enablement, synthetic production records, noncomposite tenant links, client actor/role/tenant, unrelated schema/seed hunks.
