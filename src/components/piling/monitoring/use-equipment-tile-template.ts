'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createTemplateHistory, type TemplateHistory } from './equipment-tile-history';
import { placeBlock, resizeBlock } from './equipment-tile-layout';
import {
  cloneEquipmentTileTemplate,
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  type EquipmentTileBlock,
  type EquipmentTileBlockKind,
  type EquipmentTileDataKey,
  type EquipmentTileTemplate,
} from './equipment-tile-template';
import {
  loadEquipmentTileTemplate,
  resetEquipmentTileTemplate,
  saveEquipmentTileTemplate,
} from './equipment-tile-storage';
import { migrateLegacyCardDesign } from './design-tuning-panel';
import {
  getEquipmentTileImageAssetId,
  getDefaultEquipmentTileAssetStorage,
  isEquipmentTileImageAssetId,
  type EquipmentTileAssetStorage,
} from './equipment-tile-asset-storage';

const UNLOCK_KEY = 'monitoring-design-unlocked';

function imageBlockIds(template: EquipmentTileTemplate): Set<string> {
  return new Set(template.blocks.filter((block) => block.kind === 'image').map((block) => block.id));
}

function deleteUnreferencedImageAssets(
  source: EquipmentTileTemplate,
  retained: EquipmentTileTemplate,
  storage: EquipmentTileAssetStorage,
): void {
  const sourceIds = imageBlockIds(source);
  const retainedIds = imageBlockIds(retained);
  const removedIds = [...sourceIds].filter((blockId) => !retainedIds.has(blockId));
  if (removedIds.length === 0) return;
  void storage.list().then(async (records) => {
    await Promise.all(records
      .filter((record) => removedIds.some((blockId) => isEquipmentTileImageAssetId(record.id, blockId)))
      .map((record) => storage.delete(record.id)));
  });
}

export interface EquipmentTileTemplateController {
  template: EquipmentTileTemplate;
  draft: EquipmentTileTemplate;
  unlocked: boolean;
  editing: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  assetStorage: EquipmentTileAssetStorage;
  startEditing(): void;
  cancelEditing(): void;
  saveDraft(): void;
  reset(): void;
  undo(): void;
  redo(): void;
  addBlock(kind: EquipmentTileBlockKind, dataKey?: EquipmentTileDataKey): EquipmentTileBlock;
  addImage(file: File, equipmentId: string): Promise<EquipmentTileBlock>;
  replaceImage(blockId: string, file: File, equipmentId: string): Promise<void>;
  updateBlock(blockId: string, patch: Partial<EquipmentTileBlock>): void;
  removeBlock(blockId: string): void;
  moveBlock(blockId: string, x: number, y: number): void;
  resizeBlock(blockId: string, width: number, height: number): void;
  updateCard(patch: Partial<EquipmentTileTemplate['card']>): void;
}

