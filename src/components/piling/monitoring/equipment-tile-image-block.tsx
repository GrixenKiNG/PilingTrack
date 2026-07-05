'use client';

import { useEffect, useState } from 'react';
import type { EquipmentTileAssetStorage } from './equipment-tile-asset-storage';

export function EquipmentTileImageBlock({
  storage,
  assetId,
  alt,
  fit,
}: {
  storage: EquipmentTileAssetStorage;
  assetId: string;
  alt: string;
  fit: 'contain' | 'cover';
}) {
  const [loaded, setLoaded] = useState<{ assetId: string; src: string | null } | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    void storage.get(assetId).then((record) => {
      if (!active) return;
      objectUrl = record ? URL.createObjectURL(record.blob) : null;
      setLoaded({ assetId, src: objectUrl });
    }).catch(() => {
      if (active) setLoaded({ assetId, src: null });
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId, storage]);

  if (loaded?.assetId !== assetId) {
    return <span className="text-xs text-slate-400">Загрузка изображения…</span>;
  }
  if (!loaded.src) {
    return <span className="text-xs text-slate-400">Изображение недоступно</span>;
  }

  return <img src={loaded.src} alt={alt} className="h-full w-full" style={{ objectFit: fit }} />;
}
