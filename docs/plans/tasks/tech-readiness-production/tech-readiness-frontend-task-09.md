# Tech Readiness Frontend Task 09 — URL state, action pipeline and CSV

**Work-plan coverage:** frontend half of TR-900, TR-901, frontend half of TR-902. **Goal:** consistent deep links, mutation lifecycle and server export across all tabs.

## Target files

- Create `src/components/piling/to/readiness/url/{schema,normalize,use-readiness-url-state}.ts`.
- Create/edit `shared/{shared-list-filters,entity-action-gate,command-dialog}.tsx`.
- Create `src/components/piling/to/readiness/reports/server-csv-export.tsx`.
- Edit `api/{client,contracts,errors,idempotency,query-keys}.ts` and feature controllers in `permits/**`, `shifts/**`, `maintenance/**`, `settings/**`, `reports/**`.
- Add focused URL/action/export tests.

## Prerequisites and steps

1. Backend Task 10.
2. Make URL normalization/reset/back/reload/deep-link use exact API schema.
3. Unify cancellation, pending lock, idempotency, announcement, 403/404/409/422 recovery; prevent stale response overwrite.
4. Download only server CSV and expose server filename/filter hash.

## Tests and validation

- Add property/unit URL tests; state matrix; double-submit/cancellation; browser download tests; activate reload/back/reset E2E.
- Run focused Vitest; typecheck; keyboard command smoke and HTTP Playwright filters/export.

## GitNexus gate

- Upstream `impact`: `parseView`, every edited feature controller, legacy `downloadCsv`, shared dialog/action symbols. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; URL/shared/controller/export/tests only.

## Acceptance, rollback, exclusions

- Acceptance: reset/back/reload deterministic; double submit cannot duplicate; stale response cannot overwrite current view; no browser-built CSV or client permission inference.
- Rollback: per-feature prior tested controllers/server defaults; hide export.
- Forbidden: shared primitive edits, local CSV, divergent filters, unrelated tabs.
