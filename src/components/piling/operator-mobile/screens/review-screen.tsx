'use client';

import type {OperatorMobileState, OperatorPhase} from '@/modules/operator-mobile/contracts';
import {formatDowntimeHours} from '@/lib/downtime-hours';
import {PHASE_CHECKLIST, PHASE_LABELS} from '@/modules/operator-mobile/domain/shift-phases';
import {formatRuDate} from '@/lib/format';
import {BigButton, Fact, Panel, PanelTitle, Screen, VolumeFact} from '../ui';

/**
 * Просмотр пройденного этапа смены.
 *
 * ЗАЧЕМ. Фазу выводит сервер из записанных фактов, и вернуться назад в смысле
 * «переделать» нельзя — факт записан. Но человеку на площадке регулярно нужно
 * другое: свериться, что было на осмотре, не выходя из смены. Раньше такой
 * возможности не было вовсе: пройденный шаг исчезал с экрана навсегда, а на
 * закрытой смене не оставалось даже нижних вкладок (жалоба 16.09.2026).
 *
 * ЧТО ЗДЕСЬ ВИДНО И ЧЕГО НЕТ. Видно состав этапа и его состояние: какие пункты
 * входят в чек-лист, сдан ли он, что записано в допуске, что принято в смену.
 * Отмеченных ответов по пунктам здесь НЕТ, и это не упущение экрана: снимок
 * ответов в ответе сервера не приходит — `ChecklistView` отдаёт определение и
 * признак `done`. Показывать «норма» напротив пункта, не имея записи, значило
 * бы сочинить за человека то, чего он, может, и не отмечал.
 */
export function ReviewScreen({state, phase, onBack}: {
  state: OperatorMobileState;
  phase: OperatorPhase;
  onBack: () => void;
}) {
  const stage = PHASE_CHECKLIST[phase];
  const checklist = stage ? state.checklists.find((item) => item.stage === stage) : undefined;

  return (
    <Screen
      title={PHASE_LABELS[phase]}
      subtitle="Пройденный этап — только просмотр"
      footer={<BigButton tone="ghost" onClick={onBack}>Назад</BigButton>}
    >
      {phase === 'IDENTITY' ? <IdentityReview state={state} /> : null}
      {phase === 'ADMISSION' ? <AdmissionReview state={state} /> : null}
      {phase === 'WORK' ? <WorkReview state={state} /> : null}

      {checklist ? (
        <>
          <Panel tone={checklist.done ? 'ok' : 'warning'}>
            <PanelTitle tone={checklist.done ? 'ok' : 'warning'}>
              {checklist.done ? 'Чек-лист сдан' : 'Чек-лист не сдан'}
            </PanelTitle>
            <p className="mt-1 text-sm">{checklist.purpose}</p>
            <p className="mt-1 text-2xs text-muted-foreground">Версия {checklist.version}</p>
          </Panel>

          {checklist.sections.map((section) => (
            <Panel key={section.id}>
              <PanelTitle>{section.title}</PanelTitle>
              <ul className="mt-2 space-y-2 text-sm">
                {section.items.map((item) => (
                  <li key={item.id}>
                    <span className="font-semibold">{item.text}</span>
                    {item.hint ? (
                      <span className="mt-0.5 block text-2xs text-muted-foreground">{item.hint}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}

          <p className="px-1 text-2xs text-muted-foreground">
            Отмеченные ответы по пунктам здесь не показываются: сервер отдаёт
            состав чек-листа и признак сдачи, но не сам снимок ответов.
          </p>
        </>
      ) : null}
    </Screen>
  );
}

function IdentityReview({state}: {state: OperatorMobileState}) {
  const {identity} = state;
  return (
    <Panel>
      <PanelTitle>Допуск на {formatRuDate(state.productionDate)}</PanelTitle>
      <div className="mt-2 space-y-2">
        <Fact
          label="СИЗ"
          value={identity.ppe.confirmed
            ? (identity.ppe.missing.length > 0
              ? `проверены, не хватает: ${identity.ppe.missing.join(', ')}`
              : 'проверены, комплект полон')
            : 'не проверены'}
        />
        <Fact
          label="Ознакомление"
          value={identity.briefing.ok
            ? `${identity.briefing.title}, версия ${identity.briefing.version}`
            : 'не выполнено'}
        />
        <Fact
          label="Проверка знаний"
          value={identity.knowledge.ok
            ? `действует до ${formatRuDate(identity.knowledge.validUntil)}`
            : (identity.knowledge.lastResult ?? 'не выполнена')}
        />
      </div>
    </Panel>
  );
}

function AdmissionReview({state}: {state: OperatorMobileState}) {
  const {assignment, weather} = state;
  if (!assignment) {
    return (
      <Panel>
        <PanelTitle>Приём установки</PanelTitle>
        <p className="mt-1 text-sm">Установка за вами не закреплена.</p>
      </Panel>
    );
  }
  return (
    <Panel>
      <PanelTitle>Что принято в смену</PanelTitle>
      <div className="mt-2 space-y-2">
        <Fact label="Объект" value={assignment.siteName} />
        <Fact label="Установка" value={`${assignment.equipmentName} · ${assignment.equipmentModel}`} />
        <Fact label="Помощники" value={assignment.assistants.join(', ') || '—'} />
        {weather ? (
          <Fact
            label="Погода при приёмке"
            value={[
              weather.temperatureC === null ? null : `${weather.temperatureC} °C`,
              weather.windMs === null ? null : `${weather.windMs} м/с`,
            ].filter(Boolean).join(' · ') || '—'}
          />
        ) : null}
      </div>
    </Panel>
  );
}

function WorkReview({state}: {state: OperatorMobileState}) {
  return (
    <>
      <Panel>
        <PanelTitle>Выработка смены</PanelTitle>
        <div className="mt-2 space-y-2">
          <VolumeFact
            label="Свай забито"
            count={state.production.piles.count}
            meters={state.production.piles.meters}
          />
          <VolumeFact
            label="Лидерное бурение"
            count={state.production.drilling.count}
            meters={state.production.drilling.meters}
          />
          <Fact label="Простой" value={formatDowntimeHours(state.production.downtimeHours)} />
        </div>
      </Panel>
      <Panel>
        <PanelTitle>Записи смены</PanelTitle>
        {state.entries.length === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">За смену записей нет.</p>
        ) : (
          <ul className="mt-2 space-y-2 text-sm">
            {state.entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-3">
                <span className="font-semibold">{entry.label}</span>
                <span className="text-right tabular-nums">
                  {entry.value}
                  {entry.meters === null ? '' : ` · ${entry.meters} м.п.`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
