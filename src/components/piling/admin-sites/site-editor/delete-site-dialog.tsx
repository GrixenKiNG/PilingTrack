'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { SiteListItem } from '../types';

interface DeleteSiteDialogProps {
  site: SiteListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function DeleteSiteDialog({ site, open, onOpenChange, onConfirm }: DeleteSiteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const submit = async () => {
    setDeleting(true);
    try { await onConfirm(); } finally { setDeleting(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-amber-700">Деактивировать объект?</DialogTitle>
          <DialogDescription>
            Объект «{site?.name}» станет неактивным. Отчёты, иерархия, планы и назначения сохранятся.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">Объект можно будет снова активировать.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={submit} disabled={deleting} variant="destructive">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Деактивировать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
