'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { createTemplateHistory, type TemplateHistory } from './equipment-tile-history';
import { placeBlock, resizeBlock } from './equipment-tile-layout';
import {
  cloneEquipmentTileTemplate,
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  validateEquipmentTileTemplate,
  type EquipmentTileBlock,
  type EquipmentTileBlockKind,
  type EquipmentTileDataKey,
  type EquipmentTileTemplate,
} from './equipment-tile-template';
import { loadEquipmentTileTemplate } from './equipment-tile-storage';
import { migrateLegacyCardDesign } from './design-tuning-panel';
import {
  getDefaultEquipmentTileAssetStorage,
  isEquipmentTileImageAssetId,
  type EquipmentTileAssetStorage,
} from './equipment-tile-asset-storage';
import { uploadEquipmentPhoto } from './equipment-photo-upload';

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
  saveDraft(): Promise<void>;
  reset(): Promise<void>;
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
  onPhotoUploaded?: () => void,
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
    let active = true;
    void (async () => {
      let serverTemplate = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
      try {
        const res = await authFetch('/api/monitoring/template');
        if (res.ok) {
          const body: unknown = await res.json();
          serverTemplate = validateEquipmentTileTemplate(body) ?? serverTemplate;
        }
      } catch {
        // network/parse failure — fall back to the default so the page still renders
      }
      if (!active) return;

      let initial = serverTemplate;
      const isServerDefault = JSON.stringify(serverTemplate) === JSON.stringify(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
      if (isServerDefault) {
        // No row saved server-side yet — migrate a pre-existing local customization once.
        const local = loadEquipmentTileTemplate(localStorage);
        if (JSON.stringify(local) !== JSON.stringify(DEFAULT_EQUIPMENT_TILE_TEMPLATE)) {
          initial = local;
        }
      }

      setTemplate(initial);
      setDraft(initial);
      historyRef.current = createTemplateHistory(initial);
      setHistoryState({ canUndo: false, canRedo: false });
      setUnlocked(queryUnlock || localStorage.getItem(UNLOCK_KEY) === '1');
    })();
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

  const saveDraft = useCallback(async () => {
    deleteUnreferencedImageAssets(template, draft, assetStorage);
    const res = await authFetch('/api/monitoring/template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      toast.error(res.status === 403 ? 'Только администратор может сохранять шаблон' : 'Не удалось сохранить шаблон');
      return;
    }
    setTemplate(cloneEquipmentTileTemplate(draft));
    setEditing(false);
  }, [assetStorage, draft, template]);

  const reset = useCallback(async () => {
    const next = cloneEquipmentTileTemplate(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    const res = await authFetch('/api/monitoring/template', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if (!res.ok) {
      toast.error(res.status === 403 ? 'Только администратор может сбросить шаблон' : 'Не удалось сбросить шаблон');
      return;
    }
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
    await uploadEquipmentPhoto(file, equipmentId);
    onPhotoUploaded?.();
    const block = placeBlock({
      ...base,
      id: blockId,
      kind: 'image' as const,
      dataKey: undefined,
      text: undefined,
      imageFit: 'contain' as const,
      alt: file.name,
      x: 0,
      y: lastRow,
      width: 12,
      height: 8,
      style: { ...base.style, padding: 0 },
    }, draft.blocks);
    pushDraft({ ...draft, blocks: [...draft.blocks, block] });
    return block;
  }, [draft, pushDraft, onPhotoUploaded]);

  const updateBlock = useCallback((blockId: string, patch: Partial<EquipmentTileBlock>) => {
    pushDraft({
      ...draft,
      blocks: draft.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    });
  }, [draft, pushDraft]);

  const replaceImage = useCallback(async (blockId: string, file: File, equipmentId: string) => {
    const block = draft.blocks.find((candidate) => candidate.id === blockId && candidate.kind === 'image');
    if (!block) throw new TypeError('Image block not found');
    await uploadEquipmentPhoto(file, equipmentId);
    onPhotoUploaded?.();
    updateBlock(blockId, { alt: block.alt || 'Фото установки' });
  }, [draft.blocks, updateBlock, onPhotoUploaded]);

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
