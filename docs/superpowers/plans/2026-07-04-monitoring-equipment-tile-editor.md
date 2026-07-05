# Monitoring Equipment Tile Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local, template-driven visual editor for one shared monitoring equipment tile layout, including grid resizing, block creation/removal, arbitrary text, typography, borders, alignment, preview, undo/redo, save, and reset.

**Architecture:** Separate the persisted versioned template from pure grid operations and React rendering. `EquipmentTileRenderer` consumes `FleetCard + EquipmentTileTemplate`; `EquipmentTileEditor` edits a draft template and commits it through a local storage adapter. `FleetDashboard` owns the shared template so every visible equipment tile uses the same layout.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Tailwind CSS 4, Vitest 4, Testing Library, browser `localStorage`; no new runtime dependency.

## Global Constraints

- Preserve all unrelated uncommitted user changes in the worktree.
- Run GitNexus impact analysis before modifying every existing function or component symbol.
- Run `mcp__gitnexus__detect_changes` before each implementation commit.
- Use one shared template for all equipment cards; do not add per-equipment templates.
- Persist only layout and presentation, never operational `FleetCard` values.
- Store the first release under `monitoring-equipment-tile-template-v1` in `localStorage`.
- Keep `/monitoring?design=1` as the local editor unlock; normal users must not see editing controls.
- Use a 12-column integer grid and prevent out-of-bounds placement.
- Do not add server storage, collaboration, or arbitrary external image URLs.
- Accept local JPG, PNG, and WebP files up to 12 MB; store blobs in IndexedDB and keep only `assetId` in the template.
- All editor actions must remain keyboard reachable with visible focus states and 44px minimum action targets.

---

### Task 1: Versioned template model, validation, and local persistence

**Files:**
- Create: `src/components/piling/monitoring/equipment-tile-template.ts`
- Create: `src/components/piling/monitoring/equipment-tile-storage.ts`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-template.test.ts`

**Interfaces:**
- Produces: `EquipmentTileTemplate`, `EquipmentTileBlock`, `EquipmentTileBlockStyle`, `EquipmentTileDataKey`, `DEFAULT_EQUIPMENT_TILE_TEMPLATE`, `validateEquipmentTileTemplate(value)`, `loadEquipmentTileTemplate(storage)`, `saveEquipmentTileTemplate(storage, template)`, `resetEquipmentTileTemplate(storage)`.

- [ ] **Step 1: Write failing schema and storage tests**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE, validateEquipmentTileTemplate } from '../equipment-tile-template';
import { loadEquipmentTileTemplate, saveEquipmentTileTemplate } from '../equipment-tile-storage';

describe('equipment tile template', () => {
  it('accepts the default template', () => {
    expect(validateEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE)).toEqual(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  });

  it('rejects blocks outside the 12-column grid', () => {
    const invalid = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    invalid.blocks[0].x = 12;
    expect(validateEquipmentTileTemplate(invalid)).toBeNull();
  });

  it('falls back when local JSON is corrupt', () => {
    const storage = { getItem: () => '{broken', setItem: () => undefined, removeItem: () => undefined };
    expect(loadEquipmentTileTemplate(storage)).toEqual(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  });

  it('round-trips a valid template', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    };
    saveEquipmentTileTemplate(storage, DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    expect(loadEquipmentTileTemplate(storage)).toEqual(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
  });
});
```

- [ ] **Step 2: Run the test and verify missing-module failure**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-template.test.ts`

Expected: FAIL because `equipment-tile-template` and `equipment-tile-storage` do not exist.

- [ ] **Step 3: Implement the model and strict validator**

Define `version: 1`, card dimensions/styles, and blocks with integer `x`, `y`, `width`, and `height`. Accept only known kinds (`data`, `text`, `divider`, `image`) and known `dataKey` values. Clone valid input before returning it so callers cannot mutate storage-owned state.

```ts
export const EQUIPMENT_TILE_COLUMNS = 12;
export type EquipmentTileBlockKind = 'data' | 'text' | 'divider' | 'image';
export type EquipmentTileDataKey =
  | 'photo' | 'identity' | 'status' | 'inventoryNumber'
  | 'site' | 'operator' | 'engineHours' | 'maintenance'
  | 'todayPiles' | 'todayDrilling' | 'todayDowntime' | 'maintenanceAlert';

