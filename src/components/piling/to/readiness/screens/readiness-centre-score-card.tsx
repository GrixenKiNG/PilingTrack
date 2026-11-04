import { BLOCKER_COUNT_LABEL, BLOCKER_COUNT_CLASS, countBlockersByTone } from './readiness-centre-metrics';
import { History, ShieldCheck } from '@/components/piling/icons/unified-icons';
import { card } from '../settings/shared-ui';
import { Button } from '@/components/ui/button';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import { buildAuthoritativeReadinessPresentation } from '../authoritative-presentation';
import { ReadinessRing } from './shared';
import type { ReferenceUiProps } from './types';

interface ReadinessScoreCardProps {
  score: ReturnType<typeof buildAuthoritativeReadinessPresentation>['score'];
  presentation: ReturnType<typeof buildAuthoritativeReadinessPresentation>;
  blockerTones: ReturnType<typeof countBlockersByTone>;
  warnings: number;
  props: ReferenceUiProps;
  recommendation: string;
}

export function ReadinessScoreCard({ score, presentation, blockerTones, warnings, props, recommendation }: ReadinessScoreCardProps) {
  return (
<section className={cn(card, 'p-5')}>
          <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-start 2xl:justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-bold"><ShieldCheck className="h-4 w-4 text-muted-foreground" />Готовность к работе (доказательная)</h2>
              <div className="mt-4 flex flex-wrap items-center gap-4 sm:gap-8">
                <ReadinessRing value={score} />
                <div>
                  <div className="text-xs text-muted-foreground">Балл готовности</div>
                  <div className="mt-1 font-mono text-2xl font-bold">{score ?? '—'} <span className="text-sm font-normal text-muted-foreground">/100</span></div>
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
  );
}
