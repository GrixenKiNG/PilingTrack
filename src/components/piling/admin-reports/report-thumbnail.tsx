'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Image as ImageIcon, X } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';

interface Props {
  reportId: string;
  /**
   * First photo of the report when the caller already knows it (batched
   * server-side). `null` = report has no photos, skip all requests.
   * `undefined` = unknown, fall back to fetching the media list.
   */
  mediaId?: string | null;
}

export function ReportThumbnail({ reportId, mediaId: knownMediaId }: Props) {
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [fullUrl, setFullUrl] = useState<string | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (knownMediaId === null) return;
    let cancelled = false;
    (async () => {
      try {
        let photoId = knownMediaId;
        if (!photoId) {
          const res = await authFetch(`/api/media?entityType=report&entityId=${encodeURIComponent(reportId)}`);
          if (!res.ok) return;
          const json = await res.json();
          photoId = json.data?.[0]?.id;
        }
        if (!photoId || cancelled) return;
        setMediaId(photoId);
        const dl = await authFetch(`/api/media/${photoId}/download?thumb=1`);
        if (dl.ok && !cancelled) setThumbUrl((await dl.json()).url);
      } catch {
        /* silent — list view is best-effort */
      }
    })();
    return () => { cancelled = true; };
  }, [reportId, knownMediaId]);

  const handleOpen = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!mediaId) return;
    if (!fullUrl) {
      const dl = await authFetch(`/api/media/${mediaId}/download`);
      if (dl.ok) setFullUrl((await dl.json()).url);
    }
    setOpen(true);
  };

  if (!thumbUrl) return null;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        aria-label="Открыть фото отчёта"
        className="h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 transition-colors hover:border-orange-400"
        title="Открыть фото"
      >
        <Image src={thumbUrl} alt="" width={32} height={32} unoptimized className="w-full h-full object-cover" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Закрыть фото"
            className="absolute right-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <X className="w-5 h-5" />
          </button>
          {fullUrl ? (
            <Image
              src={fullUrl}
              alt="Фото отчёта"
              width={1600}
              height={1200}
              unoptimized
              className="max-h-[90vh] w-auto h-auto object-contain rounded-lg"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <ImageIcon className="w-12 h-12 text-white/50 animate-pulse" />
          )}
        </div>
      )}
    </>
  );
}
