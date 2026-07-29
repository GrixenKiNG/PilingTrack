# Tech Readiness Backend Task 06 — Equipment/current/history/trend APIs

**Work-plan coverage:** backend half of TR-503. **Goal:** expose batched provenance-rich readiness read models without N+1.

## Target files

- Create `src/modules/readiness/application/equipment/{summary-query,current-query,history-query,trend-query}.ts`.
- Create `src/modules/readiness/infrastructure/equipment/readiness-equipment-repository.ts`.
- Create routes `src/app/api/readiness/equipment/route.ts`, `equipment/[id]/route.ts`, `equipment/[id]/current/route.ts`, `equipment/[id]/history/route.ts`, `equipment/[id]/trend/route.ts`.
- Add route/repository tests and owned contract cases.

## Prerequisites and steps

1. Backend Task 05 backfill coverage gate.
2. Implement batch equipment summary, current, immutable history, trend, evidence and active workflow panel data with server query metadata/actions.
3. Remove production route use of `deriveEquipmentReadiness`; keep legacy read-only path behind flag.

## Tests and validation

- Add tenant/role/filter, query-count/no-N+1, current-history convergence, immutability and provenance tests; activate current snapshot E2E assertion when frontend exists.
- Run focused Vitest/contract/integration; query-count probe and production-like center p95 (<1s target); typecheck.

## GitNexus gate

- Upstream `impact`: `deriveEquipmentReadiness`, current readiness route, legacy `ReadinessCentre`/`FleetScreen`, equipment repositories. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; exact read-model/routes/tests only.

## Acceptance, rollback, exclusions

- Acceptance: every returned value has snapshot/query provenance; list is bounded/batched; no client-derived readiness input.
- Rollback: turn off `readiness_snapshots_v1` reads while consumer continues.
- Forbidden: snapshot mutation, N+1/load-all, legacy UI deletion, unrelated equipment details/routes.
