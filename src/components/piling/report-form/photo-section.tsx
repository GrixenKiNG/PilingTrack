'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { Camera, Loader2, Trash2 } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';

interface MediaRecord {
  id: string;
  fileName: string;
  contentType: string;
  thumbnailKey: string | null;
}

interface Props {
  reportId: string;
  /** When false, the section becomes view-only (no upload/delete buttons). */
  canEdit?: boolean;
}

export function PhotoSection({ reportId, canEdit = true }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [photo, setPhoto] = useState<MediaRecord | null>(null);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/media?entityType=report&entityId=${encodeURIComponent(reportId)}`);
      if (!res.ok) {
        setPhoto(null);
        return;
      }
      const json = await res.json();
      const list: MediaRecord[] = json.data || [];
      const current = list[0] || null;
      setPhoto(current);
      if (current) {
        const which = current.thumbnailKey ? '?thumb=1' : '';
        const dl = await authFetch(`/api/media/${current.id}/download${which}`);
        if (dl.ok) {
          const data = await dl.json();
          setThumbUrl(data.url);
        }
      } else {
        setThumbUrl(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    if (reportId) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is recreated each render; the thumbnail only needs to (re)load when reportId changes
  }, [reportId]);

  const handleFile = async (file: File) => {
    // Desktop Chrome and some Safari builds don't know HEIC and hand us an
    // empty `file.type`. Infer from the extension so the server still gets
    // a valid content-type rather than rejecting on the allowedContentTypes
    // check.
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    const EXT_MAP: Record<string, string> = {
      heic: 'image/heic', heif: 'image/heif',
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    };
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
      // 1. presigned URL
      const presign = await authFetch('/api/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileName: file.name,
          contentType,
          fileSize: file.size,
          entityType: 'report',
          entityId: reportId,
        }),
      });
      if (!presign.ok) throw new Error((await presign.json()).error || 'Не удалось получить ссылку для загрузки');
      const { mediaId, uploadUrl } = await presign.json();

      // 2. PUT directly to R2 — must match the contentType used in the
      // presign, otherwise R2 rejects the signature.
      const put = await fetch(uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': contentType } });
      if (!put.ok) throw new Error('Загрузка не удалась');

      // 3. confirm (server downloads + builds thumbnail)
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

  const handleDelete = async () => {
    if (!photo) return;
    if (!confirm('Удалить фото?')) return;
    setBusy(true);
    try {
      const res = await authFetch(`/api/media/${photo.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Удаление не удалось');
      toast.success('Фото удалено');
      setPhoto(null);
      setThumbUrl(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-slate-900">Фото отчёта</h3>
        {photo && canEdit && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={busy}
            className="text-xs text-red-600 hover:text-red-700 flex items-center gap-1"
          >
            <Trash2 className="w-3 h-3" /> Удалить
          </button>
        )}
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-slate-400">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : photo && thumbUrl ? (
        <a href={thumbUrl} target="_blank" rel="noreferrer" className="block">
          <Image
            src={thumbUrl}
            alt={photo.fileName}
            width={400}
            height={300}
            unoptimized
            className="w-full max-h-64 object-contain rounded-lg bg-slate-50"
          />
        </a>
      ) : canEdit ? (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="w-full h-32 rounded-lg border-2 border-dashed border-slate-300 hover:border-orange-400 hover:bg-orange-50/50 transition-colors flex flex-col items-center justify-center gap-2 text-slate-500 disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <>
              <Camera className="w-7 h-7" />
              <span className="text-sm">Выбрать из галереи или сделать фото</span>
            </>
          )}
        </button>
      ) : (
        <p className="text-sm text-slate-400 text-center py-6">Фото не прикреплено</p>
      )}

      {/* No `capture` — iOS Safari forces camera-only when it's set and the
         resulting photo isn't auto-saved to Photos. Without it the OS shows
         the full picker (library + camera + file).

         The off-screen positioning (not `display: none` / `hidden`) is
         deliberate: iOS PWA mode refuses to open the system picker for a
         truly hidden input when triggered via a JS-fired click. */}
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
