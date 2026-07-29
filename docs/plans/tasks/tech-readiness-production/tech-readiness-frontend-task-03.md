# Tech Readiness Frontend Task 03 — Permit vertical slice

**Work-plan coverage:** TR-302. **Goal:** replace the legacy permit tab with real list/detail/actions and deterministic conflict recovery.

## Target files

- Create `src/components/piling/to/readiness/permits/{work-permits-route,permit-queries,permit-list,permit-detail-route,permit-command-dialogs,permit-controller}.tsx`.
- Add `src/components/piling/to/readiness/permits/__tests__/*`.
- Edit `tech-readiness-module.tsx`, `api/{contracts,query-keys}.ts`, and only permit-scoped shared action/dialog adapters.

## Prerequisites and steps

1. Backend Task 03.
2. Bind list/detail filters, deep link, create/edit/submit/approve/revoke to server `actions[]`.
3. Show ELEVATED `1/2`, pending lock, success convergence and state-specific `409/422`; never optimistically claim approval.
4. Keep per-tab fallback until parity.

## Tests and validation

- Add every role/state/action plus loading/error/empty/pending/success/conflict, dialog keyboard/focus and 1440/390 tests.
- Progressively activate elevated approval and permit dispatcher-journey E2E only with the isolated real-session harness.
- Run focused Vitest; `npx.cmd tsc --noEmit`; Playwright permit grep at 1440 and 390.

## GitNexus gate

- Upstream `impact`: `ReadinessReferenceUi` permit section, `ToModule`, `TechReadinessModule`, each edited shared controller. Stop on HIGH/CRITICAL.
- Run `detect_changes(scope:"all")`; permit/frontend allowlist only.

## Acceptance, rollback, exclusions

- Acceptance: actions exactly reflect server contract; race loser sees current server state; audit/outbox result converges in UI; keyboard path complete.
- Rollback: permit tab flag returns legacy/unavailable view; API remains.
- Forbidden: client RBAC/state machine, mock success, legacy permit removal before parity, unrelated tabs/shared UI/source code.
