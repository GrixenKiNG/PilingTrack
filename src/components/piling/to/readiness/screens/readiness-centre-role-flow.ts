import { STAGE_OWNER } from './readiness-centre-metrics';


import { ShieldCheck, User, Wrench } from '@/components/piling/icons/unified-icons';







import type { AuthoritativeReadinessFactsDto, ReadinessAbility } from '../api/contracts';
import { type AuthoritativeReadinessPresentation, type PresentationStage } from '../authoritative-presentation';


import type { ReferenceView } from './types';

/**
 * Один шаг роли в подсказке «что делать сейчас».
 *
 * Тексты и адреса — из раздела «Предложение» отчёта W60: одна фраза — одно
 * действие, один термин на понятие. `ability` — право готовности, которым шаг
 * закрывается; у кого этого права нет, тому вместо кнопки показывается, кто
 * шаг выполняет (`STAGE_OWNER` для этапов чек-листа, `owner` — для остальных).
 */
interface RoleStepHint {
  key: string;
  title: string;
  hint: string;
  target: {href?: string; view?: ReferenceView};
  ability?: ReadinessAbility;
  owner?: string;
  /**
   * Шаг выполняет другая роль. У такого шага нет кнопки «сделать» для смотрящего:
   * вместо неё подсказка называет исполнителя. `owner` остаётся владельцем этапа
   * для подсветки карточки в цепочке, `executor` — тем, кто закрывает работу.
   */
  executor?: string;
}

export const ROLE_FLOW = [
  {
    label: 'Оператор',
    icon: 'inspection' as const,
    lucide: User,
    border: 'border-success/25',
    header: 'border-success/25 bg-success/10 text-success-strong',
    steps: [
      { key: 'INSPECTION', title: 'Провести осмотр', hint: 'Осмотр проходит машинист на своём экране перед сменой. Он засчитывается только в той смене, где его провели; во вкладке «Смены» видно, есть ли у установки смена.', target: { view: 'shifts' }, ability: 'readiness.inspection.manage' },
      { key: 'ENGINE_HOURS', title: 'Зафиксировать моточасы', hint: 'На экране машиниста нажмите «Снять моточасы» и введите показание счётчика.', target: { view: 'shifts' } },
      { key: 'PERMIT', title: 'Допуск', hint: 'Наряд-допуск оформляет инженер ОТ (или механик) во вкладке «Наряд-допуски». Если допуск правилами не требуется, шаг закрыт сам.', target: { view: 'permits' }, ability: 'readiness.permit.edit', executor: 'инженер по охране труда' },
      { key: 'MAINTENANCE', title: 'Техническое обслуживание', hint: 'Обслуживание закрывает механик во вкладке «Обслуживание ТО».', target: { view: 'maintenance' }, ability: 'readiness.maintenance.manage', executor: 'механик' },
      { key: 'ACCEPTANCE', title: 'Приёмка', hint: 'Откройте вкладку «Смены» и нажмите «Допустить» у смены этой установки. Если смены на сегодня нет, сначала создайте её кнопкой «Создать смену».', target: { view: 'shifts' }, ability: 'readiness.shift.authorize', executor: 'диспетчер' },
    ] as RoleStepHint[],
  },
  {
    label: 'Диспетчер',
    icon: 'dispatcher' as const,
    lucide: User,
    border: 'border-info/25',
    header: 'border-info/25 bg-info/10 text-info-strong',
    steps: [
      { key: 'D_READINESS', title: 'Проверить готовность', hint: 'Откройте «Центр готовности» и убедитесь, что по установке есть свежая авторитетная оценка — она создаётся сама после действий оператора и механика.', target: { view: 'readiness' }, ability: 'readiness.read', owner: 'Диспетчер' },
      { key: 'D_ACCEPT', title: 'Принять и назначить технику', hint: 'Во вкладке «Смены» нажмите «Допустить смену к работе» — это и есть предсменный допуск техники.', target: { view: 'shifts' }, ability: 'readiness.shift.authorize', owner: 'Диспетчер' },
      { key: 'D_SHIFT', title: 'Проверить, что смена открыта', hint: 'Выполняет оператор — вы только проверяете.', target: { view: 'shifts' }, ability: 'readiness.shift.manage', executor: 'оператор' },
    ] as RoleStepHint[],
  },
  {
    label: 'Механик',
    icon: 'repair' as const,
    lucide: Wrench,
    border: 'border-signal/25',
    header: 'border-signal/25 bg-signal/10 text-signal-strong',
    steps: [
      { key: 'M_DEFECTS', title: 'Устранить дефекты', hint: 'Откройте вкладку «Обслуживание ТО» → «Замечания и дефекты», возьмите дефект в работу и закройте его.', target: { view: 'maintenance' }, ability: 'readiness.defect.manage', owner: 'Механик' },
      { key: 'M_MAINTENANCE', title: 'Провести обслуживание', hint: 'Во вкладке «Обслуживание ТО» закройте наряд ТО: заполните работы и подтвердите их.', target: { view: 'maintenance' }, ability: 'readiness.maintenance.manage', owner: 'Механик' },
      { key: 'M_CONFIRM', title: 'Подтвердить работы', hint: 'Закройте все открытые наряды по установке — пока есть незакрытая заявка, шаг не закрыт.', target: { view: 'maintenance' }, ability: 'readiness.maintenance.manage', owner: 'Механик' },
    ] as RoleStepHint[],
  },
  {
    label: 'Администратор',
    icon: 'reports' as const,
    lucide: ShieldCheck,
    border: 'border-border',
    header: 'border-border bg-muted text-foreground',
    steps: [
      { key: 'A_PERMIT', title: 'Контролировать допуски', hint: 'Откройте вкладку «Наряд-допуски» и проверьте, что наряд оформлен, согласован и не просрочен.', target: { view: 'permits' }, ability: 'readiness.permit.edit', owner: 'Администратор' },
      { key: 'A_RULES', title: 'Настроить правила и чек-листы', hint: 'Откройте «Настройки» → «Правила готовности» и опубликуйте набор правил.', target: { view: 'settings' }, ability: 'readiness.rules.manage', owner: 'Администратор' },
      { key: 'A_ANALYTICS', title: 'Анализировать показатели', hint: 'Снимок оценки создаётся автоматически. Историю оценок смотрите на вкладке «Отчёты».', target: { view: 'reports' }, ability: 'readiness.read', owner: 'Администратор' },
    ] as RoleStepHint[],
  },
];

