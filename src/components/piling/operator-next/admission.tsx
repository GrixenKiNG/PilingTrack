'use client';

import {type ReactNode} from 'react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {Panel, PanelTitle, Screen} from '@/components/piling/operator-mobile/ui';
import {WarningsPanel} from '@/components/piling/operator-mobile/warnings-panel';
import {DocumentsPanel} from '@/components/piling/operator-mobile/screens/documents-panel';
import {admissionBlockers, admissionSteps} from '@/components/piling/operator-mobile/safety/admission-steps';
import {ActionButton, NextActionCard, StatusMark, StageTitle} from './parts';

export type AdmissionDetour = 'PPE' | 'BRIEFING' | 'KNOWLEDGE';

/**
 * Допуск к смене — первый экран после входа.
 *
 * ЭКРАН НЕ ОБЪЯВЛЯЕТ ДОПУСК. Допуск считает сервер по своим правилам; до тех
 * пор, пока фаза держится на `IDENTITY`, экрана «работа» не будет, сколько бы
 * галочек ни стояло. Здесь видно, что человек уже сделал и что осталось.
 *
 * Карточка «Следующее действие» — из v10: новичку нужен ответ «что нажать
 * сейчас», а не список из пяти строк, где сам решай, какая важнее.
 */
export function AdmissionScreen({
  state, tabs, onOpen, onContinue, busy,
}: {
  state: OperatorMobileState;
  tabs?: ReactNode;
  onOpen: (step: AdmissionDetour) => void;
  onContinue: () => void;
  busy: boolean;
}) {
  const steps = admissionSteps(state);
  const blockers = admissionBlockers(steps);
  const firstOpen = steps.find((step) => step.id !== 'ADMISSION' && !step.done && step.opens);

  return (
    <Screen title="Допуск к смене" subtitle={state.operator.name} tabs={tabs}>
      <NextActionCard
        title={blockers.length === 0 ? 'Допуск закрыт — принимайте установку' : `Осталось: ${blockers.join(', ')}`}
        hint={blockers.length === 0
          ? 'Все обязательные проверки пройдены. Нажмите «Продолжить» — откроется приём установки.'
          : 'Откройте ближайший незакрытый шаг. Экран сам подскажет, что в нём сделать.'}
        actionLabel={blockers.length === 0 ? 'Продолжить' : 'Открыть шаг допуска'}
        onAction={() => {
          if (blockers.length === 0) {
            onContinue();
            return;
          }
          if (firstOpen?.opens) onOpen(firstOpen.opens);
        }}
        disabled={busy}
      />

      <WarningsPanel warnings={state.warnings} />

      <StageTitle hint="Шаги идут по порядку. Касание шага открывает его; подпись ставится вместе с ознакомлением с инструкцией.">
        Что нужно пройти
      </StageTitle>

      <ul className="space-y-2">
        {steps.map((step) => {
          const body = (
            <>
              <StatusMark tone={step.done ? 'ok' : step.id === 'ADMISSION' ? 'idle' : 'warning'}>
                {step.done ? '✓' : step.n}
              </StatusMark>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold leading-snug">{step.title}</span>
                <span className="block text-2xs text-muted-foreground">{step.hint}</span>
              </span>
              <span className={step.done ? 'text-2xs font-semibold text-success-strong' : 'text-2xs font-semibold text-warning-strong'}>
                {step.note}
              </span>
            </>
          );
          // Строка нажимается только там, где под ней есть действие человека.
          // «Допуск к смене» — решение сервера, под ним нажимать нечего (находка
          // №42: строка выглядела кнопкой и вела в сводку, где ничего нельзя).
          return (
            <li key={step.id}>
              {step.opens ? (
                <button
                  type="button"
                  onClick={() => onOpen(step.opens as AdmissionDetour)}
                  className="onx-step flex w-full items-center gap-3 rounded-xl border bg-card px-3 py-2 text-left shadow-xs"
                >
                  {body}
                </button>
              ) : (
                <div className="onx-step flex w-full items-center gap-3 rounded-xl border bg-secondary/60 px-3 py-2">
                  {body}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <DocumentsPanel documents={state.identity.documents} />

      <div className="space-y-1.5">
        <ActionButton
          label="Продолжить"
          tone="ghost"
          onClick={onContinue}
          disabled={busy || blockers.length > 0}
          reason={blockers.length > 0 ? `Пока не закрыто: ${blockers.join(', ')}` : undefined}
        />
      </div>

      <Panel tone="plain">
        <PanelTitle>Если чего-то нет</PanelTitle>
        <p className="mt-1 text-sm">
          Документ, инструктаж или проверку знаний заводит ответственный. Машинист их только
          проходит. Если шаг не закрывается — обратитесь к диспетчеру.
        </p>
      </Panel>
    </Screen>
  );
}
