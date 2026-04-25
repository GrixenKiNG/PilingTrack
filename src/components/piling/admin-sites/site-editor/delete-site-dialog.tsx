'use client';

import { useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { SiteListItem } from '../types';

interface DeleteSiteDialogProps {
  site: SiteListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function DeleteSiteDialog({
  site,
  open,
  onOpenChange,
  onConfirm,
}: DeleteSiteDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const submit = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-600">Удалить объект?</DialogTitle>
          <DialogDescription>
            Объект «{site?.name}» будет удалён вместе со всеми отчётами, иерархией,
            планами и назначениями. Это действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700">
            Все отчёты, планы свай и бурения, привязанные к этому объекту, будут
            безвозвратно удалены.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={deleting}
            variant="destructive"
            className="bg-red-500 hover:bg-red-600 text-white"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Удалить навсегда'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
