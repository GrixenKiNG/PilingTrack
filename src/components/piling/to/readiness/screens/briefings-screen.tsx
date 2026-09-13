'use client';

/**
 * «Инструктажи» — журнал ознакомлений с инструкциями и проверок знаний.
 *
 * Зачем отдельно от «Документов». Тот экран отвечает на вопрос «что просрочено
 * сейчас» и показывает одну действующую строку на работника; проверяющему нужен
 * другой ответ — «кто и когда проходил за период», и он накапливается. Журнал
 * читает историю (`/api/briefings/journal`), а не состояние.
 *
 * Право проверяет сервер (`users.documents.read_all`: админ, диспетчер, инженер
 * ОТ); вкладка показывается тому же набору ролей, чтобы экран не предлагал
 * того, в чём откажут.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from '@/components/piling/icons/unified-icons';
import { PilingIcon } from '@/components/piling/icons';
import {
  BRIEFING_KIND_LABELS, currentMonthRange, dayRangeToInstants, formatJournalDay,
  formatJournalMoment, type BriefingJournalEntry, type BriefingKind,
} from '@/modules/operator-mobile/contracts';
import { authFetch } from '@/lib/api';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { RefKpi } from './shared';
import type { ReferenceUiProps } from './types';

type KindFilter = BriefingKind | '';

export function BriefingsScreen(props: ReferenceUiProps) {
  const defaults = useMemo(() => currentMonthRange(), []);
  const [fromDay, setFromDay] = useState(defaults.from);
  const [toDay, setToDay] = useState(defaults.to);
  const [kind, setKind] = useState<KindFilter>('');
  const [rows, setRows] = useState<BriefingJournalEntry[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const period = dayRangeToInstants(fromDay, toDay);
    const search = new URLSearchParams({ from: period.from, to: period.to });
    if (kind) search.set('kind', kind);
    try {
      const response = await authFetch(`/api/briefings/journal?${search.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      const body = await response.json();
      setRows((body.rows ?? []) as BriefingJournalEntry[]);
      setTruncated(Boolean(body.truncated));
      setFailed(null);
    } catch (error) {
      // Пустой список молча читался бы как «инструктажей не было» — для журнала
      // это худшая из ошибок: именно его отсутствие и есть нарушение.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить журнал');
      setRows(null);
    }
  }, [fromDay, toDay, kind]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount and on filter change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const openPrintForm = () => {
    const period = dayRangeToInstants(fromDay, toDay);
    const search = new URLSearchParams({ from: period.from, to: period.to, fromDay, toDay });
    if (kind) search.set('kind', kind);
    window.open(`/print/briefing-journal?${search.toString()}`, '_blank', 'noopener');
  };

  const instructions = rows?.filter((row) => row.kind === 'INSTRUCTION') ?? [];
  const knowledge = rows?.filter((row) => row.kind === 'KNOWLEDGE') ?? [];
  const people = new Set((rows ?? []).map((row) => row.userId)).size;

  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const visible = (rows ?? []).filter((row) => !needle
    || row.userName.toLocaleLowerCase('ru-RU').includes(needle)
    || row.documentTitle.toLocaleLowerCase('ru-RU').includes(needle)
    || row.documentCode.toLocaleLowerCase('ru-RU').includes(needle));

  return (
    <>
      <ScreenTitle
        heading="Инструктажи"
        subtitle="Журнал ознакомлений с инструкциями и проверок знаний"
        actions={(
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => { setRows(null); void load(); }}>Обновить</Button>
            {/* Печать ведёт на отдельную страницу-документ: печатать рабочий
                экран вместе с навигацией модуля нельзя — в лист попадает
                оболочка, а таблица обрезается по краю прокрутки. */}
            <Button onClick={openPrintForm} disabled={!rows || rows.length === 0}>
              <PilingIcon name="print" size={14} decorative />
              Печатная форма
            </Button>
          </div>
        )}
      />

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(3)}>
        <RefKpi icon="documents" label="Ознакомлений" tone="info" value={instructions.length}
          detail="прочтений инструкции за период" />
        <RefKpi icon="accepted" label="Проверок знаний" tone="success" value={knowledge.length}
          detail="сданных проверок за период" />
        <RefKpi icon="users" label="Работников" tone="neutral" value={people}
          detail="человек в журнале за период" />
      </section>

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Период с
              <Input type="date" aria-label="Начало периода" className="h-8 w-[150px] bg-muted text-xs"
                value={fromDay} onChange={(event) => setFromDay(event.target.value)} />
            </label>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              по
              <Input type="date" aria-label="Конец периода" className="h-8 w-[150px] bg-muted text-xs"
                value={toDay} onChange={(event) => setToDay(event.target.value)} />
            </label>
            <label className="grid gap-1 text-2xs text-muted-foreground">
              Вид записи
              <select aria-label="Вид записи" value={kind}
                onChange={(event) => setKind(event.target.value as KindFilter)}
                className="h-8 min-w-[190px] rounded-md border border-input bg-background px-3 text-xs text-foreground">
                <option value="">Все записи</option>
                <option value="INSTRUCTION">{BRIEFING_KIND_LABELS.INSTRUCTION}</option>
                <option value="KNOWLEDGE">{BRIEFING_KIND_LABELS.KNOWLEDGE}</option>
              </select>
            </label>
          </div>
          <div className="relative min-w-[220px] sm:w-64">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Поиск по журналу" className="h-8 bg-muted pl-9 text-xs"
              placeholder="Работник или инструкция" value={query}
              onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>

        {truncated && (
          <p role="alert" className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning-strong">
            Записей за период больше, чем помещается в одну выборку: показаны последние 1000.
            Сузьте период — иначе распечатка журнала будет неполной.
          </p>
        )}

        {rows === null && !failed && (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}

        {rows !== null && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? 'За выбранный период записей нет.'
              : 'По запросу ничего не найдено.'}
          </p>
        )}

        {visible.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold">Дата и время</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Работник</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Вид записи</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Инструкция</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Результат</th>
                  <th scope="col" className="py-2 font-semibold">Действует до</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map((row) => (
                  <tr key={row.id}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatJournalMoment(row.recordedAt)}</td>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.userName}</div>
                      <div className="text-2xs text-muted-foreground">
                        {ROLE_LABELS[row.userRole as UserRole] ?? row.userRole}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{BRIEFING_KIND_LABELS[row.kind]}</td>
                    <td className="py-2 pr-3">
                      <div>{row.documentTitle}</div>
                      <div className="text-2xs text-muted-foreground">
                        {row.documentCode}, в. {row.documentVersion}
                      </div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{row.result ?? '—'}</td>
                    <td className="py-2 whitespace-nowrap">
                      {row.validUntil ? formatJournalDay(row.validUntil) : 'бессрочно'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Записи появляются сами, когда работник читает инструкцию и сдаёт проверку знаний на своём
        рабочем месте перед сменой. Задним числом журнал не правится: это история действий, а не
        состояние допуска — действующие подтверждения и их сроки показывает вкладка «Документы».
        {props.bootstrap?.tenant.timezone ? ` Время тенанта: ${props.bootstrap.tenant.timezone}.` : ''}
      </p>
    </>
  );
}
