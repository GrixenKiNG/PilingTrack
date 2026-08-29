'use client';

import {PilingIcon, type PilingIconName} from '@/components/piling/icons/piling-icon';
import {cn} from '@/lib/utils';

export const OPERATOR_TABS = ['shift', 'work', 'defects', 'equipment'] as const;
export type OperatorTab = typeof OPERATOR_TABS[number];

const tabs: Array<{id: OperatorTab; label: string; icon: PilingIconName}> = [
  {id: 'shift', label: 'Смена', icon: 'calendar'},
  {id: 'work', label: 'Работа', icon: 'pile-driving'},
  {id: 'defects', label: 'Дефекты', icon: 'defect'},
  {id: 'equipment', label: 'Машина', icon: 'equipment-rig'},
];

/**
 * Нижняя навигация рабочего экрана — четыре вкладки, как в F1 спецификации.
 *
 * Два отличия от прежней версии, и оба принципиальные.
 *
 * Первое: выбранная вкладка приходит снаружи и наружу же уходит. Раньше она
 * жила в собственном `useState`, компонент не принимал ни одного свойства и
 * никому о выборе не сообщал — то есть подсвечивался и не переключал ничего.
 * Управляемым он такого сделать уже не может: у него нет своего состояния,
 * которое можно было бы забыть подключить.
 *
 * Второе: вкладок четыре, а не пять. «Профиль» из спецификации ушёл — допуск и
 * документы оператор смотрит в фазе A, до смены, и отдельная вкладка на весь
 * рабочий день ради этого не нужна.
 */
export function OperatorBottomNavigation({value, onChange, available}: {
  value: OperatorTab;
  onChange: (tab: OperatorTab) => void;
  available: readonly OperatorTab[];
}) {
  const visible = tabs.filter((tab) => available.includes(tab.id));
  // Навигация из одной вкладки — не навигация. Пусть лучше её не будет, чем
  // она будет обещать переход, которого нет.
  if (visible.length < 2) return null;

  return (
    <nav
      aria-label="Основная навигация оператора"
      className="fixed inset-x-0 bottom-0 z-30 mx-auto grid w-full max-w-[430px] border-t bg-card/95 px-1 pt-1 backdrop-blur"
      style={{
        gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))`,
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {visible.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-current={value === tab.id ? 'page' : undefined}
          className={cn(
            'flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            value === tab.id && 'bg-signal/10 text-foreground',
          )}
          onClick={() => onChange(tab.id)}
        >
          <PilingIcon name={tab.icon} size={16} decorative />
          <span className="truncate">{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}
