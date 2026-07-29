# Tech Readiness Backend Task 09 — Real audit reader

**Work-plan coverage:** TR-800. **Goal:** switch `/api/audit` from FeedbackEvent to verified tenant hash-chained AuditLog after parity.

## Target files

- Edit `src/app/api/audit/route.ts`.
- Create `src/modules/readiness/application/audit/{audit-query,audit-detail-query}.ts`.
- Create `src/modules/readiness/infrastructure/audit/audit-read-repository.ts`.
- Amend only enforcement hunk in `prisma/migrations/*_audit_chain_v1/migration.sql`.
- Add repository/route/security tests and owned API contract cases.

## Prerequisites and steps

1. Backend Task 02 shadow verification plus Backend Task 08 workflow coverage.
2. Produce parallel-read parity and tenant-chain verification.
3. Switch list/detail/filter/cursor reader to AuditLog only; use neutral verification status when no projection exists.
4. Apply NOT NULL/trigger/grants only after approved legacy mapping/quarantine.

## Tests and validation

- Activate audit cursor mismatch case; add repository spy proving FeedbackEvent is never queried, safe 404 and tenant sequence tests.
- Run focused unit/contract/DB tests, parity report and chain verifier.

## GitNexus gate

- Upstream `impact`: `/api/audit` GET handler, `getEntityHistory`, audit-history/audit services and every consumer. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; audit reader/repository/migration/tests only.

## Acceptance, rollback, exclusions

- Acceptance: safety audit API reads masked AuditLog only, is tenant-safe and attributes actorRole/actingAs.
- Rollback: reader revert only with security-owner acceptance; preserve chain/shadow writes.
- Forbidden: chain deletion/rewrite, FeedbackEvent fallback, overclaiming integrity, unrelated audit consumers.
