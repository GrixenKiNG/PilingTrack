'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PILE_ACCEPTANCE_LABELS, type PileAcceptanceValue } from '@/modules/operator-mobile/domain/pile-passport';
import type {
  PileJournalHeader,
  PilePassportRow,
} from '@/modules/reports/application/queries/pile-passport.service';
import type { SiteFlatDTO } from '@/lib/types';
import { JournalTitleBlock } from './journal-title-block';
import { PileDetail } from './pile-detail';

/**
 * Журнал забивки свай — рабочее место мастера и документ по объекту.
 *
 * ПОЧЕМУ ЭТО ТАБЛИЦА, А НЕ ЛЕНТА КАРТОЧЕК. Журнал забивки — нормативная форма
 * (СП 45.13330, бывш. СНиП 3.02.01-87): титул с копром и молотом, затем строки
 * по сваям в одинаковых графах. Мастер и инспектор читают его столбцами —
 * ищут выпадающий отказ, пропущенную отметку, ряд свай с одной бедой. Лента
 * карточек читается только по одной записи за раз и прячет ровно то, ради чего
 * журнал ведут.
 *
 * ЧЬЁ ЭТО МЕСТО И ПОЧЕМУ НЕ ДИСПЕТЧЕРА. Машинист забивает сваю и записывает
 * замеры с телефона. Принимает её мастер: он отвечает за участок и решает,
 * годится свая или идёт на добивку. Диспетчер ведёт смены и разбирает дефекты
 * техники — про сваи он не постановляет.
 */

const ACCEPTANCE_STYLE: Record<PileAcceptanceValue, string> = {
  PENDING: 'bg-muted text-muted-foreground',
  ACCEPTED: 'bg-success/15 text-success-strong',
  NEEDS_REDRIVE: 'bg-warning/15 text-warning-strong',
};

type StatusFilter = 'PENDING' | 'ACCEPTED' | 'NEEDS_REDRIVE' | 'ALL';

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: 'PENDING', label: 'Не разобранные' },
  { key: 'NEEDS_REDRIVE', label: 'На добивку' },
  { key: 'ACCEPTED', label: 'Принятые' },
  { key: 'ALL', label: 'Все' },
];

interface JournalFilters {
  status: StatusFilter;
  siteId: string;
  dateFrom: string;
  dateTo: string;
  pileNumber: string;
}

const EMPTY_FILTERS: JournalFilters = {
  status: 'PENDING',
  siteId: 'all',
  dateFrom: '',
  dateTo: '',
  pileNumber: '',
};

/** Параметры выборки — одни и те же для экрана и для выгрузки. */
function journalParams(filters: JournalFilters): URLSearchParams {
  const params = new URLSearchParams();
  if (filters.status !== 'ALL') params.set('acceptance', filters.status);
  if (filters.siteId !== 'all') params.set('siteId', filters.siteId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.pileNumber.trim()) params.set('pileNumber', filters.pileNumber.trim());
  return params;
}

