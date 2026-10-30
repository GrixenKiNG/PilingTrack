'use client';

import { ReadinessEquipmentCard } from './readiness-centre-equipment-card';
import { ReadinessScoreCard } from './readiness-centre-score-card';
import { ReadinessHandoverPanel } from './readiness-centre-handover-panel';




import { STAGE_OWNER, countBlockersByTone, buildReadinessMetricTiles, evidenceMetric } from './readiness-centre-metrics';


import { RoleFlowFooter, StageLink } from './readiness-centre-role-panels';


import { buildRoleFlowProgress } from './readiness-centre-role-flow';
export type { RoleFlowStep, RoleFlowProgress } from './readiness-centre-role-flow';



import Link from 'next/link';
import { AlertTriangle, ArrowRight, ChevronRight, FileText, Gauge, HardHat, History, Search, ShieldCheck, User, Wrench } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';

import { cn } from '@/lib/utils';
import { ResizableColumns } from './resizable-columns';
import { buildHandoverJournal } from '../handover-journal';
import { isOpenRecord } from '../../to-stats';

import { buildAuthoritativeReadinessPresentation, buildUnavailableReadinessPresentation, type PresentationStage } from '../authoritative-presentation';
import { blockerTone, BLOCKER_TONE_CLASS, BLOCKER_TONE_LABEL } from './shared';
import { blockerGuidance } from './blocker-guidance';
import type { ReferenceUiProps, ReferenceView } from './types';

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
        <ReadinessEquipmentCard
          nextAction={presentation.nextAction}
          fleetCard={fleetCard} selected={selected} detail={detail}
          presentation={presentation} startAllowed={startAllowed} pendingStages={pendingStages}
          pendingSummary={pendingSummary} blockers={blockers} nextStage={nextStage}
          props={props} stageOwner={stageOwner} nextTarget={nextTarget}
          stageTargets={stageTargets} stageProgress={stageProgress} doneStages={doneStages}
        />

      <div className="flex flex-col gap-3">
        <ReadinessScoreCard
          score={presentation.score}
          presentation={presentation} blockerTones={blockerTones} warnings={warnings}
          props={props} recommendation={recommendation}
        />
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

      <ReadinessHandoverPanel
          handoverJournal={handoverJournal} props={props} awaitingAcceptance={awaitingAcceptance}
          selected={selected}
        />
      </ResizableColumns>
      <RoleFlowFooter progress={roleProgress} owner={stageOwner} onViewChange={props.onViewChange} abilities={props.bootstrap?.capabilities.abilities ?? []} />
    </div>
  );
}
