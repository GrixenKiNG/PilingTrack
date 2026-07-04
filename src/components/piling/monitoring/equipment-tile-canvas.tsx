'use client';

import { useRef } from 'react';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentTileRenderer } from './equipment-tile-renderer';
import type { EquipmentTileTemplate } from './equipment-tile-template';

export function EquipmentTileCanvas({
  card,
  template,
  selectedBlockId,
  preview,
  onSelectBlock,
  onMoveBlock,
  onResizeBlock,
}: {
  card: FleetCard;
  template: EquipmentTileTemplate;
  selectedBlockId: string | null;
  preview: boolean;
  onSelectBlock: (blockId: string) => void;
  onMoveBlock: (blockId: string, x: number, y: number) => void;
  onResizeBlock: (blockId: string, width: number, height: number) => void;
}) {
  const dragRef = useRef<{ blockId: string; startX: number; startY: number; x: number; y: number; width: number; height: number; resize: boolean } | null>(null);
  const selected = template.blocks.find((block) => block.id === selectedBlockId) ?? null;

  const beginPointer = (event: React.PointerEvent, resize: boolean) => {
    if (!selected) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { blockId: selected.id, startX: event.clientX, startY: event.clientY, x: selected.x, y: selected.y, width: selected.width, height: selected.height, resize };
  };

  const movePointer = (event: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const columnWidth = Math.max(1, (event.currentTarget.getBoundingClientRect().width - template.card.padding * 2) / 12);
    const dx = Math.round((event.clientX - drag.startX) / columnWidth);
    const dy = Math.round((event.clientY - drag.startY) / (template.card.rowHeight + template.card.gap));
    if (drag.resize) onResizeBlock(drag.blockId, drag.width + dx, drag.height + dy);
    else onMoveBlock(drag.blockId, drag.x + dx, drag.y + dy);
  };

  const keyboardMove = (event: React.KeyboardEvent) => {
    if (!selected || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const dx = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0;
    const dy = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (event.shiftKey) onResizeBlock(selected.id, selected.width + dx, selected.height + dy);
    else onMoveBlock(selected.id, selected.x + dx, selected.y + dy);
  };

  return (
    <div
      className="relative mx-auto w-full"
      style={{ maxWidth: template.card.width }}
      onPointerMove={movePointer}
      onPointerUp={() => { dragRef.current = null; }}
      onKeyDown={keyboardMove}
    >
      <EquipmentTileRenderer card={card} template={template} editing={!preview} selectedBlockId={selectedBlockId} onSelectBlock={onSelectBlock} />
      {!preview && selected && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 grid"
          style={{ gridTemplateColumns: 'repeat(12, minmax(0, 1fr))', gridAutoRows: template.card.rowHeight, gap: template.card.gap, padding: template.card.padding }}
        >
          <div
            className="pointer-events-auto relative cursor-move border-2 border-blue-600"
            style={{ gridColumn: `${selected.x + 1} / span ${selected.width}`, gridRow: `${selected.y + 1} / span ${selected.height}` }}
            onPointerDown={(event) => beginPointer(event, false)}
          >
            <button
              type="button"
              aria-label="Изменить размер блока"
              className="absolute -bottom-2 -right-2 h-6 w-6 cursor-se-resize rounded-full border-2 border-white bg-blue-600 shadow"
              onPointerDown={(event) => { event.stopPropagation(); beginPointer(event, true); }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