export function PileJournal() {
  const [filters, setFilters] = useState<JournalFilters>(EMPTY_FILTERS);
  const [rows, setRows] = useState<PilePassportRow[] | null>(null);
  const [header, setHeader] = useState<PileJournalHeader | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [sites, setSites] = useState<SiteFlatDTO[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // Объекты — только для фильтра. Их список не меняется по ходу разбора, и
  // перезапрашивать его вместе с журналом незачем.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await authFetch('/api/sites/all');
        if (!response.ok) return;
        const body = await response.json();
        if (!cancelled) setSites(body.sites ?? []);
      } catch {
        // Фильтр по объекту — удобство, а не условие работы журнала: молча
        // остаёмся без списка, вместо того чтобы городить ошибку поверх
        // загруженных строк.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const load = useCallback(async () => {
    const response = await authFetch(`/api/pile-passports?${journalParams(filters).toString()}`);
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error ?? 'Журнал недоступен');
    return body as { data: PilePassportRow[]; header: PileJournalHeader; truncated: boolean };
  }, [filters]);

  // Загрузка отменяется вместе с экраном: ответ, пришедший после ухода со
  // страницы, не должен писать в размонтированный список.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const body = await load();
        if (cancelled) return;
        setRows(body.data);
        setHeader(body.header);
        setTruncated(body.truncated === true);
        setError(null);
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Журнал недоступен');
        setRows([]);
        setHeader(null);
        setTruncated(false);
      }
    })();
    return () => { cancelled = true; };
  }, [load]);

  const reload = useCallback(async () => {
    try {
      const body = await load();
      setRows(body.data);
      setHeader(body.header);
      setTruncated(body.truncated === true);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Журнал недоступен');
    }
  }, [load]);

  const decide = async (row: PilePassportRow, acceptance: 'ACCEPTED' | 'NEEDS_REDRIVE', note: string) => {
    setBusyId(row.id);
    setError(null);
    try {
      const response = await authFetch(`/api/pile-passports/${row.id}/decide`, {
        method: 'POST',
        body: JSON.stringify({ acceptance, note: note.trim() || undefined }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error ?? 'Решение не сохранено');
      setOpenId(null);
      await reload();
    } catch (decideError) {
      setError(decideError instanceof Error ? decideError.message : 'Решение не сохранено');
    } finally {
      setBusyId(null);
    }
  };

  const exportJournal = async () => {
    setExporting(true);
    let objectUrl: string | null = null;
    try {
      const response = await authFetch(`/api/pile-passports/export?${journalParams(filters).toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер ответил ${response.status}`);
      }
      objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `zhurnal-zabivki-svay-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      toast.success('Журнал выгружен');
    } catch (exportError) {
      toast.error(exportError instanceof Error ? exportError.message : 'Не удалось выгрузить журнал');
    } finally {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setExporting(false);
    }
  };

  const patch = (part: Partial<JournalFilters>) => setFilters((current) => ({ ...current, ...part }));

  return (
    <div className="space-y-3 p-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Журнал забивки свай</h1>
          <p className="text-2xs text-muted-foreground">
            Свая уходит под землю навсегда — журнал единственное, что от неё остаётся.
            Принимает сваю мастер, он же отправляет её на добивку.
          </p>
        </div>
        <Button size="sm" variant="outline" className="h-8 text-xs" disabled={exporting}
          onClick={() => void exportJournal()}>
          {exporting ? 'Выгрузка…' : 'Выгрузить журнал (.xlsx)'}
        </Button>
      </header>

      <section className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card p-2.5">
        <div className="flex flex-wrap gap-1">
          {STATUS_FILTERS.map((option) => (
            <Button
              key={option.key}
              size="sm"
              variant={filters.status === option.key ? 'default' : 'outline'}
              className="h-8 text-xs"
              onClick={() => patch({ status: option.key })}
            >
              {option.label}
            </Button>
          ))}
        </div>

        <label className="text-2xs text-muted-foreground">
          Объект
          <select
            value={filters.siteId}
            onChange={(event) => patch({ siteId: event.target.value })}
            className="mt-0.5 block h-8 rounded-md border bg-card px-2 text-xs"
          >
            <option value="all">Все объекты</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>{site.name}</option>
            ))}
          </select>
        </label>

        <label className="text-2xs text-muted-foreground">
          Забита с
          <input
            type="date"
            value={filters.dateFrom}
            onChange={(event) => patch({ dateFrom: event.target.value })}
            className="mt-0.5 block h-8 rounded-md border bg-card px-2 text-xs"
          />
        </label>
        <label className="text-2xs text-muted-foreground">
          по
          <input
            type="date"
            value={filters.dateTo}
            onChange={(event) => patch({ dateTo: event.target.value })}
            className="mt-0.5 block h-8 rounded-md border bg-card px-2 text-xs"
          />
        </label>

        <label className="text-2xs text-muted-foreground">
          № сваи
          <input
            value={filters.pileNumber}
            onChange={(event) => patch({ pileNumber: event.target.value })}
            placeholder="С-130"
            className="mt-0.5 block h-8 w-28 rounded-md border bg-card px-2 text-xs"
          />
        </label>

        <Button size="sm" variant="ghost" className="h-8 text-xs"
          onClick={() => setFilters(EMPTY_FILTERS)}>
          Сбросить
        </Button>
      </section>

      {header ? <JournalTitleBlock header={header} /> : null}

      {truncated ? (
        <p className="text-2xs text-warning-strong">
          Показаны первые 500 свай — сузьте период или объект
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive-strong">{error}</p>
      ) : null}

      {rows === null ? <p className="text-sm text-muted-foreground">Загрузка журнала…</p> : null}
      {rows?.length === 0 ? (
        <p className="rounded-md border border-border p-4 text-sm text-muted-foreground">
          По этой выборке записей нет. Паспорта свай заводит машинист на вкладке «Сваи»,
          мастер может дописать пропущенную сваю за него.
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full min-w-[1100px] text-2xs">
            <thead className="bg-muted">
              <tr className="text-left">
                <Th>№</Th>
                <Th>Дата</Th>
                <Th>№ сваи</Th>
                <Th>Куст, пикет</Th>
                <Th>Марка</Th>
                <Th className="text-right">Длина, м</Th>
                <Th className="text-right">Глубина, м</Th>
                <Th className="text-right">Отметка головы, м</Th>
                <Th className="text-right">Залогов</Th>
                <Th className="text-right">Отказ, мм/уд</Th>
                <Th className="text-right">Проектный</Th>
                <Th>По норме</Th>
                <Th>Решение</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => {
                const alarming = row.suggestion?.value === 'NEEDS_REDRIVE';
                const open = openId === row.id;
                return [
                  <tr
                    key={row.id}
                    onClick={() => setOpenId(open ? null : row.id)}
                    className={cn(
                      'cursor-pointer border-t border-border hover:bg-muted/60',
                      open && 'bg-muted/60',
                    )}
                  >
                    <Td className="text-muted-foreground">{index + 1}</Td>
                    <Td>{new Date(row.drivenAt).toLocaleDateString('ru-RU')}</Td>
                    <Td className="font-semibold">{row.pileNumber}</Td>
                    <Td>{row.locationName ?? '—'}</Td>
                    <Td>{row.pileGradeName}</Td>
                    <Td className="text-right">{num(row.pileLengthM)}</Td>
                    <Td className="text-right">{num(row.drivenDepthM)}</Td>
                    <Td className="text-right">{num(row.actualHeadLevelM)}</Td>
                    <Td className="text-right">{row.sets.length || '—'}</Td>
                    <Td className={cn('text-right', alarming && 'font-semibold text-warning-strong')}>
                      {num(row.refusalMm)}
                    </Td>
                    <Td className="text-right text-muted-foreground">{num(row.designRefusalMm)}</Td>
                    <Td>
                      {row.drivingComplete === null
                        ? <span className="text-muted-foreground">—</span>
                        : row.drivingComplete
                          ? <span className="text-success-strong">да</span>
                          : <span className="text-warning-strong">нет</span>}
                    </Td>
                    <Td>
                      <span className={cn('rounded px-1.5 py-0.5 text-3xs font-semibold', ACCEPTANCE_STYLE[row.acceptance])}>
                        {PILE_ACCEPTANCE_LABELS[row.acceptance]}
                      </span>
                    </Td>
                  </tr>,
                  open ? (
                    <tr key={`${row.id}-detail`} className="border-t border-border bg-card">
                      <td colSpan={13} className="p-0">
                        <PileDetail
                          row={row}
                          busy={busyId === row.id}
                          onDecide={(acceptance, note) => void decide(row, acceptance, note)}
                        />
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

/** Пусто — замера нет. Прочерк честнее нуля: ноль означал бы «померили». */
function num(value: number | null): string {
  return value === null ? '—' : String(value);
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={cn('whitespace-nowrap px-2 py-1.5 font-medium text-muted-foreground', className)}>{children}</th>;
}

function Td({ children, className }: { children: React.ReactNode; className?: string }) {
  return <td className={cn('whitespace-nowrap px-2 py-1.5 font-mono', className)}>{children}</td>;
}
