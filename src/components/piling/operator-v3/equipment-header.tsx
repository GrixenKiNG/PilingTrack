import {PilingIcon} from '@/components/piling/icons/piling-icon';
import type {OperatorWorkplace} from './api/contracts';

/**
 * Контекстная строка экрана: какая машина и где. По спецификации — две строки
 * над этапом, а не карточка.
 *
 * Раньше здесь стояла раскладка `max-w-7xl` с иконкой 56 px и заголовком 24 px:
 * шапка от настольного экрана внутри телефонного шириной 430. Она съедала треть
 * первого экрана и повторяла название установки, которое ниже называла карточка
 * фазы. Состояние связи отсюда тоже ушло — оно теперь в полосе наверху, и
 * держать его в двух местах значит рано или поздно показать два разных ответа.
 */
export function EquipmentHeader({snapshot}: {snapshot: OperatorWorkplace}) {
  const site = snapshot.equipment?.site?.name;

  return (
    <header className="flex items-center gap-3 border-b bg-card px-4 py-3">
      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-signal/10">
        <PilingIcon name="equipment-rig" size={18} decorative />
      </span>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold leading-tight">
          {snapshot.equipment?.name ?? 'Установка не выбрана'}
        </h1>
        <p className="truncate text-sm leading-tight text-muted-foreground">
          {site ?? snapshot.operator.name}
        </p>
      </div>
    </header>
  );
}