export interface EquipmentTileBlockStyle {
  background: string;
  color: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  padding: number;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  textAlign: 'left' | 'center' | 'right';
  alignItems: 'start' | 'center' | 'end';
}
```

The default template must reproduce the current photo, identity/status overlay, assignment row, meter row, today metrics, and maintenance alert using only honest `FleetCard` fields.

- [ ] **Step 4: Implement storage adapter functions**

Use a structural `StorageLike` interface (`getItem`, `setItem`, `removeItem`). `load` catches parse errors and returns a deep clone of the default; `save` validates before serializing and throws `TypeError('Invalid equipment tile template')` for invalid input.

- [ ] **Step 5: Run focused tests**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-template.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the self-contained template layer**

Stage only the three Task 1 files, run GitNexus change detection, then commit with `feat(monitoring): add equipment tile template model`.

### Task 2: Pure grid placement, resizing, collision resolution, and history

**Files:**
- Create: `src/components/piling/monitoring/equipment-tile-layout.ts`
- Create: `src/components/piling/monitoring/equipment-tile-history.ts`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-layout.test.ts`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-history.test.ts`

**Interfaces:**
- Consumes: `EquipmentTileBlock`, `EquipmentTileTemplate`.
- Produces: `clampBlockToGrid(block)`, `blocksOverlap(a, b)`, `placeBlock(block, blocks)`, `resizeBlock(block, nextSize, blocks)`, `createTemplateHistory(initial)`, and `TemplateHistory` with `present`, `undo()`, `redo()`, `push(next)`, `canUndo`, `canRedo`.

- [ ] **Step 1: Write failing tests for bounds, collision, and history**

```ts
it('clamps a resized block to 12 columns', () => {
  expect(clampBlockToGrid({ ...block, x: 10, width: 5 })).toMatchObject({ x: 10, width: 2 });
});

it('moves a colliding block to the first free row', () => {
  const placed = placeBlock({ ...block, x: 0, y: 0 }, [{ ...block, id: 'occupied', x: 0, y: 0 }]);
  expect(placed.y).toBe(block.height);
});

it('supports undo and redo without mutating snapshots', () => {
  const history = createTemplateHistory(template);
  history.push({ ...template, card: { ...template.card, width: 360 } });
  expect(history.undo().card.width).toBe(template.card.width);
  expect(history.redo().card.width).toBe(360);
});
```

- [ ] **Step 2: Run tests and verify missing-module failures**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-layout.test.ts src/components/piling/monitoring/__tests__/equipment-tile-history.test.ts`

Expected: FAIL because the layout and history modules do not exist.

- [ ] **Step 3: Implement deterministic layout functions**

Use integer normalization, minimum `width = 1`, `height = 1`, `x ∈ [0, 11]`, `y ≥ 0`, and `x + width ≤ 12`. Collision resolution scans rows from requested `y` downward and columns from requested `x`, wrapping to column zero when required; it returns the first legal rectangle.

- [ ] **Step 4: Implement immutable bounded history**

Store at most 50 snapshots. `push` drops the redo branch, ignores structurally identical JSON snapshots, and deep-clones input/output.

- [ ] **Step 5: Run both focused suites**

Expected: PASS with no mutation failures.

- [ ] **Step 6: Commit grid and history primitives**

Run GitNexus change detection for staged files and commit with `feat(monitoring): add tile grid operations`.

### Task 3: Template-driven equipment tile renderer

**Files:**
- Create: `src/components/piling/monitoring/equipment-tile-renderer.tsx`
- Create: `src/components/piling/monitoring/equipment-tile-block.tsx`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-renderer.test.tsx`
- Modify: `src/components/piling/monitoring/equipment-card.tsx`

**Interfaces:**
- Consumes: `FleetCard`, `EquipmentTileTemplate`, `EquipmentTileBlock`.
- Produces: `<EquipmentTileRenderer card template editing? selectedBlockId? onSelectBlock? />` and keeps `<EquipmentCard card template />` as the role-aware navigation wrapper.

- [ ] **Step 1: Run GitNexus impact analysis for `EquipmentCard` and report the blast radius**

Expected: only `FleetDashboard` as a direct production caller; warn before editing if risk is HIGH or CRITICAL.

- [ ] **Step 2: Write renderer tests**

Test that two cards with different `FleetCard` data share positions/styles while rendering their own site/operator values; test arbitrary text; test hidden blocks; test unknown/empty data as `—`; test editing selection is a button-like keyboard target while normal rendering remains non-interactive.

- [ ] **Step 3: Run renderer tests and verify failure**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-renderer.test.tsx`

