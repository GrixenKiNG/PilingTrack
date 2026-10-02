'use client';

/**
 * Generic layout template controller (shared editor engine): loads the
 * per-tenant template for a surface from /api/layout/[surfaceId], keeps an
 * editable draft with undo/redo history, and saves it back (ADMIN-only
 * server-side). Surface-specific behavior (localStorage seed, image asset
 * GC) plugs in through options. Extracted from the monitoring
 * use-equipment-tile-template hook.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { createTemplateHistory, type TemplateHistory } from './layout-history';
import { placeBlock, resizeBlock } from './layout-placement';
import { cloneLayoutTemplate, type LayoutBlock, type LayoutBlockKind, type LayoutTemplate } from './layout-template';

/**
 * Показывается, когда сохранённую раскладку не удалось прочитать: стандартная
 * показана только для отрисовки, сохранять её нельзя — иначе PUT затрёт
 * настоящую сохранённую раскладку (F-R108-1).
 */
export const LAYOUT_LOAD_FAILED_MESSAGE = 'Не удалось загрузить вашу раскладку, обновите страницу';

/**
 * Показывается, когда запрос сохранения/сброса не дошёл: сеть оборвалась,
 * `authFetch` бросил. Черновик остаётся, поэтому повтор вручную безопасен
 * (F-R108-4).
 */
export const LAYOUT_OFFLINE_MESSAGE = 'Нет связи, изменения не сохранены — повторите';

/**
 * Отказ 403 по правам: редактор виден только ADMIN, значит роль не подвела
 * (F-R108-3).
 */
export const LAYOUT_FORBIDDEN_MESSAGE = 'Нет прав на изменение раскладки';

/**
 * Отказ 403 от проверки CSRF: `csrf-protection.ts` отдаёт 403 с телом
 * `{error: 'CSRF validation failed: …'}` при расхождении Origin/Host (вкладка
 * устарела, адрес открыт по IP/за прокси). Здесь это не про роль — человеку
 * нужно обновить страницу (F-R108-3).
 */
export const LAYOUT_CSRF_MESSAGE = 'Сессия устарела, обновите страницу';

/**
 * Текст отказа 403 на сохранение/сброс раскладки: по телу ответа различаем
 * провал проверки CSRF и настоящий отказ по правам (F-R108-3).
 */
export async function layoutForbiddenMessage(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: unknown } | null;
    if (typeof body?.error === 'string' && body.error.startsWith('CSRF validation failed')) {
      return LAYOUT_CSRF_MESSAGE;
    }
  } catch {
    // тело нечитаемо (прокси/шлюз) — считаем отказом по правам
  }
  return LAYOUT_FORBIDDEN_MESSAGE;
}

export interface LayoutController<T extends LayoutTemplate = LayoutTemplate> {
  template: T;
  draft: T;
  editing: boolean;
  dirty: boolean;
  /** true, если GET шаблона завершился сбоем (не-ok/обрыв) — сохранение запрещено. */
  loadFailed: boolean;
  canUndo: boolean;
  canRedo: boolean;
  startEditing(): void;
  cancelEditing(): void;
  saveDraft(): Promise<void>;
  reset(): Promise<void>;
  undo(): void;
  redo(): void;
  addBlock(kind: LayoutBlockKind, dataKey?: string, overrides?: Partial<LayoutBlock>): LayoutBlock;
  updateBlock(blockId: string, patch: Partial<LayoutBlock>): void;
  removeBlock(blockId: string): void;
  moveBlock(blockId: string, x: number, y: number): void;
  resizeBlock(blockId: string, width: number, height: number): void;
  updateCard(patch: Partial<LayoutTemplate['card']>): void;
}

export interface UseLayoutTemplateOptions<T extends LayoutTemplate> {
  surfaceId: string;
  defaultTemplate: T;
  validate: (value: unknown) => T | null;
  /**
   * Scope of the layout: omit / '' for the surface-wide base, or an entity id
   * to edit that single tile's override. Changing it reloads the controller.
   */
  entityId?: string;
  /** One-time local seed when the server has no saved row yet (legacy migration). */
  loadLocalSeed?: () => T | null;
  /** Draft discarded without saving (cancel) — clean up draft-only resources. */
  onDraftDiscarded?: (discarded: T, kept: T) => void;
  /** About to persist `next`, replacing `previous` — clean up removed resources. */
  onBeforeSave?: (previous: T, next: T) => void;
  onAfterReset?: () => void;
}

