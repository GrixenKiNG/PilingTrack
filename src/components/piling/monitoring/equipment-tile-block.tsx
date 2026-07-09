import { useEffect, useState } from 'react';
import Image from 'next/image';
import { AlertTriangle, MapPin, Timer, User, Wrench } from 'lucide-react';
import { authFetch } from '@/lib/api';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { getEquipmentBrand } from '@/components/piling/admin-equipment/equipment-brand-logo';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { KIND_LABEL } from '@/components/piling/admin-equipment/equipment-status';
import { formatFixed, formatHours } from '@/lib/format';
import { checkMaintenanceDue } from '@/lib/maintenance-due';
import type { EquipmentTileAssetStorage } from './equipment-tile-asset-storage';
import type { EquipmentTileBlock } from './equipment-tile-template';

function Value({ label, value, icon }: { label: string; value: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      {icon && <span className="shrink-0 text-slate-400">{icon}</span>}
      <span className="min-w-0">
        <span className="block text-[0.65em] font-medium uppercase tracking-wide opacity-55">{label}</span>
        <span className="block truncate font-semibold">{value}</span>
      </span>
    </div>
  );
}

// The media download endpoint returns { url } with a presigned S3 link (same
// contract report-thumbnail.tsx and equipment-photos.tsx consume) — an <img>
// can't point at it directly, so resolve it first. cdnUrl values pass through.
function ServerPhoto({ photoUrl, alt, fit }: { photoUrl: string; alt: string; fit: 'cover' | 'contain' }) {
  const [url, setUrl] = useState<string | null>(photoUrl.startsWith('/api/') ? null : photoUrl);

  useEffect(() => {
    if (!photoUrl.startsWith('/api/')) { setUrl(photoUrl); return; }
    let active = true;
    setUrl(null);
    void (async () => {
      try {
        const res = await authFetch(photoUrl);
        if (!res.ok) return;
        const body: unknown = await res.json();
        const signed = (body as { url?: unknown }).url;
        if (active && typeof signed === 'string') setUrl(signed);
      } catch {
        // leave the placeholder — a broken photo must not break the tile
      }
    })();
    return () => { active = false; };
  }, [photoUrl]);

  if (!url) return <span className="text-xs text-slate-400">Фото не загружено</span>;
  return <img src={url} alt={alt} className="h-full w-full" style={{ objectFit: fit }} />;
}

