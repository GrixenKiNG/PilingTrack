'use client';

import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {
  DEFECT_SEVERITY_FIELD_LABELS, DEFECT_STATUS_FIELD_LABELS, isAlarmingSeverity,
} from '@/modules/operator-mobile/domain/defect-labels';
import {Fact, Panel, PanelTitle, Sign} from '../ui';

/**
 * Карточка машины и её открытые неисправности.
 *
 * ПОЧЕМУ ДЕФЕКТЫ ЗДЕСЬ, А НЕ В СВОЕЙ ВКЛАДКЕ. Неисправность — свойство машины,
 * а не отдельная сущность в голове машиниста: он думает «что с моим копром»,
 * а не «открой журнал дефектов». Отдельная вкладка добавила бы пятую кнопку
 * внизу и заставила бы искать в двух местах то, что относится к одному.
 *
 * ПОЧЕМУ ЗДЕСЬ НЕЧЕГО НАЖАТЬ. Дефект заводит осмотр и закрывает механик.
 * Кнопка «закрыть» у машиниста означала бы, что неисправность исчезает по
 * решению того, кому она мешает работать.
 */
export function EquipmentTab({state}: {state: OperatorMobileState}) {
  const assignment = state.assignment;
  if (!assignment) {
    return (
      <Panel>
        <p className="text-sm text-muted-foreground">За вами не закреплена установка.</p>
      </Panel>
    );
  }

  const maintenance = assignment.maintenance;
  const maintenanceValue = maintenance.daysLeft === null
    ? '—'
    : maintenance.daysLeft < 0
      ? `просрочено на ${Math.abs(maintenance.daysLeft)}`
      : maintenance.daysLeft;

  return (
    <>
      <Panel>
        <PanelTitle>{assignment.equipmentName}</PanelTitle>
        <p className="text-2xs text-muted-foreground">
          {assignment.equipmentModel || 'модель не указана'}
        </p>
        <div className="mt-3 space-y-1">
          <Fact label="Объект" value={assignment.siteName} />
          <Fact
            label="Оснащение"
            value={[
              assignment.hasHammer ? 'молот' : null,
              assignment.hasRotator ? 'вращатель' : null,
            ].filter(Boolean).join(', ') || '—'}
          />
          <Fact label="Топливо на конец прошлой смены" value={assignment.fuelPercent ?? '—'} unit="%" />
          <Fact label="Следующее ТО через" value={maintenanceValue} unit="дн." />
          {assignment.assistants.length > 0 ? (
            <Fact label="Помощники" value={assignment.assistants.join(', ')} />
          ) : null}
        </div>
      </Panel>

      <Panel tone={state.defects.length > 0 ? 'warning' : 'ok'}>
        <PanelTitle tone={state.defects.length > 0 ? 'warning' : 'ok'}>
          {state.defects.length > 0
            ? `Открытых неисправностей: ${state.defects.length}`
            : 'Открытых неисправностей нет'}
        </PanelTitle>
        {state.defects.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {state.defects.map((defect) => (
              <li key={defect.id} className="flex gap-2 border-t pt-2 first:border-t-0 first:pt-0">
                <Sign tone={isAlarmingSeverity(defect.severity) ? 'danger' : 'warning'} />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{defect.title}</p>
                  <p className="text-2xs text-muted-foreground">
                    {DEFECT_SEVERITY_FIELD_LABELS[defect.severity] ?? defect.severity}
                    {' · '}
                    {DEFECT_STATUS_FIELD_LABELS[defect.status] ?? defect.status}
                    {' · с '}
                    {new Date(defect.reportedAt).toLocaleDateString('ru-RU')}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Неисправности заводятся сами, когда в осмотре отмечен отказ. Закрывает их механик.
          </p>
        )}
      </Panel>
    </>
  );
}