Expected: FAIL because `EquipmentTileRenderer` does not exist.

- [ ] **Step 4: Implement block value mapping**

`equipment-tile-block.tsx` maps every `EquipmentTileDataKey` to existing real fields and helpers (`formatHours`, `formatFixed`, `checkMaintenanceDue`, `getEquipmentPhoto`, `KIND_LABEL`). It must not synthesize telemetry, plan/fact, or trend values.

- [ ] **Step 5: Implement CSS Grid renderer**

Render blocks with `gridColumn: \`${x + 1} / span ${width}\`` and `gridRow: \`${y + 1} / span ${height}\``. Convert style numbers to bounded inline styles. In editing mode show a selected outline, overflow warning, and a stable `data-block-id`; outside editing mode omit all editor chrome.

- [ ] **Step 6: Refactor `EquipmentCard` into a navigation wrapper**

Preserve ADMIN/DISPATCHER linking and operator plain-card behavior. Replace its fixed internal layout with `EquipmentTileRenderer`; do not alter route permissions or card destination.

- [ ] **Step 7: Run renderer tests and TypeScript check**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-renderer.test.tsx`

Run: `npx.cmd tsc --noEmit --pretty false`

Expected: both PASS.

- [ ] **Step 8: Commit renderer refactor**

Run GitNexus staged change detection and commit with `refactor(monitoring): render equipment cards from template`.

### Task 4: Visual editor state, canvas interactions, library, and inspector

**Files:**
- Create: `src/components/piling/monitoring/use-equipment-tile-template.ts`
- Create: `src/components/piling/monitoring/equipment-tile-editor.tsx`
- Create: `src/components/piling/monitoring/equipment-tile-canvas.tsx`
- Create: `src/components/piling/monitoring/equipment-tile-block-library.tsx`
- Create: `src/components/piling/monitoring/equipment-tile-inspector.tsx`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx`

**Interfaces:**
- Consumes: template/storage/layout/history modules and `EquipmentTileRenderer`.
- Produces: `useEquipmentTileTemplate()` with `template`, `draft`, `unlocked`, `editing`, `dirty`, `startEditing`, `cancelEditing`, `saveDraft`, `reset`, `updateDraft`; `<EquipmentTileEditor card controller />`.

- [ ] **Step 1: Write failing component tests**

Cover unlock from `?design=1`, explicit edit mode, add arbitrary text, select a block, edit text/font/alignment/border, delete and restore a data block, undo/redo, preview, save, reset, and cancel with dirty confirmation callback.

- [ ] **Step 2: Run the focused editor suite and verify failure**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx`

Expected: FAIL because editor modules do not exist.

- [ ] **Step 3: Implement the controller hook**

Read `window.location.search` only in an effect. Set the existing `monitoring-design-unlocked` flag for backward compatibility. Maintain saved `template` separately from editable `draft`; only `saveDraft` writes storage. `cancelEditing` restores the saved snapshot.

- [ ] **Step 4: Implement toolbar and accessible panels**

Toolbar controls have Russian labels: `Отменить`, `Повторить`, `Предпросмотр`, `Сохранить`, `Сбросить`. Library buttons create known data blocks or a text block containing `Новый текст`. Inspector controls use labeled inputs/selects for position, size, background, text color, border, padding, font size/weight, horizontal and vertical alignment.

- [ ] **Step 5: Implement pointer and keyboard canvas interactions**

Pointer drag calculates column and row deltas from the canvas rectangle and delegates to `placeBlock`. A southeast resize handle delegates to `resizeBlock`. Arrow keys move one cell; Shift+Arrow resizes one cell; Delete requests removal. Do not update layout from raw pixel coordinates outside these pure functions.

- [ ] **Step 6: Add mobile panel behavior**

Below the desktop breakpoint, show library and inspector as explicit toggle drawers while keeping the canvas visible. Preserve 44px actions and focus restoration after drawer close.

- [ ] **Step 7: Run editor, layout, storage, and renderer tests**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-*.test.ts src/components/piling/monitoring/__tests__/equipment-tile-*.test.tsx`

