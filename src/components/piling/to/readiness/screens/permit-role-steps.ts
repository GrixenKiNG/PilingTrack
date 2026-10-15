import type {WorkPermitDto} from '../api/contracts';
import type {ProcessRoleStep} from './shared';

export interface PermitRoleSteps {
  label: 'Инженер ОТ или механик' | 'Диспетчер' | 'Администратор';
  steps: ProcessRoleStep[];
}

/**
 * Наряд просрочен, если его срок прошёл, а он всё ещё на согласовании или
 * согласован — либо уже помечен истёкшим. Черновик срока не держит (его можно
 * перепланировать), отозванный закрыт человеком.
 *
 * Просроченный наряд на согласовании согласовать нельзя (команда approve
 * отказывает), поэтому в «ожидающих решения» он не участвует: у него один
 * выход — оформить новый наряд.
 */
export function isOverduePermit(permit: Pick<WorkPermitDto, 'state' | 'validTo'>, now: Date): boolean {
  if (permit.state === 'EXPIRED') return true;
  if (permit.state !== 'PENDING_APPROVAL' && permit.state !== 'APPROVED') return false;
  return new Date(permit.validTo).getTime() <= now.getTime();
}

/**
 * Задачи до закрытия планировщиком: согласованный нужно закрыть, ожидающий
 * согласования — переоформить. Наличие замены не закрывает старый наряд.
 * EXPIRED и CLOSED — история; решение владельца cb8fc697 для EXPIRED сохранено.
 */
export function actionableOverduePermits<T extends Pick<WorkPermitDto, 'state' | 'validTo' | 'equipmentId'>>(
  permits: readonly T[],
  now: Date,
): T[] {
  return permits.filter((permit) => (permit.state === 'APPROVED' || permit.state === 'PENDING_APPROVAL')
    && isOverduePermit(permit, now));
}

export function buildPermitRoleSteps({permits, now}: {permits: readonly WorkPermitDto[]; now: Date}): PermitRoleSteps[] {
  const overdue = actionableOverduePermits(permits, now);
  const overduePending = overdue.filter((permit) => permit.state === 'PENDING_APPROVAL');
  const awaitingClosure = overdue.filter((permit) => permit.state === 'APPROVED' && new Date(permit.validFrom) <= now);
  const livePending = permits.filter((permit) => permit.state === 'PENDING_APPROVAL' && !isOverduePermit(permit, now));
  const drafts = permits.filter((permit) => permit.state === 'DRAFT');
  const elevatedPending = livePending.filter((permit) => permit.risk === 'ELEVATED');

  return [
    {
      label: 'Инженер ОТ или механик',
      steps: [
        {
          title: 'Создать наряд-допуск',
          done: permits.length > 0,
          hint: 'Нажмите «Создать наряд-допуск» вверху вкладки и опишите состав и границы работ.',
        },
        {
          title: 'Отправить на согласование',
          done: drafts.length === 0,
          hint: 'В реестре у черновика нажмите «Отправить на согласование».',
        },
        {
          title: 'Переоформить просроченные',
          done: overduePending.length === 0,
          hint: 'У просроченного наряда срок вышел, согласовать его нельзя. Создайте новый наряд-допуск на нужный срок.',
        },
        {
          title: 'Закрыть наряды завершённых работ',
          done: awaitingClosure.length === 0,
          hint: 'У согласованного наряда с завершёнными работами нажмите «Закрыть наряд». Закрытый наряд больше не даёт допуска.',
        },
      ],
    },
    {
      label: 'Диспетчер',
      steps: [
        {
          title: 'Согласовать наряд',
          done: livePending.length === 0,
          hint: 'В блоке «Ожидают согласования» проверьте условия и нажмите «Согласовать» или откажите с причиной.',
        },
        {
          title: 'Решить по просроченным',
          done: overduePending.length === 0,
          hint: 'Наряд с вышедшим окном согласования не согласуется. Попросите инженера ОТ или механика оформить новый.',
        },
      ],
    },
    {
      label: 'Администратор',
      steps: [
        {
          title: 'Второе решение при повышенном риске',
          done: elevatedPending.length === 0,
          hint: 'Наряд с повышенным риском требует двух согласований. Дайте второе решение; свой наряд согласовать нельзя.',
        },
      ],
    },
  ];
}
