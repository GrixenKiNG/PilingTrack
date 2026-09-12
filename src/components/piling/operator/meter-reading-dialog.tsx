'use client';

/**
 * Окно снятия моточасов для оператора.
 *
 * Наработка нужна контуру готовности до начала смены, а не в конце — критерий
 * «Моточасы» входит в балл и в условия запуска. Раньше оператор мог вписать
 * показание только внутри сменного отчёта, то есть по факту работы, и до
 * карточки установки оно не доходило вовсе. Здесь показание уходит прямо в
 * журнал наработки (`/api/equipment/:id/meter-readings`), который и есть
 * источник истины: Equipment.engineHoursTotal — его кэш.
 *
 * Установка не выбирается: она берётся из экипажа оператора. Сервер это
 * проверяет отдельно — право снимать показания не даёт права выбрать чужую
 * машину.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumber } from '@/lib/format';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentId: string | null;
  equipmentName: string | null;
  onRecorded?: () => void;
}

export function MeterReadingDialog({ open, onOpenChange, equipmentId, equipmentName, onRecorded }: Props) {
  const [current, setCurrent] = useState<number | null>(null);
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadCurrent = useCallback(async () => {
    if (!equipmentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/meter-readings`);
      if (!res.ok) {
        setCurrent(null);
        return;
      }
      const json = await res.json();
      const readings: { engineHours: number }[] = json.readings ?? [];
      setCurrent(readings.length > 0 ? readings[0].engineHours : null);
    } finally {
      setLoading(false);
    }
  }, [equipmentId]);

  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- подтягивает последнее показание при открытии; состояние ставит асинхронный загрузчик
    void loadCurrent();
  }, [open, loadCurrent]);

  // Поля чистим на переходе открытия, а не в эффекте: иначе правило
  // set-state-in-effect срабатывает на каждом рендере открытого окна.
  const handleOpenChange = (next: boolean) => {
    if (next) {
      setValue('');
      setNote('');
      setError(null);
    }
    onOpenChange(next);
  };

  const parsed = Number.parseInt(value, 10);
  const valid = Number.isInteger(parsed) && parsed >= 0;
  // Счётчик не отматывают назад. Это не запрет — счётчик могли заменить, — но
  // предупредить до отправки дешевле, чем разбирать кривую наработку потом.
  const goesBackwards = valid && current != null && parsed < current;

  const submit = async () => {
    if (!equipmentId || !valid) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/meter-readings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ engineHours: parsed, note: note.trim() || undefined }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? 'Не удалось сохранить показание');
        return;
      }
      const body = await res.json();
      toast.success(
        body.warning
          ? `Показание записано. ${body.warning}`
          : `Моточасы обновлены: ${formatNumber(parsed)} м/ч`,
      );
      onRecorded?.();
      handleOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Моточасы</DialogTitle>
          <DialogDescription>
            {equipmentName
              ? `Снимите показание счётчика установки «${equipmentName}».`
              : 'Установка не закреплена за вашим экипажем — обратитесь к диспетчеру.'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
            <div className="text-xs text-muted-foreground">Последнее известное показание</div>
            <div className="font-mono text-2xl font-semibold tabular-nums text-foreground">
              {loading ? '…' : current != null ? `${formatNumber(current)} м/ч` : 'нет данных'}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="meter-value">Новое показание, м/ч</Label>
            <Input
              id="meter-value"
              inputMode="numeric"
              autoComplete="off"
              value={value}
              onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
              placeholder={current != null ? String(current) : '0'}
              className="font-mono text-lg tabular-nums"
              aria-describedby={goesBackwards ? 'meter-backwards' : undefined}
            />
            {goesBackwards && (
              <p id="meter-backwards" className="text-xs text-warning-strong">
                Показание меньше предыдущего ({formatNumber(current ?? 0)} м/ч). Так бывает после
                замены счётчика — если это не он, проверьте цифру.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="meter-note">Примечание (необязательно)</Label>
            <Input
              id="meter-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Например: счётчик заменён"
              maxLength={500}
            />
          </div>

          {error && <p className="text-sm text-destructive-strong">{error}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Отмена
          </Button>
          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!valid || saving || !equipmentId}
            className="bg-signal-strong hover:bg-signal-strong"
          >
            {saving ? 'Сохраняем…' : 'Записать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
