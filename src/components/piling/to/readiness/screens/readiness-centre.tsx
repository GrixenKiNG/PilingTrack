'use client';

import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Gauge, HardHat, History, Search, Send, ShieldCheck, User, Wrench } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { buildHandoverJournal, handoverRoleLabel, type HandoverEventKind, type HandoverJournalEvent } from '../handover-journal';
import { isOpenRecord } from '../../to-stats';
import type { AuthoritativeReadinessFactsDto, ReadinessShiftDto } from '../api/contracts';
import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation, type AuthoritativeReadinessPresentation, type PresentationEvidence, type PresentationStage } from '../authoritative-presentation';
import { EquipmentPhoto, ReadinessRing, STAGE_CTA, muted } from './shared';
import type { EquipmentDetailSnapshot, ReferenceUiProps, ReferenceView } from './types';

const ROLE_FLOW = [
  {
    label: 'Оператор',
    icon: 'inspection' as const,
    lucide: User,
    tasks: ['Провести осмотр', 'Зафиксировать моточасы', 'Передать диспетчеру'],
    border: 'border-success/25',
    header: 'border-success/25 bg-success/10 text-success-strong',
  },
  {
    label: 'Диспетчер',
    icon: 'dispatcher' as const,
    lucide: User,
    tasks: ['Проверить готовность', 'Принять и назначить технику', 'Открыть смену'],
    border: 'border-info/25',
    header: 'border-info/25 bg-info/10 text-info-strong',
  },
  {
    label: 'Механик',
    icon: 'repair' as const,
    lucide: Wrench,
    tasks: ['Устранить дефекты', 'Провести обслуживание', 'Подтвердить работы'],
    border: 'border-signal/25',
    header: 'border-signal/25 bg-signal/10 text-signal-strong',
  },
  {
    label: 'Администратор',
    icon: 'reports' as const,
    lucide: ShieldCheck,
    tasks: ['Контролировать допуски', 'Настроить правила и чек-листы', 'Анализировать показатели'],
    border: 'border-border',
    header: 'border-border bg-muted text-foreground',
  },
];

