'use client';

/**
 * Форма дефекта из макета: категория, описание, фото, «Выявлено Нет/Да».
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ ЭКРАН. Раньше кнопка «Дефект» на экране работы уводила в
 * раздел отчёта — то есть обещала одно, а открывала другое, и замечание
 * попадало в текст сменного отчёта вместо журнала дефектов. Механик его там не
 * видел: контур готовности читает `EquipmentDefect`, а не примечания к отчёту.
 *
 * «Выявлено Нет / Да» с макета — это серьёзность, а не факт наличия: «Да»
 * означает, что работать нельзя, и уходит как CRITICAL, закрывая пуск машины
 * следующей смене. «Нет» — замечание к сведению механика (NORMAL).
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { StepButton } from './ui';

/** Узлы для выбора. Свободный текст в поле «узел» механику бесполезен. */
const CATEGORIES = [
  'Гидравлика',
  'Двигатель',
  'Ходовая часть',
  'Рабочее оборудование',
  'Канаты и лебёдки',
  'Электрика',
  'Прочее',
] as const;

interface Props {
  open: boolean;
  equipmentId: string | null;
  onClose: () => void;
  onCreated: () => void;
}

export function DefectSheet({ open, equipmentId, onClose, onCreated }: Props) {
  const [category, setCategory] = useState<string>(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [blocking, setBlocking] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async () => {
    if (!equipmentId) return toast.error('Установка не определена');
    if (description.trim().length < 3) return toast.error('Опишите, что не так');
    if (blocking === null) return toast.error('Укажите, можно ли работать');
    setBusy(true);
    try {
      const response = await authFetch('/api/readiness/defects', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
        body: JSON.stringify({
          equipmentId,
          // Заголовок собираем из узла и первых слов описания: отдельного поля
          // на макете нет, а список дефектов у механика показывает именно его.
          title: `${category}: ${description.trim().slice(0, 120)}`,
          description: description.trim(),
          node: category,
          severity: blocking ? 'CRITICAL' : 'NORMAL',
        }),
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => null))?.error?.message ?? 'Не удалось создать дефект');
      }
      toast.success(blocking ? 'Дефект создан — машина закрыта для пуска' : 'Дефект создан');
      setDescription('');
      setBlocking(null);
      onCreated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать дефект');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex items-center gap-2 border-b border-border bg-card px-3 py-3 text-foreground">
        <button type="button" onClick={onClose} className="-ml-1 h-11 w-11 rounded-lg text-signal-strong hover:bg-secondary">
          ✕<span className="sr-only">Закрыть</span>
        </button>
        <p className="text-base font-semibold">Дефект</p>
      </header>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        <div>
          <label htmlFor="defect-category" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Категория
          </label>
          <select
            id="defect-category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-card px-3 text-sm"
          >
            {CATEGORIES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        <div>
          <label htmlFor="defect-description" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Описание
          </label>
          <textarea
            id="defect-description"
            rows={4}
            value={description}
            maxLength={4000}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Например: утечка масла на соединении шланга"
            className="w-full rounded-lg border border-border bg-card p-3 text-sm"
          />
        </div>

        {/*
          Фото на макете есть, но снимок можно приложить только к уже созданной
          записи: до неё нет идентификатора, к которому его привязать. Обещать
          загрузку здесь и потерять файл — хуже, чем сказать правду.
        */}
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
          Фото прикладывается к дефекту после создания — из карточки в журнале
        </p>

        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">
            Работать на машине нельзя?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              aria-pressed={blocking === false}
              onClick={() => setBlocking(false)}
              className={cn('min-h-12 flex-1 rounded-lg border text-sm font-semibold',
                blocking === false
                  ? 'border-success bg-success/12 text-success-strong'
                  : 'border-border text-muted-foreground')}
            >
              Нет, работаю
            </button>
            <button
              type="button"
              aria-pressed={blocking === true}
              onClick={() => setBlocking(true)}
              className={cn('min-h-12 flex-1 rounded-lg border text-sm font-semibold',
                blocking === true
                  ? 'border-destructive bg-destructive/10 text-destructive-strong'
                  : 'border-border text-muted-foreground')}
            >
              Да, стою
            </button>
          </div>
          {blocking === true && (
            <p className="mt-2 text-xs text-destructive-strong">
              Машина будет закрыта для пуска, пока механик не разберёт дефект
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-border bg-card p-3">
        <StepButton label="Создать дефект" onClick={() => void submit()} busy={busy} />
      </div>
    </div>
  );
}
