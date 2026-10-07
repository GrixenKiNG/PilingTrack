import { useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { parseDecimalInput } from '@/lib/parse-decimal';
import type { DictionaryKind, RegistryItem } from './dictionary-table';

/*
  Лимиты те же, что в схеме маршрута (name ≤ 100, lengthMm ≤ 1 000 000): без них
  форма отправляла заведомо отклоняемый запрос и отвечала только «Некорректные
  данные» — человек не знал, что и на сколько сократить (R103 №6).
*/
const MAX_NAME_LENGTH = 100;
const MAX_LENGTH_MM = 1_000_000;

export interface DictionaryFormValue {
  name: string;
  code?: string;
  lengthMm?: number;
  sectionOrDiameter?: string;
  notes?: string;
}

interface DictionaryFormProps {
  mode: 'create' | 'rename';
  kind: DictionaryKind;
  item?: RegistryItem;
  saving: boolean;
  onClose: () => void;
  onSubmit: (value: DictionaryFormValue) => void;
}

export function DictionaryForm({ mode, kind, item, saving, onClose, onSubmit }: DictionaryFormProps) {
  const [name, setName] = useState(item?.name || '');
  const [code, setCode] = useState(item?.code || '');
  const [lengthMetres, setLengthMetres] = useState(
    item?.lengthMm == null ? '' : String(item.lengthMm / 1000)
  );
  const [sectionOrDiameter, setSectionOrDiameter] = useState(item?.sectionOrDiameter || '');
  const [notes, setNotes] = useState(item?.notes || '');
  const isPileCreate = mode === 'create' && kind === 'pileGrade';
  const parsedLength = parseDecimalInput(lengthMetres);
  const lengthValid = !isPileCreate
    || (parsedLength !== null && parsedLength > 0 && Math.round(parsedLength * 1000) <= MAX_LENGTH_MM);
  const valid = name.trim().length > 0 && lengthValid;

  const submit = () => {
    if (!valid) return;
    onSubmit({
      name: name.trim(),
      ...(isPileCreate ? {
        code: code.trim() || name.trim(),
        lengthMm: Math.round((parsedLength ?? 0) * 1000),
        sectionOrDiameter: sectionOrDiameter.trim(),
        notes: notes.trim(),
      } : {}),
    });
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent aria-describedby={undefined} className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === 'create' ? 'Добавить элемент' : 'Переименовать элемент'}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Название
            <Input aria-label="Название" value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} autoFocus />
          </label>
          {isPileCreate && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-medium text-foreground">
                  Код
                  <Input aria-label="Код" value={code} onChange={(event) => setCode(event.target.value)} placeholder="СВ120" />
                </label>
                <label className="grid gap-1.5 text-sm font-medium text-foreground">
                  Длина, м (до 1000)
                  <Input
                    aria-label="Длина, м"
                    value={lengthMetres}
                    onChange={(event) => setLengthMetres(event.target.value)}
                    inputMode="decimal"
                    required
                    placeholder="12"
                  />
                </label>
              </div>
              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                Сечение или диаметр
                <Input aria-label="Сечение или диаметр" value={sectionOrDiameter} onChange={(event) => setSectionOrDiameter(event.target.value)} placeholder="350×350 мм" />
              </label>
              <label className="grid gap-1.5 text-sm font-medium text-foreground">
                Примечание
                <Input aria-label="Примечание" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={submit} disabled={saving || !valid} className="bg-signal text-white hover:bg-signal-strong">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
