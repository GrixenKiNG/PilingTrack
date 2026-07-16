'use client';

/**
 * Block content for the 'equipment-card' layout surface (/admin/equipment
 * tile view). Renders the two card-specific blocks (brand logo, quick links)
 * and delegates the shared data keys (site, operator, metrics, …) to the
 * monitoring block content, which already renders them from a FleetCard.
 */

import Image from 'next/image';
import Link from 'next/link';
import { BookText, ExternalLink, Wrench } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';
import type { LayoutBlock } from '@/components/piling/layout-editor/layout-template';
import { EquipmentTileBlockContent } from '@/components/piling/monitoring/equipment-tile-block';
import { getDefaultEquipmentTileAssetStorage } from '@/components/piling/monitoring/equipment-tile-asset-storage';
import type { EquipmentTileBlock } from '@/components/piling/monitoring/equipment-tile-template';
import { getEquipmentBrand } from './equipment-brand-logo';
import type { FleetCard } from './fleet-types';

function BrandLogoBlock({ card }: { card: FleetCard }) {
  const brand = getEquipmentBrand(card.model);
  if (!brand) return <span className="text-xs text-slate-400">{card.model || '—'}</span>;
  return (
    <div
      className={cn('flex max-h-full items-center justify-center', brand.logoBg && 'rounded-xl px-4 py-3')}
      style={brand.logoBg ? { background: brand.logoBg } : undefined}
    >
      <Image
        src={brand.logoSrc}
        alt={brand.name}
        title={brand.name}
        width={brand.compact ? 96 : 128}
        height={brand.compact ? 96 : 128}
        className={cn('max-h-full object-contain', brand.compact ? 'h-24 w-24' : 'h-32 w-32')}
        style={brand.compact ? { transform: 'scaleX(1.1)' } : undefined}
        unoptimized
      />
    </div>
  );
}

function QuickLinksBlock({ card }: { card: FleetCard }) {
  const linkClass = 'flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900';
  return (
    <div className="flex w-full gap-2" onClick={(event) => event.stopPropagation()}>
      <Link href={`/admin/equipment/${card.id}`} className={linkClass}>
        <Wrench className="h-3.5 w-3.5" /> ТО
      </Link>
      <Link href={`/admin/equipment/${card.id}`} className={linkClass}>
        <BookText className="h-3.5 w-3.5" /> Документы
      </Link>
      <Link
        href={`/admin/equipment/${card.id}`}
        aria-label="Открыть карточку"
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700"
      >
        <ExternalLink className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export function EquipmentCardBlockContent({ block, card }: { block: LayoutBlock; card: FleetCard }) {
  if (block.kind === 'data' && block.dataKey === 'brandLogo') return <BrandLogoBlock card={card} />;
  if (block.kind === 'data' && block.dataKey === 'quickLinks') return <QuickLinksBlock card={card} />;
  return (
    <EquipmentTileBlockContent
      block={block as EquipmentTileBlock}
      card={card}
      assetStorage={getDefaultEquipmentTileAssetStorage()}
    />
  );
}
