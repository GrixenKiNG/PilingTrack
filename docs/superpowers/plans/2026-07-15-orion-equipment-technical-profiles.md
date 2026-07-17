# ORION Equipment Technical Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add sourced Russian technical profiles, accessible expandable specifications, and six downloadable ORION PDF cards for the equipment fleet.

**Architecture:** Keep model facts in a dedicated typed profile module and reference them from the eight equipment instances by `profileKey`. Render a compact three-metric summary and an independently expandable details panel in `OrionFleet`. Generate stable Russian PDFs from the same profile data with PDFKit and DejaVu Sans so website and documents cannot drift.

**Tech Stack:** Next.js 16, React 19, TypeScript, CSS Modules, Vitest/Testing Library, Playwright, PDFKit, DejaVu Sans, Python pypdf/pdfplumber and Poppler for verification.

## Global Constraints

- Publish 8 equipment cards backed by exactly 6 unique model profiles.
- Show only values explicitly supported by a cited source.
- Display: «Справочные характеристики модели. Фактическая комплектация конкретной установки уточняется по паспорту машины».
- Create one Russian PDF per unique model under `public/orion/specs/`.
- Russian PDFs are ORION summaries, not official translations.
- Do not copy foreign manufacturer PDFs into the repository; link to originals externally.
- Preserve the existing Industrial Cinematic visual language and mobile behavior.
- Before editing a function or component, run GitNexus upstream impact and stop for HIGH or CRITICAL risk.
- Before every commit, run GitNexus `detect_changes({ scope: "staged" })`.

---

### Task 1: Typed source-backed model profiles

**Files:**
- Create: `src/components/orion/orion-equipment-profiles.ts`
- Modify: `src/components/orion/orion-content.ts`
- Modify: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Produces: `OrionEquipmentProfile`, `OrionSpecification`, `ORION_PROFILE_DISCLAIMER`, `orionEquipmentProfiles: Record<OrionEquipmentProfileKey, OrionEquipmentProfile>`.
- Changes `OrionEquipment` to consume `profileKey: OrionEquipmentProfileKey`.
- Later tasks read profiles only through `orionEquipmentProfiles[equipment.profileKey]`.

- [ ] **Step 1: Run impact analysis**

Run GitNexus `impact({ target: "OrionSite", direction: "upstream", repo: "PilingTrack" })` and `impact({ target: "OrionFleet", direction: "upstream", repo: "PilingTrack" })`.
Expected: report callers, processes and risk before edits.

- [ ] **Step 2: Write the failing data tests**

Add assertions:

```ts
expect(new Set(orionEquipment.map((item) => item.profileKey))).toHaveLength(6);

for (const profile of Object.values(orionEquipmentProfiles)) {
  expect(profile.description.length).toBeGreaterThan(80);
  expect(profile.specifications.length).toBeGreaterThanOrEqual(3);
  expect(profile.features.length).toBeGreaterThanOrEqual(3);
  expect(profile.source.url).toMatch(/^https:\/\//);
  expect(profile.pdfPath).toMatch(/^\/orion\/specs\/.+\.pdf$/);
  expect(profile.disclaimer).toBe(ORION_PROFILE_DISCLAIMER);
}
```

- [ ] **Step 3: Run the test and verify failure**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx`
Expected: FAIL because profile exports and `profileKey` do not exist.

- [ ] **Step 4: Add the profile types and six records**

Define:

```ts
export type OrionEquipmentProfileKey =
  | 'pve-50pr'
  | 'liebherr-lrh100'
  | 'kburg-16'
  | 'kopernik-sd20c'
  | 'banut-655'
  | 'bauer-rtg-rm20';

export type OrionSpecification = {
  label: string;
  value: string;
  featured?: boolean;
};

export type OrionEquipmentProfile = {
  model: string;
  description: string;
  specifications: readonly OrionSpecification[];
  features: readonly string[];
  source: { label: string; url: string };
  pdfPath: string;
  preparedAt: '15.07.2026';
  disclaimer: typeof ORION_PROFILE_DISCLAIMER;
};

export const ORION_PROFILE_DISCLAIMER =
  'Справочные характеристики модели. Фактическая комплектация конкретной установки уточняется по паспорту машины.';
