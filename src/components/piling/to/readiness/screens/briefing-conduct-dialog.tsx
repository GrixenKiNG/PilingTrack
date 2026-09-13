'use client';

/**
 * «Провести инструктаж» — занесение записи в журнал от имени инструктора.
 *
 * ЗАЧЕМ. Записи появлялись ровно одним способом: работник сам нажимал
 * «Ознакомлен» в телефоне перед сменой. Вводный при приёме, целевой перед
 * работами вблизи ЛЭП, внеплановый после происшествия проводит человек — и
 * занести их было некуда, бумажный журнал жил отдельно от электронного.
 *
 * ПОЧЕМУ ИНСТРУКЦИЯ ВЫБИРАЕТСЯ ИЗ СПИСКА, А НЕ ВПИСЫВАЕТСЯ. Тексты инструкций
 * живут в коде (решение владельца), и запись привязана к их версии: свободная
 * строка означала бы «ознакомлен с чем-то похожим по названию».
 */

import { useState } from 'react';
import { authFetch } from '@/lib/api';
import { BRIEFING_TYPE_LABELS, BRIEFING_TYPE_ORDER, type BriefingType } from '@/modules/operator-mobile/contracts';
import { SAFETY_INSTRUCTIONS } from '@/modules/safety/instructions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';

interface EmployeeOption {
  id: string;
  name: string;
  role: string;
}

const FIELD_CLASS = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function BriefingConductDialog({
  open,
  employees,
  onClose,
  onDone,
}: {
  open: boolean;
  employees: EmployeeOption[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [userId, setUserId] = useState('');
  const [type, setType] = useState<BriefingType>('REPEAT');
  const [code, setCode] = useState(SAFETY_INSTRUCTIONS[0]?.code ?? '');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const instruction = SAFETY_INSTRUCTIONS.find((item) => item.code === code);

  const submit = async () => {
    if (!userId || !instruction) return;
    setBusy(true);
    setFailed(null);
    try {
      const response = await authFetch('/api/briefings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          type,
          documentCode: instruction.code,
          documentTitle: instruction.title,
          documentVersion: instruction.version,
          reason: reason.trim(),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setUserId('');
      setReason('');
      onDone();
      onClose();
    } catch (error) {
      // Тихо закрыть окно после неудачи нельзя: человек решит, что инструктаж
      // записан, и второй раз его не проведёт.
      setFailed(error instanceof Error ? error.message : 'Не удалось записать инструктаж');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Провести инструктаж</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Работник
            <select className={FIELD_CLASS} value={userId} onChange={(event) => setUserId(event.target.value)}>
              <option value="">Выберите работника</option>
              {employees.map((employee) => (
                <option key={employee.id} value={employee.id}>{employee.name}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted-foreground">
            Вид инструктажа
            <select className={FIELD_CLASS} value={type}
              onChange={(event) => setType(event.target.value as BriefingType)}>
              {BRIEFING_TYPE_ORDER.map((value) => (
                <option key={value} value={value}>{BRIEFING_TYPE_LABELS[value]}</option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted-foreground">
            Инструкция
            <select className={FIELD_CLASS} value={code} onChange={(event) => setCode(event.target.value)}>
              {SAFETY_INSTRUCTIONS.map((item) => (
                <option key={item.code} value={item.code}>
                  {item.title} ({item.code}, в. {item.version})
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-xs text-muted-foreground">
            Основание
            <Input value={reason} onChange={(event) => setReason(event.target.value)}
              placeholder="Приём на работу, после происшествия, работы вблизи ЛЭП" />
          </label>

          <p className="rounded-md border border-border bg-muted/40 p-2 text-2xs leading-relaxed text-muted-foreground">
            Ваша отметка встанет сразу. Работник подтверждает запись сам — до этого она числится
            ожидающей подтверждения. Это внутренний журнал, а не квалифицированная электронная
            подпись.
          </p>

          {failed && (
            <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive-strong">
              {failed}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Отмена</Button>
          <Button onClick={() => void submit()} disabled={busy || !userId || !instruction}>
            {busy ? 'Записываем…' : 'Записать инструктаж'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
