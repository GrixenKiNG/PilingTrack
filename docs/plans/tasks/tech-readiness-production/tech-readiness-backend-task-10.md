# Tech Readiness Backend Task 10 — Canonical filters, cursors and CSV

**Work-plan coverage:** backend half of TR-900 and TR-902. **Goal:** one canonical server filter/cursor model shared by JSON and bounded CSV.

## Target files

- Create `src/modules/readiness/application/query/{filters,cursor}.ts`.
- Edit list repositories/routes under `src/app/api/readiness/{equipment,shifts,handovers,work-permits,maintenance}/**` and `src/app/api/audit/route.ts` only at shared parser integration points.
- Create `src/app/api/audit/export.csv/route.ts` and `src/modules/readiness/application/audit/export-csv.ts`.
- Add filter/cursor/export tests and owned contract cases.

## Prerequisites and steps

1. Backend Task 09 and all list endpoints.
2. Normalize filters once; bind response `meta.filters`, repository predicate, HMAC cursor/filter hash and exact totals to it.
3. Stream same audit repository query as JSON with BOM, CRLF, RFC 4180, formula defense, response headers, cancellation and 100,000-row bound.

## Tests and validation

- Activate list envelope/filters/cursor mismatch and JSON/CSV hash parity cases.
- Add property tests, exact bytes/headers, `413`, client disconnect and memory/query-count probes.
- Run focused contract/integration; typecheck; bounded 100k measurement.

## GitNexus gate

- Upstream `impact`: `parseView`, each list repository/route, audit repository and existing export utility. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; canonicalizer/integration/export/tests only.

## Acceptance, rollback, exclusions

- Acceptance: URL-ready canonical model equals API meta/predicate/cursor hash; CSV rows/timezone/filter hash equal JSON; formula cells neutralized.
- Rollback: disable export route and deep cursor enhancements; never accept unsigned/mismatched cursor.
- Forbidden: browser CSV, duplicated parser, load-all, unrelated report routes.
