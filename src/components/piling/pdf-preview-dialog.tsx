'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

interface PdfPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportId: string | null;
}

export function PdfPreviewDialog({
  open,
  onOpenChange,
  reportId,
}: PdfPreviewDialogProps) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [loading, setLoading] = useState(false);

  const previewUrl = useMemo(() => {
    if (!reportId) return null;
    return `/api/reports/single-pdf?reportId=${encodeURIComponent(reportId)}&inline=1&t=${Date.now()}#toolbar=0&navpanes=0&scrollbar=0&view=Fit`;
  }, [reportId]);

  useEffect(() => {
    if (open && previewUrl) setLoading(true);
    else setLoading(false);
  }, [open, previewUrl]);

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
      <DialogContent className="flex aspect-[210/297] max-h-[95vh] w-[95vw] max-w-[820px] flex-col gap-0 overflow-hidden border-0 bg-white p-0 shadow-2xl">
        <DialogHeader className="flex flex-row items-center justify-between gap-2 border-b px-4 py-2 pr-12">
          <DialogTitle className="truncate text-sm font-medium text-slate-900">
            Просмотр отчёта
          </DialogTitle>
          <div className="flex items-center gap-1">
            <Button onClick={handlePrint} disabled={!previewUrl || loading} size="sm" variant="outline" className="h-8 text-xs">
              <Printer className="mr-1.5 h-3.5 w-3.5" />Печать
            </Button>
          </div>
        </DialogHeader>

        <div className="relative min-h-0 flex-1 bg-white">
          {previewUrl && (
            <iframe
              ref={iframeRef}
              src={previewUrl}
              className="h-full w-full border-0 bg-white"
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
