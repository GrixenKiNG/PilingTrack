'use client';

import { useEffect, useState } from 'react';
import { Wrench, Pencil, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { pluralizeRu } from '@/lib/format';
import type { EquipmentDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

interface CreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: { name: string; model?: string; description?: string }) => Promise<void>;
}

export function CreateEquipmentDialog({ open, onOpenChange, onSubmit }: CreateProps) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setModel('');
      setDescription('');
    }
  }, [open]);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Введите название установки');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        name: name.trim(),
        model: model.trim() || undefined,
        description: description.trim() || undefined,
      });
      onOpenChange(false);
      toast.success('Установка создана');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания установки');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-4 h-4" />
            Новая установка
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              Название <span className="text-red-500">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Например: Бауман 100"
              className="h-11"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Модель</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="Модель установки"
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Необязательное описание установки"
              className="min-h-[80px] resize-none"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditProps {
  open: boolean;
  item: EquipmentDTO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (
    id: string,
    input: { name: string; model?: string; description?: string; isActive: boolean }
  ) => Promise<void>;
}

export function EditEquipmentDialog({ open, item, onOpenChange, onSubmit }: EditProps) {
  const [name, setName] = useState('');
  const [model, setModel] = useState('');
  const [description, setDescription] = useState('');
  const [active, setActive] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && item) {
      setName(item.name);
      setModel(item.model);
      setDescription(item.description);
      setActive(item.isActive);
    }
  }, [open, item]);

  const submit = async () => {
    if (!item) return;
    if (!name.trim()) {
      toast.error('Введите название установки');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(item.id, {
        name: name.trim(),
        model: model.trim() || undefined,
        description: description.trim() || undefined,
        isActive: active,
      });
      onOpenChange(false);
      toast.success('Установка сохранена');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4" />
            Редактировать установку
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>
              Название <span className="text-red-500">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="h-11"
              autoFocus
            />
          </div>
          <div className="space-y-1.5">
            <Label>Модель</Label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-11"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Необязательное описание установки"
              className="min-h-[80px] resize-none"
            />
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <Label className="text-sm">Активна</Label>
            <button
              onClick={() => setActive(!active)}
              className={cn(
                'w-10 h-6 rounded-full transition-colors relative',
                active ? 'bg-green-500' : 'bg-slate-300'
              )}
            >
              <div
                className={cn(
                  'w-4 h-4 rounded-full bg-white absolute top-1 transition-transform',
                  active ? 'translate-x-5' : 'translate-x-1'
                )}
              />
            </button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting || !name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteProps {
  open: boolean;
  item: EquipmentDTO | null;
  crewCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => Promise<void>;
}

export function DeleteEquipmentDialog({
  open,
  item,
  crewCount,
  onOpenChange,
  onConfirm,
}: DeleteProps) {
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!item) return;
    setSubmitting(true);
    try {
      await onConfirm(item.id);
      onOpenChange(false);
      toast.success('Установка удалена');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления установки');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-600">Удалить установку?</DialogTitle>
          <DialogDescription>
            Установка «{item?.name}» будет удалена. Это действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        {crewCount > 0 && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-red-700">
              Эта установка используется в <strong>{crewCount}</strong>{' '}
              {pluralizeRu(crewCount, ['бригаде', 'бригадах', 'бригадах'])}.
              Удаление может повлиять на связанные записи.
            </p>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            variant="destructive"
            className="bg-red-500 hover:bg-red-600 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Удалить навсегда'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