Expected: PASS.

- [ ] **Step 8: Commit editor UI**

Run GitNexus staged change detection and commit with `feat(monitoring): add local visual tile editor`.

### Task 5: Fleet dashboard integration and legacy tuning compatibility

**Files:**
- Modify: `src/components/piling/monitoring/fleet-dashboard.tsx`
- Modify: `src/components/piling/monitoring/design-tuning-panel.tsx`
- Create: `src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx`

**Interfaces:**
- Consumes: `useEquipmentTileTemplate`, `EquipmentTileEditor`, `EquipmentCard` with `template`.
- Produces: one shared dashboard template applied to every visible card and one editor using the first visible card as preview data.

- [ ] **Step 1: Run GitNexus impact analysis for `FleetDashboard`, `useCardDesignTokens`, `tokensToCssVars`, and `DesignTuningPanel`**

Report direct callers and affected processes. Stop for user confirmation before editing any HIGH or CRITICAL symbol.

- [ ] **Step 2: Write failing integration tests**

Mock fleet data with two installations. Assert both `EquipmentCard` instances receive the same saved template, the editor is hidden without unlock, appears after unlock, and a saved text block appears on both cards.

- [ ] **Step 3: Replace token-only wiring in `FleetDashboard`**

Remove `tokensToCssVars` from the grid. Keep the existing grid column density behavior inside the new template card settings. Pass `controller.template` to every `EquipmentCard`; mount `EquipmentTileEditor` once when unlocked and at least one card exists.

- [ ] **Step 4: Preserve legacy local tuning values safely**

Turn `design-tuning-panel.tsx` into a migration-only compatibility module. On first load, map valid `monitoring-card-design-v1` width/height/font/photo/density values into the new default template, then mark migration with `monitoring-equipment-tile-template-v1-migrated`. Never overwrite a new saved template.

- [ ] **Step 5: Run integration and focused monitoring tests**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__`

Expected: PASS.

- [ ] **Step 6: Commit dashboard integration**

Run GitNexus staged change detection and commit with `feat(monitoring): integrate shared tile template editor`.

### Task 6: Verification, accessibility, and browser quality pass

**Files:**
- Modify only files from Tasks 1–5 when verification finds a concrete defect.
- Create: `tests/e2e/monitoring-tile-editor.spec.ts` if the existing authenticated E2E setup can reach `/monitoring`; otherwise document the exact manual authenticated steps in the implementation handoff without adding a permanently skipped test.

**Interfaces:**
- Consumes: complete local editor.
- Produces: verified desktop/mobile behavior and a clean focused test/build result.

- [ ] **Step 1: Add authenticated E2E coverage where supported**

Verify unlock, opening edit mode, adding `Новый текст`, keyboard move, resize, save, reload persistence, application to at least two tiles, preview mode, reset, and desktop/mobile panel access.

- [ ] **Step 2: Run focused unit and component tests**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__`

Expected: PASS.

- [ ] **Step 3: Run lint and production build**

Run: `npm.cmd run lint`

Run: `npm.cmd run build`

Expected: both exit 0. Pre-existing failures outside the changed monitoring scope must be reported separately and must not be masked.

- [ ] **Step 4: Verify visually in a browser**

Open `/monitoring?design=1`, show the editor, and capture desktop and mobile screenshots. Confirm no block overlap, no horizontal page scroll, clear selected/focus states, 44px controls, and identical saved template structure across cards.

- [ ] **Step 5: Run final GitNexus change detection**

Run `mcp__gitnexus__detect_changes(scope: "all", worktree: "C:\\PillingR\\my-project")`. Review every changed monitoring symbol and affected process; separate unrelated pre-existing dirty files in the final report.

- [ ] **Step 6: Commit verification fixes only if files changed**

