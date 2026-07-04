import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { cn } from '@/lib/utils';
import { EquipmentTileBlockContent } from './equipment-tile-block';
import type { EquipmentTileBlock, EquipmentTileTemplate } from './equipment-tile-template';

export interface EquipmentTileRendererProps {
  card: FleetCard;
  template: EquipmentTileTemplate;
  editing?: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
}

function blockStyle(block: EquipmentTileBlock): React.CSSProperties {
  const alignItems = block.style.alignItems === 'start' ? 'flex-start' : block.style.alignItems === 'end' ? 'flex-end' : 'center';
  const justifyContent = block.style.textAlign === 'left' ? 'flex-start' : block.style.textAlign === 'right' ? 'flex-end' : 'center';
  return {
    gridColumn: `${block.x + 1} / span ${block.width}`,
    gridRow: `${block.y + 1} / span ${block.height}`,
    display: 'flex',
    alignItems,
    justifyContent,
    overflow: 'hidden',
    background: block.style.background,
    color: block.style.color,
    borderColor: block.style.borderColor,
    borderWidth: block.style.borderWidth,
    borderStyle: block.style.borderWidth > 0 ? 'solid' : 'none',
    borderRadius: block.style.borderRadius,
    padding: block.style.padding,
    fontSize: block.style.fontSize,
    fontWeight: block.style.fontWeight,
    textAlign: block.style.textAlign,
  };
}

export function EquipmentTileRenderer({
  card,
  template,
  editing = false,
  selectedBlockId = null,
  onSelectBlock,
}: EquipmentTileRendererProps) {
  const content = template.blocks.filter((block) => block.visible).map((block) => {
    const common = {
      key: block.id,
      'data-testid': `equipment-tile-block-${block.id}`,
      'data-block-id': block.id,
      style: blockStyle(block),
      className: cn(
        'relative min-h-0 min-w-0 transition-shadow',
        editing && 'cursor-pointer outline outline-1 outline-blue-300 hover:outline-blue-500',
        editing && selectedBlockId === block.id && 'z-10 outline-2 outline-blue-600 shadow-lg',
      ),
    };

    if (editing) {
      return (
        <button
          {...common}
          type="button"
          aria-label={`Редактировать блок ${block.id}`}
          aria-pressed={selectedBlockId === block.id}
          onClick={() => onSelectBlock?.(block.id)}
        >
          <EquipmentTileBlockContent block={block} card={card} />
        </button>
      );
    }

    return (
      <div {...common}>
        <EquipmentTileBlockContent block={block} card={card} />
      </div>
    );
  });

  return (
    <article
      data-testid="equipment-tile"
      className="grid h-full w-full overflow-hidden shadow-sm"
      style={{
        minHeight: template.card.minHeight,
        gridTemplateColumns: `repeat(12, minmax(0, 1fr))`,
        gridAutoRows: template.card.rowHeight,
        gap: template.card.gap,
        padding: template.card.padding,
        background: template.card.background,
        borderColor: template.card.borderColor,
        borderWidth: template.card.borderWidth,
        borderStyle: template.card.borderWidth > 0 ? 'solid' : 'none',
        borderRadius: template.card.borderRadius,
      }}
    >
      {content}
    </article>
  );
}
