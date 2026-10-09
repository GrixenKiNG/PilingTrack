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

export function buildPermitRoleSteps({permits, now}: {permits: readonly WorkPermitDto[]; now: Date}): PermitRoleSteps[] {
  const overdue = permits.filter((permit) => isOverduePermit(permit, now));
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
          done: overdue.length === 0,
          hint: 'У просроченного наряда срок вышел, согласовать его нельзя. Создайте новый наряд-допуск на нужный срок.',
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
          done: overdue.length === 0,
          hint: 'Просроченный наряд не согласуется. Попросите инженера ОТ или механика оформить новый.',
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
