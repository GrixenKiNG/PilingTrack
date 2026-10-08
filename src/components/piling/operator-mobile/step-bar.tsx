'use client';

import {createContext, useContext, useState, type ReactNode} from 'react';
import {Play} from 'lucide-react';
import {cn} from '@/lib/utils';
import type {NextStep} from './shift-next-step';

/**
 * Кнопка «Следующий шаг» в нижнем меню машиниста.
 *
 * ЗАЧЕМ. Владелец 07.10.2026: человек в перчатке на морозе не должен искать,
 * куда нажать — «Следующий шаг» всегда ведёт к тому, что нужно сделать сейчас.
 * Владелец 09.10.2026 убрал отдельную панель («Главная», «Следующий шаг»,
 * «Завершить смену») и поставил одну круглую кнопку прямо в нижнее меню: в v5
 * между «Работой» и «Дефектами», в остальных версиях между «ТБ» и «Техникой».
 *
 * ПОЧЕМУ КНОПКА НЕ ЗНАЕТ СВОЕГО МОДУЛЯ. Что считать следующим шагом, решает
 * фаза смены (shift-next-step), а КАК перейти на нужный экран — дело модуля: у
 * каждого своя навигация. Кнопка получает готовое описание шага и два
 * обработчика, и один и тот же компонент стоит во всех модулях оператора.
 *
 * ЗАВЕРШЕНИЕ РАБОТЫ ТРЕБУЕТ ВТОРОГО НАЖАТИЯ. Обратного хода у него нет: смена
 * уходит в ЕО после работы и сдачу. Когда следующий шаг — «Завершить работу»,
 * кнопка сама спрашивает подтверждение, а модуль получает только решённое «да».
 *
 * НЕДОСТУПНАЯ КНОПКА ОБЪЯСНЯЕТ ПРИЧИНУ. Серая кнопка без слов заставляет
 * гадать. Нажатие на неё показывает, что сделать сначала.
 */

export interface NextStepTabProps {
  step: NextStep;
  busy?: boolean;
  /** Перейти туда, где делается следующий шаг. Для завершения работы не зовётся. */
  onNext: () => void;
  /** Завершить работу — только после подтверждения у кнопки. */
  onFinishWork: () => void;
  /** Классы ячейки меню (ширина, отступы) — у каждого модуля своё меню. */
  className?: string;
  /** Цвет подписи под кнопкой — на тёмном меню нужен светлый. */
  labelColor?: string;
  /** Размер подписи, по умолчанию 12px; у каждого меню свой. */
  labelSize?: string;
  /** Цвет кольца вокруг круга — должен совпадать с фоном меню. */
  ringColor?: string;
}

export function NextStepTab({
  step, busy = false, onNext, onFinishWork, className, labelColor, labelSize, ringColor,
}: NextStepTabProps) {
  const [confirming, setConfirming] = useState(false);
  const [why, setWhy] = useState<string | null>(null);

  const active = step.enabled && !busy;

  const press = () => {
    if (busy) return;
    if (!step.enabled) { setWhy(step.hint); setConfirming(false); return; }
    setWhy(null);
    if (step.action.kind === 'FINISH_WORK') { setConfirming(true); return; }
    onNext();
  };

  const confirmFinish = () => {
    setConfirming(false);
    onFinishWork();
  };

  return (
    <div className={cn('operator-next-step relative flex min-w-0 flex-col items-center justify-end', className)}>
      {confirming ? (
        <div
          className="absolute bottom-full left-1/2 z-40 mb-3 w-[min(20rem,calc(100vw-1.5rem))] -translate-x-1/2 space-y-2 rounded-lg border border-warning bg-card p-3 text-foreground shadow-lg"
          role="alertdialog"
          aria-label="Подтверждение завершения работы"
        >
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

      {why && !confirming ? (
        <p
          role="status"
          className="absolute bottom-full left-1/2 z-40 mb-3 w-[min(18rem,calc(100vw-1.5rem))] -translate-x-1/2 rounded-lg border bg-card p-3 text-center text-sm text-foreground shadow-lg"
        >
          {why}
        </p>
      ) : null}

      {/*
        Оформление круга и подписи задано строкой стиля, а не классами: у каждого
        меню (v5, v7, v10) свои правила на button и span внутри него
        (фон, отступы, рамка, шрифт), и они перебили бы классы. Строка стиля
        сильнее таких правил, поэтому круг выглядит одинаково везде.
      */}
      <button
        type="button"
        aria-disabled={!active}
        aria-label={`Следующий шаг: ${step.title}`}
        title={`Шаг ${step.index} из ${step.total}: ${step.title}`}
        onClick={press}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center', flex: '0 0 auto',
          width: 56, height: 56, minHeight: 56, marginTop: -20, padding: 0, gap: 0,
          borderRadius: 9999, borderStyle: 'solid', borderWidth: 4,
          borderColor: ringColor ?? 'var(--card, #fff)',
          background: active ? 'var(--signal-strong)' : 'var(--muted)',
          color: active ? '#fff' : 'var(--muted-foreground)',
          boxShadow: '0 4px 12px rgb(0 0 0 / 0.25)', cursor: 'pointer',
        }}
      >
        <Play className="size-6 fill-current" aria-hidden />
      </button>
      <div
        style={{
          marginTop: 4, textAlign: 'center', lineHeight: 1.15, fontWeight: 700, padding: 0, border: 0,
          fontSize: labelSize ?? '12px',
          color: labelColor ?? 'var(--signal-strong)',
        }}
      >
        Следующий шаг
      </div>
    </div>
  );
}

/**
 * Кнопка одна — там, где нижних вкладок нет (допуск, осмотр, пуск, сдача).
 *
 * До начала работы вкладки спрятаны намеренно: порядок шагов — это
 * безопасность (см. TabBar). Но «Следующий шаг» нужен именно там, где человека
 * ведут по порядку, поэтому в такие моменты он стоит один, по центру нижней
 * полосы.
 */
export function NextStepDock(props: NextStepTabProps) {
  return (
    <nav
      className="operator-tab-bar flex justify-center border-t bg-card px-4 pb-1.5 pt-1"
      aria-label="Следующий шаг смены"
    >
      <NextStepTab {...props} className={cn('w-28', props.className)} />
    </nav>
  );
}

/**
 * Кнопка, которую экраны модуля подхватывают сами.
 *
 * Экранов у модуля много, и у каждого своя рамка с нижней областью. Вместо того
 * чтобы протаскивать кнопку через все экраны, модуль кладёт её в контекст, а
 * общая рамка экрана рисует её, когда нижних вкладок нет.
 */
const NextStepSlot = createContext<ReactNode>(null);

export const NextStepSlotProvider = NextStepSlot.Provider;

export function useNextStepSlot(): ReactNode {
  return useContext(NextStepSlot);
}
