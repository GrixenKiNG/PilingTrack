'use client';

import {ChevronRight} from 'lucide-react';
import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {admissionBlockers, admissionSteps} from '../safety/admission-steps';
import {Panel, PanelTitle, Sign} from '../ui';

/**
 * Вкладка «ТБ» — шаги допуска к смене.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ «ПРОФИЛЯ». Соседняя вкладка отвечает на вопрос «что у меня
 * с документами»: сроки медкомиссии, удостоверения, корочки. Здесь — другой
 * вопрос: «пущен ли я сегодня на площадку». Ответ на него меняется каждую
 * смену, документы — раз в год, и держать их в одном списке значило бы
 * заставлять искать сегодняшнее среди годового.
 *
 * ПОЧЕМУ ВСЕ ПЯТЬ СТРОК ВИДНЫ СРАЗУ. Человек должен видеть не только текущий
 * шаг, но и сколько осталось: пять пунктов, из которых сделано два, читаются
 * иначе, чем одна кнопка «дальше».
 */
export function SafetyTab({state, onOpen}: {
  state: OperatorMobileState;
  onOpen: (step: 'PPE' | 'BRIEFING' | 'KNOWLEDGE') => void;
}) {
  const steps = admissionSteps(state);
  const left = admissionBlockers(steps);

  return (
    <>
      <Panel tone={left.length === 0 ? 'ok' : 'warning'}>
        <PanelTitle tone={left.length === 0 ? 'ok' : 'warning'}>
          {left.length === 0 ? 'Все шаги пройдены' : `Осталось шагов: ${left.length}`}
        </PanelTitle>
        <p className="mt-1 text-2xs text-muted-foreground">
          {left.length === 0
            ? 'Допуск к работе на объекте оформлен.'
            : `Не выполнено: ${left.join(', ')}. Прохождение занимает 5–10 минут.`}
        </p>
      </Panel>

      <Panel>
        <PanelTitle>Перед сменой</PanelTitle>
        <ul className="mt-2">
          {steps.map((step) => {
            const body = (
              <>
                <Sign tone={step.done ? 'ok' : step.id === 'ADMISSION' ? 'warning' : 'danger'} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">{step.n}. {step.title}</span>
                  <span className="block text-2xs text-muted-foreground">{step.hint}</span>
                  <span className="block text-2xs font-semibold text-muted-foreground">{step.note}</span>
                </span>
              </>
            );
            /*
              Строки без действия кнопками не притворяются: подпись ставится
              вместе с ознакомлением, а допуск объявляет сервер. Нажатие,
              которое ничего не делает, человек читает как поломку.
            */
            return (
              <li key={step.id} className="border-t first:border-t-0">
                {step.opens ? (
                  <button
                    type="button"
                    onClick={() => onOpen(step.opens as 'PPE' | 'BRIEFING' | 'KNOWLEDGE')}
                    className="flex w-full items-start gap-2 py-3 text-left"
                  >
                    {body}
                    <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </button>
                ) : (
                  <div className="flex items-start gap-2 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}
