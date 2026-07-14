'use client';

import { useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type HierarchyType = 'field' | 'cluster' | 'picket';

const TYPE_LABELS: Record<HierarchyType, string> = {
  field: 'Свайное поле',
  cluster: 'Куст',
  picket: 'Пикет',
};

interface AddHierarchyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: HierarchyType;
  onAdd: (name: string) => Promise<void>;
}

export function AddHierarchyDialog({ open, onOpenChange, type, onAdd }: AddHierarchyDialogProps) {
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Введите название');
      return;
    }
    setAdding(true);
    try {
      await onAdd(name.trim());
      setName('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить {TYPE_LABELS[type]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`Название ${TYPE_LABELS[type].toLowerCase()}`}
              className="h-11"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={adding || !name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
