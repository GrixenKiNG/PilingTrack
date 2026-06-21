'use client';

/**
 * EquipmentPhotos — gallery for /admin/equipment/[id].
 *
 * Reuses the same R2 presigned-upload flow as report photos
 * (presign → PUT → confirm), but stores multiple photos per equipment
 * (entityType='equipment'). Only admins / dispatchers can reach this
 * screen, so media-auth lets the upload through without an explicit
 * entityType branch.
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
  equipmentId: string;
}

const EXT_MAP: Record<string, string> = {
  heic: 'image/heic', heif: 'image/heif',
  jpg: 'image/jpeg', jpeg: 'image/jpeg',
  png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

export function EquipmentPhotos({ equipmentId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photos, setPhotos] = useState<PhotoTile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(
        `/api/media?entityType=equipment&entityId=${encodeURIComponent(equipmentId)}`
      );
      if (!res.ok) {
        setPhotos([]);
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
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
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
          entityType: 'equipment',
          entityId: equipmentId,
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
      setPhotos((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (tile: PhotoTile) => {
    // Lazily fetch the full-size URL only on click, otherwise we'd
    // presign N original-size URLs per page render.
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

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Фото установки (общий вид, шильды, повреждения). До 10 МБ, jpg/png/heic.
        </p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 rounded-md bg-orange-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-orange-600 disabled:opacity-50"
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Camera className="w-3.5 h-3.5" />}
          Добавить фото
        </button>
      </div>

      {loading ? (
        <div className="h-24 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : photos.length === 0 ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full h-28 rounded-lg border-2 border-dashed border-slate-300 hover:border-orange-400 hover:bg-orange-50/50 transition-colors flex flex-col items-center justify-center gap-1.5 text-slate-500 disabled:opacity-50"
        >
          <Camera className="w-6 h-6" />
          <span className="text-sm">Загрузить первое фото</span>
        </button>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
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
                  <Camera className="w-8 h-8" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                disabled={busy}
                className="absolute top-1.5 right-1.5 inline-flex h-6 w-6 items-center justify-center rounded-md bg-white/90 text-rose-600 opacity-0 group-hover:opacity-100 hover:bg-white shadow-sm disabled:opacity-50"
                title="Удалить"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

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
