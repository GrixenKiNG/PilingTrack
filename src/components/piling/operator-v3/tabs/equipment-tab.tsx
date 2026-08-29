import type {OperatorWorkplace} from '../api/contracts';

function Row({term, value}: {term: string; value: string}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b py-2.5 last:border-b-0">
      <dt className="text-sm text-muted-foreground">{term}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/**
 * Паспорт машины на смену: чем работаем и сколько осталось до ТО.
 *
 * Запас до ТО показан здесь по той же причине, по которой спецификация ставит
 * его в приёмку: цифра нужна оператору до того, как машина окажется в забое.
 */
export function EquipmentTab({snapshot}: {snapshot: OperatorWorkplace}) {
  const {equipment, meter} = snapshot;

  if (!equipment) {
    return (
      <section aria-label="Машина" className="rounded-xl border bg-card p-5">
        <h2 className="font-semibold">Установка не выбрана</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Машина появится здесь после того, как вы её примете.
        </p>
      </section>
    );
  }

  const hours = meter.current ?? equipment.engineHoursTotal;
  const untilService = equipment.nextMaintenanceAtHours !== null && hours !== null
    ? equipment.nextMaintenanceAtHours - hours
    : null;

  return (
    <section aria-label="Машина" className="rounded-xl border bg-card p-5">
      {/* Названия машины здесь нет: его несёт шапка экрана, и повторять его
          на вкладке значит тратить строку на то, что человек уже прочитал. */}
      <h2 className="font-semibold">{equipment.model || "Паспорт машины"}</h2>
      <dl className="mt-3">
        {equipment.site && <Row term="Объект" value={equipment.site.name} />}
        <Row term="Моточасы" value={hours === null ? 'Не записаны' : `${hours} м/ч`} />
        {untilService !== null && (
          <Row
            term="До ТО"
            value={untilService > 0 ? `${untilService} ч` : `перепробег ${Math.abs(untilService)} ч`}
          />
        )}
        <Row
          term="Показание снято"
          value={meter.source === 'reading' ? 'в этой смене' : 'из карточки машины'}
        />
      </dl>
    </section>
  );
}
