'use client';

/**
 * «Проверка знаний» — кто сдавал, с каким результатом и до какой даты.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ ЖУРНАЛА ИНСТРУКТАЖЕЙ. Журнал отвечает «что происходило за
 * период» и мешает в одну ленту ознакомления и проверки. Проверяющему и
 * инженеру ОТ нужен другой срез: по человеку — одна действующая проверка и её
 * срок. Здесь состояние, там история.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Кнопки «Назначить проверку»: понятия «назначено» в системе
 * пока не существует — проверку человек проходит сам на своём экране перед
 * сменой. Кнопка, открывающая пустоту, хуже её отсутствия.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import type { BriefingJournalEntry } from '@/modules/operator-mobile/contracts';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { RefKpi } from './shared';

interface Attempt {
  entry: BriefingJournalEntry;
  expired: boolean;
}

export function KnowledgeScreen() {
  const [rows, setRows] = useState<BriefingJournalEntry[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/briefings/journal?kind=KNOWLEDGE');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setRows(((await response.json()).rows ?? []) as BriefingJournalEntry[]);
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить проверки знаний');
      setRows(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  /**
   * По одной действующей строке на человека — самой свежей.
   *
   * Журнал отдаёт записи от новых к старым, поэтому первая встреченная и есть
   * последняя попытка. Показывать все попытки значило бы, что человек с тремя
   * пересдачами занимает три строки и выглядит как трое.
   */
  const latest = useMemo<Attempt[]>(() => {
    const seen = new Set<string>();
    const now = Date.now();
    const result: Attempt[] = [];
    for (const entry of rows ?? []) {
      if (seen.has(entry.userId)) continue;
      seen.add(entry.userId);
      result.push({
        entry,
        expired: entry.validUntil != null && new Date(entry.validUntil).getTime() < now,
      });
    }
    return result;
  }, [rows]);

  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const visible = latest.filter(({ entry }) => !needle
    || entry.userName.toLocaleLowerCase('ru-RU').includes(needle));
  const expired = latest.filter((attempt) => attempt.expired).length;

  return (
    <>
      <ScreenTitle
        heading="Проверка знаний"
        subtitle="Последняя проверка каждого работника и срок её действия"
        actions={(
          <Button variant="outline" onClick={() => { setRows(null); void load(); }}>Обновить</Button>
        )}
      />

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(3)}>
        <RefKpi icon="accepted" label="Сдавали проверку" tone="success" value={latest.length}
          detail="человек с записью в журнале" />
        <RefKpi icon="defect" label="Срок вышел" tone="danger" value={expired} alert={expired > 0}
          detail="требуется пересдача" />
        <RefKpi icon="documents" label="Всего попыток" tone="info" value={rows?.length ?? '—'}
          detail="записей за всё время" />
      </section>

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">Действующие проверки знаний</h2>
          <div className="relative min-w-[220px] sm:w-64">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Поиск по работникам" className="h-8 bg-muted pl-9 text-xs"
              placeholder="Фамилия" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>

        {rows === null && !failed && (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}

        {rows !== null && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {latest.length === 0
              ? 'Проверок знаний ещё не проходили.'
              : 'По запросу ничего не найдено.'}
          </p>
        )}

        {visible.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold">Работник</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Инструкция</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Результат</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Дата проверки</th>
                  <th scope="col" className="py-2 font-semibold">Действует до</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visible.map(({ entry, expired: isExpired }) => (
                  <tr key={entry.id}>
                    <td className="py-2 pr-3">
                      <div className="font-medium">{entry.userName}</div>
                      <div className="text-2xs text-muted-foreground">
                        {ROLE_LABELS[entry.userRole as UserRole] ?? entry.userRole}
                      </div>
                    </td>
                    <td className="py-2 pr-3">
                      <div>{entry.documentTitle}</div>
                      <div className="text-2xs text-muted-foreground">
                        {entry.documentCode}, в. {entry.documentVersion}
                      </div>
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap font-semibold">{entry.result ?? '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatRuDate(entry.recordedAt)}</td>
                    <td className="py-2 whitespace-nowrap">
                      {entry.validUntil ? (
                        <span className={isExpired ? 'font-semibold text-destructive-strong' : 'text-success-strong'}>
                          {formatRuDate(entry.validUntil)}
                          {isExpired ? ' — просрочена' : ''}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">срок не указан</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Проверку знаний работник проходит сам на своём рабочем месте перед сменой, сразу после
        ознакомления с инструкцией. Просроченная проверка — повод назначить пересдачу, но допуска к
        смене она не снимает: его держат обязательные документы.
      </p>
    </>
  );
}
