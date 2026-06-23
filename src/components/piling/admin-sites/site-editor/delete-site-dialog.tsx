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
  onDeactivate: () => Promise<void>;
}

export function DeleteSiteDialog({ site, open, onOpenChange, onConfirm, onDeactivate }: DeleteSiteDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const submit = async () => {
    setDeleting(true);
    try { await onConfirm(); } finally { setDeleting(false); }
  };
  const deactivate = async () => {
    setDeactivating(true);
    try { await onDeactivate(); } finally { setDeactivating(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-700">Удалить объект навсегда?</DialogTitle>
          <DialogDescription>
            Объект «{site?.name}» и его настройки (планы, иерархия, назначения) будут удалены безвозвратно.
            Удаление возможно только для ошибочно заведённых объектов — без бригад и без отчётов.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-xs text-red-800">
            Это действие необратимо. Если объект уже в работе (есть бригады или отчёты), удаление будет отклонено —
            деактивируйте его вместо удаления.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={deactivate} disabled={deactivating || deleting}>
              {deactivating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Деактивировать вместо удаления'}
            </Button>
            <Button onClick={submit} disabled={deleting || deactivating} variant="destructive">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить навсегда'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
