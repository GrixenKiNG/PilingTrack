# Tech Readiness Frontend Task 07 — Seven honest settings sections

**Work-plan coverage:** TR-701. **Goal:** exactly seven settings sections; only real owned contracts can mutate.

## Target files

- Create `src/components/piling/to/readiness/settings/{settings-route,settings-section-list,settings-section-boundary}.tsx`.
- Create `settings/rules/rules-settings.tsx` and section components `checklists-settings.tsx`, `roles-access-settings.tsx`, `dictionaries-settings.tsx`, `notifications-settings.tsx`, `integrations-settings.tsx`, `audit-settings.tsx`.
- Add settings tests; edit API contracts/query keys and module route only.

## Prerequisites and steps

1. Backend Task 08.
2. Bind rules draft/publish with revision conflict recovery.
3. Bind another section only if its real endpoint/capability exists; otherwise render explicit read-only/unavailable state.

## Tests and validation

- Add type/DOM exactly-seven, capability/action/state and draft conflict tests.
- Run focused component/route tests; typecheck; browser 1440/390.

## GitNexus gate

- Upstream `impact`: legacy `SettingsWorkspace`, `RulesSettings`, workspace settings, dictionary/notification/integration/audit settings points. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; settings/API/tests only.

## Acceptance, rollback, exclusions

- Acceptance: no local-only successful mutation; every enabled control has endpoint ownership; seven sections exactly.
- Rollback: section flags/read-only states; preserve rules.
- Forbidden: fake controls, speculative endpoints, unrelated workspace/dictionary code.