function PhotoBlock({ card }: { card: FleetCard }) {
  const photo = getEquipmentPhoto(card.model);
  const brand = getEquipmentBrand(card.model);
  const status =
    card.equipmentStatus === 'repair'
      ? { label: 'В ремонте', classes: 'bg-red-100 text-red-700' }
      : card.status === 'active'
        ? { label: 'В работе', classes: 'bg-emerald-100 text-emerald-700' }
        : card.status === 'expected'
          ? { label: 'Ждём отчёт', classes: 'bg-amber-100 text-amber-700' }
          : { label: 'Нет отчёта', classes: 'bg-slate-200 text-slate-700' };

  return (
    <div className="relative h-full min-h-0 overflow-hidden" style={{ backgroundColor: brand?.tint ?? '#cbd5e1' }}>
      {photo && (
        <>
          <Image src={photo} alt="" fill aria-hidden className="scale-125 object-cover blur-lg opacity-70" unoptimized />
          <Image src={photo} alt="" fill sizes="(max-width: 768px) 100vw, 480px" className="object-contain" unoptimized />
        </>
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-black/60 via-black/10 to-transparent" />
      <div className="absolute left-3 top-3 max-w-[72%] text-left text-white">
        <span className={`inline-flex rounded-md px-2 py-1 text-3xs font-bold uppercase ${status.classes}`}>
          {status.label}
        </span>
        <h3 className="mt-1 line-clamp-1 text-base font-bold leading-tight drop-shadow">{card.name}</h3>
        <p className="line-clamp-1 text-2xs font-medium text-white/85">
          {card.model}{card.model && KIND_LABEL[card.kind] !== '—' ? ` · ${KIND_LABEL[card.kind]}` : ''}
        </p>
      </div>
      {card.inventoryNumber && (
        <span className="absolute right-3 top-3 rounded-md bg-white/20 px-2 py-1 text-3xs font-semibold text-white backdrop-blur">
          {card.inventoryNumber}
        </span>
      )}
    </div>
  );
}

export function EquipmentTileBlockContent({
  block,
  card,
  // Kept in the prop shape for caller compatibility (assetStorage still threads
  // through EquipmentTileRenderer/Canvas for the editor's live preview machinery);
  // no longer used here since 'image' blocks render card.photoUrl from the server.
  assetStorage: _assetStorage,
}: {
  block: EquipmentTileBlock;
  card: FleetCard;
  assetStorage: EquipmentTileAssetStorage;
}) {
  if (block.kind === 'text') return <span className="whitespace-pre-wrap break-words">{block.text}</span>;
  if (block.kind === 'divider') return <span className="block h-px w-full bg-current opacity-20" />;
  if (block.kind === 'image') {
    if (!card.photoUrl) return <span className="text-xs text-slate-400">Фото не загружено</span>;
    return <ServerPhoto photoUrl={card.photoUrl} alt={block.alt ?? card.name} fit={block.imageFit ?? 'cover'} />;
  }
  if (block.dataKey === 'photo') return <PhotoBlock card={card} />;

  const hoursLeft =
    card.nextMaintenanceAtHours != null && card.engineHoursTotal != null
      ? card.nextMaintenanceAtHours - card.engineHoursTotal
      : null;

  switch (block.dataKey) {
    case 'identity':
      return <Value label="Установка" value={`${card.name} · ${card.model}`} />;
    case 'status':
      return <Value label="Статус" value={card.equipmentStatus === 'repair' ? 'В ремонте' : card.status === 'active' ? 'В работе' : 'Нет отчёта'} />;
    case 'inventoryNumber':
      return <Value label="Инвентарный №" value={card.inventoryNumber ?? '—'} />;
    case 'site':
      return <Value label="Объект" value={card.assignedSiteName ?? '—'} icon={<MapPin className="h-4 w-4" />} />;
    case 'operator':
      return <Value label="Оператор" value={card.assignedOperatorName ?? '—'} icon={<User className="h-4 w-4" />} />;
    case 'engineHours':
      return <Value label="Моточасы" value={card.engineHoursTotal != null ? `${card.engineHoursTotal.toLocaleString('ru')} ч` : '—'} icon={<Timer className="h-4 w-4" />} />;
    case 'maintenance':
      return <Value label="Ближайшее ТО" value={hoursLeft != null ? `${Math.max(0, Math.round(hoursLeft))} ч` : '—'} icon={<Wrench className="h-4 w-4" />} />;
    case 'todayPiles':
      return <Value label="Сваи" value={card.todayTotals ? `${card.todayTotals.piles} / ${formatFixed(card.todayTotals.pileMeters, 1)} м` : '—'} />;
    case 'todayDrilling':
      return <Value label="Бурение" value={card.todayTotals ? `${card.todayTotals.drillingCount} / ${formatFixed(card.todayTotals.drillingMeters, 1)} м` : '—'} />;
    case 'todayDowntime':
      return <Value label="Простой" value={card.todayTotals && card.todayTotals.downtimeHours > 0 ? formatHours(card.todayTotals.downtimeHours) : '—'} />;
    case 'maintenanceAlert': {
      const due = checkMaintenanceDue(card);
      if (!due.overdue && !due.soon) return <span className="opacity-45">ТО по графику</span>;
      return (
        <span className="flex items-center gap-2 font-semibold">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {due.overdue ? 'ТО просрочено' : hoursLeft != null ? `ТО через ${Math.max(0, Math.round(hoursLeft))} ч` : 'ТО скоро'}
        </span>
      );
    }
    default:
      return <span>—</span>;
  }
}