```

Populate only sourced values:

- PVE 50PR: leader 24.8/27.8 m, pile+hammer 18.5 t, engine 250 hp, operating mass 51 t, transport width 3.45 m.
- Liebherr LRH 100: pile 19.0 m, operating mass 65 t, drop weight 2.5-7 t, inclination +/-18.4°, assembled transport.
- КБУРГ-16: pile 16 m, section 400x400 mm, pile mass 6.5 t, installation mass 49.1 t, drill speed 23 rpm.
- Kopernik SD-20C: mass 57 t without tool, 267 hp, drilling 2000 mm with casing/1500 mm without, mast 21.57 m, rotation 8-30 rpm.
- Banut 655: pile 20 m, useful leader 15 m, mass about 70 t, engine 261 kW, pile 8.5-12 t, mast inclinations 18/45° and 18°.
- Bauer RTG RM20: pile 20 m, drop weight 10 t, engine 201 kW, height 25.7 m, mass about 68.6 t with HRS 5.

- [ ] **Step 5: Link all eight equipment instances to profiles**

Add the correct `profileKey` to every item. LRH №1/№2 share `liebherr-lrh100`; КБУРГ №1/№2 share `kburg-16`.

- [ ] **Step 6: Run tests**

Run: `npx vitest run src/components/orion/__tests__/orion-site.test.tsx`
Expected: PASS.

- [ ] **Step 7: Stage, inspect and commit**

Run GitNexus staged `detect_changes`, then commit only Task 1 files:

```powershell
git add src/components/orion/orion-equipment-profiles.ts src/components/orion/orion-content.ts src/components/orion/__tests__/orion-site.test.tsx
git commit -m "feat(orion): add sourced equipment profiles"
```

### Task 2: Accessible expandable technical passport

**Files:**
- Create: `src/components/orion/orion-equipment-profile.tsx`
- Modify: `src/components/orion/orion-fleet.tsx`
- Modify: `src/components/orion/orion-site.module.css`
- Modify: `src/components/orion/__tests__/orion-site.test.tsx`

**Interfaces:**
- Consumes: `OrionEquipmentProfile`.
- Produces: `OrionEquipmentProfilePanel({ profile, panelId, expanded, onToggle })`.

- [ ] **Step 1: Run impact analysis for `OrionFleet`**

Expected: report risk and callers before editing.

- [ ] **Step 2: Write failing interaction tests**

```ts
const toggle = screen.getByRole('button', {
  name: /все характеристики pve 50pr/i,
});
expect(toggle).toHaveAttribute('aria-expanded', 'false');
fireEvent.click(toggle);
expect(toggle).toHaveAttribute('aria-expanded', 'true');
expect(screen.getByRole('region', { name: /технические характеристики pve 50pr/i })).toBeVisible();
expect(screen.getByRole('link', { name: /скачать pdf на русском/i })).toHaveAttribute(
  'href',
  '/orion/specs/pve-50pr.pdf',
);
```

- [ ] **Step 3: Verify the interaction test fails**

Run the focused Vitest file.
Expected: FAIL because the toggle and region do not exist.

- [ ] **Step 4: Implement the panel**

Render three featured specifications outside the collapsible region. The toggle must set `aria-expanded` and `aria-controls`. The expanded region contains description, a semantic `dl`, features, disclaimer, download link with `download`, and external source link with `target="_blank" rel="noreferrer"`.

- [ ] **Step 5: Add independent expansion state**

Use `Record<string, boolean>` in `OrionFleet`, keyed by equipment name, so multiple machines can remain open. Generate stable panel IDs from the map index and profile key.

- [ ] **Step 6: Add Industrial Cinematic styles**

Add CSS classes `machineHighlights`, `profileToggle`, `profilePanel`, `specGrid`, `featureList`, `profileNotice`, and `profileActions`. At <=560 px, use one-column specification rows and full-width actions. Under reduced motion, disable panel transition.

- [ ] **Step 7: Run unit and component tests**

Run the focused Vitest file.
Expected: PASS.

- [ ] **Step 8: Stage, detect and commit**

```powershell
git add src/components/orion/orion-equipment-profile.tsx src/components/orion/orion-fleet.tsx src/components/orion/orion-site.module.css src/components/orion/__tests__/orion-site.test.tsx
git commit -m "feat(orion): add expandable equipment passports"
```

### Task 3: Six Russian PDF cards generated from shared data

**Files:**
- Create: `scripts/generate-orion-equipment-pdfs.ts`
- Create: `scripts/verify-orion-equipment-pdfs.py`
- Create: `public/orion/specs/pve-50pr.pdf`
- Create: `public/orion/specs/liebherr-lrh100.pdf`
- Create: `public/orion/specs/kburg-16.pdf`
- Create: `public/orion/specs/kopernik-sd20c.pdf`
- Create: `public/orion/specs/banut-655.pdf`
- Create: `public/orion/specs/bauer-rtg-rm20.pdf`

**Interfaces:**
- Consumes: `orionEquipmentProfiles`.
- Produces stable PDFs at every profile's `pdfPath`.

- [ ] **Step 1: Add a failing PDF verifier**

The Python script must use `pypdf.PdfReader`, require exactly six filenames, extract all page text, and assert model name, source URL host, and the phrase `Справочные характеристики модели`.

- [ ] **Step 2: Run the verifier and confirm failure**

Run: `python scripts/verify-orion-equipment-pdfs.py`
Expected: FAIL listing six missing PDFs.

- [ ] **Step 3: Implement PDF generation with PDFKit**

Use `public/fonts/DejaVuSans.ttf` and `DejaVuSans-Bold.ttf`. Generate A4 documents with graphite header, orange accent, model title, summary, two-column specification table, numbered features, disclaimer box, source URL and footer `ОРИОН · 15.07.2026`. Create the output directory recursively and overwrite deterministically.

- [ ] **Step 4: Generate all PDFs**

Run: `npx tsx scripts/generate-orion-equipment-pdfs.ts`
Expected: six files reported with non-zero byte sizes.

- [ ] **Step 5: Verify extracted text**

Run: `python scripts/verify-orion-equipment-pdfs.py`
Expected: `6 ORION equipment PDFs verified`.

- [ ] **Step 6: Render every PDF for visual inspection**

Run:

```powershell
New-Item -ItemType Directory -Force tmp/pdfs
Get-ChildItem public/orion/specs/*.pdf | ForEach-Object {
  pdftoppm -png -r 130 $_.FullName ("tmp/pdfs/" + $_.BaseName)
}
```

Inspect all rendered pages for clipped Cyrillic, overlaps, broken tables, black squares, footer/page alignment and readable URLs. Correct the generator and repeat generation, extraction and rendering if any defect is found.

- [ ] **Step 7: Stage, detect and commit**

```powershell
git add scripts/generate-orion-equipment-pdfs.ts scripts/verify-orion-equipment-pdfs.py public/orion/specs
git commit -m "feat(orion): add Russian equipment PDF cards"
```

### Task 4: Mobile E2E and final verification

**Files:**
- Modify: `e2e/orion-industrial-cinematic.spec.ts`

**Interfaces:**
- Consumes the final ORION fleet UI and six PDF paths.
- Produces regression coverage only.

- [ ] **Step 1: Add a failing mobile E2E scenario**

At 375x812, open `/orion`, scroll to PVE 50PR, click «Все характеристики PVE 50PR», assert the region, disclaimer, PDF link, external source link and `scrollWidth <= clientWidth`. Focus the toggle and press Enter to close it.

- [ ] **Step 2: Run E2E against a clean local server and verify failure before implementation if possible**

Run the app on a free port and execute only `e2e/orion-industrial-cinematic.spec.ts`.
Expected before Tasks 1-3: FAIL; after Tasks 1-3: PASS.

- [ ] **Step 3: Run final verification**

```powershell
npx vitest run src/components/orion/__tests__/orion-site.test.tsx
python scripts/verify-orion-equipment-pdfs.py
npm.cmd run build
$env:BASE_URL='http://localhost:3187'; npx.cmd playwright test e2e/orion-industrial-cinematic.spec.ts --project=chromium --workers=1
git diff --check
```

Expected: unit PASS, six PDFs verified, build exit 0, all ORION E2E scenarios PASS, no diff-check output.

- [ ] **Step 4: Visual browser review**

Use `autoglm-browser-agent` first. If unavailable, use Playwright fallback. Check desktop and 375 px mobile views, expanded and collapsed profiles, keyboard control, download actions, reduced motion, console errors and horizontal overflow.

- [ ] **Step 5: Final GitNexus review and commit**

Stage only the E2E file, run `detect_changes({ scope: "staged" })`, confirm expected ORION-only scope, then:

```powershell
git commit -m "test(orion): cover equipment technical profiles"
```

- [ ] **Step 6: Report handoff**

Report commit hashes, six PDF paths, source attribution policy, exact verification counts and any remaining need for machine passports.
