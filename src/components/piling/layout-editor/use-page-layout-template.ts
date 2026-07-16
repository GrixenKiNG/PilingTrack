'use client';

/**
 * Page-layout controller (Stage B): loads the per-tenant widget list for a
 * `page-layout` surface from /api/layout/[surfaceId], keeps an editable draft,
 * and saves (PUT) / resets (DELETE) it. Widget operations are visibility,
 * size, reorder and per-widget settings. Missing catalog widgets are merged
 * in (append) so the editor always lists the full catalog even after the
 * catalog grows.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import {
  clonePageLayoutTemplate,
  type PageLayoutTemplate,
  type PageWidgetPlacement,
  type WidgetSize,
} from './page-layout-template';

export interface PageLayoutController {
  template: PageLayoutTemplate;
  draft: PageLayoutTemplate;
  editing: boolean;
  dirty: boolean;
  startEditing(): void;
  cancelEditing(): void;
  saveDraft(): Promise<void>;
  reset(): Promise<void>;
  setVisible(id: string, visible: boolean): void;
  setSize(id: string, size: WidgetSize): void;
  move(id: string, direction: -1 | 1): void;
  updateSettings(id: string, patch: Record<string, unknown>): void;
}

function mergeCatalog(template: PageLayoutTemplate, catalogIds: readonly string[]): PageLayoutTemplate {
  const known = new Set(catalogIds);
  // Keep only catalog widgets, preserving saved order/visibility/size.
  const kept = template.widgets.filter((w) => known.has(w.id));
  const present = new Set(kept.map((w) => w.id));
  let nextOrder = kept.reduce((max, w) => Math.max(max, w.order), -1) + 1;
  const appended: PageWidgetPlacement[] = catalogIds
    .filter((id) => !present.has(id))
    .map((id) => ({ id, visible: true, size: 'sm' as WidgetSize, order: nextOrder++ }));
  return { version: 1, widgets: [...kept, ...appended] };
}

export function usePageLayoutTemplate(options: {
  surfaceId: string;
  defaultTemplate: PageLayoutTemplate;
  validate: (value: unknown) => PageLayoutTemplate | null;
  catalogIds: readonly string[];
}): PageLayoutController {
  const { surfaceId, defaultTemplate, validate, catalogIds } = options;
  const endpoint = `/api/layout/${surfaceId}`;
  const [template, setTemplate] = useState<PageLayoutTemplate>(() => mergeCatalog(defaultTemplate, catalogIds));
  const [draft, setDraft] = useState<PageLayoutTemplate>(() => mergeCatalog(defaultTemplate, catalogIds));
  const [editing, setEditing] = useState(false);

  const load = useCallback(async (): Promise<PageLayoutTemplate> => {
    let server = defaultTemplate;
    try {
      const res = await authFetch(endpoint);
      if (res.ok) server = validate(await res.json()) ?? defaultTemplate;
    } catch {
      // fall back to default so the page still renders
    }
    return mergeCatalog(server, catalogIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when the surface (endpoint) changes; catalog/default fixed per surface
  }, [endpoint]);

  useEffect(() => {
    let active = true;
    void load().then((t) => { if (active) { setTemplate(t); setDraft(t); } });
    return () => { active = false; };
  }, [load]);

  const startEditing = useCallback(() => { setDraft(clonePageLayoutTemplate(template)); setEditing(true); }, [template]);
  const cancelEditing = useCallback(() => { setDraft(clonePageLayoutTemplate(template)); setEditing(false); }, [template]);

  const saveDraft = useCallback(async () => {
    const res = await authFetch(endpoint, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(draft),
    });
    if (!res.ok) {
      toast.error(res.status === 403 ? 'Только администратор может сохранять раскладку' : 'Не удалось сохранить раскладку');
      return;
    }
    setTemplate(clonePageLayoutTemplate(draft));
    setEditing(false);
  }, [draft, endpoint]);

  const reset = useCallback(async () => {
    const res = await authFetch(endpoint, { method: 'DELETE' });
    if (!res.ok) {
      toast.error(res.status === 403 ? 'Только администратор может сбросить раскладку' : 'Не удалось сбросить раскладку');
      return;
    }
    const t = await load();
    setTemplate(t);
    setDraft(t);
  }, [endpoint, load]);

  const patchWidget = useCallback((id: string, patch: Partial<PageWidgetPlacement>) => {
    setDraft((d) => ({ version: 1, widgets: d.widgets.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
  }, []);

  const setVisible = useCallback((id: string, visible: boolean) => patchWidget(id, { visible }), [patchWidget]);
  const setSize = useCallback((id: string, size: WidgetSize) => patchWidget(id, { size }), [patchWidget]);

  const move = useCallback((id: string, direction: -1 | 1) => {
    setDraft((d) => {
      const sorted = [...d.widgets].sort((a, b) => a.order - b.order);
      const i = sorted.findIndex((w) => w.id === id);
      const j = i + direction;
      if (i < 0 || j < 0 || j >= sorted.length) return d;
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
      return { version: 1, widgets: sorted.map((w, idx) => ({ ...w, order: idx })) };
    });
  }, []);

  const updateSettings = useCallback((id: string, patch: Record<string, unknown>) => {
    setDraft((d) => ({
      version: 1,
      widgets: d.widgets.map((w) => (w.id === id ? { ...w, settings: { ...w.settings, ...patch } } : w)),
    }));
  }, []);

  return {
    template,
    draft,
    editing,
    dirty: JSON.stringify(template) !== JSON.stringify(draft),
    startEditing,
    cancelEditing,
    saveDraft,
    reset,
    setVisible,
    setSize,
    move,
    updateSettings,
  };
}
