'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PILE_ACCEPTANCE_LABELS, type PileAcceptanceValue } from '@/modules/operator-mobile/domain/pile-passport';
import type { PilePassportRow } from '@/modules/reports/application/queries/pile-passport.service';

/**
 * Журнал забивки — рабочее место мастера.
 *
 * ЧЬЁ ЭТО МЕСТО И ПОЧЕМУ НЕ ДИСПЕТЧЕРА. Машинист забивает сваю и записывает
 * замеры с телефона. Принимает её мастер: он отвечает за участок и решает,
 * годится свая или идёт на добивку. Диспетчер ведёт смены и разбирает дефекты
 * техники — про сваи он не постановляет.
 *
 * ПОЧЕМУ РЕШЕНИЕ НЕ АВТОМАТИЧЕСКОЕ. Отказ больше проектного — сильный довод не
 * принимать, но не приговор: грунт «отдыхает», и добивка через сутки часто даёт
 * нужный отказ; бывает и ошибка замера. Экран показывает довод и подсвечивает
 * подсказку, решение нажимает человек.
 */

const ACCEPTANCE_STYLE: Record<PileAcceptanceValue, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  ACCEPTED: 'bg-success/15 text-success-strong',
  NEEDS_REDRIVE: 'bg-warning/15 text-warning-strong',
};

function fmt(value: number | null, unit = ''): string {
  return value === null ? '—' : `${value}${unit}`;
}

