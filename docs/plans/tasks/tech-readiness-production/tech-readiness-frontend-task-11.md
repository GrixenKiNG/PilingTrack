# Tech Readiness Frontend Task 11 — Full role/state E2E

**Work-plan coverage:** TR-1101 and E2E graduation from TR-1100. **Goal:** prove every claimed role workflow with real API-backed state across seven tabs.

## Target files

- Edit `e2e/tech-readiness-production.spec.ts`.
- Create/edit only Tech Readiness Playwright helpers and fixture bindings associated with that spec.

## Prerequisites and steps

1. Backend Task 12 and Frontend Task 10.
2. Bind deterministic sessions/reset for operator read-only, NORMAL permit+handover, ELEVATED two-person approval, concurrent accept recovery and blocked start.
3. Extend across seven tabs/settings, filters, CSV and current snapshot.
4. Remove suite-level skip only after every case passes independently; remove remaining case skips only when owned.

## Tests and validation

- Run Chromium single worker twice and shuffled; then supported project matrix.
- Validate 1440/1280/1024/390 and keyboard: `npx.cmd playwright test e2e/tech-readiness-production.spec.ts --project=chromium --workers=1`.

## GitNexus gate

- Upstream `impact` fixture/session helper integration points before edits. Product symbols are not edited in this task.
- `detect_changes(scope:"all")`; E2E/helper allowlist only.

## Acceptance, rollback, exclusions

- Acceptance: every role workflow performs a real mutation/read and verifies resulting server state; no unauthenticated static screen.
- Rollback: none in product; any failing/skipped acceptance blocks release.
- Forbidden: test-only product bypass, mocks, production/default tenant, screenshot-only assertions, unrelated E2E.
