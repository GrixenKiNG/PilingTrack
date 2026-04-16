'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Eye, ExternalLink, Loader2, Printer, X, ZoomIn, ZoomOut } from 'lucide-react';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(100);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [scrollPosition, setScrollPosition] = useState({ x: 0, y: 0 });

  const previewUrl = useMemo(() => {
    if (!reportId) {
      return null;
    }

    return `/api/reports/single-pdf?reportId=${encodeURIComponent(reportId)}&inline=1&t=${Date.now()}#zoom=page-fit`;
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
      setZoom(100);
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

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('iframe')) {
      if (target.tagName !== 'IFRAME') return;
    }

    setIsDragging(true);
    setDragStart({ x: e.clientX, y: e.clientY });
    setScrollPosition({
      x: containerRef.current.scrollLeft,
      y: containerRef.current.scrollTop,
    });
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging || !containerRef.current) return;

    const deltaX = e.clientX - dragStart.x;
    const deltaY = e.clientY - dragStart.y;

    containerRef.current.scrollLeft = scrollPosition.x - deltaX;
    containerRef.current.scrollTop = scrollPosition.y - deltaY;
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 10, 200));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 10, 50));
  };

  const handleZoomReset = () => {
    setZoom(100);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-full max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex-shrink-0 border-b border-slate-200 px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0 flex-1">
              <DialogTitle className="flex items-center gap-2 text-base font-semibold text-slate-900">
                <Eye className="h-4 w-4 flex-shrink-0 text-orange-500" />
                <span className="truncate">Предварительный просмотр отчёта</span>
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs text-slate-500">
                {loading
                  ? 'Загрузка PDF...'
                  : error
                    ? 'Не удалось отобразить PDF'
                    : 'Используйте мышь для перемещения, кнопки для масштабирования'}
              </DialogDescription>
            </div>
            <div className="flex flex-shrink-0 items-center gap-1">
              <Button onClick={handleZoomOut} disabled={!previewUrl || zoom <= 50} size="sm" variant="outline" className="h-8 whitespace-nowrap text-xs">
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <Button onClick={handleZoomReset} disabled={!previewUrl || zoom === 100} size="sm" variant="outline" className="h-8 min-w-12 whitespace-nowrap text-xs">
                {zoom}%
              </Button>
              <Button onClick={handleZoomIn} disabled={!previewUrl || zoom >= 200} size="sm" variant="outline" className="h-8 whitespace-nowrap text-xs">
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
              <div className="mx-1 h-6 w-px bg-slate-200" />
              <Button onClick={handlePrint} disabled={!previewUrl || loading || !!error} size="sm" variant="outline" className="h-8 whitespace-nowrap text-xs">
                <Printer className="mr-1.5 h-3.5 w-3.5" />
                Печать
              </Button>
              <Button
                onClick={handleDownload}
                disabled={!downloadUrl}
                size="sm"
                variant="outline"
                className="h-8 whitespace-nowrap border-orange-200 text-xs text-orange-600 hover:bg-orange-50 hover:text-orange-700"
              >
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Скачать
              </Button>
              <Button onClick={handleOpenInNewTab} disabled={!previewUrl} size="sm" variant="outline" className="h-8 whitespace-nowrap text-xs">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Открыть
              </Button>
              <Button onClick={handleClose} size="sm" variant="outline" className="h-8 whitespace-nowrap text-xs">
                <X className="mr-1.5 h-3.5 w-3.5" />
                Закрыть
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div
          ref={containerRef}
          className="relative min-h-0 flex-1 overflow-auto bg-slate-100 px-4 py-4"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          {previewUrl && (
            <>
              <div style={{ display: 'inline-block', width: '100%' }}>
                <iframe
                  ref={iframeRef}
                  src={previewUrl}
                  className="rounded-lg border border-slate-200 bg-white"
                  style={{
                    width: '100%',
                    aspectRatio: '8.5 / 11',
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top center',
                    transition: 'transform 0.2s ease-out',
                  }}
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
              </div>
              {!loading && !error && (
                <div className="mt-3 flex flex-col items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:flex-row sm:gap-3">
                  <span className="text-center sm:text-left">Если встроенный просмотрщик не отрисовал PDF, откройте его в новой вкладке.</span>
                  <Button onClick={handleOpenInNewTab} size="sm" variant="outline" className="h-7 flex-shrink-0 whitespace-nowrap text-xs">
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
