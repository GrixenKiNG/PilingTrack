# ORION Tender-First Industrial Cinematic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the live ORION route around procurement trust, verified evidence, sourced fleet documentation, and an accessible Industrial Cinematic presentation.

**Architecture:** Keep the existing Next.js App Router page and focused ORION component boundary. Preserve equipment data, profile panels, PDFs, and the working lead API. Recompose the page in `OrionSite`, refine the hero/fleet/contact components, and centralize the visual system in the existing CSS Module.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Vitest, Testing Library, Playwright.

## Global Constraints

- Publish no invented case outcomes, clients, dates, volumes, prices, certifications, availability, or technical specifications.
- The fleet contains exactly eight units; Bauer RTG RM20 is unit 08.
- Every fleet unit exposes five source-linked photographs.
- Every equipment profile uses its existing Russian PDF and original source.
- Keep the working POST `/api/orion/lead` integration.
- Touch targets are at least 44px; mobile baseline is 375px.
- Respect `prefers-reduced-motion`.
- Run GitNexus impact before editing each function and detect_changes before any commit.

---

### Task 1: Lock the evidence contract in tests

**Files:**
- Modify: `src/components/orion/__tests__/orion-site.test.tsx`
- Read: `src/components/orion/orion-content.ts`

**Interfaces:**
- Consumes: `orionEquipment`, `orionProofPoints`, `orionStories`, `orionEquipmentProfiles`.
- Produces: regression assertions for tender CTA, honest story empty state, eight-unit fleet, source links, and working engineering form.

- [ ] **Step 1: Replace the named-project rendering assertion with the honest evidence-state contract**

Assert that the rendered page includes:
```ts
expect(screen.getByRole('heading', { name: /&#1076;&#1086;&#1082;&#1072;&#1079;&#1072;&#1090;&#1077;&#1083;&#1100;&#1089;&#1090;&#1074;&#1072;, &#1072; &#1085;&#1077; &#1088;&#1077;&#1082;&#1083;&#1072;&#1084;&#1085;&#1099;&#1077; &#1082;&#1077;&#1081;&#1089;&#1099;/i })).toBeInTheDocument();
expect(screen.getByText(/&#1088;&#1077;&#1072;&#1083;&#1100;&#1085;&#1099;&#1077; &#1092;&#1086;&#1090;&#1086; &#1080; &#1092;&#1072;&#1082;&#1090;&#1099; &#1087;&#1086; &#1086;&#1073;&#1098;&#1077;&#1082;&#1090;&#1072;&#1084; &#1073;&#1091;&#1076;&#1091;&#1090; &#1086;&#1087;&#1091;&#1073;&#1083;&#1080;&#1082;&#1086;&#1074;&#1072;&#1085;&#1099; &#1087;&#1086;&#1089;&#1083;&#1077; &#1087;&#1086;&#1076;&#1090;&#1074;&#1077;&#1088;&#1078;&#1076;&#1077;&#1085;&#1080;&#1103;/i)).toBeInTheDocument();
expect(screen.queryByText(/&#1042;&#1077;&#1088;&#1093;&#1086;&#1074;&#1085;&#1099;&#1081; &#1057;&#1091;&#1076; &#1063;&#1091;&#1074;&#1072;&#1096;&#1089;&#1082;&#1086;&#1081; &#1056;&#1077;&#1089;&#1087;&#1091;&#1073;&#1083;&#1080;&#1082;&#1080;/i)).not.toBeInTheDocument();
```

- [ ] **Step 2: Add tender CTA and qualification proof assertions**

```ts
expect(screen.getAllByRole('link', { name: /&#1087;&#1086;&#1083;&#1091;&#1095;&#1080;&#1090;&#1100; &#1090;&#1077;&#1085;&#1076;&#1077;&#1088;&#1085;&#1099;&#1081; &#1087;&#1072;&#1082;&#1077;&#1090;/i }).length).toBeGreaterThan(0);
expect(screen.getByText(/8 &#1077;&#1076;&#1080;&#1085;&#1080;&#1094; &#1090;&#1077;&#1093;&#1085;&#1080;&#1082;&#1080;/i)).toBeInTheDocument();
expect(screen.getByText(/&#1088;&#1072;&#1073;&#1086;&#1090;&#1072; &#1087;&#1086; &#1087;&#1088;&#1086;&#1077;&#1082;&#1090;&#1091; &#1080; &#1055;&#1055;&#1056;/i)).toBeInTheDocument();
```

- [ ] **Step 3: Run the focused test and verify the new assertions fail**

Run:
```powershell
npx.cmd vitest run src/components/orion/__tests__/orion-site.test.tsx
```

