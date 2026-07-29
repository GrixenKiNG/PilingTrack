# Tech Readiness Frontend Task 10 — Geometry and accessibility hardening

**Work-plan coverage:** TR-1000, TR-1001, frontend half of TR-1002. **Goal:** all seven views/settings pass responsive, zoom, keyboard, screen-reader and cancellation gates.

## Target files

- Edit only feature-local files under `src/components/piling/to/readiness/{center,equipment,shifts,permits,maintenance,reports,settings,boundaries,shared}/**`.
- Add `src/components/piling/to/readiness/__tests__/{geometry,a11y,cancellation}.test.tsx`.
- Edit `src/app/(app)/layout.tsx`, `src/app/globals.css`, or `src/components/ui/**` only after a new explicit high-blast-radius approval.

## Prerequisites and steps

1. Frontend Tasks 01–09.
2. Execute all seven views/settings at 1440×900, 1280×800, 1024×768, 390×844 and 200% zoom; replace critical mobile tables with cards.
3. Correct labels, names, semantics, focus trap/return, validation associations, live-region dedupe, contrast and reduced motion.
4. Bound/cancel queries and mutations; expose stale/lag state without client inference.

## Tests and validation

- Add geometry intersection/clipping/X-scroll assertions, axe zero critical/serious, keyboard journeys, focus/reduced-motion and stale cancellation tests.
- Run focused Vitest/typecheck; HTTP browser screenshots/DOM assertions at matrix; desktop/mobile role accessibility scan.

## GitNexus gate

- Upstream `impact` every existing shared layout/control symbol proposed for edit. HIGH/CRITICAL requires sequence approval.
- `detect_changes(scope:"all")`; feature-local/test allowlist; shared paths only with recorded approval and unrelated-route smoke.

## Acceptance, rollback, exclusions

- Acceptance: UI Spec §13 green; all critical journeys pointer-free; no critical/serious axe finding; stale response never overwrites current state.
- Rollback: revert only faulty feature wrapper/responsive hunk; server commands remain safe.
- Forbidden: visual-only screenshot acceptance, broad CSS reformat, unrelated app pages/shared controls.
