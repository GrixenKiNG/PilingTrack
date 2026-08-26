'use client';

/**
 * Работа шага смены — внутри экрана смены, а не отдельной страницей.
 *
 * ЗАЧЕМ. Осмотр и отчёт жили на своих маршрутах (`/inspections/[id]`,
 * `/report`). Оператор уходил туда и возвращался, и цикл смены разваливался на
 * три окна: у каждого своя шапка, своя кнопка «назад» и своё представление о
 * том, где человек находится. На седьмом шаге из семи это перестаёт читаться
 * как один процесс.
 *
 * ПОЭТОМУ ОДНО ОКНО. Экран смены сам показывает работу текущего шага, а сверху
 * остаётся полоса шагов — единственное место, где видно весь путь. Маршруты
 * никуда не делись: по ним ходят диспетчер и механик, и там те же компоненты
 * работают по-старому.
 */

import { ArrowLeft } from '@/components/piling/icons/unified-icons';
import { RunInspection } from '@/components/piling/inspections/run-inspection';
import { ReportForm } from '@/components/piling/report-form';
import { ShiftPhaseStrip } from './shift-step-screens';
import { PHASE_COUNT, type ShiftPhaseNumber } from './shift-phase';

export type ShiftTask =
  | { kind: 'inspection'; inspectionId: string; title: string }
  | { kind: 'report'; anchor?: string };

interface Props {
  task: ShiftTask;
  /** Номер шага смены — полоса наверху остаётся той же, что на экране смены. */
  phase: ShiftPhaseNumber;
  equipmentName: string | null;
  /** Закрыть работу и вернуться к шагу. Экран смены на этом перечитывает факты. */
  onExit: () => void;
}

export function ShiftTaskScreen({ task, phase, equipmentName, onExit }: Props) {
  const title = task.kind === 'report' ? 'Отчёт за смену' : task.title;

  return (
    <div className="mx-auto w-full max-w-2xl">
      {/* Рамка шага. Не липкая намеренно: у осмотра и отчёта свои панели
          сверху, а две наложенные шапки на телефоне съедают треть экрана. */}
      <div className="space-y-2 border-b border-border bg-card px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Шаг {phase} из {PHASE_COUNT} · {title}
            </p>
            <p className="truncate text-sm font-semibold text-foreground">
              {equipmentName ?? 'Установка не выбрана'}
            </p>
          </div>
          <button
            type="button"
            onClick={onExit}
            className="hit-target inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> К смене
          </button>
        </div>
        <ShiftPhaseStrip phase={phase} />
      </div>

      {task.kind === 'inspection' ? (
        <RunInspection inspectionId={task.inspectionId} onExit={onExit} />
      ) : (
        <ReportForm anchor={task.anchor} onExit={onExit} />
      )}
    </div>
  );
}
