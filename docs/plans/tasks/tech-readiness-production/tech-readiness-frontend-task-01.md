# Tech Readiness Frontend Task 01 — Safe seven-tab shell

**Work-plan coverage:** TR-100, TR-101, TR-102. **Goal:** introduce the production shell, safe geometry, semantic tabs, focus and boundaries without claiming backend readiness.

## Target files

- Create `src/components/piling/to/readiness/{tech-readiness-module,module-tab-list,live-region}.tsx`.
- Create `src/components/piling/to/readiness/boundaries/{bootstrap-boundary,active-view-error-boundary,query-state}.tsx`.
- Create `src/components/piling/to/readiness/shared/{command-dialog,entity-detail-shell}.tsx`.
- Create focused tests beside those files.
- Edit only `src/components/piling/to/to-module.tsx`; edit `src/app/(app)/layout.tsx` and `src/app/globals.css` only if feature-local flow cannot satisfy UI Spec §13.

## Prerequisites and steps

1. Backend Task 00 approved.
2. Preserve `readiness-reference-ui.tsx` and add a reversible shell flag.
3. Implement immutable exactly-seven-tab contract, one live region, loading/error/forbidden/feature-off states.
4. Replace module-owned fixed viewport subtraction with flex/grid/document flow; add semantic tab keyboard behavior, focus after switch/retry, dialog trap/return.

## Tests and validation

- Add: tab count/selection, boundary states, live-region dedupe, keyboard/focus, axe smoke, DOM geometry at 1440×900, 1280×800, 1024×768, 390×844 and 200% zoom. Do not unskip generated E2E.
- Run focused Vitest; `npx.cmd tsc --noEmit`; existing ToModule tests; browser screenshots plus bounding-box assertions over an HTTP test server.

## GitNexus gate

- Before edits run upstream `impact` for `ToModule`, `parseView`, `ReadinessReferenceUi`; for shared CSS/layout also `AppLayout`; for reused dialog/sheet symbols impact them individually.
- Stop and report HIGH/CRITICAL. After changes run `detect_changes({scope:"all",repo:"PilingTrack"})`; allow only the listed shell/test paths and expressly approved layout/CSS hunks.

## Acceptance, rollback, exclusions

- Acceptance: existing app shell/left nav remains single; one tab row; no X-scroll, clipping, sticky overlap or keyboard trap at all five conditions; one announcement per state change.
- Rollback: turn off shell flag; leave new unused files; revert only this task’s feature-local hunks.
- Forbidden unrelated files: dirty shared UI primitives, schema/routes, legacy reference UI deletion, ORION/analytics/reporting, unrelated layout/CSS hunks.
