'use client';

/**
 * Сдача смены следующему оператору.
 *
 * ЗАЧЕМ ОТДЕЛЬНОЕ ОКНО. Контур требует словами описать состояние машины — это
 * единственное место всей смены, где без текста не обойтись: следующий человек
 * читает именно его. Но заставлять писать с нуля в конце двенадцатичасовой
 * смены значит получать «всё норм» и пустую передачу.
 *
 * ПОЭТОМУ СНАЧАЛА КАСАНИЕ. Два готовых ответа закрывают обычные случаи одним
 * нажатием; текст нужен только там, где есть что сказать, — и тогда он
 * обязателен, а не «по желанию».
 */

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

const CLEAN = 'Замечаний нет, машина исправна';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  equipmentName: string | null;
  busy?: boolean;
  onSubmit: (summary: string) => void;
}

export function HandoverDialog({ open, onOpenChange, equipmentName, busy = false, onSubmit }: Props) {
  const [hasIssues, setHasIssues] = useState(false);
  const [text, setText] = useState('');

  // eslint-disable-next-line react-hooks/set-state-in-effect -- сбрасываем ответ при каждом открытии: прошлая смена к этой отношения не имеет
  useEffect(() => { if (open) { setHasIssues(false); setText(''); } }, [open]);

  const summary = hasIssues ? text.trim() : CLEAN;
  // Три символа — граница сервера. Проверяем и здесь, чтобы человек узнал об
  // этом до нажатия, а не отказом после.
  const ready = summary.length >= 3;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Сдать смену</DialogTitle>
          <DialogDescription>
            Состояние установки «{equipmentName ?? 'машина'}» для следующего оператора.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setHasIssues(false)}
            aria-pressed={!hasIssues}
            className={`min-h-14 rounded-xl border-2 px-3 text-sm font-semibold transition ${
              hasIssues ? 'border-border bg-card text-muted-foreground' : 'border-success bg-success/10 text-success-strong'
            }`}
          >
            Замечаний нет
          </button>
          <button
            type="button"
            onClick={() => setHasIssues(true)}
            aria-pressed={hasIssues}
            className={`min-h-14 rounded-xl border-2 px-3 text-sm font-semibold transition ${
              hasIssues ? 'border-destructive bg-destructive/10 text-destructive-strong' : 'border-border bg-card text-muted-foreground'
            }`}
          >
            Есть замечания
          </button>
        </div>

        {hasIssues && (
          <div className="mt-3">
            <Label htmlFor="handover-text">Что передать следующему</Label>
            <Textarea
              id="handover-text"
              value={text}
              onChange={(event) => setText(event.target.value)}
              rows={3}
              placeholder="Например: следить за гидравлическим шлангом на левой опоре"
            />
          </div>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Отмена
          </Button>
          <Button type="button" onClick={() => onSubmit(summary)} disabled={!ready || busy}>
            {busy ? 'Секунду…' : 'Передать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
