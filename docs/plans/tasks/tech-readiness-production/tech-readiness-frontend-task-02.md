# Tech Readiness Frontend Task 02 — Real bootstrap client

**Work-plan coverage:** frontend half of TR-204. **Goal:** bind the shell to the real bootstrap contract with typed errors/capabilities and no mocks.

## Target files

- Create `src/components/piling/to/readiness/api/{client,contracts,errors,idempotency,query-keys}.ts`.
- Edit `src/components/piling/to/readiness/boundaries/bootstrap-boundary.tsx` and `tech-readiness-module.tsx`.
- Add `src/components/piling/to/readiness/api/__tests__/*` and boundary component tests.

## Prerequisites and steps

1. Backend Task 02 and live `GET /api/readiness/bootstrap`.
2. Implement typed transport adapters, cancellation/correlation propagation and stable query key.
3. Render loading/error/retry/forbidden/feature unavailable from server envelope; consume server capabilities without role-name inference.

## Tests and validation

- Add bootstrap request/contract, loading/error/forbidden/retry/cancellation, foreign-ID non-render and capability behavior tests.
- Run focused Vitest; `npx.cmd tsc --noEmit`; manual ADMIN/MECHANIC/DISPATCHER/OPERATOR/foreign-tenant matrix through HTTP.

## GitNexus gate

- Upstream `impact`: `ToModule`, `TechReadinessModule`, auth-fetch wrapper and equipment selector query integration point. Stop on HIGH/CRITICAL.
- Run `detect_changes(scope:"all")`; allow only the API/boundary/module tests and approved integration hunks.

## Acceptance, rollback, exclusions

- Acceptance: first backend-to-frontend path has no mock/local permissions and no foreign identifier; retry focus and one announcement remain correct.
- Rollback: feature flag returns the legacy module; keep unused typed client.
- Forbidden: generated OpenAPI, role inference, legacy reference deletion, shared UI primitives, unrelated routes/components.
