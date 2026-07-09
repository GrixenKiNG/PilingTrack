'use client';

import Link from 'next/link';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { usePilingStore } from '@/lib/store';
import type { EquipmentTileAssetStorage } from './equipment-tile-asset-storage';
import { EquipmentTileRenderer } from './equipment-tile-renderer';
import {
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  type EquipmentTileTemplate,
} from './equipment-tile-template';

export function EquipmentCard({
  card,
  template = DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  assetStorage,
}: {
  card: FleetCard;
  template?: EquipmentTileTemplate;
  assetStorage?: EquipmentTileAssetStorage;
}) {
  const role = usePilingStore((state) => state.currentUser?.role);
  const clickable = role === 'ADMIN' || role === 'DISPATCHER';
  const body = <EquipmentTileRenderer card={card} template={template} assetStorage={assetStorage} />;

  if (!clickable) return body;

  return (
    <Link
      href={`/admin/equipment/${card.id}`}
      className="block rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {body}
    </Link>
  );
}