Expected: FAIL because the old page still renders named objects and lacks the new tender-first copy.

### Task 2: Recompose the page around procurement trust

**Files:**
- Modify: `src/components/orion/orion-site.tsx`
- Modify: `src/components/orion/orion-hero.tsx`
- Modify: `src/components/orion/orion-content.ts`
- Modify: `src/components/orion/orion-site.module.css`

**Interfaces:**
- Consumes: existing equipment arrays, company facts, process steps, requisites, and `OrionFleet`.
- Produces: header, hero, qualification proof, engineering matrix, tender-readiness section, digital-control section, honest project-story state, process, and contact composition.

- [ ] **Step 1: Update hero actions and copy**

Use two distinct anchors:
```tsx
<a className={styles.primaryButton} href="#contact">&#1054;&#1073;&#1089;&#1091;&#1076;&#1080;&#1090;&#1100; &#1086;&#1073;&#1098;&#1077;&#1082;&#1090;</a>
<a className={styles.secondaryButton} href="#tender">&#1055;&#1086;&#1083;&#1091;&#1095;&#1080;&#1090;&#1100; &#1090;&#1077;&#1085;&#1076;&#1077;&#1088;&#1085;&#1099;&#1081; &#1087;&#1072;&#1082;&#1077;&#1090;</a>
```

Keep the sourced Bauer model reference and remove any unsupported performance promise.

- [ ] **Step 2: Replace generic capability cards with an engineering matrix**

Each row must show:
```tsx
<article className={styles.solutionRow}>
  <span>01</span>
  <h3>&#1055;&#1086;&#1075;&#1088;&#1091;&#1078;&#1077;&#1085;&#1080;&#1077; &#1089;&#1074;&#1072;&#1081;</h3>
  <p>&#1055;&#1086;&#1076;&#1073;&#1086;&#1088; &#1090;&#1077;&#1093;&#1085;&#1086;&#1083;&#1086;&#1075;&#1080;&#1080; &#1087;&#1086; &#1087;&#1088;&#1086;&#1077;&#1082;&#1090;&#1091;, &#1075;&#1088;&#1091;&#1085;&#1090;&#1072;&#1084; &#1080; &#1086;&#1075;&#1088;&#1072;&#1085;&#1080;&#1095;&#1077;&#1085;&#1080;&#1103;&#1084; &#1087;&#1083;&#1086;&#1097;&#1072;&#1076;&#1082;&#1080;.</p>
  <p>&#1058;&#1077;&#1093;&#1085;&#1080;&#1082;&#1072; -> &#1082;&#1086;&#1085;&#1090;&#1088;&#1086;&#1083;&#1100; -> &#1080;&#1089;&#1087;&#1086;&#1083;&#1085;&#1080;&#1090;&#1077;&#1083;&#1100;&#1085;&#1099;&#1077; &#1076;&#1072;&#1085;&#1085;&#1099;&#1077;</p>
</article>
```

- [ ] **Step 3: Add the tender-readiness section with verified boundaries**

The section contains:
- Fleet passport and original-source package.
- Project/PPR workflow.
- Crew-operated rental.
- Required customer inputs: project excerpt, pile schedule, site location, requested dates.
- Direct engineering request CTA.

Do not claim certifications or document availability that are absent from the repository.

- [ ] **Step 4: Replace named project tiles with an honest empty state**

Render two editorial panels:
- `&#1048;&#1089;&#1090;&#1086;&#1088;&#1080;&#1080; &#1086;&#1073;&#1098;&#1077;&#1082;&#1090;&#1086;&#1074;`: future format `&#1079;&#1072;&#1076;&#1072;&#1095;&#1072; -> &#1088;&#1077;&#1096;&#1077;&#1085;&#1080;&#1077; -> &#1087;&#1086;&#1076;&#1090;&#1074;&#1077;&#1088;&#1078;&#1076;&#1077;&#1085;&#1085;&#1099;&#1081; &#1088;&#1077;&#1079;&#1091;&#1083;&#1100;&#1090;&#1072;&#1090;`.
- `&#1052;&#1072;&#1090;&#1077;&#1088;&#1080;&#1072;&#1083;&#1099; &#1075;&#1086;&#1090;&#1086;&#1074;&#1103;&#1090;&#1089;&#1103;`: real photographs and facts appear only after ORION confirmation.

Do not render `orionObjects` or `orionClients` as public proof.

- [ ] **Step 5: Implement the token-driven responsive CSS**

Add semantic tokens for:
```css
--orion-background;
--orion-surface;
--orion-paper;
--orion-text;
--orion-text-muted;
--orion-border;
--orion-accent;
--orion-technical;
--orion-motion-fast;
--orion-motion-base;
```

