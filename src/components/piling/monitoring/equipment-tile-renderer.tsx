/**
 * Monitoring wrapper around the shared LayoutRenderer: binds block content to
 * a FleetCard via EquipmentTileBlockContent. Public API unchanged.
 */

import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { LayoutRenderer } from '@/components/piling/layout-editor/layout-renderer';
import {
  getDefaultEquipmentTileAssetStorage,
  type EquipmentTileAssetStorage,
} from './equipment-tile-asset-storage';
import { EquipmentTileBlockContent } from './equipment-tile-block';
import type { EquipmentTileBlock, EquipmentTileTemplate } from './equipment-tile-template';

export interface EquipmentTileRendererProps {
  card: FleetCard;
  template: EquipmentTileTemplate;
  editing?: boolean;
  selectedBlockId?: string | null;
  onSelectBlock?: (blockId: string) => void;
  assetStorage?: EquipmentTileAssetStorage;
}

export function EquipmentTileRenderer({
  card,
  template,
  editing = false,
  selectedBlockId = null,
  onSelectBlock,
  assetStorage = getDefaultEquipmentTileAssetStorage(),
}: EquipmentTileRendererProps) {
  return (
    <LayoutRenderer
      template={template}
      editing={editing}
      selectedBlockId={selectedBlockId}
      onSelectBlock={onSelectBlock}
      renderBlockContent={(block) => (
        <EquipmentTileBlockContent block={block as EquipmentTileBlock} card={card} assetStorage={assetStorage} />
      )}
    />
  );
}
