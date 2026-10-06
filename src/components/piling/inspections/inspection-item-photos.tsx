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
import { Camera, Loader2, Trash2 } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { getThumbnailUrl } from '@/lib/media-thumbnails';
import { InspectionLoadError, isRetryableLoadError, loadErrorText, catchText } from './inspection-api-error';

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
  // Сбой чтения галереи — не «фото нет»: раньше он молча отдавал пустой
  // список и обнулял счётчик у родителя (R100 №8).
  const [loadError, setLoadError] = useState<InspectionLoadError | null>(null);

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
      // Отказ (403/500) — не «фото нет»: пустая галерея обнуляла счётчик у
      // родителя, и завершение требовало фото, которое на сервере есть.
      if (!res.ok) {
        setLoadError(new InspectionLoadError(res.status));
        return;
      }
      const json = await res.json();
      const list: MediaRecord[] = json.data || [];
      const tiles = await Promise.all(
        list.map(async (m): Promise<PhotoTile> => {
          // Через накопитель: плитки грузятся разом, и ссылки на них уезжают
          // одним запросом вместо одного на плитку. Про отсутствующую
          // миниатюру решает сервер — он сам откатывается к оригиналу.
          const thumbUrl = await getThumbnailUrl(m.id);
          return { ...m, thumbUrl, fullUrl: null };
        })
      );
      setPhotos(tiles);
      setLoadError(null);
      onCountChangeRef.current?.(tiles.length);
    } catch {
      setLoadError(new InspectionLoadError(null));
    } finally {
      setLoading(false);
    }
  }, [entityId]);

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
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-2).
      toast.error(catchText(err, 'Ошибка загрузки'));
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
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-2).
      toast.error(catchText(err, 'Ошибка удаления'));
    } finally {
      setBusy(false);
    }
  };

  const handleOpen = async (tile: PhotoTile) => {
    if (tile.fullUrl) {
      window.open(tile.fullUrl, '_blank', 'noreferrer');
      return;
    }
    try {
      const dl = await authFetch(`/api/media/${tile.id}/download`);
      // Тихий `return` на отказе давал клик без окна и без объяснения (F-R115-9).
      if (!dl.ok) {
        toast.error(dl.status === 403
          ? 'Нет прав на просмотр фото. Смените роль или обратитесь к администратору.'
          : 'Не удалось открыть фото. Повторите попытку.');
        return;
      }
      const url = (await dl.json()).url as string;
      setPhotos((prev) => prev.map((p) => (p.id === tile.id ? { ...p, fullUrl: url } : p)));
      window.open(url, '_blank', 'noreferrer');
    } catch (err) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-2).
      toast.error(catchText(err, 'Не удалось открыть фото. Повторите попытку.'));
    }
  };

  if (loading) {
    return (
      <div className="h-10 flex items-center gap-1.5 text-muted-foreground text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Загрузка фото…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>
          {loadErrorText(loadError, {
            forbidden: 'Нет прав на просмотр фото. Смените роль или обратитесь к администратору.',
            notFound: 'Фото не найдены.',
            server: 'Не удалось загрузить фото. Сервер вернул ошибку.',
          })}
        </span>
        {isRetryableLoadError(loadError) && (
          <button
            type="button"
            onClick={() => void refresh()}
            className="inline-flex min-h-11 items-center text-xs font-medium text-signal-strong underline hover:no-underline sm:min-h-0"
          >
            Повторить
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="mt-2">
      {photos.length > 0 && (
        <div className="mb-2 grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((p) => (
            <div key={p.id} className="group relative aspect-square overflow-hidden rounded-lg bg-muted border">
              {p.thumbUrl ? (
                <button
                  type="button"
                  onClick={() => handleOpen(p)}
                  aria-label="Открыть фото"
                  title="Открыть фото"
                  className="absolute inset-0"
                >
                  <Image
                    src={p.thumbUrl}
                    alt={p.fileName}
                    fill
                    unoptimized
                    className="object-cover cursor-zoom-in"
                  />
                </button>
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <Camera className="w-6 h-6" />
                </div>
              )}
              <button
                type="button"
                onClick={() => handleDelete(p.id)}
                disabled={busy}
                aria-label="Удалить фото"
                className="absolute top-1 right-1 inline-flex h-11 w-11 items-center justify-center rounded bg-card/90 text-destructive-strong shadow-sm disabled:opacity-50"
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
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-signal-strong disabled:opacity-50"
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
