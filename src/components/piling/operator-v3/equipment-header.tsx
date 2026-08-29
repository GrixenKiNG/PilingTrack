import {Badge} from '@/components/ui/badge';
import {PilingIcon} from '@/components/piling/icons/piling-icon';
import type {OperatorWorkplace} from './api/contracts';

const syncLabels: Record<OperatorWorkplace['sync']['state'], string> = {
  SYNCED: 'Все данные переданы', PENDING: 'Есть данные для отправки', SENDING: 'Выполняется отправка данных',
  OFFLINE: 'Работа без связи', CONFLICT: 'Обнаружено противоречие данных',
  INTERVENTION_REQUIRED: 'Требуется вмешательство', AUTHORIZATION_EXPIRED: 'Разрешение работы без связи истекло',
};

export function EquipmentHeader({snapshot}: {snapshot: OperatorWorkplace}) {
  return <header className="border-b bg-card">
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 md:flex-row md:items-center md:justify-between">
      <div className="flex min-w-0 items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-signal/10"><PilingIcon name="equipment-rig" size={28} decorative /></span>
        <div className="min-w-0">
          <p className="text-sm font-medium text-muted-foreground">Рабочее место оператора</p>
          <h1 className="truncate text-xl font-semibold tracking-tight md:text-2xl">{snapshot.equipment?.name ?? 'Установка не выбрана'}</h1>
          <p className="truncate text-sm text-muted-foreground">{snapshot.equipment?.site?.name ?? snapshot.operator.name}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{snapshot.phase.name}</Badge>
        <Badge variant={snapshot.sync.state === 'SYNCED' ? 'secondary' : 'outline'}>{syncLabels[snapshot.sync.state]}</Badge>
      </div>
    </div>
  </header>;
}
