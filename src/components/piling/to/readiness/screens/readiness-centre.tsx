'use client';

import { useState } from 'react';
import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Gauge, HardHat, History, Search, Send, ShieldCheck, User, Wrench } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { buildHandoverJournal, handoverRoleLabel, type HandoverEventKind, type HandoverJournalEvent } from '../handover-journal';
import { isOpenRecord } from '../../to-stats';
import type { AuthoritativeReadinessFactsDto, ReadinessAbility } from '../api/contracts';
import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation, type AuthoritativeReadinessPresentation, type PresentationEvidence, type PresentationNotice, type PresentationStage } from '../authoritative-presentation';
import { EquipmentPhoto, ReadinessRing, STAGE_CTA, muted, blockerTone, type BlockerTone, BLOCKER_TONE_CLASS, BLOCKER_TONE_LABEL } from './shared';
import { blockerGuidance } from './blocker-guidance';
import type { EquipmentDetailSnapshot, ReferenceUiProps, ReferenceView } from './types';

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

const ROLE_FLOW = [
  {
    label: 'Оператор',
    icon: 'inspection' as const,
    lucide: User,
    border: 'border-success/25',
    header: 'border-success/25 bg-success/10 text-success-strong',
    steps: [
      { key: 'INSPECTION', title: 'Провести осмотр', hint: 'Откройте вкладку «Смены» и нажмите «Провести осмотр». Осмотр засчитывается только за сегодня.', target: { view: 'shifts' }, ability: 'readiness.inspection.manage' },
      { key: 'ENGINE_HOURS', title: 'Зафиксировать моточасы', hint: 'На экране машиниста нажмите «Снять моточасы» и введите показание счётчика.', target: { view: 'shifts' } },
      { key: 'PERMIT', title: 'Допуск', hint: 'Наряд-допуск оформляет инженер ОТ (или механик) во вкладке «Наряд-допуски». Если допуск правилами не требуется, шаг закрыт сам.', target: { view: 'permits' }, ability: 'readiness.permit.edit', executor: 'инженер по охране труда' },
      { key: 'MAINTENANCE', title: 'Техническое обслуживание', hint: 'Обслуживание закрывает механик во вкладке «Обслуживание ТО».', target: { view: 'maintenance' }, ability: 'readiness.maintenance.manage', executor: 'механик' },
      { key: 'ACCEPTANCE', title: 'Приёмка', hint: 'Смену допускает к работе тот, кто выходит в смену: нажмите «Допустить смену к работе» во вкладке «Смены».', target: { view: 'shifts' }, ability: 'readiness.shift.authorize', executor: 'диспетчер' },
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
      { key: 'D_SHIFT', title: 'Открыть смену', hint: 'Смену заводит оператор или администратор. Диспетчер может допустить её к работе, но не создать.', target: { view: 'shifts' }, ability: 'readiness.shift.manage', executor: 'оператор' },
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
function buildRoleFlowProgress(
  presentation: AuthoritativeReadinessPresentation,
  facts: AuthoritativeReadinessFactsDto | null,
  openMaintenanceCount: number | null,
  rulesPublished: boolean,
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
    // Смену заводит оператор или администратор — у диспетчера этого права нет.
    // Раньше шаг загорался тем же запуском смены, что и «Принять и назначить
    // технику»: диспетчер видел выполненным чужое действие, да ещё и дважды.
    // Своим шагом он его не считает — исполнитель подписан в ROLE_FLOW.
    { key: 'D_SHIFT', done: false },
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
function stepOwner(step: RoleStepHint): string | null {
  return (STAGE_OWNER as Record<string, string>)[step.key] ?? step.owner ?? null;
}

/**
 * Подсказка «что делать сейчас» по нажатию на карточку роли.
 *
 * Состояния шагов — из того же `roleProgress`, что рисует цепочку: второго
 * источника нет. Первый невыполненный шаг подсвечен и подписан «Сделайте это
 * сейчас»; у шага, на который у смотрящего нет права, вместо кнопки — строка
 * «Этот шаг выполняет <роль>».
 */
function RoleStepsPanel({ roleIndex, progress, onViewChange, abilities }: {
  roleIndex: number;
  progress: RoleFlowProgress[];
  onViewChange: (view: ReferenceView) => void;
  abilities: readonly ReadinessAbility[];
}) {
  const role = ROLE_FLOW[roleIndex];
  const steps = progress[roleIndex]?.steps ?? [];
  // «Сделайте это сейчас» ставим только на шаг, который смотрящий реально может
  // закрыть: чужой шаг (есть исполнитель) и шаг без данных не подсвечиваем.
  const firstPending = steps.findIndex((step, index) =>
    !step.done && step.known !== false && !role.steps[index]?.executor);
  return (
    <section aria-label={`Что делать сейчас: ${role.label}`} className="mt-2 rounded-lg border border-border bg-card p-3 shadow-sm">
      <h2 className="text-sm font-extrabold">Что делать сейчас: {role.label}</h2>
      <ul className="mt-2 space-y-2">
        {role.steps.map((step, index) => {
          const done = steps[index]?.done ?? false;
          const known = steps[index]?.known !== false;
          const now = index === firstPending;
          const hasTarget = Boolean(step.target.view || step.target.href);
          // Чужой шаг: его закрывает другая роль — кнопки «сделать» у него нет.
          const foreign = Boolean(step.executor);
          const allowed = !foreign && (!step.ability || abilities.includes(step.ability));
          const performedBy = step.executor ?? stepOwner(step);
          const pill = done
            ? { text: 'Выполнено', cls: 'bg-success/10 text-success-strong' }
            : !known
              ? { text: 'Нет данных', cls: 'bg-muted text-muted-foreground' }
              : now
                ? { text: 'Сейчас', cls: 'bg-signal text-white' }
                : { text: 'Впереди', cls: 'bg-muted text-muted-foreground' };
          return (
            <li key={step.key} className={cn('rounded-lg border p-2.5', now ? 'border-signal ring-2 ring-signal/30' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded px-2 py-0.5 text-3xs font-bold', pill.cls)}>
                  {pill.text}
                </span>
                <span className="text-xs font-bold">{step.title}</span>
                {now && <span className="ml-auto text-3xs font-bold text-signal-strong">Сделайте это сейчас</span>}
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{step.hint}</p>
              {allowed && hasTarget ? (
                step.target.href ? (
                  <Link href={step.target.href} aria-label={`${step.title}: перейти`} className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-signal-strong">
                    Перейти<ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => step.target.view && onViewChange(step.target.view)}
                    aria-label={`${step.title}: перейти`}
                    className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-signal-strong"
                  >
                    Перейти<ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )
              ) : performedBy ? (
                <p className="mt-2 text-2xs text-muted-foreground">Выполняет {performedBy}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function RoleFlowFooter({ progress, owner, onViewChange, abilities }: {
  progress: RoleFlowProgress[];
  owner: string | null;
  onViewChange: (view: ReferenceView) => void;
  abilities: readonly ReadinessAbility[];
}) {
  const [openRole, setOpenRole] = useState<number | null>(null);
  return (
    <>
      <section aria-label="Роли процесса технической готовности" className="mt-2 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2 2xl:grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] 2xl:gap-0">
        {ROLE_FLOW.map((role, index) => {
          const RoleIcon = role.lucide;
          const roleProgress = progress[index];
          // Роль, на которой стоит процесс: без этой отметки лента показывала
          // четыре равнозначные карточки, и кто именно держит ход — не читалось.
          const holding = owner === role.label;
          const open = openRole === index;
          return (
            <div key={role.label} className="contents">
              <article className={cn(
                'flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm',
                holding ? 'border-signal ring-2 ring-signal/30' : role.border,
              )}>
                {/* Карточка роли теперь открывает подсказку «что делать сейчас». */}
                <button
                  type="button"
                  onClick={() => setOpenRole(open ? null : index)}
                  aria-expanded={open}
                  aria-label={`${role.label}: что делать сейчас`}
                  className="flex flex-1 flex-col text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <header className={cn('flex items-center gap-2 border-b px-3 py-1.5', role.header)}>
                    <RoleIcon className="h-4 w-4" />
                    <h2 className="text-sm font-extrabold">{role.label}</h2>
                    {holding && (
                      <span className="ml-auto rounded bg-signal px-2 py-0.5 text-3xs font-bold text-white">
                        Сейчас ход
                      </span>
                    )}
                    <ChevronRight className={cn('h-4 w-4', holding ? '' : 'ml-auto', open && 'rotate-90')} />
                  </header>
                  <div className="flex flex-1 items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1 space-y-1 text-2xs leading-[1.35] text-muted-foreground">
                      {role.steps.map((step) => <div key={step.key} className="flex gap-1.5"><span className="text-muted-foreground">•</span><span>{step.title}</span></div>)}
                    </div>
                    {roleProgress && (
                      <div className="shrink-0 rounded-[10px] border border-border px-2.5 py-1.5 text-center text-2xs">
                        <div className="text-muted-foreground">{roleProgress.state}</div>
                        <div className="font-bold tabular-nums">{roleProgress.done}/{roleProgress.total} шагов</div>
                      </div>
                    )}
                    {/* The handoff uses the approved PNG directly in this footer. */}
                    { }
                    <img src={`/icons/pilingtrack/${role.icon}.png`} alt="" className="h-[34px] w-[34px] shrink-0 object-contain" />
                  </div>
                </button>
              </article>
              {index < ROLE_FLOW.length - 1 && <div className="hidden items-center justify-center text-xl text-muted-foreground 2xl:flex">→</div>}
            </div>
          );
        })}
      </section>
      {openRole !== null && (
        <RoleStepsPanel roleIndex={openRole} progress={progress} onViewChange={onViewChange} abilities={abilities} />
      )}
    </>
  );
}

/** Этап цепочки: ведёт либо на страницу другого модуля, либо на вкладку контура. */
function StageLink({target, label, onViewChange, children}: {
  target: {href?: string; view?: ReferenceView};
  label: string;
  onViewChange: (view: ReferenceView) => void;
  children: React.ReactNode;
}) {
  // flex, а не block: у <button> браузер центрирует содержимое по вертикали,
  // и в сетке цепочки кружки шагов с однострочной подписью съезжали на 8px
  // ниже кружков со «Техническое обслуживание» — ряд переставал быть линией.
  const shared = 'flex min-h-11 flex-col items-center justify-start rounded-lg px-2 py-1 text-center transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (!target.href && !target.view) return <div className={shared}>{children}</div>;
  return target.href
    ? <Link href={target.href} className={shared} aria-label={`${label}: открыть`}>{children}</Link>
    : <button type="button" onClick={() => target.view && onViewChange(target.view)} className={shared} aria-label={`${label}: открыть`}>{children}</button>;
}

/**
 * Состояние шага читается пилюлей справа, а не из текста значения — так строка
 * чек-листа сканируется одним взглядом, как в утверждённом макете.
 */
const STAGE_PILL: Record<PresentationStage['state'], { label: string; cls: string }> = {
  pass: { label: 'Выполнено', cls: 'bg-success/10 text-success-strong' },
  warning: { label: 'Есть замечания', cls: 'bg-warning/10 text-warning-strong' },
  fail: { label: 'Не выполнено', cls: 'bg-destructive/10 text-destructive-strong' },
  unknown: { label: 'Ожидает', cls: 'bg-muted text-muted-foreground' },
};

/**
 * Кто отвечает за шаг. По незакрытому шагу видно, на ком стоит процесс:
 * подпись под цепочкой и подсветка карточки в нижней ленте ролей берутся
 * отсюда. Названия обязаны совпадать с ROLE_FLOW — по ним идёт сопоставление.
 */
const STAGE_OWNER: Record<PresentationStage['key'], string> = {
  INSPECTION: 'Оператор',
  ENGINE_HOURS: 'Оператор',
  PERMIT: 'Администратор',
  MAINTENANCE: 'Механик',
  ACCEPTANCE: 'Диспетчер',
};

/**
 * Моточасы снимает осмотр перед работой, а карточка установки закрыта ролям без
 * права `equipment.read`. Вместо ссылки в тупик такому зрителю показываем, где
 * шаг закрывается: `W66`.
 */
const ENGINE_HOURS_NOTE = 'Моточасы снимаются в осмотре перед работой';

/** Иконка события журнала передачи. Кружок в ленте вместо безымянной точки. */
const HANDOVER_ICON: Record<HandoverEventKind, typeof Send> = {
  SUBMITTED: Send,
  REWORKED: AlertCircle,
  ACCEPTED: CheckCircle2,
};

/** Сколько событий передачи видно сразу; остальное — под «полным журналом». */
const HANDOVER_PREVIEW = 4;

const HANDOVER_PILL: Record<HandoverEventKind, { label: string; cls: string }> = {
  SUBMITTED: { label: 'Передано', cls: 'border-signal/40 text-signal-strong' },
  REWORKED: { label: 'На доработке', cls: 'border-warning/40 text-warning-strong' },
  ACCEPTED: { label: 'Принято', cls: 'border-border text-muted-foreground' },
};

/**
 * Счёт блокеров по тону действия — тому же, которым блокер красится.
 *
 * Правило «нет осмотра за сегодня» (`RETURN_TO_OPERATOR`) — незакрытый шаг, а
 * не критический дефект; «нужно подтверждение» (`REQUIRE_CONFIRMATION`) —
 * решение ответственного. Раньше плитка и блок называли ЛЮБОЙ блокер
 * критическим. Неизвестное действие `blockerTone` относит к строгому запрету,
 * поэтому в «Критические» попадает и оно: недооценить блокировку пуска хуже,
 * чем перестраховаться. Сами условия допуска остаются блокерами — меняется
 * лишь подпись и цвет счётчика.
 */
function countBlockersByTone(blockers: readonly PresentationNotice[]): Record<BlockerTone, number> {
  const counts: Record<BlockerTone, number> = { critical: 0, attention: 0, info: 0 };
  for (const notice of blockers) counts[blockerTone(notice.action)] += 1;
  return counts;
}

/** Слово-итог счётчика по тону блокера: «Критическое» — только строгий запрет. */
const BLOCKER_COUNT_LABEL: Record<BlockerTone, string> = {
  critical: 'Критические',
  attention: BLOCKER_TONE_LABEL.attention,
  info: BLOCKER_TONE_LABEL.info,
};

/** Заливка счётчика по тону блокера: красная — только у запрета пуска. */
const BLOCKER_COUNT_CLASS: Record<BlockerTone, string> = {
  critical: 'bg-destructive/10 text-destructive-strong',
  attention: 'bg-warning/10 text-warning-strong',
  info: 'bg-info/10 text-info-strong',
};

interface ReadinessMetricTile {
  key: string;
  label: string;
  icon: typeof FileText;
  pill: { label: string; cls: string };
  rows: Array<{ caption: string; value: string }>;
  href?: string;
  view?: ReferenceView;
  /** Строка вместо кнопки, когда адреса нет: например, моточасы без карточки установки. */
  note?: string;
}

/**
 * Плитки доказательств: показатель, а не идентификатор.
 *
 * Раньше здесь печатались ссылки на сущности («Установка», «Расчёт выполнен»)
 * и до семи строк «Заявка N» подряд — по ним нельзя было понять состояние, не
 * открыв каждую. Метрики берутся из фактов авторитетного снимка; сами
 * идентификаторы никуда не делись — они под «Смотреть всё».
 */
function buildReadinessMetricTiles(
  facts: AuthoritativeReadinessFactsDto | null,
  presentation: AuthoritativeReadinessPresentation,
  equipmentId: string,
  engineHoursTotal: number | null | undefined,
  detail: EquipmentDetailSnapshot | undefined,
  inspectionHref: string | null,
  mayOpenEquipmentCard: boolean,
): ReadinessMetricTile[] {
  const inspectionStage = presentation.stages.find((stage) => stage.key === 'INSPECTION');
  const maintenanceStage = presentation.stages.find((stage) => stage.key === 'MAINTENANCE');
  const lastInspection = detail?.latestInspection ?? null;
  // Пункты, а не процент: доля из facts — это флаг «завершён / начат / нет»,
  // по ней нельзя сказать, сколько строк чек-листа реально заполнено.
  // Пустая карточка машины — это незнание, а не факт о технике: деталь могла
  // не загрузиться отказом по правам или сбоем сети.
  const inspectionItems = !detail
    ? 'нет данных'
    : !lastInspection
      ? 'осмотра ещё не было'
      : lastInspection.itemsTotal === 0
        ? 'пункты не заданы'
        : `${lastInspection.itemsAnswered} из ${lastInspection.itemsTotal}`;
  const nextAtHours = detail?.equipment?.nextMaintenanceAtHours;
  const hoursLeft = nextAtHours != null && engineHoursTotal != null
    ? Math.round(nextAtHours - engineHoursTotal)
    : null;
  const nextDate = detail?.equipment?.nextMaintenanceDate;
  const daysLeft = nextDate
    ? Math.ceil((new Date(nextDate).getTime() - Date.now()) / 86_400_000)
    : null;
  // Блокеры одного вердикта разных исходов — «критический» только запрет пуска.
  const blockerTones = countBlockersByTone(presentation.blockers);

  return [
    {
      key: 'inspection',
      label: 'Чек-лист осмотра',
      icon: FileText,
      pill: STAGE_PILL[inspectionStage?.state ?? 'unknown'],
      rows: [{ caption: 'Выполнено пунктов', value: inspectionItems }],
      // Source-aware ссылка из доказательства (журнал ЕО/ТО открывается,
      // чек-лист машиниста — без ссылки). Иначе последний реальный осмотр
      // (валидная сущность /inspections), иначе список. Никогда не сырой
      // inspectionId: он может быть id чек-листа машиниста и вести в 404.
      href: inspectionHref
        ?? (lastInspection ? `/inspections/${lastInspection.id}` : '/inspections'),
    },
    {
      key: 'meter',
      label: 'Моточасы',
      icon: Gauge,
      pill: facts?.meterKnown
        ? { label: 'Выполнено', cls: 'bg-success/10 text-success-strong' }
        : { label: 'Нет показаний', cls: 'bg-muted text-muted-foreground' },
      rows: [{
        caption: 'Текущие моточасы',
        value: engineHoursTotal != null ? `${engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—',
      }],
      // Карточка установки закрыта роли без `equipment.read` — вместо ссылки в
      // тупик показываем, где моточасы на самом деле снимаются.
      href: mayOpenEquipmentCard ? `/admin/equipment/${equipmentId}` : undefined,
      note: mayOpenEquipmentCard ? undefined : ENGINE_HOURS_NOTE,
    },
    {
      key: 'findings',
      label: 'Замечания и дефекты',
      icon: AlertTriangle,
      pill: blockerTones.critical > 0
        ? { label: 'Есть', cls: BLOCKER_COUNT_CLASS.critical }
        : blockerTones.attention > 0
          ? { label: 'Есть', cls: BLOCKER_COUNT_CLASS.attention }
          : blockerTones.info > 0
            ? { label: 'Есть', cls: BLOCKER_COUNT_CLASS.info }
            : presentation.warnings.length > 0
              ? { label: 'Есть замечания', cls: 'bg-warning/10 text-warning-strong' }
              : { label: 'Нет', cls: 'bg-success/10 text-success-strong' },
      rows: [
        { caption: BLOCKER_COUNT_LABEL.critical, value: String(blockerTones.critical) },
        ...(blockerTones.attention > 0 ? [{ caption: BLOCKER_COUNT_LABEL.attention, value: String(blockerTones.attention) }] : []),
        ...(blockerTones.info > 0 ? [{ caption: BLOCKER_COUNT_LABEL.info, value: String(blockerTones.info) }] : []),
        { caption: 'Обычные', value: String(facts?.findings ?? presentation.warnings.length) },
      ],
      view: 'maintenance',
    },
    {
      key: 'maintenance',
      label: 'Обслуживание ТО',
      icon: Wrench,
      pill: maintenanceStage?.state === 'pass'
        ? { label: 'Актуально', cls: 'bg-success/10 text-success-strong' }
        : { label: 'Требует внимания', cls: 'bg-warning/10 text-warning-strong' },
      rows: [
        {
          caption: 'Ближайшее ТО',
          value: hoursLeft != null
            ? hoursLeft > 0 ? `через ${hoursLeft.toLocaleString('ru-RU')} м/ч` : `перепробег ${Math.abs(hoursLeft).toLocaleString('ru-RU')} м/ч`
            : detail ? 'регламент не задан' : 'нет данных',
        },
        {
          caption: 'Плановое ТО',
          value: daysLeft != null
            ? daysLeft > 0 ? `через ${daysLeft} дн.` : `просрочено на ${Math.abs(daysLeft)} дн.`
            : 'дата не задана',
        },
      ],
      view: 'maintenance',
    },
  ];
}

/** Одно событие ленты передачи. Вынесено, чтобы список и раскрытие «полного
 *  журнала» рисовали строку одинаково, а не двумя копиями разметки. */
function HandoverEvent({ event, latest, timezone }: {
  event: HandoverJournalEvent;
  latest: boolean;
  timezone: string | undefined;
}) {
  const EventIcon = HANDOVER_ICON[event.kind];
  const pill = HANDOVER_PILL[event.kind];
  return (
    <li className="relative">
      {/* Кружок с иконкой вместо безымянной точки: тип события читается,
          не доходя до подписи. */}
      <span className={cn('absolute -left-[35px] top-0 grid h-[18px] w-[18px] place-items-center rounded-full border bg-card',
        latest ? 'border-signal text-signal-strong' : event.kind === 'REWORKED' ? 'border-warning text-warning-strong' : 'border-border text-muted-foreground')}>
        <EventIcon className="h-2.5 w-2.5" />
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-xs font-semibold">{event.label}</div>
        <div className="flex shrink-0 items-center gap-1">
          {/* Самоприёмку показываем видимой меткой: разрешена, но «кто
              проверил» — вопрос для разбора, и в аудите он лежал незаметно. */}
          {event.selfAccepted && (
            <span className="rounded border border-warning bg-warning/10 px-1.5 py-0.5 text-3xs font-semibold text-warning-strong">
              Самоприёмка
            </span>
          )}
          <span className={cn('rounded border px-1.5 py-0.5 text-3xs font-semibold', pill.cls)}>
            {pill.label}
          </span>
        </div>
      </div>
      <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">
        {formatDateTimeInTimezone(event.occurredAt, timezone)}
        {event.actorName ? ` · ${event.actorName}` : ''}
        {handoverRoleLabel(event.actorRole) ? ` (${handoverRoleLabel(event.actorRole)})` : ''}
        {event.selfAccepted ? ' · принято тем же, кто сдал' : ''}
        {` · пакет v${event.packageVersion}`}
      </div>
      {event.comment && (
        <p className="mt-1 rounded border border-border bg-muted/40 p-2 text-2xs leading-relaxed">{event.comment}</p>
      )}
    </li>
  );
}

export function ReadinessCentre(props: ReferenceUiProps) {
  const selected = props.equipment.find((item) => item.id === props.selectedId) ?? props.equipment[0];
  if (!selected) {
    return (
      <div className="grid min-h-[420px] place-items-center px-4 text-center">
        <div className="max-w-md">
          <HardHat className="mx-auto h-9 w-9 text-muted-foreground" />
          <h1 className="mt-3 text-lg font-bold">Установки не найдены</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Добавьте установку в модуле «Оборудование» или повторите загрузку, если данные появились недавно.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline"><Link href="/admin/equipment">Открыть оборудование</Link></Button>
            <Button type="button" onClick={props.onRetry}>Повторить</Button>
          </div>
        </div>
      </div>
    );
  }
  const authoritativeCurrent = props.currentReadiness.find((item) => item.equipmentId === selected.id) ?? null;
  const presentation = props.authoritativeReadinessError
    ? buildUnavailableReadinessPresentation(authoritativeCurrent)
    : buildAuthoritativeReadinessPresentation(authoritativeCurrent);
  const detail = props.details[selected.id];
  const fleetCard = props.fleetCards.find((item) => item.id === selected.id);
  const handoverJournal = buildHandoverJournal(props.shifts, selected.id, props.bootstrap?.selectors.actors);
  /**
   * Установки, чью смену ждут принять.
   *
   * Состояние HANDOVER_PENDING — это и есть «сдано, ждём приёмки»; тем же
   * признаком пользуется экран смен. Порядок — как в списке техники, чтобы
   * очередь и парк читались одинаково.
   */
  const awaitingAcceptance = props.equipment.filter((item) => props.shifts.some(
    (shift) => shift.equipmentId === item.id && shift.state === 'HANDOVER_PENDING',
  ));

  // Ссылку на осмотр берём готовой из доказательства: presentation уже сделал
  // её зависимой от источника — журнал ЕО/ТО открывается, а у предсменного
  // чек-листа машиниста своей страницы нет, поэтому ссылки нет. Раньше здесь
  // бралась сырая `reference` (inspectionId) и подставлялась в /inspections/{id};
  // для чек-листа машиниста это чужой тип сущности — открывался 404.
  const inspectionHref = presentation.evidence.find((item) => item.key === 'inspection')?.links?.[0]?.href ?? null;
  // Карточка установки — админский экран: роли без `equipment.read` он закрыт,
  // и ссылка на него привела бы на «Нет доступа».
  const mayOpenEquipmentCard = props.bootstrap?.capabilities.entities.equipment.read ?? false;
  /**
   * Куда ведёт шаг чек-листа. Осмотр и моточасы живут в других модулях,
   * остальные шаги — вкладки этого же контура. Раньше строки показывали
   * шеврон, но не открывали ничего.
   */
  const stageTargets: Record<PresentationStage['key'], {href?: string; view?: ReferenceView}> = {
    INSPECTION: {href: inspectionHref ?? '/inspections'},
    // Карточка установки открыта не всем: у роли без `equipment.read` ссылка
    // ведёт на «Нет доступа». Такому зрителю моточасы объясняем словами.
    ENGINE_HOURS: mayOpenEquipmentCard ? {href: `/admin/equipment/${selected.id}`} : {},
    PERMIT: {view: 'permits'},
    MAINTENANCE: {view: 'maintenance'},
    ACCEPTANCE: {view: 'shifts'},
  };
  const blockers = presentation.blockers.length;
  const warnings = presentation.warnings.length;
  // Счёт по исходу, а не «все блокеры критические»: возврат оператору и
  // подтверждение — не критический дефект, красным красится только запрет пуска.
  const blockerTones = countBlockersByTone(presentation.blockers);
  const facts = presentation.mode === 'inactive' ? null : authoritativeCurrent?.facts ?? null;
  const doneStages = presentation.stages.filter((stage) => stage.state === 'pass').length;
  const stageProgress = Math.round((doneStages / presentation.stages.length) * 100);
  /**
   * Первый незакрытый шаг задаёт и подпись, и адрес кнопки «следующее
   * действие». Раньше кнопка при любом состоянии вела на /admin/to — то есть
   * на страницу, где пользователь уже стоит.
   */
  const nextStage = presentation.stages.find((stage) => stage.state !== 'pass') ?? null;
  const nextTarget = nextStage ? stageTargets[nextStage.key] : null;
  const stageOwner = nextStage ? STAGE_OWNER[nextStage.key] : null;
  const metricTiles = buildReadinessMetricTiles(
    facts, presentation, selected.id, selected.engineHoursTotal, detail, inspectionHref, mayOpenEquipmentCard,
  );
  // Открытые заявки по выбранной установке — вход для счётчика механика.
  // `undefined` (журнал не загружен) — это не ноль: шаг «нет данных».
  const journalRecords = props.journals[selected.id];
  const openMaintenanceCount = journalRecords === undefined ? null : journalRecords.filter(isOpenRecord).length;
  const roleProgress = buildRoleFlowProgress(
    presentation,
    facts,
    openMaintenanceCount,
    props.rulesState.publishedInDb,
  );
  /*
    ДОПУСК И ХОД ПРОЦЕДУРЫ — РАЗНЫЕ УТВЕРЖДЕНИЯ.

    «Готова к работе» — это вердикт по действующим правилам: ничто из
    включённых условий пуск не запретило. Это НЕ значит, что процедура
    пройдена. Рядом на экране стояли «Осмотр не завершён · 50%», «Приёмка не
    подтверждена» и «Процесс остановился на шаге Осмотр» — и зелёная плашка
    читалась как опровержение этих строк. На деле они верны все сразу:
    правило «осмотр ниже 80%» в опубликованном наборе выключено, а условия
    на неподтверждённую приёмку нет вовсе, поэтому незакрытые шаги вердикт
    не ухудшают.

    Считаем незакрытые шаги из того же снимка, что и вердикт, — цепочка и
    плашка приходят из одних фактов, расхождения во времени между ними нет.
  */
  const startAllowed = presentation.outcome === 'READY' || presentation.outcome === 'READY_WITH_WARNING';
  /*
    ОДНО СЛЕДУЮЩЕЕ ДЕЙСТВИЕ, А НЕ ДВА РАЗНЫХ.
    В блоке «Следующее действие» стояло «Авторитетная оценка подтверждает
    готовность к работе» — это вообще не действие, — а кнопка под ним вела
    на осмотр. Пока критических замечаний нет, но в цепочке есть незакрытый
    шаг, действие ровно одно: закрыть этот шаг. Есть блокер — он и есть
    действие, его подпись перебивает всё остальное.
  */
  const pendingStages = presentation.stages.filter((stage) => stage.state !== 'pass');
  const pendingSummary = pendingStages.map((stage) => `${stage.label} — ${stage.value.toLowerCase()}`).join('; ');
  const topBlocker = presentation.blockers[0] ?? null;
  /*
    Блокер блокеру не равен: запрет пуска (`DENY_START`), возврат оператору
    (`RETURN_TO_OPERATOR`) и «нужно подтверждение» (`REQUIRE_CONFIRMATION`) —
    разные исходы. Раньше любой из них звался «критическим замечанием» и
    красился красным, и подпись правила «нет осмотра за сегодня» читалась как
    критический дефект. Тон берём из действия блокера.
  */
  const topTone = topBlocker ? BLOCKER_TONE_CLASS[blockerTone(topBlocker.action)] : null;
  /*
    Кто снимает причину и куда идти. Доменный `actionLabel` («Вернуть
    оператору») — команда системе, а не адрес для человека; маршрутизация
    «кто/куда» уже описана в blocker-guidance и до сих пор жила только в
    «Отчётах». Показываем её рядом с причиной; кнопка перехода ведёт на ту же
    вкладку, но только если вкладка доступна роли (полоса вкладок фильтруется
    по тем же capabilities.screens — иначе обещали бы переход в никуда).
  */
  const topGuidance = topBlocker ? blockerGuidance(topBlocker) : null;
  const guidanceView = topGuidance?.view ?? null;
  const guidanceAvailable = guidanceView != null
    && props.bootstrap?.capabilities.screens[guidanceView] !== false;
  const hasBlockingDeny = presentation.blockers.some((notice) => blockerTone(notice.action) === 'critical');
  const recommendation = blockers > 0
    ? hasBlockingDeny
      ? 'Рекомендация: устранить блокирующие условия для допуска к работе.'
      : 'Рекомендация: закрыть условие допуска — требуется действие ответственного.'
    : warnings > 0
      ? 'Рекомендация: закрыть замечания до начала смены.'
      : presentation.status === 'READY'
        ? pendingStages.length > 0
          ? `Рекомендация: пуск правилами не запрещён, но процедура не завершена — ${pendingSummary}.`
          : 'Рекомендация: установка допущена к работе.'
        : 'Рекомендация: выполнить авторитетную оценку готовности.';

  return (
    <div>
      {/*
        Пропорции взяты с утверждённой визуализации: 0.9 / 1.45 / 1, то есть
        27% / 43% / 30%. Было 300px / 1fr / 320px — фиксированные бока отдавали
        центру весь избыток ширины, и на большом мониторе он раздувался, а
        карточка установки и журнал передач оставались зажатыми.

        Именно доли, а не фиксированные ширины: под сетку идёт не вся страница,
        слева рельс навигации (на 1280px остаётся 977px). При жёстких 360+400
        центр схлопывался до 193px. Доли держат соотношение макета на любой
        ширине и нигде не давят середину.

        Колонки — flex-контейнеры, последняя карточка в каждой тянется, поэтому
        все три заканчиваются на одной линии.
      */}
      <div className="grid min-h-0 grid-cols-1 items-stretch gap-3 py-3 md:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className={cn(card, 'flex flex-col overflow-hidden')}>
        <div className="border-b border-border p-4">
          <div className={cn(muted, 'text-2xs')}>Выбранная установка</div>
          <div className="mt-3 flex gap-3">
            <EquipmentPhoto cardData={fleetCard} name={selected.name} className="h-24 w-24 shrink-0" priority />
            <div className="min-w-0">
              <h2 className="break-words text-xl font-extrabold">
                <Link href={`/admin/equipment/${selected.id}`} className="hover:text-signal-strong hover:underline">{selected.name}</Link>
              </h2>
              <div className="mt-2 text-2xs text-muted-foreground">Заводской №</div>
              <div className="text-xs font-semibold">{detail?.equipment?.serialNumber || '—'}</div>
              <div className="mt-1 text-2xs text-muted-foreground">Место базирования</div>
              <div className="text-xs font-semibold">{detail?.crew?.site?.name
                ? <Link href="/admin/sites" className="hit-target hover:text-signal-strong hover:underline">{detail.crew.site.name}</Link>
                : 'Не назначено'}</div>
              <div className="mt-1 text-2xs text-muted-foreground">Наработка</div>
              <div className="text-xs font-semibold">{selected.engineHoursTotal != null ? `${selected.engineHoursTotal.toLocaleString('ru-RU')} м/ч` : '—'}</div>
            </div>
          </div>
        </div>
        <div className="border-b border-border p-4">
          <div className="text-2xs text-muted-foreground">Статус готовности</div>
          {/*
            Статус — плашка, а не мелкий чип: это первое, что должен увидеть
            диспетчер, и рядом обязан стоять балл, иначе «Требует внимания»
            ничем не отличается от «Заблокировано».
          */}
          {/*
            Четыре исхода вместо двух. Раньше «готова с замечанием» красилась
            зелёным наравне с чистой готовностью — замечание было некому
            заметить, — а «требуется подтверждение диспетчера» показывалось
            тем же красным, что и «эксплуатация запрещена».
          */}
          <div className={cn(
            'mt-2 flex items-start gap-2.5 rounded-lg border p-3',
            presentation.outcome === 'READY' && 'border-success/30 bg-success/10',
            presentation.outcome === 'READY_WITH_WARNING' && 'border-warning/30 bg-warning/10',
            presentation.outcome === 'ATTENTION' && 'border-info/30 bg-info/10',
            presentation.outcome === 'BLOCKED' && 'border-destructive/30 bg-destructive/10',
            presentation.outcome === 'UNCONFIRMED' && 'border-warning/30 bg-warning/10',
          )}>
            {presentation.outcome === 'READY'
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success-strong" />
              : <AlertTriangle className={cn('h-5 w-5 shrink-0',
                  presentation.outcome === 'BLOCKED' ? 'text-destructive-strong'
                    : presentation.outcome === 'ATTENTION' ? 'text-info-strong' : 'text-warning-strong')} />}
            <div className="min-w-0">
              <div className="text-sm font-bold">{presentation.title}</div>
              <div className="mt-0.5 text-2xs text-muted-foreground">
                {/*
                  «Готовность подтверждена на 66%» звучало как достоверность
                  вывода. Это взвешенный балл по пяти критериям, и назвать
                  его надо тем, что он есть.
                */}
                {presentation.score != null
                  ? `Балл готовности ${presentation.score} из 100`
                  : 'Авторитетной оценки ещё нет'}
              </div>
              <div className="mt-0.5 text-2xs leading-relaxed text-muted-foreground">
                Взвешенная оценка состояния узлов. Пуск разрешают не баллы, а блокирующие правила.
              </div>
            </div>
          </div>
          {/*
            Оговорка стоит вплотную к вердикту, а не в цепочке ниже: именно
            рядом зелёная плашка и читалась как «всё сделано».
          */}
          {startAllowed && pendingStages.length > 0 && (
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-2xs leading-relaxed text-foreground">
              <span className="font-semibold">Процедура не завершена:</span> {pendingSummary}.{' '}
              <span className="text-muted-foreground">Действующие правила пуск этим не ограничивают — вердикт выше относится к запрету, а не к полноте процедуры.</span>
            </p>
          )}
          <div className="mt-3 rounded-lg border border-signal bg-signal/10 p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-2xs text-muted-foreground">Следующее действие</div>
                <div className="mt-2 font-bold">
                  {blockers === 0 && nextStage ? `Завершить шаг «${nextStage.label}»` : presentation.nextAction}
                </div>
                {/* 14px на телефоне — норма служебного текста (QA F-MOB-READINESS-TEXT); на компьютере размер прежний. */}
                <p className="mt-1 text-sm sm:text-xs leading-relaxed text-muted-foreground">
                  {props.authoritativeReadinessError
                    ?? (blockers === 0 && nextStage
                      ? `${nextStage.value}. Ход за: ${stageOwner ?? 'не назначен'}.`
                      : presentation.description)}
                </p>
              </div>
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-signal text-white">
                <ClipboardCheck className="h-7 w-7" />
              </span>
            </div>
            {nextStage && (nextTarget?.href || nextTarget?.view) ? (
              nextTarget.href ? (
                <Button asChild className="mt-3 h-10 w-full bg-signal text-white hover:bg-signal-strong">
                  <Link href={nextTarget.href}>
                    {STAGE_CTA[nextStage.key]} <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              ) : (
                <Button
                  type="button"
                  className="mt-3 h-10 w-full bg-signal text-white hover:bg-signal-strong"
                  onClick={() => nextTarget.view && props.onViewChange(nextTarget.view)}
                >
                  {STAGE_CTA[nextStage.key]} <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              )
            ) : nextStage ? (
              <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                {nextStage.key === 'ENGINE_HOURS' ? ENGINE_HOURS_NOTE : presentation.nextAction}
              </p>
            ) : (
              <p className="mt-3 rounded-md bg-success/10 px-3 py-2 text-xs font-semibold text-success-strong">
                Все шаги контура закрыты
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <h3 className="flex items-center gap-2 font-bold"><ClipboardCheck className="h-4 w-4 text-muted-foreground" />Чек-лист смены (5 шагов)</h3>
          <div className="mt-3 divide-y divide-border">
            {presentation.stages.map((stage, index) => {
              const target = stageTargets[stage.key];
              const current = nextStage?.key === stage.key;
              // Шаг без адреса — не ссылка и не кнопка: например, моточасы у роли
              // без `equipment.read`. Строку показываем, но переходить некуда.
              const navigable = Boolean(target.href || target.view);
              const body = (
                <>
                  {/*
                    Цветом залито только выполненное. Текущий шаг обведён
                    оранжевым, но не залит, остальные — серый контур. Раньше
                    заливку получали все состояния кроме «нет данных», и пять
                    цветных кружков подряд читались как пять сделанных шагов.
                  */}
                  <span className={cn(
                    'grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 text-xs font-bold',
                    stage.state === 'pass'
                      ? 'border-success bg-success-strong text-white'
                      : current
                        ? 'border-signal bg-card text-signal-strong'
                        : 'border-border bg-card text-muted-foreground',
                  )}>{index + 1}</span>
                  <div className="min-w-0 flex-1 text-left">
                    <div className="text-xs font-semibold">{stage.label}</div>
                    <div
                      title={stage.value}
                      className="line-clamp-2 break-words text-2xs text-muted-foreground"
                    >
                      {stage.value}
                    </div>
                    {!navigable && stage.key === 'ENGINE_HOURS' && (
                      <div className="text-2xs text-muted-foreground">{ENGINE_HOURS_NOTE}</div>
                    )}
                  </div>
                  <span className={cn('shrink-0 rounded px-2 py-1 text-2xs font-semibold', STAGE_PILL[stage.state].cls)}>
                    {STAGE_PILL[stage.state].label}
                  </span>
                  {navigable && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
                </>
              );
              const shared = 'flex w-full min-h-11 items-center gap-3 py-2.5 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
              return navigable
                ? target.href
                  ? <Link key={stage.key} href={target.href} className={shared} aria-label={`${stage.label}: открыть`}>{body}</Link>
                  : <button key={stage.key} type="button" onClick={() => target.view && props.onViewChange(target.view)} className={shared} aria-label={`${stage.label}: открыть`}>{body}</button>
                : <div key={stage.key} className="flex w-full min-h-11 items-center gap-3 py-2.5 text-left">{body}</div>;
            })}
          </div>
          {/*
            Сколько контура пройдено — одной полосой. До этого пять пилюль
            приходилось пересчитывать глазами, чтобы понять, далеко ли до смены.
          */}
          <div className="mt-auto pt-4">
            {/*
              «Готовность чек-листа смены» стояла рядом с баллом готовности и
              читалась как второй балл: совпадение «3 из 5 · 60 %» с баллом
              случайно. Здесь доля процедуры, а не оценка узлов, и подпись
              говорит, что это именно этапы предсменного контроля.
            */}
            <div className="text-2xs font-semibold">Пройдено шагов процедуры</div>
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={stageProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Пройдено шагов процедуры"
            >
              <div
                className={cn('h-full rounded-full', stageProgress === 100 ? 'bg-success-strong' : 'bg-signal')}
                style={{ width: `${stageProgress}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-2xs text-muted-foreground">
              <span>Выполнено {doneStages} из {presentation.stages.length} шагов</span>
              <span className="font-semibold tabular-nums">{stageProgress}%</span>
            </div>
            {/* 14px на телефоне — норма служебного текста (QA F-MOB-READINESS-TEXT); на компьютере размер прежний. */}
            <p className="mt-1 text-sm sm:text-2xs leading-relaxed text-muted-foreground">
              Сколько этапов предсменного контроля уже пройдено. Это не балл готовности.
            </p>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <section className={cn(card, 'p-5')}>
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-muted-foreground" />Готовность к работе (доказательная)</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4 sm:gap-8">
                <ReadinessRing value={presentation.score} />
                <div>
                  <div className="text-xs text-muted-foreground">Балл готовности</div>
                  <div className="mt-1 font-mono text-2xl font-bold">{presentation.score ?? '—'} <span className="text-sm font-normal text-muted-foreground">/100</span></div>
                  {/* 14px на телефоне — норма служебного текста (QA F-MOB-READINESS-TEXT); на компьютере размер прежний. */}
                  <p className="mt-1 text-sm sm:text-2xs leading-relaxed text-muted-foreground">
                    Взвешенная оценка состояния узлов. Пуск разрешают не баллы, а блокирующие правила.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    <span>Критические блокеры <b className={cn('ml-1 rounded px-1.5 py-0.5', BLOCKER_COUNT_CLASS.critical)}>{blockerTones.critical}</b></span>
                    {blockerTones.attention > 0 && <span>{BLOCKER_COUNT_LABEL.attention} <b className={cn('ml-1 rounded px-1.5 py-0.5', BLOCKER_COUNT_CLASS.attention)}>{blockerTones.attention}</b></span>}
                    {blockerTones.info > 0 && <span>{BLOCKER_COUNT_LABEL.info} <b className={cn('ml-1 rounded px-1.5 py-0.5', BLOCKER_COUNT_CLASS.info)}>{blockerTones.info}</b></span>}
                    <span>Замечания <b className="ml-1 rounded bg-signal/10 px-1.5 py-0.5 text-signal-strong">{warnings}</b></span>
                  </div>
                </div>
              </div>
            </div>
            <div className="text-left text-xs text-muted-foreground sm:text-right">
              <div>Последнее обновление</div>
              <div className="mt-2 font-semibold text-muted-foreground">{presentation.calculatedAt ? formatDateTimeInTimezone(presentation.calculatedAt, props.bootstrap?.tenant.timezone) : 'Авторитетного снимка нет'}</div>
              <Button variant="outline" className="mt-3 h-9" onClick={() => props.onViewChange('reports')}><History className="mr-2 h-4 w-4" />История оценок</Button>
            </div>
          </div>
          {/*
            Первой строкой — что делать, второй мелким — на чём основано.
            Раньше здесь стояла только техническая справка о версии правил:
            вердикт есть, а указания к действию нет.
          */}
          <div className="mt-4 border-t border-border pt-3">
            <p className="text-xs font-semibold text-foreground">{recommendation}</p>
            <p className="mt-1 text-2xs text-muted-foreground">
              {presentation.ruleSetVersion === 'unpublished'
                ? 'Правила готовности ещё не опубликованы. '
                : presentation.ruleSetVersion ? `Правила ${presentation.ruleSetVersion}. ` : ''}{presentation.title}. {presentation.calculatedAt ? `Авторитетный снимок от ${formatDateTimeInTimezone(presentation.calculatedAt, props.bootstrap?.tenant.timezone)}.` : presentation.description}
            </p>
          </div>
        </section>
        <section className={cn(card, 'flex flex-1 flex-col overflow-hidden')}>
          <div className="p-4">
            <h2 className="flex items-center gap-2 font-bold"><History className="h-4 w-4 text-muted-foreground" />Цепочка состояния</h2>
            {/*
              Пять равных колонок: центры кружков стоят на 10 / 30 / 50 / 70 /
              90 % ширины, поэтому шаги распределены строго равномерно, а линия
              и стрелки ложатся ровно между ними. Раньше соединитель лежал
              ВНУТРИ ячейки шага и растягивался своим flex-1: ширины выходили
              разными, а вертикальный центр считался по всей ячейке вместе с
              двухстрочной подписью — линия уезжала и вниз, и вбок.

              Кружок centre-y = padding StageLink (4px) + половина кружка
              (20px) = 24px; на этой отметке и линия, и стрелки.
            */}
            {/* gap-0: с зазором центры ячеек смещаются, и стрелки перестают
                попадать точно в середину между кружками. Подписи не слипаются
                за счёт собственных px-2 внутри StageLink. */}
            <div className="relative mt-4 grid grid-cols-5">
              <div
                aria-hidden
                className="pointer-events-none absolute left-[10%] right-[10%] -translate-y-1/2 border-t-2 border-dashed border-border"
                style={{ top: 24 }}
              />
              {[20, 40, 60, 80].map((left) => (
                <ChevronRight
                  key={left}
                  aria-hidden
                  className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 bg-card text-muted-foreground"
                  style={{ top: 24, left: `${left}%` }}
                />
              ))}
              {presentation.stages.map((stage, index) => {
                const Icon = [Search, Gauge, ShieldCheck, Wrench, User][index] ?? Search;
                // Заливка означает ровно одно — шаг выполнен. Текущий шаг
                // выделен толстой оранжевой обводкой, но НЕ залит: при четырёх
                // закрытых шагах залитая «Приёмка» делала линию сплошь цветной,
                // и невыполненное читалось как сделанное. Правило то же, что в
                // чек-листе смены слева.
                const current = nextStage?.key === stage.key;
                return (
                  <StageLink key={stage.key} target={stageTargets[stage.key]} label={stage.label} onViewChange={props.onViewChange}>
                    <span className={cn(
                      'relative z-10 mx-auto grid h-10 w-10 place-items-center rounded-full border-2 bg-card',
                      stage.state === 'pass'
                        ? 'border-success bg-success-strong text-white'
                        : current
                          ? 'border-signal text-signal-strong'
                          : 'border-border text-muted-foreground',
                    )}>
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className={cn('mt-2 text-2xs', current ? 'font-semibold text-signal-strong' : 'text-muted-foreground')}>{stage.label}</div>
                  </StageLink>
                );
              })}
            </div>
            {/*
              Явная строка «где встал процесс и кто его держит»: по цепочке это
              приходилось вычислять глазами, сопоставляя цвет кружков с ролями
              в нижней ленте.
            */}
            {nextStage ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-signal/30 bg-signal/10 px-3 py-2">
                <span className="text-2xs text-muted-foreground">Процесс остановился на шаге</span>
                <span className="text-xs font-bold">{nextStage.label}</span>
                <span className="text-2xs text-muted-foreground">· ход за</span>
                <span className="rounded bg-signal px-2 py-0.5 text-2xs font-semibold text-white">{stageOwner}</span>
              </div>
            ) : (
              <div className="mt-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-2xs font-semibold text-success-strong">
                Все шаги контура закрыты — установка готова к работе
              </div>
            )}
          </div>
          <div className="border-t border-border p-4">
            <h3 className="flex items-center gap-2 font-bold"><AlertTriangle className={cn('h-4 w-4', topTone?.icon ?? 'text-muted-foreground')} />Что держит допуск</h3>
            <div className={cn('mt-3 flex items-center gap-3 rounded-lg border p-3', topTone?.box ?? 'border-border bg-muted')}>
              <AlertTriangle className={cn('h-7 w-7', topTone?.icon ?? 'text-muted-foreground')} />
              <div className="flex-1">
                <div className="font-semibold">{topBlocker?.label ?? (presentation.status === 'UNCONFIRMED' ? presentation.title : 'Ничего не держит допуск')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{topBlocker?.actionLabel ?? presentation.description}</div>
                {/* Карта интерфейса: кто отвечает за снятие и на каком экране это делается. */}
                {topGuidance && (
                  <div className="mt-1 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
                    <span>Снимает</span>
                    <span className="font-semibold text-foreground">{topGuidance.who}</span>
                    <span aria-hidden>·</span>
                    <span>{topGuidance.where}</span>
                  </div>
                )}
              </div>
              <span className={cn('rounded border px-2 py-1 text-xs', topTone?.badge ?? 'border-border text-muted-foreground')}>{topBlocker ? BLOCKER_TONE_LABEL[blockerTone(topBlocker.action)] : 'Нет блокеров'}</span>
            </div>
            {guidanceAvailable && (
              <Button
                type="button"
                variant="outline"
                className="mt-2 h-9 w-full"
                onClick={() => guidanceView && props.onViewChange(guidanceView)}
              >
                Перейти к снятию <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            )}
          </div>
          <div className="flex flex-1 flex-col border-t border-border p-4">
            <h3 className="flex items-center gap-2 font-bold"><FileText className="h-4 w-4 text-muted-foreground" />Доказательства готовности</h3>
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 2xl:grid-cols-4">
              {metricTiles.map((tile) => {
                const TileIcon = tile.icon;
                return (
                  <div key={tile.key} className="flex flex-col rounded-lg border border-border p-3">
                    <div className="flex items-center gap-2">
                      <TileIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-xs font-semibold">{tile.label}</span>
                    </div>
                    <span className={cn('mt-2 self-start rounded px-2 py-1 text-2xs font-semibold', tile.pill.cls)}>
                      {tile.pill.label}
                    </span>
                    <dl className="mt-3 flex-1 space-y-1.5">
                      {tile.rows.map((row) => (
                        <div key={row.caption}>
                          <dt className="text-2xs text-muted-foreground">{row.caption}</dt>
                          <dd className="text-xs font-semibold">{row.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {tile.href ? (
                      <Button asChild variant="outline" className="mt-3 h-9 w-full">
                        <Link href={tile.href}><ArrowRight className="h-4 w-4" />Открыть</Link>
                      </Button>
                    ) : tile.view ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3 h-9 w-full"
                        onClick={() => tile.view && props.onViewChange(tile.view)}
                      >
                        <ArrowRight className="h-4 w-4" />Открыть
                      </Button>
                    ) : tile.note ? (
                      <p className="mt-3 text-2xs leading-relaxed text-muted-foreground">{tile.note}</p>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {/*
              Сами идентификаторы решения остаются доступны, но убраны под
              раскрытие: в развёрнутом виде это была стена из «Заявка 1…7»,
              которая перебивала показатели. Аудитору они по-прежнему нужны —
              это единственный способ проверить, на чём построен вердикт.
            */}
            <details className="mt-auto rounded-lg border border-border">
              <summary className="hit-target cursor-pointer px-3 py-2 text-xs font-semibold text-signal-strong">
                Смотреть всё — первоисточники решения
              </summary>
              <div className="space-y-2 border-t border-border p-3">
                {presentation.evidence.map((evidence) => (
                  <div key={evidence.key} className="flex flex-wrap items-baseline gap-x-3 gap-y-2">
                    <span className="text-2xs font-semibold">{evidence.label}:</span>
                    <span className="text-2xs text-muted-foreground">
                      {evidenceMetric(evidence, presentation.stages, props.bootstrap?.tenant.timezone)}
                    </span>
                    {evidence.links?.map((link) => (
                      <Link key={link.href} href={link.href} className="hit-target inline-flex items-center gap-1 text-2xs font-semibold text-signal-strong hover:underline">
                        {link.text}<ArrowRight className="h-3 w-3" />
                      </Link>
                    ))}
                  </div>
                ))}
                {presentation.evidence.length === 0 && (
                  <p className="text-2xs text-signal-strong">{presentation.title}</p>
                )}
              </div>
            </details>
          </div>
        </section>
      </div>

      <aside className="flex flex-col gap-3 md:col-span-2 xl:col-span-1">
        <section className={cn(card, 'p-4')}>
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold"><Send className="h-4 w-4 text-muted-foreground" />Передача и приёмка</h2><span className="text-2xs text-muted-foreground">неизменяемый журнал</span></div>
          {handoverJournal.length === 0 ? (
            <p className="mt-3 rounded-lg border border-border p-3 text-2xs leading-relaxed text-muted-foreground">
              По этой установке ещё не было передач смены. Записи появятся, когда оператор передаст смену диспетчеру.
            </p>
          ) : (
            <ol className="mt-4 space-y-5 border-l border-border pl-6">
              {handoverJournal.slice(0, HANDOVER_PREVIEW).map((event, index) => (
                <HandoverEvent
                  key={event.id}
                  event={event}
                  latest={index === 0}
                  timezone={props.bootstrap?.tenant.timezone}
                />
              ))}
            </ol>
          )}
          {/*
            Полный журнал раскрывается на месте — так же, как первоисточники
            решения в «Доказательствах». Раньше кнопка уводила на вкладку
            «Отчёты», где журнала передач по этой установке нет вовсе.
          */}
          {handoverJournal.length > HANDOVER_PREVIEW && (
            <details className="mt-4 rounded-lg border border-border">
              <summary className="hit-target cursor-pointer px-3 py-2 text-xs font-semibold text-signal-strong">
                Открыть полный журнал — ещё {handoverJournal.length - HANDOVER_PREVIEW}
              </summary>
              <ol className="ml-6 space-y-5 border-l border-border py-3 pl-6 pr-3">
                {handoverJournal.slice(HANDOVER_PREVIEW).map((event) => (
                  <HandoverEvent
                    key={event.id}
                    event={event}
                    latest={false}
                    timezone={props.bootstrap?.tenant.timezone}
                  />
                ))}
              </ol>
            </details>
          )}
        </section>
        <section className={cn(card, 'flex flex-1 flex-col p-4')}>
          {/*
            Входящие — это установки, чью смену действительно ждут принять,
            а не первые три из парка. Панель показывала срез списка техники и
            подписывала его числом всех машин: диспетчер видел «входящих 12»
            при пустой очереди и три карточки, которые к передаче отношения не
            имели. Очередь определяется состоянием смены HANDOVER_PENDING —
            тем же, по которому её строит экран смен.
          */}
          <div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-bold"><AlertCircle className="h-4 w-4 text-muted-foreground" />Входящие (диспетчер)</h2><span className="text-xs text-muted-foreground">{awaitingAcceptance.length}</span></div>
          <div className="mt-3 space-y-3">
            {awaitingAcceptance.length === 0 && (
              <p className="text-xs text-muted-foreground">Ничего не ждёт приёмки.</p>
            )}
            {awaitingAcceptance.slice(0, 3).map((item) => {
              const itemSnapshot = props.currentReadiness.find((entry) => entry.equipmentId === item.id) ?? null;
              const itemPresentation = props.authoritativeReadinessError
                ? buildUnavailableReadinessPresentation(itemSnapshot)
                : buildAuthoritativeReadinessPresentation(itemSnapshot);
              const itemFleet = props.fleetCards.find((cardItem) => cardItem.id === item.id);
              const active = item.id === selected.id;
              // Время последней передачи по этой установке — «когда упало во входящие».
              const lastSubmitted = buildHandoverJournal(props.shifts, item.id, props.bootstrap?.selectors.actors)
                .find((event) => event.kind === 'SUBMITTED');
              const statusPill = itemPresentation.outcome === 'READY'
                ? { label: 'Готова к приёмке', cls: 'border-success/30 bg-success/10 text-success-strong' }
                : itemPresentation.outcome === 'READY_WITH_WARNING'
                  ? { label: 'Готова с замечанием', cls: 'border-warning/30 bg-warning/10 text-warning-strong' }
                  : itemPresentation.outcome === 'BLOCKED'
                    ? { label: 'Заблокирована', cls: 'border-destructive/30 bg-destructive/10 text-destructive-strong' }
                    : itemPresentation.outcome === 'ATTENTION'
                      ? { label: 'Требует решения', cls: 'border-info/30 bg-info/10 text-info-strong' }
                      : { label: 'Требует внимания', cls: 'border-warning/30 bg-warning/10 text-warning-strong' };
              return (
                <div key={item.id} className={cn('rounded-lg border p-3', active ? 'border-signal bg-signal/5' : 'border-border')}>
                  <button
                    type="button"
                    onClick={() => props.onSelect(item.id)}
                    className="flex w-full gap-3 text-left"
                    aria-label={`${item.name}: открыть карточку готовности`}
                  >
                    <EquipmentPhoto cardData={itemFleet} name={item.name} className="h-12 w-12 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="truncate text-xs font-bold">{item.name}</div>
                        {lastSubmitted && (
                          <span className="shrink-0 text-3xs text-muted-foreground">
                            {formatDateTimeInTimezone(lastSubmitted.occurredAt, props.bootstrap?.tenant.timezone)}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-2xs text-muted-foreground">{props.details[item.id]?.crew?.site?.name || 'Объект не назначен'}</div>
                      <span className={cn('mt-2 inline-block rounded border px-2 py-0.5 text-2xs font-semibold', statusPill.cls)}>
                        {statusPill.label}
                      </span>
                    </div>
                  </button>
                  {/*
                    Приёмка и возврат на доработку живут на вкладке «Смены» —
                    здесь кнопки ведут туда с уже выбранной установкой, а не
                    имитируют действие на месте.
                  */}
                  {active && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        className="h-9 flex-1 bg-signal text-white hover:bg-signal-strong"
                        onClick={() => props.onViewChange('shifts')}
                      >
                        <CheckCircle2 className="h-4 w-4" />Принять и назначить
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 flex-1"
                        onClick={() => props.onViewChange('shifts')}
                      >
                        <AlertCircle className="h-4 w-4" />Запросить доработки
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => props.onViewChange('shifts')} className="hit-target mt-auto flex items-center gap-1 pt-3 text-left text-xs font-semibold text-signal-strong">
            Открыть все входящие<ChevronRight className="h-4 w-4" />
          </button>
        </section>
        </aside>
      </div>
      <RoleFlowFooter progress={roleProgress} owner={stageOwner} onViewChange={props.onViewChange} abilities={props.bootstrap?.capabilities.abilities ?? []} />
    </div>
  );
}

/**
 * Что показать в карточке доказательства. `reference` — это внутренний
 * идентификатор записи; сам по себе он диспетчеру ничего не говорит, поэтому
 * на видном месте стоит состояние соответствующего критерия, а ссылка ниже
 * ведёт к самой записи.
 */
const EVIDENCE_STAGE: Partial<Record<PresentationEvidence['key'], PresentationStage['key']>> = {
  inspection: 'INSPECTION',
  permit: 'PERMIT',
  maintenance: 'MAINTENANCE',
};

function evidenceMetric(
  evidence: PresentationEvidence,
  stages: readonly PresentationStage[],
  timezone: string | undefined,
): string {
  if (evidence.key === 'evaluation') {
    return formatDateTimeInTimezone(evidence.reference, timezone);
  }
  if (evidence.key === 'equipment') return 'Запись справочника техники';
  const stageKey = EVIDENCE_STAGE[evidence.key];
  const stage = stageKey ? stages.find((item) => item.key === stageKey) : undefined;
  if (!stage) return evidence.reference;
  return evidence.key === 'maintenance' && evidence.links
    ? `${stage.value} · записей: ${evidence.links.length}`
    : stage.value;
}
