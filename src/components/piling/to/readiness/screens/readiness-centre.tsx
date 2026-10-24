'use client';

import { STAGE_PILL, STAGE_OWNER, ENGINE_HOURS_NOTE, HANDOVER_ICON, HANDOVER_PREVIEW, HANDOVER_PILL, countBlockersByTone, BLOCKER_COUNT_LABEL, BLOCKER_COUNT_CLASS, buildReadinessMetricTiles, evidenceMetric } from './readiness-centre-metrics';


import { RoleFlowFooter, StageLink } from './readiness-centre-role-panels';


import { buildRoleFlowProgress } from './readiness-centre-role-flow';
export type { RoleFlowStep, RoleFlowProgress } from './readiness-centre-role-flow';



import Link from 'next/link';
import { AlertCircle, AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck, FileText, Gauge, HardHat, History, Search, Send, ShieldCheck, User, Wrench } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { ResizableColumns } from './resizable-columns';
import { buildHandoverJournal, handoverRoleLabel, type HandoverJournalEvent } from '../handover-journal';
import { isOpenRecord } from '../../to-stats';

import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation, type PresentationStage } from '../authoritative-presentation';
import { EquipmentPhoto, ReadinessRing, STAGE_CTA, muted, blockerTone, BLOCKER_TONE_CLASS, BLOCKER_TONE_LABEL } from './shared';
import { blockerGuidance } from './blocker-guidance';
import type { ReferenceUiProps, ReferenceView } from './types';

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
            Добавьте установку в модуле «Установки» или повторите загрузку, если данные появились недавно.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button asChild variant="outline"><Link href="/admin/equipment">Открыть установки</Link></Button>
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
  /**
   * Смена открыта по загруженному снимку смен — тот же признак, которым
   * «в работе» считается установка (`STARTED` или `HANDOVER_PENDING`).
   * Шаг диспетчера «Проверить, что смена открыта» загорается по нему: сам он
   * смену не заводит, но обязан убедиться, что она открыта.
   */
  const shiftOpen = props.shifts.some((shift) => shift.equipmentId === selected.id
    && (shift.state === 'STARTED' || shift.state === 'HANDOVER_PENDING'));
  const roleProgress = buildRoleFlowProgress(
    presentation,
    facts,
    openMaintenanceCount,
    props.rulesState.publishedInDb,
    shiftOpen,
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

        На широком экране между колонками стоят разделители: границы тянутся
        мышью или стрелками, размеры помнятся в браузере (`ResizableColumns`).
        Доли 0.9 / 1.45 / 1 остаются исходными и возвращаются двойным щелчком.
      */}
      <ResizableColumns storageKey="readiness-centre-columns-v1" className="grid min-h-0 grid-cols-1 items-stretch gap-3 py-3 md:grid-cols-[300px_minmax(0,1fr)]">
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
            <p className="mt-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-2xs max-sm:text-sm! leading-relaxed text-foreground">
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
              <p className="mt-3 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground max-sm:text-sm">
                {nextStage.key === 'ENGINE_HOURS' ? ENGINE_HOURS_NOTE : presentation.nextAction}
              </p>
            ) : (
              <p className="mt-3 rounded-md bg-success/10 px-3 py-2 text-xs font-semibold text-success-strong max-sm:text-sm">
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
            <p className="text-xs font-semibold text-foreground max-sm:text-sm">{recommendation}</p>
            <p className="mt-1 text-2xs max-sm:text-sm! text-muted-foreground">
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
                      <p className="mt-3 text-2xs max-sm:text-sm! leading-relaxed text-muted-foreground">{tile.note}</p>
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
                  <p className="text-2xs max-sm:text-sm! text-signal-strong">{presentation.title}</p>
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
            <p className="mt-3 rounded-lg border border-border p-3 text-2xs max-sm:text-sm! leading-relaxed text-muted-foreground">
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
              <p className="text-xs text-muted-foreground max-sm:text-sm">Ничего не ждёт приёмки.</p>
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
      </ResizableColumns>
      <RoleFlowFooter progress={roleProgress} owner={stageOwner} onViewChange={props.onViewChange} abilities={props.bootstrap?.capabilities.abilities ?? []} />
    </div>
  );
}