Ensure all buttons, navigation items, source links, thumbnails, form controls, and footer contact links have a minimum 44px interactive box.

- [ ] **Step 6: Run the focused test**

Run:
```powershell
npx.cmd vitest run src/components/orion/__tests__/orion-site.test.tsx
```

Expected: PASS.

### Task 3: Turn the fleet into verifiable equipment evidence

**Files:**
- Modify: `src/components/orion/orion-fleet.tsx`
- Modify: `src/components/orion/orion-equipment-profile.tsx` only if accessible labelling requires it
- Modify: `src/components/orion/orion-site.module.css`
- Test: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Consumes: `orionEquipment`, `orionEquipmentProfiles`.
- Produces: featured unit 08 context, five-photo galleries, source attribution, independent profile disclosures, Russian PDF downloads.

- [ ] **Step 1: Add evidence language to the fleet heading**

State that photographs are model references from named sources and that ownership/availability is confirmed directly for a tender.

- [ ] **Step 2: Make Bauer RTG RM20 visually identifiable as unit 08**

Use data, not a duplicate hard-coded equipment record:
```ts
const isFeaturedTenderUnit = equipment.name === 'Bauer RTG RM20';
```

Apply a semantic badge and retain the original list order required by the test.

- [ ] **Step 3: Preserve accessible gallery and profile interactions**

Retain:
- `aria-pressed` on thumbnails.
- `aria-expanded` and `aria-controls` on profile toggles.
- Labelled profile regions.
- PDF `download` attribute.
- Original-source links opening with `rel="noreferrer"`.

- [ ] **Step 4: Verify all eight units and profiles**

Run the focused Vitest file. Expected: 8 units, 5 photos each, 6 sourced profiles, all assertions PASS.

### Task 4: Refine the engineering request flow

**Files:**
- Modify: `src/components/orion/orion-contact.tsx`
- Modify: `src/components/orion/orion-site.module.css`
- Read: `src/app/api/orion/lead/route.ts`
- Test: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Consumes: existing JSON payload `{ name, contact, message, consent, website }`.
- Produces: procurement-oriented form copy without breaking the endpoint contract.

- [ ] **Step 1: Preserve the API payload and improve field guidance**

Use visible labels and placeholders that request company, object type, region, pile type, and requested dates through the existing message field. Do not add a decorative file upload unless the API accepts it.

- [ ] **Step 2: Add a document handoff instruction**

Tell the customer that project/PPR/pile schedule files can be sent to the published email after the request. Make the email link at least 44px high.

- [ ] **Step 3: Keep all form states accessible**

Retain `role="status"` for success, `role="alert"` for errors, disabled sending button, required consent, and honeypot.

- [ ] **Step 4: Test submission contract**

Mock `fetch`, submit valid form data, assert:
```ts
expect(fetch).toHaveBeenCalledWith('/api/orion/lead', expect.objectContaining({ method: 'POST' }));
```

Expected: PASS.

### Task 5: Metadata, browser QA, and production verification

**Files:**
- Modify: `src/app/orion/page.tsx`
- Verify: `src/components/orion/orion-site.module.css`
- Verify: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Consumes: completed ORION page.
- Produces: search metadata and evidence-backed completion report.

- [ ] **Step 1: Refine metadata**

Title mentions ORION, pile works, and equipment rental. Description mentions engineering assessment, PPR workflow, eight-unit fleet, and sourced technical passports without unsupported geography.

- [ ] **Step 2: Run focused tests**

```powershell
npx.cmd vitest run src/components/orion/__tests__/orion-site.test.tsx
```

Expected: all tests PASS.

- [ ] **Step 3: Run text-integrity and production build**

```powershell
npm.cmd run check:text-integrity
npm.cmd run build
```

Expected: exit code 0 for both commands.

- [ ] **Step 4: Browser QA at desktop, tablet, and mobile**

Open `http://localhost:3000/orion` at:
- 1440x1000
- 768x1024
- 375x812

Verify:
- no horizontal overflow;
- hero CTAs reach distinct targets;
- mobile menu opens, closes on selection, and closes on Escape;
- all 8 fleet items render;
- gallery thumbnails switch the active image;
- profile disclosure opens and exposes PDF/source actions;
- story section contains no named unverified case;
- form validation, sending, sent, and error states remain usable;
- touch targets are at least 44px.

- [ ] **Step 5: Run GitNexus change detection**

```text
detect_changes(scope: "all", repo: "PilingTrack")
```

Review every changed symbol and affected process. Do not commit if unrelated flows are reported.

- [ ] **Step 6: Run completion audit**

Map every item in the design specification success criteria to test output, build output, browser state, or source evidence. Keep the goal active if any item lacks direct evidence.

