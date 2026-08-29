import type {OperatorWorkplace} from '../api/contracts';

export function EquipmentAcceptanceStep({snapshot}: {snapshot: OperatorWorkplace}) {
  return <dl className="grid gap-3 text-sm sm:grid-cols-2"><div><dt className="text-muted-foreground">Установка</dt><dd className="mt-1 font-medium">{snapshot.equipment?.name ?? 'Не выбрана'}</dd></div><div><dt className="text-muted-foreground">Объект</dt><dd className="mt-1 font-medium">{snapshot.equipment?.site?.name ?? 'Не указан'}</dd></div><div><dt className="text-muted-foreground">Последние моточасы</dt><dd className="mt-1 font-medium">{snapshot.equipment?.engineHoursTotal ?? 'Нет данных'}</dd></div><div><dt className="text-muted-foreground">Входящая передача</dt><dd className="mt-1 font-medium">{snapshot.handover.incoming?.summary ?? 'Передача отсутствует'}</dd></div></dl>;
}
