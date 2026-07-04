'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const UNLOCK_KEY = 'monitoring-design-unlocked';

export interface EquipmentTileTemplateController {
  template: EquipmentTileTemplate;
  draft: EquipmentTileTemplate;
  unlocked: boolean;
  editing: boolean;
  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;
  startEditing(): void;
  cancelEditing(): void;
  saveDraft(): void;
  reset(): void;
  undo(): void;
  redo(): void;
  addBlock(kind: EquipmentTileBlockKind, dataKey?: EquipmentTileDataKey): EquipmentTileBlock;
  updateBlock(blockId: string, patch: Partial<EquipmentTileBlock>): void;
  removeBlock(blockId: string): void;
  moveBlock(blockId: string, x: number, y: number): void;
  resizeBlock(blockId: string, width: number, height: number): void;
  updateCard(patch: Partial<EquipmentTileTemplate['card']>): void;
}

export function useEquipmentTileTemplate(): EquipmentTileTemplateController {
  const queryUnlock =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('design') === '1';
  const [template, setTemplate] = useState(() => cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE));
  const [draft, setDraft] = useState(() => cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE));
  const [unlocked, setUnlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [historyVersion, setHistoryVersion] = useState(0);
  const historyRef = useRef<TemplateHistory>(createTemplateHistory(DEFAULT_EQUIPMENT_TILE_TEMPLATE));

  useEffect(() => {
    if (queryUnlock) localStorage.setItem(UNLOCK_KEY, '1');
    migrateLegacyCardDesign(localStorage);
    const saved = loadEquipmentTileTemplate(localStorage);
    setTemplate(saved);
    setDraft(saved);
    historyRef.current = createTemplateHistory(saved);
    setUnlocked(queryUnlock || localStorage.getItem(UNLOCK_KEY) === '1');
  }, [queryUnlock]);

  const pushDraft = useCallback((next: EquipmentTileTemplate) => {
    const pushed = historyRef.current.push(next);
    setDraft(pushed);
    setHistoryVersion((version) => version + 1);
  }, []);

  const startEditing = useCallback(() => {
    const next = cloneEquipmentTileTemplate(template);
    historyRef.current = createTemplateHistory(next);
    setDraft(next);
    setHistoryVersion((version) => version + 1);
    setEditing(true);
  }, [template]);

  const cancelEditing = useCallback(() => {
    const next = cloneEquipmentTileTemplate(template);
    historyRef.current = createTemplateHistory(next);
    setDraft(next);
    setHistoryVersion((version) => version + 1);
    setEditing(false);
  }, [template]);

  const saveDraft = useCallback(() => {
    saveEquipmentTileTemplate(localStorage, draft);
    setTemplate(cloneEquipmentTileTemplate(draft));
    setEditing(false);
  }, [draft]);

  const reset = useCallback(() => {
    resetEquipmentTileTemplate(localStorage);
    const next = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    historyRef.current = createTemplateHistory(next);
    setTemplate(next);
    setDraft(next);
    setHistoryVersion((version) => version + 1);
  }, []);

  const undo = useCallback(() => {
    setDraft(historyRef.current.undo());
    setHistoryVersion((version) => version + 1);
  }, []);

  const redo = useCallback(() => {
    setDraft(historyRef.current.redo());
    setHistoryVersion((version) => version + 1);
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

  const updateBlock = useCallback((blockId: string, patch: Partial<EquipmentTileBlock>) => {
    pushDraft({
      ...draft,
      blocks: draft.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    });
  }, [draft, pushDraft]);

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

  const historyState = useMemo(() => ({
    canUndo: historyRef.current.canUndo,
    canRedo: historyRef.current.canRedo,
  }), [historyVersion]);

  return {
    template,
    draft,
    unlocked,
    editing,
    dirty: JSON.stringify(template) !== JSON.stringify(draft),
    ...historyState,
    startEditing,
    cancelEditing,
    saveDraft,
    reset,
    undo,
    redo,
    addBlock,
    updateBlock,
    removeBlock,
    moveBlock,
    resizeBlock: resizeSelectedBlock,
    updateCard,
  };
}
