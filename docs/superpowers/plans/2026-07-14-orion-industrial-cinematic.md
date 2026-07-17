# ORION Industrial Cinematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the existing `/orion` public page to the approved Industrial Cinematic direction while preserving the verified eight-machine fleet and honest empty project portfolio.

**Architecture:** Keep the isolated App Router page and typed content module. Split the client UI into focused hero, fleet and contact components that share one CSS Module; use CSS scroll-driven animation as progressive enhancement so the page remains complete without motion or JavaScript.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Lucide React, Vitest, Testing Library, Playwright.

## Global Constraints

- Publish only confirmed facts: eight fleet units, provided service categories and sourced photographs.
- Do not add fictional projects, clients, certifications, specifications, metrics or a fake successful form submission.
- Keep all authenticated PilingTrack routes and styles unchanged.
- Keep five photo slots for every fleet unit and preserve source attribution.
- Meet WCAG AA, visible focus, 44px targets and `prefers-reduced-motion`.
- Use a static hero photograph on mobile and whenever motion is disabled.
- Run GitNexus impact before changing existing symbols and `detect_changes` before each commit.

---

### Task 1: Lock the trust-first content contract

**Files:**
- Modify: `src/components/orion/orion-content.ts`
- Modify: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Produces: `orionProofPoints: readonly OrionProofPoint[]` and `orionProcessSteps: readonly OrionProcessStep[]`.
- Preserves: `orionEquipment`, `orionStories`, `orionCapabilities`.

- [ ] **Step 1: Add failing assertions**

Add assertions that proof points contain exactly `8 / единиц собственного парка`, `ППР / работа по проекту` and `Экипаж / аренда с оператором`, and that `orionStories` remains empty.

- [ ] **Step 2: Run the focused test**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx`

Expected: FAIL because `orionProofPoints` and `orionProcessSteps` are not exported.

- [ ] **Step 3: Add typed content**

```ts
export type OrionProofPoint = { value: string; label: string };
export type OrionProcessStep = { number: string; title: string; copy: string };

export const orionProofPoints = [
  { value: '8', label: 'единиц собственного парка' },
  { value: 'ППР', label: 'работа по проекту' },
  { value: 'Экипаж', label: 'аренда с оператором' },
] as const satisfies readonly OrionProofPoint[];
```

Add five process steps matching the approved sequence: исходные данные, технология и ППР, мобилизация, производство, исполнительная документация.

- [ ] **Step 4: Run the test**

Expected: PASS with all eight fleet units and no fictional stories.

### Task 2: Build the cinematic hero and focused page components

**Files:**
- Create: `src/components/orion/orion-hero.tsx`
- Create: `src/components/orion/orion-fleet.tsx`
- Create: `src/components/orion/orion-contact.tsx`
- Modify: `src/components/orion/orion-site.tsx`
- Modify: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- `OrionHero()` renders the hero, CTA pair, verified metric and model-reference credit.
- `OrionFleet()` owns active gallery state and renders all eight machines.
- `OrionContact()` owns `idle | unconfigured` form state and never claims a request was delivered.
- `OrionSite()` composes the components and owns only mobile navigation state.

- [ ] **Step 1: Add failing UI assertions**

Assert the page exposes `Смотреть парк`, the three verified proof points, a hero label containing `референс модели`, and no text matching `24/7` or `Запрос принят`.

- [ ] **Step 2: Run the focused test**

Expected: FAIL against the current monolithic page.

- [ ] **Step 3: Extract and compose components**

Move hero markup to `OrionHero`, gallery logic to `OrionFleet`, and form logic to `OrionContact`. Keep source links, photo counts, accessible thumbnail names and the honest stories empty state.

Use this unconfigured form response:

```tsx
<p role="status">
  Онлайн-отправка ещё не подключена. Контакт для тендерных заявок будет опубликован после подтверждения компанией.
</p>
```

Add Escape handling for the mobile menu and update `aria-label` between «Открыть меню» and «Закрыть меню».

- [ ] **Step 4: Run the focused test**

Expected: PASS.

### Task 3: Implement the Industrial Cinematic visual system

**Files:**
- Modify: `src/components/orion/orion-site.module.css`

**Interfaces:**
- Provides class names consumed by all ORION components.
- Uses CSS custom properties `--ink`, `--paper`, `--signal`, `--muted`, `--line`.

- [ ] **Step 1: Establish the hero composition**

Make the hero at least `calc(100svh - 82px)`, place the verified equipment photo edge-to-edge, overlay the copy, keep both CTAs above the fold and add a dark gradient scrim.

- [ ] **Step 2: Add progressive motion**

Inside `@supports (animation-timeline: view())`, apply a view-timeline scale/translate animation only to the hero media and a subtle reveal to the next proof section. Keep the final static state outside the feature query.

- [ ] **Step 3: Refine fleet, stories and process**

Use large alternating fleet cards instead of a dense four-column catalogue, a cinematic empty-state panel for stories and a vertical five-step process with restrained orange progress markers.

- [ ] **Step 4: Add responsive and accessibility rules**

At 900px collapse layouts; at 560px use a static hero crop, single-column fleet and full-width CTA buttons. Under `prefers-reduced-motion: reduce`, disable animation and transition. Add visible `:focus-visible` outlines and 44px minimum targets.

### Task 4: Verify the public experience

**Files:**
- Create: `e2e/orion-industrial-cinematic.spec.ts`
- Modify: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Verifies the public route only; does not touch authenticated PilingTrack state.

- [ ] **Step 1: Add E2E coverage**

```ts
test('ORION stays usable at mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/orion');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Свайные работы');
  await expect(page.getByRole('link', { name: /обсудить объект/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
```

Add a reduced-motion context assertion that the hero, park and contact remain visible.

- [ ] **Step 2: Run focused tests and build**

Run:
- `npx vitest run src/components/orion/__tests__/orion-site.test.tsx`
- `npm run build`

Expected: both commands pass and `/orion` appears in the route list.

- [ ] **Step 3: Run browser verification**

Check 1440×900 and 375×812, keyboard navigation, Escape-close menu, gallery thumbnails, no horizontal overflow, console errors and reduced motion.

- [ ] **Step 4: Run GitNexus and commit**

Run `detect_changes({ scope: 'staged' })`; confirm only ORION symbols and tests are affected. Commit implementation without staging unrelated PilingTrack changes.