export interface RoleFlowStep {
  key: string;
  done: boolean;
  /**
   * `false` — факт шага не прочитан (нет источника: журнал не загружен), а не
   * «не выполнено». Такой шаг ни «выполнен», ни «осталось» — «нет данных».
   */
  known?: boolean;
}

export interface RoleFlowProgress {
  done: number;
  total: number;
  state: string;
  /** Тот же счёт, разложенный по шагам роли — источник состояний для подсказки. */
  steps: RoleFlowStep[];
}

/**
 * Кто на каком шаге прямо сейчас.
 *
 * Раньше эти счётчики были константами в ROLE_FLOW: у оператора вечно
 * «1/5 шагов», у остальных «0/3», независимо от того, что происходит с
 * установкой. Теперь каждый шаг — проверяемый факт из авторитетного снимка,
 * смены и журнала обслуживания; галочка ставится только по факту.
 *
 * У оператора шкала намеренно пятишаговая: это тот же чек-лист смены, что и в
 * левой колонке, — два счётчика на одном экране обязаны совпадать.
 *
 * `openMaintenanceCount === null` значит «журнал заявок не прочитан» — зритель
 * без права `maintenance.manage` его не грузит; тогда шаг не считается ни
 * выполненным, ни оставшимся.
 */
export function buildRoleFlowProgress(
  presentation: AuthoritativeReadinessPresentation,
  facts: AuthoritativeReadinessFactsDto | null,
  openMaintenanceCount: number | null,
  rulesPublished: boolean,
  shiftOpen: boolean,
): RoleFlowProgress[] {
  const stageDone = (key: PresentationStage['key']) =>
    presentation.stages.find((stage) => stage.key === key)?.state === 'pass';

  const label = (done: number, total: number) =>
    done === 0 ? 'Ожидает' : done === total ? 'Готово' : 'В работе';

  // Шаги оператора — это этапы авторитетного снимка: подсказка показывает те же
  // пять строк, что и чек-лист смены, и не заводит второго источника.
  const operatorSteps: RoleFlowStep[] = presentation.stages.map((stage) => ({
    key: stage.key,
    done: stage.state === 'pass',
  }));
  const operatorDone = operatorSteps.filter((step) => step.done).length;

  const dispatcherSteps: RoleFlowStep[] = [
    { key: 'D_READINESS', done: presentation.mode === 'authoritative' },
    { key: 'D_ACCEPT', done: Boolean(facts?.accepted) },
    // W71: смену заводит оператор или администратор — у диспетчера этого права
    // нет, шаг подписан исполнителем в ROLE_FLOW. Раньше он был вечно
    // `done: false`, и «3 из 3» диспетчер не набирал никогда. Считаем факт,
    // который диспетчер действительно проверяет: смена открыта — тем же
    // правилом, что и состояние установки «в работе» (`STARTED` /
    // `HANDOVER_PENDING`), а не выдуманным «шагом» системы.
    { key: 'D_SHIFT', done: shiftOpen },
  ];
  const dispatcher = dispatcherSteps.filter((step) => step.done).length;

  const mechanicSteps: RoleFlowStep[] = [
    { key: 'M_DEFECTS', done: facts ? !facts.criticalDefect : false },
    { key: 'M_MAINTENANCE', done: stageDone('MAINTENANCE') },
    // Журнал заявок отдают только с правом `maintenance.manage`. Без него
    // пустой `journals` — это «не прочитано», а не «заявок нет»: иначе шаг
    // ложно «выполнен» у того, кому журнал вообще не загружают.
    { key: 'M_CONFIRM', done: openMaintenanceCount === 0, known: openMaintenanceCount !== null },
  ];
  const mechanic = mechanicSteps.filter((step) => step.done).length;

  const adminSteps: RoleFlowStep[] = [
    { key: 'A_PERMIT', done: stageDone('PERMIT') },
    { key: 'A_RULES', done: rulesPublished },
    { key: 'A_ANALYTICS', done: presentation.calculatedAt !== null },
  ];
  const admin = adminSteps.filter((step) => step.done).length;

  return [
    { done: operatorDone, total: presentation.stages.length, state: label(operatorDone, presentation.stages.length), steps: operatorSteps },
    { done: dispatcher, total: 3, state: label(dispatcher, 3), steps: dispatcherSteps },
    { done: mechanic, total: 3, state: label(mechanic, 3), steps: mechanicSteps },
    { done: admin, total: 3, state: admin === 3 ? 'В мониторинге' : label(admin, 3), steps: adminSteps },
  ];
}

/**
 * Кто выполняет шаг, если у смотрящего нет на него права. У этапов чек-листа
 * ответ берётся из единственного источника — `STAGE_OWNER` (тот же, что
 * подсвечивает карточку роли в цепочке); у остальных шагов он записан рядом.
 */
export function stepOwner(step: RoleStepHint): string | null {
  return (STAGE_OWNER as Record<string, string>)[step.key] ?? step.owner ?? null;
}