export interface RoleFlowProgress {
  done: number;
  total: number;
  state: string;
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
 */
function buildRoleFlowProgress(
  presentation: AuthoritativeReadinessPresentation,
  facts: AuthoritativeReadinessFactsDto | null,
  shift: ReadinessShiftDto | null,
  openMaintenanceCount: number,
  rulesPublished: boolean,
): RoleFlowProgress[] {
  const stageDone = (key: PresentationStage['key']) =>
    presentation.stages.find((stage) => stage.key === key)?.state === 'pass';

  const label = (done: number, total: number) =>
    done === 0 ? 'Ожидает' : done === total ? 'Готово' : 'В работе';

  const operatorDone = presentation.stages.filter((stage) => stage.state === 'pass').length;

  const dispatcher = [
    presentation.mode === 'authoritative',
    Boolean(facts?.accepted),
    shift?.state === 'STARTED' || shift?.state === 'HANDOVER_PENDING' || shift?.state === 'CLOSED',
  ].filter(Boolean).length;

  const mechanic = [
    facts ? !facts.criticalDefect : false,
    stageDone('MAINTENANCE'),
    openMaintenanceCount === 0,
  ].filter(Boolean).length;

  const admin = [
    stageDone('PERMIT'),
    rulesPublished,
    presentation.calculatedAt !== null,
  ].filter(Boolean).length;

  return [
    { done: operatorDone, total: presentation.stages.length, state: label(operatorDone, presentation.stages.length) },
    { done: dispatcher, total: 3, state: label(dispatcher, 3) },
    { done: mechanic, total: 3, state: label(mechanic, 3) },
    { done: admin, total: 3, state: admin === 3 ? 'В мониторинге' : label(admin, 3) },
  ];
}

function RoleFlowFooter({ progress, owner }: { progress: RoleFlowProgress[]; owner: string | null }) {
  return (
    <section aria-label="Роли процесса технической готовности" className="mt-2 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2 2xl:grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] 2xl:gap-0">
      {ROLE_FLOW.map((role, index) => {
        const RoleIcon = role.lucide;
        const roleProgress = progress[index];
        // Роль, на которой стоит процесс: без этой отметки лента показывала
        // четыре равнозначные карточки, и кто именно держит ход — не читалось.
        const holding = owner === role.label;
        return (
          <div key={role.label} className="contents">
            <article className={cn(
              'flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm',
              holding ? 'border-signal ring-2 ring-signal/30' : role.border,
            )}>
              <header className={cn('flex items-center gap-2 border-b px-3 py-1.5', role.header)}>
                <RoleIcon className="h-4 w-4" />
                <h2 className="text-sm font-extrabold">{role.label}</h2>
                {holding && (
                  <span className="ml-auto rounded bg-signal px-2 py-0.5 text-3xs font-bold text-white">
                    Сейчас ход
                  </span>
                )}
              </header>
              <div className="flex flex-1 items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1 space-y-1 text-2xs leading-[1.35] text-muted-foreground">
                  {role.tasks.map((task) => <div key={task} className="flex gap-1.5"><span className="text-muted-foreground">•</span><span>{task}</span></div>)}
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
            </article>
            {index < ROLE_FLOW.length - 1 && <div className="hidden items-center justify-center text-xl text-muted-foreground 2xl:flex">→</div>}
          </div>
        );
      })}
    </section>
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

interface ReadinessMetricTile {
  key: string;
  label: string;
  icon: typeof FileText;
  pill: { label: string; cls: string };
  rows: Array<{ caption: string; value: string }>;
  href?: string;
  view?: ReferenceView;
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
  inspectionId: string | null,
): ReadinessMetricTile[] {
  const inspectionStage = presentation.stages.find((stage) => stage.key === 'INSPECTION');
  const maintenanceStage = presentation.stages.find((stage) => stage.key === 'MAINTENANCE');
  const lastInspection = detail?.latestInspection ?? null;
  // Пункты, а не процент: доля из facts — это флаг «завершён / начат / нет»,
  // по ней нельзя сказать, сколько строк чек-листа реально заполнено.
  const inspectionItems = !lastInspection
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

  return [
    {
      key: 'inspection',
      label: 'Чек-лист осмотра',
      icon: FileText,
      pill: STAGE_PILL[inspectionStage?.state ?? 'unknown'],
      rows: [{ caption: 'Выполнено пунктов', value: inspectionItems }],
      href: inspectionId
        ? `/inspections/${inspectionId}`
        : lastInspection ? `/inspections/${lastInspection.id}` : '/inspections',
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
      href: `/admin/equipment/${equipmentId}`,
    },
    {
      key: 'findings',
      label: 'Замечания и дефекты',
      icon: AlertTriangle,
      pill: presentation.blockers.length > 0
        ? { label: 'Есть', cls: 'bg-destructive/10 text-destructive-strong' }
        : presentation.warnings.length > 0
          ? { label: 'Есть замечания', cls: 'bg-warning/10 text-warning-strong' }
          : { label: 'Нет', cls: 'bg-success/10 text-success-strong' },
      rows: [
        { caption: 'Критические', value: String(presentation.blockers.length) },
        { caption: 'Обычные', value: String(facts?.findings ?? presentation.warnings.length) },
      ],
      view: 'maintenance',
    },
    {
      key: 'maintenance',
      label: 'Обслуживание',
      icon: Wrench,
      pill: maintenanceStage?.state === 'pass'
        ? { label: 'Актуально', cls: 'bg-success/10 text-success-strong' }
        : { label: 'Требует внимания', cls: 'bg-warning/10 text-warning-strong' },
      rows: [
        {
          caption: 'Ближайшее ТО',
          value: hoursLeft != null
            ? hoursLeft > 0 ? `через ${hoursLeft.toLocaleString('ru-RU')} м/ч` : `перепробег ${Math.abs(hoursLeft).toLocaleString('ru-RU')} м/ч`
            : 'регламент не задан',
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
        <span className={cn('shrink-0 rounded border px-1.5 py-0.5 text-3xs font-semibold', pill.cls)}>
          {pill.label}
        </span>
      </div>
      <div className="mt-1 text-2xs leading-relaxed text-muted-foreground">
        {formatDateTimeInTimezone(event.occurredAt, timezone)}
        {event.actorName ? ` · ${event.actorName}` : ''}
        {handoverRoleLabel(event.actorRole) ? ` (${handoverRoleLabel(event.actorRole)})` : ''}
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
  const inspectionEvidenceId = presentation.evidence.find((item) => item.key === 'inspection')?.reference ?? null;
  /**
   * Куда ведёт шаг чек-листа. Осмотр и моточасы живут в других модулях,
   * остальные шаги — вкладки этого же контура. Раньше строки показывали
   * шеврон, но не открывали ничего.
   */
  const stageTargets: Record<PresentationStage['key'], {href?: string; view?: ReferenceView}> = {
    INSPECTION: {href: inspectionEvidenceId ? `/inspections/${inspectionEvidenceId}` : '/inspections'},
    ENGINE_HOURS: {href: `/admin/equipment/${selected.id}`},
    PERMIT: {view: 'permits'},
    MAINTENANCE: {view: 'maintenance'},
    ACCEPTANCE: {view: 'shifts'},
  };
  const blockers = presentation.blockers.length;
  const warnings = presentation.warnings.length;
  const facts = authoritativeCurrent?.facts ?? null;
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
    facts, presentation, selected.id, selected.engineHoursTotal, detail, inspectionEvidenceId,
  );
  // Смена и открытые заявки по выбранной установке — вход для счётчиков ролей.
  const currentShift = props.shifts.find((item) => item.equipmentId === selected.id) ?? null;
  const openMaintenanceCount = (props.journals[selected.id] ?? []).filter(isOpenRecord).length;
  const roleProgress = buildRoleFlowProgress(
    presentation,
    facts,
    currentShift,
    openMaintenanceCount,
    props.rulesState.publishedInDb,
  );
  const recommendation = blockers > 0
    ? 'Рекомендация: устранить критические замечания для допуска к работе.'
    : warnings > 0
      ? 'Рекомендация: закрыть замечания до начала смены.'
      : presentation.status === 'READY'
        ? 'Рекомендация: установка допущена к работе.'
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
          <div className={cn(
            'mt-2 flex items-start gap-2.5 rounded-lg border p-3',
            presentation.status === 'READY' && 'border-success/30 bg-success/10',
            presentation.status === 'BLOCKED' && 'border-destructive/30 bg-destructive/10',
            presentation.status === 'UNCONFIRMED' && 'border-warning/30 bg-warning/10',
          )}>
            {presentation.status === 'READY'
              ? <CheckCircle2 className="h-5 w-5 shrink-0 text-success-strong" />
              : <AlertTriangle className={cn('h-5 w-5 shrink-0', presentation.status === 'BLOCKED' ? 'text-destructive-strong' : 'text-warning-strong')} />}
            <div className="min-w-0">
              <div className="text-sm font-bold">
                {presentation.status === 'READY' ? 'Готово' : presentation.status === 'BLOCKED' ? 'Заблокировано' : 'Требует внимания'}
              </div>
              <div className="mt-0.5 text-2xs text-muted-foreground">
                {presentation.score != null
                  ? `Готовность подтверждена на ${presentation.score}%`
                  : 'Авторитетной оценки ещё нет'}
              </div>
            </div>
          </div>
          <div className="mt-3 rounded-lg border border-signal bg-signal/10 p-3">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-2xs text-muted-foreground">Следующее действие</div>
                <div className="mt-2 font-bold">{presentation.nextAction}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{props.authoritativeReadinessError ?? presentation.description}</p>
              </div>
              <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-signal text-white">
                <ClipboardCheck className="h-7 w-7" />
              </span>
            </div>
            {nextStage && nextTarget ? (
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
            ) : (
              <p className="mt-3 rounded-md bg-success/10 px-3 py-2 text-xs font-semibold text-success-strong">
                Все шаги контура закрыты
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-1 flex-col p-4">
          <h3 className="font-bold">Чек-лист смены (5 шагов)</h3>
          <div className="mt-3 divide-y divide-border">
            {presentation.stages.map((stage, index) => {
              const target = stageTargets[stage.key];
              const current = nextStage?.key === stage.key;
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
                  </div>
                  <span className={cn('shrink-0 rounded px-2 py-1 text-2xs font-semibold', STAGE_PILL[stage.state].cls)}>
                    {STAGE_PILL[stage.state].label}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </>
              );
              const shared = 'flex w-full min-h-11 items-center gap-3 py-2.5 text-left transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
              return target.href
                ? <Link key={stage.key} href={target.href} className={shared} aria-label={`${stage.label}: открыть`}>{body}</Link>
                : <button key={stage.key} type="button" onClick={() => target.view && props.onViewChange(target.view)} className={shared} aria-label={`${stage.label}: открыть`}>{body}</button>;
            })}
          </div>
          {/*
            Сколько контура пройдено — одной полосой. До этого пять пилюль
            приходилось пересчитывать глазами, чтобы понять, далеко ли до смены.
          */}
          <div className="mt-auto pt-4">
            <div
              className="h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={stageProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Готовность чек-листа смены"
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
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-3">
        <section className={cn(card, 'p-5')}>
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <h2 className="font-bold">Готовность к работе (доказательная)</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4 sm:gap-8">
                <ReadinessRing value={presentation.score} />
                <div>
                  <div className="text-xs text-muted-foreground">Итоговый балл готовности</div>
                  <div className="mt-1 font-mono text-2xl font-bold">{presentation.score ?? '—'} <span className="text-sm font-normal text-muted-foreground">/100</span></div>
                  <div className="mt-3 flex gap-4 text-xs">
                    <span>Критические блокеры <b className="ml-1 rounded bg-destructive/10 px-1.5 py-0.5 text-destructive-strong">{blockers}</b></span>
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
            <h2 className="font-bold">Цепочка состояния</h2>
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
            <h3 className="font-bold">Критическое замечание</h3>
            <div className="mt-3 flex items-center gap-3 rounded-lg border border-destructive/25 bg-destructive/10 p-3">
              <AlertTriangle className="h-7 w-7 text-destructive-strong" />
              <div className="flex-1">
                <div className="font-semibold">{presentation.blockers[0]?.label ?? (presentation.status === 'UNCONFIRMED' ? presentation.title : 'Критических замечаний не обнаружено')}</div>
                <div className="mt-1 text-xs text-muted-foreground">{presentation.blockers[0]?.actionLabel ?? presentation.description}</div>
              </div>
              <span className="rounded border border-destructive px-2 py-1 text-xs text-destructive-strong">{blockers ? 'Критическое' : 'Нет блокеров'}</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col border-t border-border p-4">
            <h3 className="font-bold">Доказательства готовности</h3>
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
                        <Link href={tile.href}>Открыть</Link>
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="outline"
                        className="mt-3 h-9 w-full"
                        onClick={() => tile.view && props.onViewChange(tile.view)}
                      >
                        Открыть
                      </Button>
                    )}
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
          <div className="flex items-center justify-between"><h2 className="font-bold">Передача и приёмка</h2><span className="text-2xs text-muted-foreground">неизменяемый журнал</span></div>
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
          <div className="flex items-center justify-between"><h2 className="font-bold">Входящие (диспетчер)</h2><span className="text-xs text-muted-foreground">{props.equipment.length}</span></div>
          <div className="mt-3 space-y-3">
            {props.equipment.slice(0, 3).map((item) => {
              const itemSnapshot = props.currentReadiness.find((entry) => entry.equipmentId === item.id) ?? null;
              const itemPresentation = props.authoritativeReadinessError
                ? buildUnavailableReadinessPresentation(itemSnapshot)
                : buildAuthoritativeReadinessPresentation(itemSnapshot);
              const itemFleet = props.fleetCards.find((cardItem) => cardItem.id === item.id);
              const active = item.id === selected.id;
              // Время последней передачи по этой установке — «когда упало во входящие».
              const lastSubmitted = buildHandoverJournal(props.shifts, item.id, props.bootstrap?.selectors.actors)
                .find((event) => event.kind === 'SUBMITTED');
              const statusPill = itemPresentation.status === 'READY'
                ? { label: 'Готова к приёмке', cls: 'border-success/30 bg-success/10 text-success-strong' }
                : itemPresentation.status === 'BLOCKED'
                  ? { label: 'Заблокирована', cls: 'border-destructive/30 bg-destructive/10 text-destructive-strong' }
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
                        Принять и назначить
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-9 flex-1"
                        onClick={() => props.onViewChange('shifts')}
                      >
                        Запросить доработки
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" onClick={() => props.onViewChange('shifts')} className="hit-target mt-auto pt-3 text-left text-xs font-semibold text-signal-strong">
            Открыть все входящие →
          </button>
        </section>
        </aside>
      </div>
      <RoleFlowFooter progress={roleProgress} owner={stageOwner} />
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
