# Tech Readiness Backend Task 12 — Isolated harness and security/RLS

**Work-plan coverage:** TR-1100, TR-1102. **Goal:** deterministic real-session fixtures and fail-closed tenant/security proof before contract materialization.

## Target files

- Edit `tests/fixtures/tech-readiness.fixture.ts`; create test seed/reset/session adapters and Playwright setup files found by the existing harness.
- Add/edit readiness contract and DB-security cases.
- Edit readiness routes/repositories, tenant wrapper, audit/outbox only for proven fixes.
- Create `prisma/migrations/*_readiness_rls_enforce/migration.sql`.

## Prerequisites and steps

1. Backend Task 11; all functional slices.
2. Seed/reset isolated ADMIN, MECHANIC, two DISPATCHERs, OPERATOR and foreign tenant through services; test auth must compile/runtime fail outside test mode.
3. Test path/body/query/link IDOR, spoofing, composite FK, CSRF/rate limits, redaction and unset/wrong tenant.
4. Only after every request/worker/source wrapper passes, ENABLE+FORCE RLS for non-owner app/worker roles with no BYPASSRLS.

## Tests and validation

- Activate all contract role/tenant cases; add DB RLS/security suite; repeat fixtures twice and shuffled.
- Run focused contract/integration/security in disposable PostgreSQL; production-build negative test for test auth.

## GitNexus gate

- `explain` readiness route/command files; upstream `impact` auth/session test adapter, seed role service and every security fix. Absence of taint is not proof; stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; harness/security/RLS/fix allowlist only.

## Acceptance, rollback, exclusions

- Acceptance: wrong/unset tenant denies; missing/cross-tenant same safe 404; zero cross-tenant link/read/write; no secrets/contact data in sinks; no production test bypass.
- Rollback: command/read flags off and forward fix; never replace fail-closed RLS with allow-all.
- Forbidden: production/default tenant, production users, BYPASSRLS, destructive DB reset, unrelated auth/routes.
