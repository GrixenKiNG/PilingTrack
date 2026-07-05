# Per-Equipment Tile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every monitoring installation render and edit its own local image while keeping one shared tile layout.

**Architecture:** Store image blobs in the existing IndexedDB adapter under deterministic keys derived from `equipmentId` and `blockId`. Keep geometry and image presentation in the shared template, pass the current equipment identity through renderer and editor, and select the preview installation inside the editor.

**Tech Stack:** React 19, TypeScript, IndexedDB, Vitest, Testing Library, Playwright.

## Global Constraints

- The shared template controls photo block layout and styling; files are unique per installation and photo block.
- Accept only `image/jpeg`, `image/png`, and `image/webp`, maximum 12 MB.
- Local files remain browser-local and use the existing memory fallback when IndexedDB is unavailable.
- Preserve unrelated dirty worktree changes.
- Run GitNexus impact analysis before editing every existing symbol and `gitnexus_detect_changes` before each commit.

---

### Task 1: Deterministic per-installation asset identity

**Files:**
- Modify: `src/components/piling/monitoring/equipment-tile-asset-storage.ts`
- Modify: `src/components/piling/monitoring/__tests__/equipment-tile-asset-storage.test.ts`

**Interfaces:**
- Produces: `getEquipmentTileImageAssetId(equipmentId: string, blockId: string): string`
- Produces: `isEquipmentTileImageAssetId(assetId: string, blockId?: string): boolean`

- [ ] **Step 1: Write failing identity tests**

```ts
expect(getEquipmentTileImageAssetId('rig-1', 'photo-1')).toBe('equipment-tile-image:rig-1:photo-1');
expect(getEquipmentTileImageAssetId('rig-2', 'photo-1')).not.toBe(getEquipmentTileImageAssetId('rig-1', 'photo-1'));
expect(isEquipmentTileImageAssetId('equipment-tile-image:rig-1:photo-1', 'photo-1')).toBe(true);
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run src/components/piling/monitoring/__tests__/equipment-tile-asset-storage.test.ts`

Expected: FAIL because the identity helpers are not exported.

- [ ] **Step 3: Implement encoded deterministic keys**

```ts
const IMAGE_ASSET_PREFIX = 'equipment-tile-image:';

export function getEquipmentTileImageAssetId(equipmentId: string, blockId: string): string {
  return `${IMAGE_ASSET_PREFIX}${encodeURIComponent(equipmentId)}:${encodeURIComponent(blockId)}`;
}

export function isEquipmentTileImageAssetId(assetId: string, blockId?: string): boolean {
  if (!assetId.startsWith(IMAGE_ASSET_PREFIX)) return false;
  return blockId == null || assetId.endsWith(`:${encodeURIComponent(blockId)}`);
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx vitest run src/components/piling/monitoring/__tests__/equipment-tile-asset-storage.test.ts`

Expected: all asset-storage tests pass.

### Task 2: Controller operations and cleanup

**Files:**
- Modify: `src/components/piling/monitoring/equipment-tile-template.ts`
- Modify: `src/components/piling/monitoring/use-equipment-tile-template.ts`
- Modify: `src/components/piling/monitoring/__tests__/equipment-tile-template.test.ts`
- Modify: `src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx`

**Interfaces:**
- Consumes: `getEquipmentTileImageAssetId(equipmentId, blockId)`
- Produces: `addImage(file: File, equipmentId: string): Promise<EquipmentTileBlock>`
- Produces: `replaceImage(blockId: string, file: File, equipmentId: string): Promise<void>`
- Produces: optional `assetRevision: number` on image blocks to force blob URL refresh after replacement.

- [ ] **Step 1: Write failing tests for independent files**

```ts
await controller.addImage(firstFile, 'rig-1');
await controller.replaceImage(block.id, secondFile, 'rig-2');
expect(await storage.get(getEquipmentTileImageAssetId('rig-1', block.id))).not.toBeNull();
expect(await storage.get(getEquipmentTileImageAssetId('rig-2', block.id))).not.toBeNull();
```

- [ ] **Step 2: Run tests and verify old shared-asset behavior fails**

Run: `npx vitest run src/components/piling/monitoring/__tests__/equipment-tile-template.test.ts src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx`

Expected: FAIL because controller methods do not accept equipment identity.

- [ ] **Step 3: Change controller writes and template validation**

```ts
const blockId = `image-${Date.now()}-${draft.blocks.length}`;
const assetId = getEquipmentTileImageAssetId(equipmentId, blockId);
await assetStorage.put(file, assetId);

const block: EquipmentTileBlock = {
  ...base,
  id: blockId,
  kind: 'image',
  imageFit: 'contain',
  alt: 'Фото установки',
  assetRevision: Date.now(),
};
```

