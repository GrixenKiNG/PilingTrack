'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Loader2, Printer, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

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

  const previewUrl = useMemo(() => {
    if (!reportId) return null;
    return `/api/reports/single-pdf?reportId=${encodeURIComponent(reportId)}&inline=1&t=${Date.now()}#toolbar=0&navpanes=0&scrollbar=0&view=FitH`;
  }, [reportId]);

  const downloadUrl = useMemo(() => {
    if (!reportId) return null;
    return `/api/reports/single-pdf?reportId=${encodeURIComponent(reportId)}&t=${Date.now()}`;
  }, [reportId]);

  useEffect(() => {
    if (open && previewUrl) setLoading(true);
    else setLoading(false);
  }, [open, previewUrl]);

  const handleDownload = () => {
    if (!downloadUrl) return;
    const link = document.createElement('a');
    link.href = downloadUrl;
    link.download = downloadName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePrint = () => {
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameWindow) return;
    try {
      frameWindow.focus();
      frameWindow.print();
    } catch {
      if (previewUrl) window.open(previewUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[95vh] w-[95vw] max-w-5xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-2">
          <DialogTitle className="truncate text-sm font-medium text-slate-900">
            Просмотр отчёта
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button onClick={handlePrint} disabled={!previewUrl || loading} size="sm" variant="outline" className="h-8 text-xs">
              <Printer className="mr-1.5 h-3.5 w-3.5" />Печать
            </Button>
            <Button onClick={handleDownload} disabled={!downloadUrl} size="sm" variant="outline" className="h-8 text-xs">
              <Download className="mr-1.5 h-3.5 w-3.5" />Скачать
            </Button>
            <Button onClick={() => onOpenChange(false)} size="sm" variant="ghost" className="h-8 w-8 p-0">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-slate-100">
          {previewUrl && (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="h-full w-full border-0"
              title="PDF Preview"
              onLoad={() => setLoading(false)}
            />
          )}
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white/80">
              <Loader2 className="h-5 w-5 animate-spin text-orange-500" />
              <span className="text-sm text-slate-500">Загрузка PDF…</span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
