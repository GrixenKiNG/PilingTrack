'use client';

import { motion } from 'framer-motion';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { PHASE_COUNT, type ShiftPhase } from './shift-phase';

/**
 * Карточка текущего шага смены — то, что оператор видит вместо большой кнопки
 * «Начало смены».
 *
 * Заменяет её намеренно, а не дополняет: на экране должно быть ровно одно
 * очевидное действие. Прежняя кнопка знала два состояния («начать» и
 * «редактировать отчёт»), из-за чего порядок работ держался в голове человека,
 * а не на экране.
 */
const PHASE_ICONS: Record<number, PilingIconName> = {
  1: 'shift-start',
  2: 'operator',
  3: 'inspection',
  4: 'shift-start',
  5: 'reports',
  6: 'reports',
  7: 'send',
};

interface ShiftStepCardProps {
  phase: ShiftPhase;
  onAction: () => void;
  busy?: boolean;
}

export function ShiftStepCard({ phase, onAction, busy = false }: ShiftStepCardProps) {
  const blocked = phase.target === null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      aria-label="Текущий шаг смены"
      className="rounded-2xl border-2 border-signal/30 bg-card p-5 shadow-sm"
    >
      <p className="text-sm font-medium uppercase tracking-wider text-[#555]">
        Шаг {phase.phase} из {PHASE_COUNT}
      </p>

      <div className="mt-2 flex items-center gap-3">
        <PilingIcon name={PHASE_ICONS[phase.phase] ?? 'shift-start'} size={52} decorative />
        <div className="min-w-0">
          <h2 className="text-xl font-semibold text-foreground">{phase.title}</h2>
          {phase.progress && (
            <p className="truncate text-base text-[#555]">{phase.progress}</p>
          )}
        </div>
      </div>

      {phase.blockers.length > 0 && (
        <ul className="mt-4 space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
          {phase.blockers.map((blocker) => (
            <li key={blocker} className="text-base text-destructive-strong">
              {blocker}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={onAction}
        disabled={blocked || busy}
        className="mt-4 flex min-h-14 w-full items-center justify-center rounded-xl bg-signal px-4 text-lg font-semibold text-white transition active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-muted disabled:text-[#555]"
      >
        {busy ? 'Секунду…' : phase.action}
      </button>
    </motion.section>
  );
}

/**
 * Полоса из семи шагов вместо прежних четырёх точек.
 *
 * Прежняя полоса показывала стадии отчёта («создан», «работы внесены»), то есть
 * половину пути — про допуск машины на ней не было ничего.
 */
export function ShiftPhaseStrip({ phase }: { phase: number }) {
  return (
    <div
      className="flex gap-1"
      role="img"
      aria-label={`Смена: шаг ${phase} из ${PHASE_COUNT}`}
    >
      {Array.from({ length: PHASE_COUNT }, (_, index) => index + 1).map((step) => (
        <span
          key={step}
          className={`h-1.5 flex-1 rounded-full ${
            step < phase ? 'bg-success-strong' : step === phase ? 'bg-signal' : 'bg-border'
          }`}
        />
      ))}
    </div>
  );
}
