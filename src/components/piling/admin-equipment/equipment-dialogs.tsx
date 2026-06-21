'use client';

import { useEffect, useState } from 'react';
import { Wrench, Pencil, AlertTriangle, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
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
import {
  EquipmentForm,
  EMPTY_EQUIPMENT_FORM,
  type EquipmentFormState,
  formStateToPayload,
  equipmentToFormState,
} from './equipment-form';

// --------------------------------------------------------------------------
// CREATE
// --------------------------------------------------------------------------

interface CreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
}

export function CreateEquipmentDialog({ open, onOpenChange, onSubmit }: CreateProps) {
  const [state, setState] = useState<EquipmentFormState>(EMPTY_EQUIPMENT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    if (open) setState(EMPTY_EQUIPMENT_FORM);
  }, [open]);

  const submit = async () => {
    if (!state.name.trim()) {
      toast.error('Введите название установки');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(formStateToPayload(state));
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Wrench className="w-4 h-4" /> Новая установка
          </DialogTitle>
          <DialogDescription>
            Заполни хотя бы название. Технические характеристики и эксплуатационные данные можно дозаполнять потом.
          </DialogDescription>
        </DialogHeader>
        <EquipmentForm state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={submit}
            disabled={submitting || !state.name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
// EDIT
// --------------------------------------------------------------------------

interface EditProps {
  open: boolean;
  item: EquipmentDTO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (id: string, payload: Record<string, unknown>) => Promise<void>;
}

export function EditEquipmentDialog({ open, item, onOpenChange, onSubmit }: EditProps) {
  const [state, setState] = useState<EquipmentFormState>(EMPTY_EQUIPMENT_FORM);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    if (open) setState(equipmentToFormState(item as unknown as Record<string, unknown> | null));
  }, [open, item]);

  const submit = async () => {
    if (!item) return;
    if (!state.name.trim()) {
      toast.error('Введите название установки');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(item.id, formStateToPayload(state));
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
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="w-4 h-4" /> Редактировать установку
          </DialogTitle>
        </DialogHeader>
        <EquipmentForm state={state} onChange={(patch) => setState((s) => ({ ...s, ...patch }))} equipmentId={item?.id} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={submit}
            disabled={submitting || !state.name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --------------------------------------------------------------------------
// DELETE — unchanged
// --------------------------------------------------------------------------

interface DeleteProps {
  open: boolean;
  item: EquipmentDTO | null;
  crewCount: number;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => Promise<void>;
}

export function DeleteEquipmentDialog({
  open, item, crewCount, onOpenChange, onConfirm,
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
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