export function PileJournal() {
  const [rows, setRows] = useState<PilePassportRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchRows = useCallback(async (): Promise<PilePassportRow[]> => {
    const response = await authFetch(`/api/pile-passports?pendingOnly=${pendingOnly}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? 'Журнал недоступен');
    return body.data as PilePassportRow[];
  }, [pendingOnly]);

  // Загрузка отменяется вместе с экраном: ответ, пришедший после ухода со
  // страницы, не должен писать в размонтированный список.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const data = await fetchRows();
        if (!cancelled) { setRows(data); setError(null); }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Журнал недоступен');
        setRows([]);
      }
    })();
    return () => { cancelled = true; };
  }, [fetchRows]);

  const reload = useCallback(async () => {
    try {
      setRows(await fetchRows());
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Журнал недоступен');
    }
  }, [fetchRows]);

  const counts = useMemo(() => {
    const list = rows ?? [];
    return {
      total: list.length,
      redrive: list.filter((row) => row.acceptance === 'NEEDS_REDRIVE').length,
      suggestedRedrive: list.filter((row) => row.suggestion?.value === 'NEEDS_REDRIVE').length,
    };
  }, [rows]);

  const decide = async (row: PilePassportRow, acceptance: 'ACCEPTED' | 'NEEDS_REDRIVE') => {
    setBusyId(row.id);
    setError(null);
    try {
      const response = await authFetch(`/api/pile-passports/${row.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ acceptance, note: note.trim() || undefined }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Решение не сохранено');
      setNote('');
      setOpenId(null);
      await reload();
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : 'Решение не сохранено');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Журнал забивки</h1>
          <p className="text-2xs text-muted-foreground">
            Паспорта свай. Принимает сваю мастер — он же отправляет её на добивку.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant={pendingOnly ? 'default' : 'outline'}
            onClick={() => setPendingOnly(true)}
            className="h-8 text-xs"
          >
            Не разобранные
          </Button>
          <Button
            size="sm"
            variant={pendingOnly ? 'outline' : 'default'}
            onClick={() => setPendingOnly(false)}
            className="h-8 text-xs"
          >
            Все
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-3 divide-x rounded-md border border-border bg-muted">
        <div className="p-2.5">
          <p className="text-2xs text-muted-foreground">Свай в списке</p>
          <p className="font-mono text-base font-semibold">{counts.total}</p>
        </div>
        <div className="p-2.5">
          <p className="text-2xs text-muted-foreground">Отказ выше проектного</p>
          <p className={cn('font-mono text-base font-semibold', counts.suggestedRedrive > 0 && 'text-warning-strong')}>
            {counts.suggestedRedrive}
          </p>
        </div>
        <div className="p-2.5">
          <p className="text-2xs text-muted-foreground">Отправлено на добивку</p>
          <p className="font-mono text-base font-semibold">{counts.redrive}</p>
        </div>
      </div>

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive-strong">{error}</p>
      ) : null}

      {rows === null ? <p className="text-sm text-muted-foreground">Загрузка журнала…</p> : null}
      {rows?.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          {pendingOnly
            ? 'Все сваи разобраны. Переключитесь на «Все», чтобы посмотреть принятые.'
            : 'Паспортов свай пока нет. Их заводит машинист на вкладке «Сваи».'}
        </p>
      ) : null}

      <ul className="space-y-2">
        {(rows ?? []).map((row) => {
          const open = openId === row.id;
          const alarming = row.suggestion?.value === 'NEEDS_REDRIVE';
          return (
            <li
              key={row.id}
              className={cn(
                'rounded-md border p-3',
                alarming && row.acceptance === 'PENDING' ? 'border-warning' : 'border-border',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{row.pileNumber}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-3xs font-semibold', ACCEPTANCE_STYLE[row.acceptance])}>
                  {PILE_ACCEPTANCE_LABELS[row.acceptance]}
                </span>
                {row.recordedByForeman ? (
                  <span className="rounded bg-info/15 px-1.5 py-0.5 text-3xs font-semibold text-info-strong">
                    Записал мастер
                  </span>
                ) : null}
                <span className="ml-auto text-2xs text-muted-foreground">
                  {new Date(row.drivenAt).toLocaleString('ru-RU')}
                </span>
              </div>

              <p className="mt-1 text-2xs text-muted-foreground">
                {row.siteName} · {row.pileGradeName}
                {row.pileLengthM !== null ? ` (${row.pileLengthM} м)` : ''} · {row.operatorName}
              </p>

              <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
                <Fact label="Отказ" value={fmt(row.refusalMm, ' мм/уд')} strong={alarming} />
                <Fact label="Проектный отказ" value={fmt(row.designRefusalMm, ' мм/уд')} />
                <Fact label="Глубина" value={fmt(row.drivenDepthM, ' м')} />
                <Fact label="Отметка головы" value={fmt(row.actualHeadLevelM, ' м')} />
              </div>

              {row.suggestion ? (
                <p
                  className={cn(
                    'mt-2 rounded-md px-2.5 py-1.5 text-2xs font-medium',
                    alarming ? 'bg-warning/15 text-warning-strong' : 'bg-info/10 text-info-strong',
                  )}
                >
                  {row.suggestion.reason}
                  {alarming ? '. Свая не добита.' : '.'}
                </p>
              ) : (
                <p className="mt-2 text-2xs text-muted-foreground">
                  Проектный отказ не заведён — сравнить не с чем, решайте по своим данным.
                </p>
              )}

              {row.acceptanceNote ? (
                <p className="mt-1 text-2xs text-muted-foreground">Решение: {row.acceptanceNote}</p>
              ) : null}

              {open ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-2xs sm:grid-cols-4">
                    <Fact label="Залог" value={`${fmt(row.refusalSetPenetrationMm)} мм / ${fmt(row.refusalSetBlows)} уд`} />
                    <Fact label="Ударов всего" value={fmt(row.totalBlows)} />
                    <Fact label="На последний метр" value={fmt(row.blowsLastMeter)} />
                    <Fact label="Проектная отметка" value={fmt(row.designHeadLevelM, ' м')} />
                    <Fact label="Отклонение в плане" value={fmt(row.planDeviationMm, ' мм')} />
                    <Fact label="От вертикали" value={fmt(row.tiltPercent, ' %')} />
                    <Fact label="Молот" value={row.hammerType ?? '—'} />
                    <Fact label="Энергия / высота" value={`${fmt(row.hammerEnergyKj, ' кДж')} / ${fmt(row.dropHeightM, ' м')}`} />
                    <Fact label="Добивка" value={row.redriven ? 'да' : 'нет'} />
                    <Fact label="Добойник" value={row.followerUsed ? 'да' : 'нет'} />
                  </div>
                  {row.note ? <p className="text-2xs text-muted-foreground">Примечание: {row.note}</p> : null}

                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={2}
                    placeholder="Основание решения. Для добивки обязательно."
                    className="w-full rounded-md border bg-card px-3 py-2 text-sm shadow-xs"
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" className="h-8 text-xs" disabled={busyId === row.id}
                      onClick={() => void decide(row, 'ACCEPTED')}>
                      Принять сваю
                    </Button>
                    <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busyId === row.id}
                      onClick={() => void decide(row, 'NEEDS_REDRIVE')}>
                      На добивку
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs"
                      onClick={() => { setOpenId(null); setNote(''); }}>
                      Свернуть
                    </Button>
                  </div>
                </div>
              ) : (
                <Button size="sm" variant="outline" className="mt-2 h-8 text-xs"
                  onClick={() => { setOpenId(row.id); setNote(row.acceptanceNote ?? ''); }}>
                  Разобрать
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Fact({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div>
      <span className="block text-muted-foreground">{label}</span>
      <span className={cn('font-mono', strong && 'font-semibold text-warning-strong')}>{value}</span>
    </div>
  );
}
