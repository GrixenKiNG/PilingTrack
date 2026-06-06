'use client';

/**
 * InspectionItemPhotos — per-item photo widget for the run-inspection flow.
 *
 * Uses a STABLE composite entityId: `${inspectionId}__${itemId}`.
 * Answers are delete+recreated on every save, so keying by answer.id
 * would churn. The item id is stable for the lifetime of the inspection.
 *
 * Mirror of WorkOrderPhotos (presign → PUT → confirm, gallery, delete).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

interface MediaRecord {
  id: string;
  fileName: string;
  contentType: string;
  thumbnailKey: string | null;
}

interface PhotoTile extends MediaRecord {
  thumbUrl: string | null;
  fullUrl: string | null;
}

interface Props {
  inspectionId: string;
  itemId: string;
  onCountChange?: (count: number) => void;
}

const EXT_MAP: Record<string, string> = {
  heic: 'image/heic', heif: 'image/heif',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

export function InspectionItemPhotos({ inspectionId, itemId, onCountChange }: Props) {
  const entityId = `${inspectionId}__${itemId}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  // Keep the latest onCountChange in a ref so `refresh` does not depend on it.
  // The parent passes an inline callback; depending on it would re-create
  // `refresh` every render and re-fire the fetch effect in a loop.
  const onCountChangeRef = useRef(onCountChange);
  useEffect(() => {
    onCountChangeRef.current = onCountChange;
  });

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/media?entityType=inspection&entityId=${encodeURIComponent(entityId)}`
      );
      if (!res.ok) {
        setPhotos([]);
        onCountChangeRef.current?.(0);
        return;
      }
      const json = await res.json();
      const list: MediaRecord[] = json.data || [];
      const tiles = await Promise.all(
        list.map(async (m): Promise<PhotoTile> => {
          const which = m.thumbnailKey ? '?thumb=1' : '';
          const dl = await authFetch(`/api/media/${m.id}/download${which}`);
          const thumbUrl = dl.ok ? (await dl.json()).url : null;
          return { ...m, thumbUrl, fullUrl: null };
        })
      );
      setPhotos(tiles);
      onCountChangeRef.current?.(tiles.length);
    } finally {
      setLoading(false);
    }
  }, [entityId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleFile = async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const contentType = file.type || EXT_MAP[ext] || '';
    if (!contentType.startsWith('image/')) {
      toast.error('Можно загрузить только изображение');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('Размер файла не должен превышать 10 МБ');
      return;
    }

    setBusy(true);
    try {
      const presign = await authFetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType,
          fileSize: file.size,
          entityType: 'inspection',
          entityId,
        }),
      });
      if (!presign.ok) throw new Error((await presign.json()).error || 'Не удалось получить ссылку');
      const { mediaId, uploadUrl } = await presign.json();

      const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
      if (!put.ok) throw new Error('Загрузка не удалась');

      const confirm = await authFetch(`/api/media/${mediaId}/confirm`, { method: 'POST' });
      if (!confirm.ok) throw new Error((await confirm.json()).error || 'Подтверждение не удалось');

      toast.success('Фото загружено');
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Удалить фото?')) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/media/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Удаление не удалось');
      toast.success('Фото удалено');
      const next = photos.filter((p) => p.id !== id);
      setPhotos(next);
      onCountChange?.(next.length);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (tile: PhotoTile) => {
    if (tile.fullUrl) {
      window.open(tile.fullUrl, '_blank', 'noreferrer');
      return;
    }
    const dl = await authFetch(`/api/media/${tile.id}/download`);
    if (!dl.ok) return;
    const url = (await dl.json()).url as string;
    setPhotos((prev) => prev.map((p) => (p.id === tile.id ? { ...p, fullUrl: url } : p)));
    window.open(url, '_blank', 'noreferrer');
  };

  if (loading) {
    return (
      <div className="h-10 flex items-center gap-1.5 text-slate-400 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка фото…
      </div>
    );
  }

  return (
    <div className="mt-2">
      {photos.length > 0 && (
        <div className="mb-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-slate-50 border">
              {p.thumbUrl ? (
                <Image
                  src={p.thumbUrl}
                  alt={p.fileName}
                  fill
                  unoptimized
                  className="object-cover cursor-zoom-in"
                  onClick={() => handleOpen(p)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-slate-300">
                  <Camera className="w-6 h-6" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                disabled={busy}
                className="absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded bg-white/90 text-rose-600 opacity-0 group-hover:opacity-100 shadow-sm disabled:opacity-50"
                title="Удалить"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-orange-600 disabled:opacity-50"
      >
        {busy
          ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
          : <Camera className="w-3.5 h-3.5" />}
        {photos.length > 0 ? `Ещё фото (${photos.length})` : 'Добавить фото'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*,.heic,.heif"
        className="sr-only absolute"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
        }}
      />
    </div>
  );
}