export function useLayoutTemplate<T extends LayoutTemplate>(options: UseLayoutTemplateOptions<T>): LayoutController<T> {
  const { surfaceId, defaultTemplate, validate, entityId, loadLocalSeed, onDraftDiscarded, onBeforeSave, onAfterReset } = options;
  const endpoint = entityId
    ? `/api/layout/${surfaceId}?entityId=${encodeURIComponent(entityId)}`
    : `/api/layout/${surfaceId}`;
  const [template, setTemplate] = useState<T>(() => cloneLayoutTemplate(defaultTemplate));
  const [draft, setDraft] = useState<T>(() => cloneLayoutTemplate(defaultTemplate));
  const [editing, setEditing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
  const historyRef = useRef<TemplateHistory<T>>(createTemplateHistory(defaultTemplate));

  const loadTemplate = useCallback(async (): Promise<{ initial: T; failed: boolean }> => {
    let serverTemplate = cloneLayoutTemplate(defaultTemplate);
    let failed = false;
    try {
      const res = await authFetch(endpoint);
      if (res.ok) {
        const body: unknown = await res.json();
        serverTemplate = validate(body) ?? serverTemplate;
      } else {
        // не-ok (5xx/403/обрыв на сервере) — «раскладки нет» сервер отдаёт как
        // 200 со стандартным шаблоном (layout-service.ts), значит это сбой чтения
        failed = true;
      }
    } catch {
      // network/parse failure — standard template is shown for rendering only, saving stays blocked
      failed = true;
    }
    // При сбое не подставляем локальный seed: он может быть устаревшим, а
    // показанный шаблон всё равно нельзя сохранять, пока он не перечитан.
    if (failed) return { initial: serverTemplate, failed: true };
    const isServerDefault = JSON.stringify(serverTemplate) === JSON.stringify(defaultTemplate);
    if (isServerDefault && loadLocalSeed) {
      const local = loadLocalSeed();
      if (local && JSON.stringify(local) !== JSON.stringify(defaultTemplate)) return { initial: local, failed: false };
    }
    return { initial: serverTemplate, failed: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the scope (endpoint) changes; surface config is fixed per surfaceId
  }, [endpoint]);

  const applyLoaded = useCallback((initial: T) => {
    setTemplate(initial);
    setDraft(initial);
    historyRef.current = createTemplateHistory(initial);
    setHistoryState({ canUndo: false, canRedo: false });
  }, []);

  useEffect(() => {
    let active = true;
    void loadTemplate().then(({ initial, failed }) => {
      if (active) {
        applyLoaded(initial);
        setLoadFailed(failed);
      }
    });
    return () => { active = false; };
  }, [loadTemplate, applyLoaded]);

  const pushDraft = useCallback((next: T) => {
    const pushed = historyRef.current.push(next);
    setDraft(pushed);
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }, []);

  const startEditing = useCallback(() => {
    const next = cloneLayoutTemplate(template);
    historyRef.current = createTemplateHistory(next);
    setDraft(next);
    setHistoryState({ canUndo: false, canRedo: false });
    setEditing(true);
  }, [template]);

  const cancelEditing = useCallback(() => {
    onDraftDiscarded?.(draft, template);
    const next = cloneLayoutTemplate(template);
    historyRef.current = createTemplateHistory(next);
    setDraft(next);
    setHistoryState({ canUndo: false, canRedo: false });
    setEditing(false);
  }, [draft, template, onDraftDiscarded]);

  const saveDraft = useCallback(async () => {
    if (loadFailed) {
      // Читали сбой: под стандартной раскладкой может быть сохранённая — не затираем её.
      toast.error(LAYOUT_LOAD_FAILED_MESSAGE);
      return;
    }
    onBeforeSave?.(template, draft);
    let res: Response;
    try {
      res = await authFetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
    } catch {
      // Обрыв сети: черновик не тронут, правки можно повторить (F-R108-4).
      toast.error(LAYOUT_OFFLINE_MESSAGE);
      return;
    }
    if (!res.ok) {
      toast.error(res.status === 403 ? await layoutForbiddenMessage(res) : 'Не удалось сохранить шаблон');
      return;
    }
    setTemplate(cloneLayoutTemplate(draft));
    setEditing(false);
  }, [draft, template, endpoint, onBeforeSave, loadFailed]);

  const reset = useCallback(async () => {
    // Remove the saved layout at this scope; a tile override falls back to the
    // base, the base falls back to the hardcoded default.
    let res: Response;
    try {
      res = await authFetch(endpoint, { method: 'DELETE' });
    } catch {
      // Обрыв сети: ничего не удалено, можно повторить (F-R108-4).
      toast.error(LAYOUT_OFFLINE_MESSAGE);
      return;
    }
    if (!res.ok) {
      toast.error(res.status === 403 ? await layoutForbiddenMessage(res) : 'Не удалось сбросить шаблон');
      return;
    }
    const { initial, failed } = await loadTemplate();
    applyLoaded(initial);
    setLoadFailed(failed);
    onAfterReset?.();
  }, [endpoint, loadTemplate, applyLoaded, onAfterReset]);

  const undo = useCallback(() => {
    setDraft(historyRef.current.undo());
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }, []);

  const redo = useCallback(() => {
    setDraft(historyRef.current.redo());
    setHistoryState({ canUndo: historyRef.current.canUndo, canRedo: historyRef.current.canRedo });
  }, []);

  const addBlock = useCallback((kind: LayoutBlockKind, dataKey?: string, overrides?: Partial<LayoutBlock>) => {
    const lastRow = draft.blocks.reduce((max, block) => Math.max(max, block.y + block.height), 0);
    const base = cloneLayoutTemplate(defaultTemplate).blocks[1] ?? cloneLayoutTemplate(defaultTemplate).blocks[0];
    const block: LayoutBlock = placeBlock({
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
      ...overrides,
    }, draft.blocks);
    pushDraft({ ...draft, blocks: [...draft.blocks, block] } as T);
    return block;
  }, [draft, defaultTemplate, pushDraft]);

  const updateBlock = useCallback((blockId: string, patch: Partial<LayoutBlock>) => {
    pushDraft({
      ...draft,
      blocks: draft.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block),
    } as T);
  }, [draft, pushDraft]);

  const removeBlock = useCallback((blockId: string) => {
    pushDraft({ ...draft, blocks: draft.blocks.filter((block) => block.id !== blockId) } as T);
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

  const updateCard = useCallback((patch: Partial<LayoutTemplate['card']>) => {
    pushDraft({ ...draft, card: { ...draft.card, ...patch } } as T);
  }, [draft, pushDraft]);

  return {
    template,
    draft,
    editing,
    dirty: JSON.stringify(template) !== JSON.stringify(draft),
    loadFailed,
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
