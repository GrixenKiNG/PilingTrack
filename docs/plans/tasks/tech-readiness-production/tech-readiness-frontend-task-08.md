# Tech Readiness Frontend Task 08 — Audit report and detail

**Work-plan coverage:** TR-801. **Goal:** server-backed audit list/detail with honest chain language.

## Target files

- Create `src/components/piling/to/readiness/reports/{reports-route,audit-event-list,audit-event-detail-route,audit-queries}.tsx`.
- Add report tests; edit API contracts/query keys and module report route only.

## Prerequisites and steps

1. Backend Task 09.
2. Render actor/entity/action/tenant-timezone, sequence/hash and unknown/verified status neutrally.
3. Enforce server capability on list/detail and preserve drawer focus return.

## Tests and validation

- Add role/permission/detail/unknown verification/loading/error/empty tests.
- Run focused tests; typecheck; keyboard/mobile detail drawer at 1440/390.

## GitNexus gate

- Upstream `impact`: legacy `ReportsScreen` and current audit UI consumers. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; report/API/tests only.

## Acceptance, rollback, exclusions

- Acceptance: UI never labels FeedbackEvent as safety audit and makes no electronic-signature/privileged-owner claim.
- Rollback: hide audit view/export capability without data change.
- Forbidden: client verification, browser CSV, unrelated reports/analytics.
