# PilingTrack Icon System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved hybrid industrial icon system across shared navigation and the primary operator, inspection, fleet, and technical-readiness surfaces, then verify all three application roles in a real browser.

**Architecture:** A single typed `PilingIcon` facade resolves custom 24×24 domain SVGs and approved Lucide utility icons. A typed role-navigation catalog is shared by desktop and mobile layouts, while `IconTile` supplies the larger operator treatment without changing routes, permissions, or data flow.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, Lucide React, Vitest, Testing Library.

## Global Constraints

- Preserve existing routes, workflows, API calls, permissions, and visible text.
- Do not ship the reference PNG or add another icon dependency.
- Use graphite contour plus semantic primary/info/success/warning/danger accents.
- Keep labels beside navigation and domain actions; icon-only controls require accessible names.
- Touch targets stay at least 44×44 px; primary operator actions use at least 48×48 px.
- Existing user changes in `AGENTS.md`, `CLAUDE.md`, and root HTML mockups remain untouched.

---

### Task 1: Typed icon catalog and accessibility contract

**Files:**
- Create: `src/components/piling/icons/icon-catalog.ts`
- Create: `src/components/piling/icons/piling-icon.tsx`
- Create: `src/components/piling/icons/icon-tile.tsx`
- Create: `src/components/piling/icons/index.ts`
- Create: `src/components/piling/icons/__tests__/piling-icon.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Produces: `PilingIconName`, `PilingIconTone`, `PilingIcon`, `IconTile`, `PILING_ICON_NAMES`.
- `PilingIcon` accepts `{name, size?, tone?, decorative?, label?, className?}` and always renders one SVG.

- [ ] Write a catalog test that renders every `PILING_ICON_NAMES` entry and expects one SVG with `data-piling-icon`.
- [ ] Write accessibility tests that expect decorative icons to be `aria-hidden` and standalone icons to expose their label.
- [ ] Run `npx vitest run src/components/piling/icons/__tests__/piling-icon.test.tsx` and confirm the module-not-found RED failure.
- [ ] Implement semantic tokens, 18 custom domain glyphs, the Lucide utility registry, and `IconTile`.
- [ ] Re-run the targeted test and confirm GREEN.

### Task 2: One navigation catalog for all roles

**Files:**
- Create: `src/components/piling/icons/role-navigation.ts`
- Create: `src/components/piling/icons/__tests__/role-navigation.test.ts`
- Modify: `src/app/(app)/layout.tsx`

**Interfaces:**
- Produces: `ROLE_NAVIGATION: Record<UserRole, NavigationItem[]>` where every item includes `label`, `href`, and typed `icon`.
- Consumes: `PilingIcon` from Task 1.

- [ ] Write tests for required operator, dispatcher, and administrator routes, icon presence, and absence of emoji.
- [ ] Run the targeted navigation test and confirm RED because the catalog is missing.
- [ ] Implement the catalog and replace text-only/emoji navigation with the shared `PilingIcon` rendering.
- [ ] Add accessible names to menu and logout icon-only controls.
- [ ] Re-run icon and navigation tests and confirm GREEN.

### Task 3: Operator workflow and domain surfaces

**Files:**
- Modify: `src/components/piling/operator-dashboard.tsx`
- Modify: `src/components/piling/report-form/shift-info.tsx`
- Modify: `src/components/piling/report-form/pile-section.tsx`
- Modify: `src/components/piling/report-form/drilling-section.tsx`
- Modify: `src/components/piling/report-form/downtime-section.tsx`
- Modify: `src/components/piling/report-form/report-sent-screen.tsx`
- Modify: `src/components/piling/inspections/inspections-list.tsx`
- Modify: `src/components/piling/admin-equipment/admin-equipment.tsx`
- Modify: `src/components/piling/admin-equipment/equipment-to-tab.tsx`
- Modify: `src/components/piling/inspections/lubrication-map.tsx`

**Interfaces:**
- Consumes: domain icon names `shift-start`, `inspection`, `engine-hours`, `pile-group`, `drilling-auger`, `downtime`, `handoff`, `technical-readiness`, `equipment-rig`, and `repair`.

- [ ] Replace operator hero, report headings, engine-hours field, production sections, sent state, inspections, fleet, and readiness headings with the typed facade.
- [ ] Replace remaining UI emoji in navigation/technical-readiness surfaces with SVG icons.
- [ ] Preserve all existing visible labels and submit/navigation behavior.
- [ ] Run focused component tests and the complete unit suite.

### Task 4: Verification and browser acceptance

**Files:**
- Test: `src/components/piling/icons/__tests__/piling-icon.test.tsx`
- Test: `src/components/piling/icons/__tests__/role-navigation.test.ts`

- [ ] Run `npm run lint` and fix only regressions introduced by this feature.
- [ ] Run `npm run build` and confirm production compilation.
- [ ] Run `gitnexus_detect_changes()` and verify only expected UI symbols and flows are affected.
- [ ] Start the app and test administrator navigation at desktop and mobile widths.
- [ ] Sign in as dispatcher and verify its reduced navigation catalog and active states.
- [ ] Sign in as operator and verify start shift → report → engine hours → downtime/defect-adjacent flow → sent state, plus mobile navigation.
- [ ] Confirm no emoji remain in application navigation and every icon-only control inspected has an accessible name.

