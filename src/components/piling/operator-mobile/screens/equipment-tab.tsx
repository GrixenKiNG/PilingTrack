'use client';

import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';
import {Fact, Panel, PanelTitle} from '../ui';

/**
 * Карточка машины: что закреплено за машинистом и в каком оно состоянии.
 *
 * ПОЧЕМУ БЕЗ СПИСКА НЕИСПРАВНОСТЕЙ (решение владельца 18.09.2026). Здесь висел
 * перечень открытых дефектов со счётчиком. Заводит их осмотр, закрывает
 * механик, нажать машинисту нечего — на экране смены это семь строк, мимо
 * которых он проходит каждый день. Неисправности остались там, где с ними
 * работают: у механика и в карточке техники.
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
    </>
  );
}
