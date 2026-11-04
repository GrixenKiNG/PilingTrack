import { STAGE_PILL, ENGINE_HOURS_NOTE } from './readiness-centre-metrics';
import Link from 'next/link';
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronRight, ClipboardCheck } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { buildAuthoritativeReadinessPresentation, type PresentationStage } from '../authoritative-presentation';
import { EquipmentPhoto, STAGE_CTA, muted } from './shared';
import type { ReferenceUiProps, ReferenceView } from './types';

interface ReadinessEquipmentCardProps {
  nextAction: string;
  fleetCard: ReferenceUiProps['fleetCards'][number] | undefined;
  selected: ReferenceUiProps['equipment'][number];
  detail: ReferenceUiProps['details'][string] | undefined;
  presentation: ReturnType<typeof buildAuthoritativeReadinessPresentation>;
  startAllowed: boolean;
  pendingStages: PresentationStage[];
  pendingSummary: string;
  blockers: number;
  nextStage: PresentationStage | null;
  props: ReferenceUiProps;
  stageOwner: string | null;
  nextTarget: { href?: string; view?: ReferenceView } | null;
  stageTargets: Record<PresentationStage['key'], { href?: string; view?: ReferenceView }>;
  stageProgress: number;
  doneStages: number;
}

export function ReadinessEquipmentCard({ nextAction, fleetCard, selected, detail, presentation, startAllowed, pendingStages, pendingSummary, blockers, nextStage, props, stageOwner, nextTarget, stageTargets, stageProgress, doneStages }: ReadinessEquipmentCardProps) {
  return (
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
                  {blockers === 0 && nextStage ? `Завершить шаг «${nextStage.label}»` : nextAction}
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
                {nextStage.key === 'ENGINE_HOURS' ? ENGINE_HOURS_NOTE : nextAction}
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
  );
}
