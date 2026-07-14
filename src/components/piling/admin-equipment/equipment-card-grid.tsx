'use client';

/**
 * Template-driven tile view for /admin/equipment (the 'equipment-card'
 * layout surface). Each fleet card renders through the shared LayoutRenderer
 * using its resolved template: its own per-tile override -> the tenant base
 * -> the hardcoded default. ADMIN edits either the base («все плитки») or a
 * single tile («эта плитка») in the shared full-screen editor. The classic
 * list (EquipmentTile) stays untouched — this view lives beside it.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pencil } from '@/components/piling/icons/unified-icons';
import { usePilingStore } from '@/lib/store';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { LayoutEditor } from '@/components/piling/layout-editor/layout-editor';
import { LayoutRenderer } from '@/components/piling/layout-editor/layout-renderer';
import { useLayoutTemplate } from '@/components/piling/layout-editor/use-layout-template';
import type { LayoutTemplate } from '@/components/piling/layout-editor/layout-template';
import {
  DEFAULT_EQUIPMENT_CARD_TEMPLATE,
  validateEquipmentCardTemplate,
  type EquipmentCardDataKey,
} from './equipment-card-template';
import { EquipmentCardBlockContent } from './equipment-card-block';
import type { FleetCard } from './fleet-types';

const SURFACE_ID = 'equipment-card';
const BASE_SCOPE = ''; // editing the base layout (applies to every tile without its own)

const DATA_BLOCKS: Array<{ key: EquipmentCardDataKey; label: string }> = [
  { key: 'brandLogo', label: 'Логотип производителя' },
  { key: 'identity', label: 'Название и модель' },
  { key: 'status', label: 'Статус' },
  { key: 'site', label: 'Объект' },
  { key: 'operator', label: 'Оператор' },
  { key: 'engineHours', label: 'Моточасы' },
  { key: 'todayPiles', label: 'Сваи сегодня' },
  { key: 'todayDrilling', label: 'Бурение сегодня' },
  { key: 'todayDowntime', label: 'Простой сегодня' },
  { key: 'maintenanceAlert', label: 'Предупреждение ТО' },
  { key: 'quickLinks', label: 'Быстрые ссылки' },
];

interface LayoutSet {
  base: LayoutTemplate;
  overrides: Record<string, LayoutTemplate>;
}

function ScopeEditor({
  scope,
  cards,
  onSwitch,
  onClose,
}: {
  scope: string;
  cards: FleetCard[];
  onSwitch: (scope: string) => void;
  onClose: () => void;
}) {
  const controller = useLayoutTemplate({
    surfaceId: SURFACE_ID,
    entityId: scope || undefined,
    defaultTemplate: DEFAULT_EQUIPMENT_CARD_TEMPLATE,
    validate: validateEquipmentCardTemplate,
  });
  const scopedCard = cards.find((card) => card.id === scope) ?? cards[0] ?? null;
  const previewCard = scopedCard;
  if (!previewCard) return null;

  const switcher = (
    <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">
      <span className="hidden sm:inline">Что редактируем</span>
      <select
        aria-label="Что редактируем"
        className="max-w-48 bg-transparent font-semibold text-slate-900 focus:outline-none"
        value={scope}
        onChange={(event) => onSwitch(event.target.value)}
      >
        <option value={BASE_SCOPE}>Все плитки (база)</option>
        {cards.map((card) => (
          <option key={card.id} value={card.id}>{card.name}</option>
        ))}
      </select>
    </label>
  );

  return (
    <LayoutEditor
      title={scope === BASE_SCOPE ? 'Все плитки (база)' : `Плитка: ${scopedCard?.name ?? scope}`}
      controller={controller}
      visible
      autoOpen
      onClose={onClose}
      headerControl={switcher}
      dataBlocks={DATA_BLOCKS}
      renderBlockContent={(block) => <EquipmentCardBlockContent block={block} card={previewCard} />}
    />
  );
}

export function EquipmentCardGrid({
  cards,
  selectedId,
  onSelect,
}: {
  cards: FleetCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const isAdmin = usePilingStore((state) => state.currentUser?.role) === 'ADMIN';
  const [set, setSet] = useState<LayoutSet | null>(null);
  // null = not editing; '' = base; equipmentId = that tile's override.
  const [editScope, setEditScope] = useState<string | null>(null);

  const fetchSet = useCallback(async (): Promise<LayoutSet | null> => {
    try {
      const res = await authFetch(`/api/layout/${SURFACE_ID}?scope=set`);
      if (res.ok) return (await res.json()) as LayoutSet;
    } catch {
      // leave the last-known set; tiles fall back to the default template
    }
    return null;
  }, []);
  useEffect(() => {
    let active = true;
    void fetchSet().then((next) => { if (active && next) setSet(next); });
    return () => { active = false; };
  }, [fetchSet]);
  const reloadSet = useCallback(async () => {
    const next = await fetchSet();
    if (next) setSet(next);
  }, [fetchSet]);

  const base = set?.base ?? DEFAULT_EQUIPMENT_CARD_TEMPLATE;
  const resolve = (card: FleetCard): LayoutTemplate => set?.overrides?.[card.id] ?? base;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => {
          const customized = Boolean(set?.overrides?.[card.id]);
          return (
            <div key={card.id} className="group relative">
              <div
                role="button"
                tabIndex={0}
                onClick={() => onSelect(card.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onSelect(card.id);
                  }
                }}
                className={cn(
                  'cursor-pointer rounded-2xl transition-shadow hover:shadow-md',
                  selectedId === card.id && 'ring-2 ring-blue-500/40',
                )}
              >
                <LayoutRenderer
                  template={resolve(card)}
                  renderBlockContent={(block) => <EquipmentCardBlockContent block={block} card={card} />}
                />
              </div>
              {isAdmin && (
                <button
                  type="button"
                  aria-label={`Редактировать плитку: ${card.name}`}
                  onClick={(event) => { event.stopPropagation(); setEditScope(card.id); }}
                  className={cn(
                    'absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs font-semibold shadow-sm backdrop-blur transition-colors',
                    customized
                      ? 'border-blue-200 bg-blue-50/90 text-blue-700 hover:bg-blue-100'
                      : 'border-slate-200 bg-white/90 text-slate-600 opacity-0 hover:bg-slate-50 group-hover:opacity-100',
                  )}
                >
                  <Pencil className="h-3.5 w-3.5" /> {customized ? 'Изменена' : 'Эта плитка'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {isAdmin && (
        <button
          type="button"
          onClick={() => setEditScope(BASE_SCOPE)}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Pencil className="h-4 w-4" /> Редактировать все плитки (база)
        </button>
      )}

      {isAdmin && editScope !== null && (
        <ScopeEditor
          key={editScope}
          scope={editScope}
          cards={cards}
          onSwitch={setEditScope}
          onClose={() => { setEditScope(null); void reloadSet(); }}
        />
      )}
    </>
  );
}
