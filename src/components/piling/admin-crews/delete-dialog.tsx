'use client';

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

interface DeleteDialogProps {
  open: boolean;
  onClose: () => void;
  crewName: string;
  deleting: boolean;
  onConfirm: () => void;
}

export function DeleteDialog({ open, onClose, crewName, deleting, onConfirm }: DeleteDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="h-4 w-4" />Удалить бригаду?
          </DialogTitle>
          <DialogDescription>
            Вы уверены, что хотите удалить бригаду «{crewName}»? Это действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={deleting}>Отмена</Button>
          <Button onClick={onConfirm} disabled={deleting} className="bg-red-600 text-white hover:bg-red-700">
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