Image validation must require `imageFit` and `alt`, but not the obsolete shared `assetId`. On replacement, overwrite the deterministic equipment key and update `assetRevision`. Cleanup must list records and delete only deterministic records belonging to image block IDs removed by save/reset; cancellation must preserve assets referenced by the saved template.

- [ ] **Step 4: Run controller and validation tests**

Run: `npx vitest run src/components/piling/monitoring/__tests__/equipment-tile-template.test.ts src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx`

Expected: all focused tests pass.

### Task 3: Equipment-aware renderer and editor selector

**Files:**
- Modify: `src/components/piling/monitoring/equipment-tile-block.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-image-block.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-renderer.tsx`
- Modify: `src/components/piling/monitoring/equipment-card.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-canvas.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-editor.tsx`
- Modify: `src/components/piling/monitoring/equipment-tile-inspector.tsx`
- Modify: `src/components/piling/monitoring/fleet-dashboard.tsx`
- Modify: `src/components/piling/monitoring/__tests__/equipment-tile-renderer.test.tsx`
- Modify: `src/components/piling/monitoring/__tests__/equipment-tile-image-block.test.tsx`
- Modify: `src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx`

**Interfaces:**
- Consumes: deterministic asset key helper and controller methods from Tasks 1–2.
- Produces: `EquipmentTileEditor({ cards, controller })` with a selected preview installation.

- [ ] **Step 1: Write failing rendering and selector tests**

```tsx
render(<EquipmentTileEditor cards={[rigOne, rigTwo]} controller={controller} />);
fireEvent.change(screen.getByLabelText('Установка для фото'), { target: { value: rigTwo.id } });
fireEvent.change(screen.getByLabelText('Загрузить фото'), { target: { files: [file] } });
expect(storage.put).toHaveBeenCalledWith(file, getEquipmentTileImageAssetId(rigTwo.id, expect.any(String)));
```

Render two cards with one template and assert that each image component requests its own deterministic asset key. Assert missing files show `Фото не загружено`.

- [ ] **Step 2: Run focused UI tests and verify failure**

Run: `npx vitest run src/components/piling/monitoring/__tests__/equipment-tile-renderer.test.tsx src/components/piling/monitoring/__tests__/equipment-tile-image-block.test.tsx src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx src/components/piling/monitoring/__tests__/equipment-tile-editor.test.tsx`

Expected: FAIL because the editor accepts one card and image rendering still uses a shared asset ID.

- [ ] **Step 3: Pass equipment identity through rendering**

```tsx
const assetId = getEquipmentTileImageAssetId(card.id, block.id);
return (
  <EquipmentTileImageBlock
    key={`${assetId}:${block.assetRevision ?? 0}`}
    storage={assetStorage}
    assetId={assetId}
    alt={block.alt || `Фото ${card.name}`}
    fit={block.imageFit ?? 'contain'}
  />
);
```

Change the unavailable copy to `Фото не загружено`. Pass `cards={visibleCards}` from `FleetDashboard`; keep `selectedCardId` in the editor; render a labeled installation `<select>` in the header; use the selected card in the canvas and in upload/replace calls. Show the selected installation name in image inspector controls.

- [ ] **Step 4: Run focused UI tests and verify pass**

Run the command from Step 2.

Expected: all focused UI tests pass.

### Task 4: Browser coverage and full verification

**Files:**
- Modify: `e2e/monitoring-tile-editor.spec.ts`

**Interfaces:**
- Consumes: complete per-installation photo editor.
- Produces: regression coverage across save and reload.

- [ ] **Step 1: Extend the browser test**

Upload one PNG for the first installation, select the second installation, upload a different PNG, save, and verify each tile contains only its assigned image after reload. Retain desktop and 390×844 mobile checks.

- [ ] **Step 2: Run focused unit tests**

Run: `npx vitest run src/components/piling/monitoring/__tests__/equipment-tile-*.test.tsx src/components/piling/monitoring/__tests__/equipment-tile-*.test.ts src/components/piling/monitoring/__tests__/fleet-dashboard-template.test.tsx`

Expected: all focused tests pass.

- [ ] **Step 3: Run repository verification**

Run: `npm run test:unit`

Run: `npx eslint src/components/piling/monitoring e2e/monitoring-tile-editor.spec.ts`

Run: `npm run build`

Expected: every command exits with code 0.

- [ ] **Step 4: Run browser verification**

Run: `$env:BASE_URL='http://localhost:3000'; npx playwright test e2e/monitoring-tile-editor.spec.ts --project=chromium --project='Mobile Chrome' --workers=1`

Expected: desktop and mobile scenarios pass with no horizontal overflow.

- [ ] **Step 5: Review scope and commit**

Run GitNexus staged change detection, confirm only monitoring tile/photo flows are affected, then commit the implementation without staging unrelated files.

