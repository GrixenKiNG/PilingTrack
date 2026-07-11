'use client';

/**
 * Template-driven tile view for /admin/equipment (the 'equipment-card'
 * layout surface). Renders every fleet card through the shared
 * LayoutRenderer using the tenant's saved template; ADMIN gets the shared
 * full-screen editor. The classic list (EquipmentTile) stays untouched —
 * this view lives alongside it behind the page's view toggle.
 */

import { usePilingStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { LayoutEditor } from '@/components/piling/layout-editor/layout-editor';
import { LayoutRenderer } from '@/components/piling/layout-editor/layout-renderer';
import { useLayoutTemplate } from '@/components/piling/layout-editor/use-layout-template';
import {
  DEFAULT_EQUIPMENT_CARD_TEMPLATE,
  validateEquipmentCardTemplate,
  type EquipmentCardDataKey,
} from './equipment-card-template';
import { EquipmentCardBlockContent } from './equipment-card-block';
import type { FleetCard } from './fleet-types';

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

export function EquipmentCardGrid({
  cards,
  selectedId,
  onSelect,
}: {
  cards: FleetCard[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const controller = useLayoutTemplate({
    surfaceId: 'equipment-card',
    defaultTemplate: DEFAULT_EQUIPMENT_CARD_TEMPLATE,
    validate: validateEquipmentCardTemplate,
  });
  const isAdmin = usePilingStore((state) => state.currentUser?.role) === 'ADMIN';
  const previewCard = cards[0] ?? null;

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <div
            key={card.id}
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
              template={controller.template}
              renderBlockContent={(block) => <EquipmentCardBlockContent block={block} card={card} />}
            />
          </div>
        ))}
      </div>
      {previewCard && (
        <LayoutEditor
          title="Редактор карточки установки"
          controller={controller}
          visible={isAdmin}
          dataBlocks={DATA_BLOCKS}
          renderBlockContent={(block) => <EquipmentCardBlockContent block={block} card={previewCard} />}
        />
      )}
    </>
  );
}
