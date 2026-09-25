'use client';

/**
 * Обёртка над общим LayoutEditor для плитки установки: закрыта ролью
 * администратора, привязывает содержимое блоков к выбранной карточке и
 * подключает загрузку фото именно к этой установке.
 *
 * Живёт в «Настройки → Шаблоны плиток». На экране мониторинга редактора нет:
 * раньше он висел там плавающей кнопкой за скрытым замком `?design=1`, и
 * найти его можно было только зная адрес.
 */

import { useState } from 'react';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { usePilingStore } from '@/lib/store';
import { LayoutEditor } from '@/components/piling/layout-editor/layout-editor';
import { EquipmentTileBlockContent } from './equipment-tile-block';
import type { EquipmentTileBlock, EquipmentTileDataKey } from './equipment-tile-template';
import type { EquipmentTileTemplateController } from './use-equipment-tile-template';

const DATA_BLOCKS: Array<{ key: EquipmentTileDataKey; label: string }> = [
  { key: 'site', label: 'Объект' },
  { key: 'operator', label: 'Оператор' },
  { key: 'engineHours', label: 'Моточасы' },
  { key: 'maintenance', label: 'Ближайшее ТО' },
  { key: 'todayPiles', label: 'Сваи сегодня' },
  { key: 'todayDrilling', label: 'Бурение сегодня' },
  { key: 'todayDowntime', label: 'Простой сегодня' },
  { key: 'maintenanceAlert', label: 'Предупреждение ТО' },
];

export function EquipmentTileEditor({
  cards,
  controller,
  autoOpen = false,
  onClose,
}: {
  cards: FleetCard[];
  controller: EquipmentTileTemplateController;
  /** Открыть сразу при монтировании — режим окна, которым управляет родитель. */
  autoOpen?: boolean;
  onClose?: () => void;
}) {
  const [selectedCardId, setSelectedCardId] = useState(() => cards[0]?.id ?? '');
  const isAdmin = usePilingStore((state) => state.currentUser?.role) === 'ADMIN';
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? cards[0] ?? null;

  if (!selectedCard) return null;
  // Read-only users never see the editor affordances — saving/uploading is
  // ADMIN-only server-side (403), so there's nothing for them to do here.
  return (
    <LayoutEditor
      title="Редактор плитки установки"
      controller={controller}
      visible={isAdmin}
      autoOpen={autoOpen}
      onClose={onClose}
      dataBlocks={DATA_BLOCKS}
      renderBlockContent={(block) => (
        <EquipmentTileBlockContent block={block as EquipmentTileBlock} card={selectedCard} assetStorage={controller.assetStorage} />
      )}
      imageSupport={{
        subjectName: selectedCard.name,
        headerControl: (
          <label className="flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted px-3 text-xs font-medium text-muted-foreground">
            <span className="hidden sm:inline">Установка для фото</span>
            <select
              aria-label="Установка для фото"
              className="max-w-48 bg-transparent font-semibold text-foreground focus:border-info focus:outline-none focus:ring-2 focus:ring-info/30/15"
              value={selectedCard.id}
              onChange={(event) => setSelectedCardId(event.target.value)}
            >
              {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
            </select>
          </label>
        ),
        uploadImage: (file) => controller.addImage(file, selectedCard.id),
        replaceImage: (blockId, file) => controller.replaceImage(blockId, file, selectedCard.id),
      }}
    />
  );
}