export function useEquipmentTileTemplate(
  providedAssetStorage?: EquipmentTileAssetStorage,
): EquipmentTileTemplateController {
  const queryUnlock =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('design') === '1';
  const [template, setTemplate] = useState(() => cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE));
  const [draft, setDraft] = useState(() => cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE));
  const [unlocked, setUnlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const [assetStorage] = useState(() => providedAssetStorage ?? getDefaultEquipmentTileAssetStorage());
  const historyRef = useRef<TemplateHistory>(createTemplateHistory(DEFAULT_EQUIPMENT_TILE_TEMPLATE));

  useEffect(() => {
    if (queryUnlock) localStorage.setItem(UNLOCK_KEY, '1');
    migrateLegacyCardDesign(localStorage);
    const saved = loadEquipmentTileTemplate(localStorage);
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setTemplate(saved);
      setDraft(saved);
      historyRef.current = createTemplateHistory(saved);
      setHistoryState({ canUndo: false, canRedo: false });
      setUnlocked(queryUnlock || localStorage.getItem(UNLOCK_KEY) === '1');
    });
    return () => { active = false; };
  }, [queryUnlock]);

  const pushDraft = useCallback((next: EquipmentTileTemplate) => {
    const pushed = historyRef.current.push(next);
    setDraft(pushed);
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }, []);

  const startEditing = useCallback(() => {
    const next = cloneEquipmentTileTemplate(template);
    historyRef.current = createTemplateHistory(next);
    setDraft(next);
    setHistoryState({ canUndo: false, canRedo: false });
    setEditing(true);
  }, [template]);

  const cancelEditing = useCallback(() => {
    deleteUnreferencedImageAssets(draft, template, assetStorage);
    const next = cloneEquipmentTileTemplate(template);
    historyRef.current = createTemplateHistory(next);
    setDraft(next);
    setHistoryState({ canUndo: false, canRedo: false });
    setEditing(false);
  }, [assetStorage, draft, template]);

  const saveDraft = useCallback(() => {
    deleteUnreferencedImageAssets(template, draft, assetStorage);
    saveEquipmentTileTemplate(localStorage, draft);
    setTemplate(cloneEquipmentTileTemplate(draft));
    setEditing(false);
  }, [assetStorage, draft, template]);

  const reset = useCallback(() => {
    resetEquipmentTileTemplate(localStorage);
    const next = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    historyRef.current = createTemplateHistory(next);
    setTemplate(next);
    setDraft(next);
    setHistoryState({ canUndo: false, canRedo: false });
    void assetStorage.clear();
  }, [assetStorage]);

  const undo = useCallback(() => {
    setDraft(historyRef.current.undo());
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }, []);

  const redo = useCallback(() => {
    setDraft(historyRef.current.redo());
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }, []);

  const addBlock = useCallback((kind: EquipmentTileBlockKind, dataKey?: EquipmentTileDataKey) => {
    const lastRow = draft.blocks.reduce((max, block) => Math.max(max, block.y + block.height), 0);
    const base = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE).blocks[1];
    const block: EquipmentTileBlock = placeBlock({
      ...base,
      id: `${kind}-${Date.now()}-${draft.blocks.length}`,
      kind,
      dataKey: kind === 'data' ? dataKey : undefined,
      text: kind === 'text' ? 'Новый текст' : undefined,
      x: 0,
      y: lastRow,
      width: kind === 'divider' ? 12 : 6,
      height: kind === 'divider' ? 1 : 3,
      visible: true,
    }, draft.blocks);
    pushDraft({ ...draft, blocks: [...draft.blocks, block] });
    return block;
  }, [draft, pushDraft]);

  const addImage = useCallback(async (file: File, equipmentId: string) => {
    const lastRow = draft.blocks.reduce((max, block) => Math.max(max, block.y + block.height), 0);
    const base = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE).blocks[1];
    const blockId = `image-${Date.now()}-${draft.blocks.length}`;
    await assetStorage.put(file, getEquipmentTileImageAssetId(equipmentId, blockId));
    const block = placeBlock({
      ...base,
      id: blockId,
      kind: 'image' as const,
      dataKey: undefined,
      text: undefined,
      imageFit: 'contain' as const,
      alt: file.name,
      assetRevision: Date.now(),
      x: 0,
      y: lastRow,
      width: 12,
      height: 8,
      style: { ...base.style, padding: 0 },
    }, draft.blocks);
    pushDraft({ ...draft, blocks: [...draft.blocks, block] });
    return block;
  }, [assetStorage, draft, pushDraft]);

  const updateBlock = useCallback((blockId: string, patch: Partial<EquipmentTileBlock>) => {
    pushDraft({
      ...draft,
      blocks: draft.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    });
  }, [draft, pushDraft]);

  const replaceImage = useCallback(async (blockId: string, file: File, equipmentId: string) => {
    const block = draft.blocks.find((candidate) => candidate.id === blockId && candidate.kind === 'image');
    if (!block) throw new TypeError('Image block not found');
    await assetStorage.put(file, getEquipmentTileImageAssetId(equipmentId, blockId));
    updateBlock(blockId, { assetRevision: Date.now(), alt: block.alt || 'Фото установки' });
  }, [assetStorage, draft.blocks, updateBlock]);

  const removeBlock = useCallback((blockId: string) => {
    pushDraft({ ...draft, blocks: draft.blocks.filter((block) => block.id !== blockId) });
  }, [draft, pushDraft]);

  const moveBlock = useCallback((blockId: string, x: number, y: number) => {
    const block = draft.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    const moved = placeBlock({ ...block, x, y }, draft.blocks);
    updateBlock(blockId, moved);
  }, [draft.blocks, updateBlock]);

  const resizeSelectedBlock = useCallback((blockId: string, width: number, height: number) => {
    const block = draft.blocks.find((candidate) => candidate.id === blockId);
    if (!block) return;
    const resized = resizeBlock(block, { width, height }, draft.blocks);
    updateBlock(blockId, resized);
  }, [draft.blocks, updateBlock]);

  const updateCard = useCallback((patch: Partial<EquipmentTileTemplate['card']>) => {
    pushDraft({ ...draft, card: { ...draft.card, ...patch } });
  }, [draft, pushDraft]);

  return {
    template,
    draft,
    unlocked,
    editing,
    dirty: JSON.stringify(template) !== JSON.stringify(draft),
    ...historyState,
    assetStorage,
    startEditing,
    cancelEditing,
    saveDraft,
    reset,
    undo,
    redo,
    addBlock,
    addImage,
    replaceImage,
    updateBlock,
    removeBlock,
    moveBlock,
    resizeBlock: resizeSelectedBlock,
    updateCard,
  };
}
