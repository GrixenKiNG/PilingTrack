# Tech Readiness Backend Task 01 — Tenant, roles and bootstrap API

**Work-plan coverage:** TR-200, TR-201, backend half of TR-204. **Goal:** create fail-closed session-owned tenant/timezone and capability bootstrap.

## Target files

- `prisma/schema.prisma`; new ordered migrations `prisma/migrations/*_readiness_tenant_context/migration.sql` and `*_readiness_mechanic_role/migration.sql`.
- Create `src/modules/readiness/infrastructure/tenant-transaction.ts`, `src/modules/readiness/application/capabilities.ts`, `src/modules/readiness/application/bootstrap-query.ts`.
- Edit exact integration files found by GitNexus for `ensureTenantAccess`, tenant context, session issue/refresh, role validation/navigation, Prisma transaction and readiness worker.
- Create/edit `src/app/api/readiness/bootstrap/route.ts`, `prisma/seed.ts`, route/unit/DB tests and `tests/fixtures/tech-readiness.fixture.ts`.

## Prerequisites and steps

1. Frontend Task 01 and approved ledger.
2. Add IANA tenant timezone and composite parent uniques with orphan/duplicate/invalid-timezone preflight.
3. Implement request/worker transaction wrappers with `SET LOCAL app.current_tenant`; no body/query/header/environment tenant fallback.
4. Add string-backed `MECHANIC`, explicit abilities, session-version invalidation, audited ADMIN `actingAs=MECHANIC`.
5. Return real timezone, flags, selectors, counts and screen/entity capabilities from bootstrap.

## Tests and validation

- Activate only contract cases for safe missing/cross-tenant `404`, mechanic RBAC and spoofed context; retain remaining case-level skips with slice references.
- Add tenant wrapper, unset/wrong-tenant DB, auth/session, role navigation, bootstrap and foreign-tenant tests.
- Run focused Vitest/contract cases; `npm.cmd run db:check-migrations`; `npm.cmd run db:generate`; `npx.cmd tsc --noEmit`; migration rehearsal twice in disposable PostgreSQL.

## GitNexus gate

- Upstream `impact`: `ensureTenantAccess`, tenant-context exports, Prisma transaction wrapper, worker entry, authorization `can`/ability registry, role schemas, session issue/refresh, role navigation, auth wrapper, equipment selector query.
- Stop on HIGH/CRITICAL. Run `detect_changes(scope:"all")`; allow only targets, tests, seed and two additive migrations.

## Acceptance, rollback, exclusions

- Acceptance: no client-controlled context; wrong/missing tenant fails closed; cached sessions lose removed powers; no production role assignment; bootstrap leaks no foreign identifier.
- Rollback: route/command flags off; leave additive timezone/role/composite keys; revoke only dev/test role assignments through the role service.
- Forbidden: default tenant fallback, production seed assignment, RLS enforcement, destructive migrations, unrelated auth/navigation changes.
