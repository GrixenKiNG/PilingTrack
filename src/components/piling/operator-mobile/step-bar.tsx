'use client';

import {createContext, useContext, useState, type ReactNode} from 'react';
import {Flag, House} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {FinishShift, NextStep} from './shift-next-step';

/**
 * Нижняя панель машиниста: «Главная», «Следующий шаг», «Завершить смену».
 *
 * ЗАЧЕМ. Владелец 07.10.2026: «вывести в низ на панель большие кнопки: главная
 * (начальная страница) и следующий шаг; эти кнопки должны быть во всех модулях;
 * также во всех модулях должно быть завершить смену». Человек в перчатке на
 * морозе не должен искать, куда нажать: «Следующий шаг» всегда ведёт к тому, что
 * нужно сделать сейчас, «Главная» — на начальный экран, «Завершить смену» есть
 * всегда.
 *
 * ПОЧЕМУ ПАНЕЛЬ НЕ ЗНАЕТ СВОЕГО МОДУЛЯ. Что считать следующим шагом, решает
 * фаза смены (shift-next-step), а КАК перейти на нужный экран — дело модуля: у
 * каждого своя навигация. Панель получает готовое описание шага и три
 * обработчика, и один и тот же компонент стоит во всех модулях оператора.
 *
 * ЗАВЕРШЕНИЕ РАБОТЫ ТРЕБУЕТ ВТОРОГО НАЖАТИЯ. Обратного хода у него нет: смена
 * уходит в ЕО после работы и сдачу. Кнопка стоит рядом с «Следующим шагом», и
 * промах по ней в перчатке заканчивал бы работу досрочно — поэтому панель сама
 * спрашивает подтверждение, а модуль получает только решённое «да».
 *
 * НЕДОСТУПНАЯ КНОПКА ОБЪЯСНЯЕТ ПРИЧИНУ. Серая кнопка без слов заставляет
 * гадать. Нажатие на неё показывает, что сделать сначала.
 */

export interface StepBarProps {
  step: NextStep;
  finish: FinishShift;
  busy?: boolean;
  /** На начальный экран модуля. */
  onHome: () => void;
  /** Перейти туда, где делается следующий шаг. Для завершения работы не зовётся. */
  onNext: () => void;
  /** Завершить работу — только после подтверждения на панели. */
  onFinishWork: () => void;
  /** Перейти к сдаче смены (работа уже завершена). */
  onGoClosing: () => void;
  className?: string;
}

export function StepBar({
  step, finish, busy = false, onHome, onNext, onFinishWork, onGoClosing, className,
}: StepBarProps) {
  const [confirming, setConfirming] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  const nextAsksConfirm = step.action.kind === 'FINISH_WORK';

  const pressNext = () => {
    if (!step.enabled) { setWhy(step.hint); return; }
    setWhy(null);
    if (nextAsksConfirm) { setConfirming(true); return; }
    onNext();
  };

  const pressFinish = () => {
    if (!finish.enabled) { setWhy(finish.hint); return; }
    setWhy(null);
    if (finish.action.kind === 'FINISH_WORK') { setConfirming(true); return; }
    onGoClosing();
  };

  const confirmFinish = () => {
    setConfirming(false);
    onFinishWork();
  };

  return (
    <div
      className={cn('operator-step-bar border-t bg-card px-2 pt-2', className)}
      role="group"
      aria-label="Панель шагов смены"
    >
      {confirming ? (
        <div className="mb-2 space-y-2 rounded-lg border border-warning bg-warning/10 p-3" role="alertdialog" aria-label="Подтверждение завершения работы">
          <p className="text-base font-bold">Завершить работу?</p>
          <p className="text-sm">
            Работа закончится. Дальше — ЕО после работы и сдача отчёта. Сваи, бурение и простой
            можно будет дописать до сдачи.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button" disabled={busy} onClick={confirmFinish}
              className="min-h-14 rounded-lg bg-destructive px-3 text-base font-bold text-white disabled:opacity-50"
            >
              Да, завершить
            </button>
            <button
              type="button" onClick={() => setConfirming(false)}
              className="min-h-14 rounded-lg border bg-card px-3 text-base font-semibold"
            >
              Продолжить работу
            </button>
          </div>
        </div>
      ) : null}

      <div className="grid grid-cols-[1fr_1.7fr_1fr] gap-2">
        <button
          type="button" onClick={() => { setWhy(null); setConfirming(false); onHome(); }}
          className="flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border bg-card px-1 text-center text-sm font-bold leading-tight active:bg-muted"
        >
          <House className="size-5" aria-hidden />
          <span>Главная</span>
        </button>

        <button
          type="button"
          aria-disabled={!step.enabled || busy}
          aria-label={`Следующий шаг: ${step.title}`}
          onClick={() => { if (!busy) pressNext(); }}
          className={cn(
            'flex min-h-16 flex-col items-center justify-center rounded-xl px-1 text-center text-base font-black leading-tight',
            step.enabled && !busy
              ? 'bg-signal-strong text-white active:opacity-90'
              : 'border bg-muted text-muted-foreground',
          )}
        >
          <span>Следующий шаг</span>
          <span className="line-clamp-1 w-full text-sm font-semibold opacity-90">{step.title}</span>
        </button>

        <button
          type="button"
          aria-disabled={!finish.enabled || busy}
          onClick={() => { if (!busy) pressFinish(); }}
          className={cn(
            'flex min-h-16 flex-col items-center justify-center gap-0.5 rounded-xl border-2 px-1 text-center text-sm font-bold leading-tight',
            finish.enabled && !busy
              ? 'border-destructive text-destructive active:bg-destructive/10'
              : 'border-border text-muted-foreground',
          )}
        >
          <Flag className="size-5" aria-hidden />
          <span>Завершить смену</span>
        </button>
      </div>

      <p className="min-h-5 px-1 py-1 text-center text-sm text-muted-foreground" role="status">
        {why ?? `Шаг ${step.index} из ${step.total}`}
      </p>
    </div>
  );
}

/**
 * Панель, которую экраны модуля подхватывают сами.
 *
 * Экранов у модуля много, и у каждого своя рамка с нижней областью. Вместо того
 * чтобы протаскивать панель через все экраны, модуль кладёт её в контекст, а
 * общая рамка экрана рисует её над нижними вкладками.
 */
const StepBarSlot = createContext<ReactNode>(null);

export const StepBarSlotProvider = StepBarSlot.Provider;

export function useStepBarSlot(): ReactNode {
  return useContext(StepBarSlot);
}
