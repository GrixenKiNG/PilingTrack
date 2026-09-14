'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PILE_ACCEPTANCE_LABELS } from '@/modules/operator-mobile/domain/pile-passport';
import type { PilePassportRow } from '@/modules/reports/application/queries/pile-passport.service';
import { DrivingSets } from './driving-sets';

/**
 * Одна свая целиком: чем била, что получилось, что постановил мастер.
 *
 * ПОЧЕМУ РЕШЕНИЕ НЕ АВТОМАТИЧЕСКОЕ. Отказ больше проектного — сильный довод не
 * принимать, но не приговор: грунт «отдыхает», и добивка через двое-трое суток
 * часто даёт нужный отказ; бывает и ошибка замера. Экран показывает довод и
 * подсвечивает подсказку, решение нажимает человек.
 */
export function PileDetail({ row, busy, onDecide }: {
  row: PilePassportRow;
  busy: boolean;
  onDecide: (acceptance: 'ACCEPTED' | 'NEEDS_REDRIVE', note: string) => void;
}) {
  const [note, setNote] = useState(row.acceptanceNote ?? '');
  const alarming = row.suggestion?.value === 'NEEDS_REDRIVE';

  const redriveReadyAt = row.redriveReadyAt ? new Date(row.redriveReadyAt) : null;
  const restLeft = redriveReadyAt
    ? Math.ceil((redriveReadyAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
    : null;

  return (
    <div className="space-y-3 p-3">
      <header>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-base font-semibold">{row.pileNumber}</span>
          <span className="rounded bg-muted px-1.5 py-0.5 text-3xs font-semibold text-muted-foreground">
            {PILE_ACCEPTANCE_LABELS[row.acceptance]}
          </span>
          {row.recordedByForeman ? (
            <span className="rounded bg-info/15 px-1.5 py-0.5 text-3xs font-semibold text-info-strong">
              Записал мастер
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-2xs text-muted-foreground">
          {new Date(row.drivenAt).toLocaleString('ru-RU')} · {row.siteName}
          {row.locationName ? ` · ${row.locationName}` : ''} · {row.operatorName}
          {row.equipmentName ? ` · ${row.equipmentName}` : ''}
        </p>
      </header>

      {/* Довод по свае — первое, что должно попасться на глаза: ради него
          мастер этот экран и открыл. */}
      {row.suggestion ? (
        <p
          className={cn(
            'rounded-md px-2.5 py-2 text-2xs font-medium',
            alarming ? 'bg-warning/15 text-warning-strong' : 'bg-success/10 text-success-strong',
          )}
        >
          {row.suggestion.reason}
          {alarming ? '. Свая не добита.' : '.'}
          {row.refusalSetsUsed > 0 ? ` Отказ по ${row.refusalSetsUsed} залогам.` : ''}
        </p>
      ) : (
        <p className="rounded-md bg-muted px-2.5 py-2 text-2xs text-muted-foreground">
          Проектный отказ не заведён — сравнить не с чем, решайте по своим данным.
        </p>
      )}

      {row.drivingComplete === false ? (
        <p className="rounded-md bg-warning/10 px-2.5 py-2 text-2xs text-warning-strong">
          Условие нормы не выполнено: три последних залога подряд должны дать отказ не больше
          проектного.
        </p>
      ) : null}

      {restLeft !== null && redriveReadyAt ? (
        <p className="rounded-md bg-info/10 px-2.5 py-2 text-2xs text-info-strong">
          {restLeft > 0
            ? `Грунту нужен отдых: добивать с ${redriveReadyAt.toLocaleDateString('ru-RU')} `
              + `(осталось ${restLeft} сут.). Раньше срока отказ покажет разжиженный грунт, а не опору.`
            : 'Отдых грунта выдержан — сваю можно добивать.'}
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-2xs sm:grid-cols-3">
        <Fact label="Отказ фактический" value={fmt(row.refusalMm, ' мм/уд')} strong={alarming} />
        <Fact label="Отказ проектный" value={fmt(row.designRefusalMm, ' мм/уд')} />
        <Fact label="Марка сваи" value={`${row.pileGradeName}${row.pileSection ? ` · ${row.pileSection}` : ''}`} />
        <Fact label="Длина сваи" value={fmt(row.pileLengthM, ' м')} />
        <Fact label="Глубина погружения" value={fmt(row.drivenDepthM, ' м')} />
        <Fact label="Отметка головы факт." value={fmt(row.actualHeadLevelM, ' м')} />
        <Fact label="Отметка головы проект." value={fmt(row.designHeadLevelM, ' м')} />
        <Fact label="Ударов всего" value={fmt(row.totalBlows)} />
        <Fact label="На последний метр" value={fmt(row.blowsLastMeter)} />
        <Fact label="Отклонение в плане" value={fmt(row.planDeviationMm, ' мм')} />
        <Fact label="От вертикали" value={fmt(row.tiltPercent, ' %')} />
        <Fact label="Молот" value={row.hammerType ?? '—'} />
        <Fact label="Энергия удара" value={fmt(row.hammerEnergyKj, ' кДж')} />
        <Fact label="Высота подъёма" value={fmt(row.dropHeightM, ' м')} />
        <Fact
          label="Отметки"
          value={[
            row.redriven ? 'добивка' : null,
            row.followerUsed ? 'добойник' : null,
            row.headCutOff ? 'голова срублена' : null,
          ].filter(Boolean).join(', ') || '—'}
        />
      </div>

      <section>
        <h3 className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">
          Ход забивки по залогам
        </h3>
        <DrivingSets row={row} />
      </section>

      {row.note ? <p className="text-2xs text-muted-foreground">Примечание машиниста: {row.note}</p> : null}
      {row.acceptanceNote ? (
        <p className="text-2xs text-muted-foreground">
          Решение{row.acceptedByName ? ` (${row.acceptedByName})` : ''}: {row.acceptanceNote}
        </p>
      ) : null}

      <section className="space-y-2 border-t border-border pt-3">
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Основание решения. Для добивки обязательно."
          className="w-full rounded-md border bg-card px-3 py-2 text-sm shadow-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" className="h-8 text-xs" disabled={busy}
            onClick={() => onDecide('ACCEPTED', note)}>
            Принять сваю
          </Button>
          <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busy}
            onClick={() => onDecide('NEEDS_REDRIVE', note)}>
            На добивку
          </Button>
        </div>
      </section>
    </div>
  );
}

function fmt(value: number | null, unit = ''): string {
  return value === null ? '—' : `${value}${unit}`;
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <span className="block text-muted-foreground">{label}</span>
      <span className={cn('font-mono', strong && 'font-semibold text-warning-strong')}>{value}</span>
    </div>
  );
}
