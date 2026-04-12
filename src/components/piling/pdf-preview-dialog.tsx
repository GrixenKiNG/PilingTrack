'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, ExternalLink, Loader2, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { pushClientFeedback } from '@/lib/client-feedback';

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string | null;
  downloadName?: string;
}

export function PdfPreviewDialog({
  open,
  onOpenChange,
  reportId,
  downloadName = 'otchet.pdf',
}: PdfPreviewDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const previewUrl = useMemo(() => {
    if (!reportId) {
      return null;
    }

    return `/api/reports/single-pdf?reportId=${encodeURIComponent(reportId)}&inline=1&t=${Date.now()}`;
  }, [reportId, open]);

  const downloadUrl = useMemo(() => {
    if (!reportId) {
      return null;
    }

    return `/api/reports/single-pdf?reportId=${encodeURIComponent(reportId)}&t=${Date.now()}`;
  }, [reportId, open]);

  useEffect(() => {
    if (open && previewUrl) {
      setLoading(true);
      setError(null);
      return;
    }

    if (!open) {
      setLoading(false);
      setError(null);
    }
  }, [open, previewUrl]);

  useEffect(() => {
    if (!open || !previewUrl || !loading) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setLoading(false);
    }, 2500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [loading, open, previewUrl]);

  const handleClose = () => {
    onOpenChange(false);
  };

  const handleDownload = () => {
    if (!downloadUrl) {
      return;
    }

    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleOpenInNewTab = () => {
    if (!previewUrl) {
      return;
    }

    pushClientFeedback({
      level: 'info',
      scope: 'pdf',
      action: 'pdf.preview.open_external',
      title: 'PDF открыт отдельно',
      message: 'Предпросмотр был открыт в новой вкладке как резервный сценарий.',
      persist: true,
    });
    window.open(previewUrl, '_blank', 'noopener,noreferrer');
  };

  const handlePrint = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) {
      // Fallback: open PDF in new tab and trigger print there
      if (previewUrl) {
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
      }
      return;
    }

    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      // Cross-origin frame — fallback to new tab
      if (previewUrl) {
        window.open(previewUrl, '_blank', 'noopener,noreferrer');
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[95vw] max-w-4xl flex-col gap-0 p-0">
        <DialogHeader className="px-6 pb-3 pt-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Eye className="h-4 w-4 text-orange-500" />
                Предварительный просмотр отчёта
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-slate-500">
                {loading
                  ? 'Загрузка PDF...'
                  : error
                    ? 'Не удалось отобразить PDF'
                    : 'Просмотр, печать и скачивание отчёта'}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button onClick={handlePrint} disabled={!previewUrl || loading || !!error} size="sm" variant="outline" className="h-8 text-xs">
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Печать
              </Button>
              <Button
                onClick={handleDownload}
                disabled={!downloadUrl}
                size="sm"
                variant="outline"
                className="h-8 border-orange-200 text-xs text-orange-600 hover:bg-orange-50 hover:text-orange-700"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Скачать
              </Button>
              <Button onClick={handleOpenInNewTab} disabled={!previewUrl} size="sm" variant="outline" className="h-8 text-xs">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Открыть
              </Button>
              <Button onClick={handleClose} size="sm" variant="outline" className="h-8 text-xs">
                <X className="mr-1.5 h-3.5 w-3.5" />
                Закрыть
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 px-6 pb-5">
          {previewUrl && (
            <>
              <iframe
                ref={iframeRef}
                src={previewUrl}
                className="h-full min-h-[60vh] w-full rounded-lg border border-slate-200"
                title="PDF Preview"
              onLoad={() => {
                setLoading(false);
                setError(null);
              }}
              onError={() => {
                setLoading(false);
                setError('Не удалось загрузить PDF для предпросмотра');
                pushClientFeedback({
                  level: 'warn',
                  scope: 'pdf',
                  action: 'pdf.preview.render_failed',
                  title: 'Проблема отображения PDF',
                  message: 'Встроенный просмотрщик не смог отрисовать PDF в окне приложения.',
                  persist: true,
                });
              }}
            />
              {!loading && !error && (
                <div className="mt-2 flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <span>Если встроенный просмотрщик не отрисовал PDF, откройте его в новой вкладке.</span>
                  <Button onClick={handleOpenInNewTab} size="sm" variant="outline" className="h-7 text-xs">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    Открыть отдельно
                  </Button>
                </div>
              )}
            </>
          )}

          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/85">
              <Loader2 className="h-8 w-8 animate-spin text-orange-500" />
              <p className="text-sm text-slate-500">Загрузка PDF...</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white/95">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50">
                <X className="h-6 w-6 text-red-500" />
              </div>
              <p className="text-sm font-medium text-red-600">{error}</p>
              <div className="flex items-center gap-2">
                <Button onClick={() => setLoading(true)} size="sm" variant="outline" className="text-xs">
                  Попробовать снова
                </Button>
                <Button onClick={handleOpenInNewTab} size="sm" variant="outline" className="text-xs">
                  Открыть в новой вкладке
                </Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
