# ORION Corporate Site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a public, trust-first ORION corporate site at `/orion` without changing the authenticated PilingTrack product.

**Architecture:** Keep public marketing content in `src/components/orion/` and render it from a dedicated App Router route. Put equipment and future project-story content in typed local content modules; the stories module deliberately renders an honest empty state until ORION supplies real case material.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS 4, Lucide React, Vitest, Playwright.

## Global Constraints

- Preserve the existing `/` auth redirect and all authenticated routes.
- Use only confirmed equipment: PVE 50PR, Liebherr LRH 100 №1/№2, КБУРГ-16.02 №1/№2, Kopernik-SD-20, Banut 655, Bauer RTG RM20.
- Do not publish invented case studies, client logos, certificates, project metrics or equipment specifications.
- Use the existing RTG RM20, Liebherr, PVE and Banut photographs in `public/icons/equipment-photos/`; new remote images must be licensed and attributed before download.
- Meet WCAG AA, keyboard navigation, visible focus, 44px targets and `prefers-reduced-motion`.

---

### Task 1: Establish the ORION content contract and correct the design record

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-orion-corporate-site-design.md`
- Create: `src/components/orion/orion-content.ts`
- Test: `src/components/orion/__tests__/orion-content.test.ts`

**Interfaces:**
- Produces `EquipmentCard`, `ProjectStory`, `orionEquipment`, `orionStories`.
- `orionEquipment` contains exactly eight entries; `orionStories` is initially an empty array.

- [ ] **Step 1: Write the failing content contract test.**

```ts
import { expect, it } from 'vitest';
import { orionEquipment, orionStories } from '../orion-content';

it('publishes the eight confirmed fleet units and no fictional stories', () => {
  expect(orionEquipment.map(({ name }) => name)).toEqual([
    'PVE 50PR', 'Liebherr LRH 100 №1', 'Liebherr LRH 100 №2',
    'КБУРГ-16.02 №1', 'КБУРГ-16.02 №2', 'Kopernik-SD-20',
    'Banut 655', 'Bauer RTG RM20',
  ]);
  expect(orionStories).toEqual([]);
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run src/components/orion/__tests__/orion-content.test.ts`

Expected: FAIL because `orion-content.ts` does not exist.

- [ ] **Step 3: Implement the typed content module.**

```ts
export type EquipmentCard = { name: string; role: string; image: string | null; facts: string[] };
export type ProjectStory = { slug: string; title: string; region: string; cover: string; facts: string[] };
export const orionEquipment: EquipmentCard[] = [/* eight confirmed entries */];
export const orionStories: ProjectStory[] = [];
```

Use actual local paths for available photos and `null` when a licensed image is unavailable; the renderer must show a labelled visual fallback, never a stock substitute.

- [ ] **Step 4: Update the design record.**

Replace its former seven-unit discrepancy with the confirmed Bauer RTG RM20 and retain the rule against fictional cases.

- [ ] **Step 5: Run the test and commit.**

Run: `npx vitest run src/components/orion/__tests__/orion-content.test.ts`

Expected: PASS.

Run: `git add docs/superpowers/specs/2026-07-14-orion-corporate-site-design.md src/components/orion/orion-content.ts src/components/orion/__tests__/orion-content.test.ts && git commit -m "feat(orion): add verified public content contract"`

### Task 2: Build the isolated public route and visual system

**Files:**
- Create: `src/app/orion/page.tsx`
- Create: `src/components/orion/orion-site.tsx`
- Create: `src/components/orion/orion-site.module.css`
- Test: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- `OrionSite()` consumes `orionEquipment` and `orionStories`.
- The route exports metadata for ORION only and does not import authentication code.

- [ ] **Step 1: Write the failing route composition test.**

```tsx
import { render, screen } from '@testing-library/react';
import { OrionSite } from '../orion-site';
it('offers an engineering consultation and labels the empty stories state honestly', () => {
  render(<OrionSite />);
  expect(screen.getByRole('heading', { name: /свайные работы/i })).toBeInTheDocument();
  expect(screen.getByText(/готовим портфолио реализованных объектов/i)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /обсудить объект/i })).toHaveAttribute('href', '#contact');
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx`

Expected: FAIL because `OrionSite` does not exist.

- [ ] **Step 3: Implement the site in semantic sections.**

`OrionSite` must render: skip link; header and mobile menu; hero; proof strip; competencies; fleet; `StoriesEmptyState`; safety/process; tender CTA; contact footer. Use `Image` with declared `sizes`, meaningful alt text and `priority` only for the hero. Use CSS tokens local to the ORION module: graphite surface, engineering blue and amber CTA.

- [ ] **Step 4: Implement the route.**

```tsx
import type { Metadata } from 'next';
import { OrionSite } from '@/components/orion/orion-site';
export const metadata: Metadata = { title: 'ОРИОН — свайные работы и аренда техники', description: 'Инженерная оценка свайных работ и аренда установок с экипажем.' };
export default function OrionPage() { return <OrionSite />; }
```

- [ ] **Step 5: Run component test, typecheck and commit.**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx && npx tsc --noEmit`

Expected: PASS with no TypeScript errors.

Run: `git add src/app/orion/page.tsx src/components/orion && git commit -m "feat(orion): build public trust-first landing page"`

### Task 3: Add an accessible contact interaction and responsive verification

**Files:**
- Modify: `src/components/orion/orion-site.tsx`
- Modify: `src/components/orion/orion-site.module.css`
- Test: `src/components/orion/__tests__/orion-site.test.tsx`
- Create: `e2e/orion-site.spec.ts`

**Interfaces:**
- `ContactForm` manages `idle | submitting | success | error` locally; it makes no external CRM or file-upload request.

- [ ] **Step 1: Write failing unit and E2E assertions.**

```tsx
expect(screen.getByLabelText(/имя/i)).toBeRequired();
expect(screen.getByLabelText(/телефон или e-mail/i)).toBeRequired();
```

```ts
test('ORION page has no horizontal overflow and exposes the consultation CTA', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/orion');
  await expect(page.getByRole('link', { name: /обсудить объект/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
});
```

- [ ] **Step 2: Run tests to verify failure.**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx`

- [ ] **Step 3: Implement form feedback and responsive states.**

Use native labels, `type="email"` / `type="tel"`, disabled submit while submitting, an `aria-live="polite"` success message, inline validation and no attachment control until a destination is approved. Ensure the mobile menu is a semantic button with `aria-expanded` and Escape-close support.

- [ ] **Step 4: Verify in browser and automated tests.**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx && npx playwright test e2e/orion-site.spec.ts --project=chromium --workers=1`

Expected: PASS at 375px and desktop; no horizontal overflow.

- [ ] **Step 5: Final quality gate and commit.**

Run: `npm run lint && npx tsc --noEmit`

Run GitNexus `detect_changes({ scope: 'all' })`, review unexpected affected flows, then commit only expected ORION files.