Stage only monitoring editor/test files, rerun staged change detection, and commit with `test(monitoring): verify equipment tile editor`.

### Task 7: Local image upload blocks backed by IndexedDB

**Files:**
- Create: `src/components/piling/monitoring/equipment-tile-asset-storage.ts`
- Create: `src/components/piling/monitoring/equipment-tile-image-block.tsx`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-asset-storage.test.ts`
- Create: `src/components/piling/monitoring/__tests__/equipment-tile-image-block.test.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-template.ts`
- Modify: `src/components/piling/monitoring/equipment-tile-block-library.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-inspector.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-block.tsx`
- Modify: `src/components/piling/monitoring/use-equipment-tile-template.ts`

**Interfaces:**
- Produces: `EquipmentTileAssetStorage` with `put(file)`, `get(assetId)`, `delete(assetId)`; `createIndexedDbEquipmentTileAssetStorage(indexedDB)`; `<EquipmentTileImageBlock assetId alt fit storage />`.
- Extends: `EquipmentTileBlock` with `assetId?: string`, `imageFit?: 'contain' | 'cover'`, and `alt?: string`.

- [ ] **Step 1: Write failing asset validation and storage tests**

Test JPG/PNG/WebP acceptance, rejection of unsupported MIME types, rejection above 12 MB, deterministic blob retrieval, replacement, and deletion using an in-memory storage adapter that satisfies the same interface as IndexedDB.

- [ ] **Step 2: Run tests and verify missing-module failure**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__/equipment-tile-asset-storage.test.ts`

Expected: FAIL because `equipment-tile-asset-storage` does not exist.

- [ ] **Step 3: Implement storage and validation**

Use database `monitoring-equipment-tile-assets-v1`, version `1`, object store `assets`, records `{ id, blob, name, type, updatedAt }`. Reject invalid files before opening a write transaction. Return a generated stable asset id from `put`.

- [ ] **Step 4: Write failing image block lifecycle tests**

Mock `URL.createObjectURL` and `URL.revokeObjectURL`. Assert a stored blob renders with the requested alt and fit, a missing asset shows `Изображение недоступно`, and every created URL is revoked after replacement or unmount.

- [ ] **Step 5: Implement `EquipmentTileImageBlock`**

Load the blob asynchronously by `assetId`, create one object URL, revoke the previous URL before replacement and on cleanup, and render a neutral placeholder on missing/error state.

- [ ] **Step 6: Add upload and image properties to the editor**

Add `Добавить фото` with an accessible hidden `input[type=file]` accepting `.jpg,.jpeg,.png,.webp`. After validation/storage, create an image block with `assetId`, `imageFit: 'contain'`, and `alt` from the filename. Inspector allows replacing the file, editing alt text, and choosing `contain`/`cover`. Show storage errors next to the upload control without discarding the rest of the draft.

- [ ] **Step 7: Remove unreferenced blobs after explicit image deletion**

When an image block is deleted, check the current draft for another block with the same `assetId`; delete the blob only when no block references it. Reset deletes all template-owned image records.

- [ ] **Step 8: Run focused tests and TypeScript**

Run: `npx.cmd vitest run src/components/piling/monitoring/__tests__`

Run: `npx.cmd tsc --noEmit --pretty false`

Expected: PASS.

- [ ] **Step 9: Commit image upload support**

Run GitNexus staged change detection and commit with `feat(monitoring): add local image blocks`.

### Task 8: Repeat final verification with an uploaded image

**Files:**
- Modify: `e2e/monitoring-tile-editor.spec.ts`
- Modify only monitoring editor files when the verification exposes a reproducible defect.

- [ ] **Step 1: Extend E2E with a generated in-memory PNG upload**

Use Playwright `setInputFiles` with a small PNG buffer. Verify preview, `cover` selection, save/reload persistence, application to all cards, and desktop/mobile screenshots.

- [ ] **Step 2: Run focused, full unit, lint, build, and E2E checks**

Expected: all commands exit 0; screenshots show no horizontal overflow.

- [ ] **Step 3: Run final GitNexus change detection and commit verification changes**

Stage only image/editor/E2E files, review affected processes, and commit with `test(monitoring): verify local image blocks`.
