'use client';

/**
 * «Документы» — контроль сроков документов работников.
 *
 * Третья роль утверждённого порядка: оператор прикладывает документы, инженер
 * ОТ проверяет безопасность, а диспетчер следит за просрочкой. Последнего в
 * контуре не было: сроки лежали в карточке каждого работника по отдельности, и
 * узнать «у кого сегодня кончилось» можно было только обойдя всех руками.
 *
 * Экран читает готовую выборку `/api/user-documents/control` — просроченные и
 * истекающие по всему тенанту. Право проверяет сервер
 * (`users.documents.read_all`: админ, диспетчер, инженер ОТ); вкладка
 * показывается тому же набору ролей, чтобы экран не предлагал того, в чём
 * откажут.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, Search } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { RefKpi } from './shared';
import type { ReferenceUiProps } from './types';

interface ControlRow {
  id: string;
  number: string | null;
  expiresAt: string | null;
  type: { id: string; name: string };
  user: { id: string; name: string; role: string };
  expiry: { status: 'ok' | 'expiring' | 'expired' | 'perpetual'; daysLeft: number | null };
}

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Администратор', DISPATCHER: 'Диспетчер', OPERATOR: 'Машинист',
  ASSISTANT: 'Помощник', MECHANIC: 'Механик', FOREMAN: 'Мастер',
  SAFETY_ENGINEER: 'Инженер ОТ',
};

export function DocumentsScreen(props: ReferenceUiProps) {
  const [rows, setRows] = useState<ControlRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/user-documents/control');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setRows(((await response.json()).documents ?? []) as ControlRow[]);
      setFailed(null);
    } catch (error) {
      // Молчаливый пустой список читался бы как «всё в порядке» — худшая из
      // возможных ошибок на экране контроля просрочки.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить документы');
      setRows(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const expired = rows?.filter((row) => row.expiry.status === 'expired') ?? [];
  const expiring = rows?.filter((row) => row.expiry.status === 'expiring') ?? [];
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const visible = (rows ?? []).filter((row) => !needle
    || row.user.name.toLocaleLowerCase('ru-RU').includes(needle)
    || row.type.name.toLocaleLowerCase('ru-RU').includes(needle));

  return (
    <>
      <ScreenTitle
        heading="Документы"
        subtitle="Сроки удостоверений и допусков работников"
        actions={(
          <Button variant="outline" onClick={() => { setRows(null); void load(); }}>Обновить</Button>
        )}
      />
      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(3)}>
        <RefKpi icon="defect" label="Просрочено" tone="danger" value={expired.length} alert={expired.length > 0}
          detail="работать нельзя до продления" />
        <RefKpi icon="history" label="Истекает" tone="warning" value={expiring.length}
          detail="в пределах срока предупреждения" />
        <RefKpi icon="documents" label="Требуют внимания" tone="info" value={rows?.length ?? 0}
          detail="всего в списке" />
      </section>

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Что требует внимания</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Просроченные и истекающие документы всех действующих работников. Срок предупреждения задаётся видом документа.
            </p>
          </div>
          <div className="relative min-w-[220px] sm:w-64">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input aria-label="Поиск по документам" className="h-8 bg-muted pl-9 text-xs"
              placeholder="Работник или вид документа" value={query}
              onChange={(event) => setQuery(event.target.value)} />
          </div>
        </div>

        {rows === null && !failed && (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}

        {rows !== null && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {rows.length === 0
              ? 'Просроченных и истекающих документов нет.'
              : 'По запросу ничего не найдено.'}
          </p>
        )}

        {visible.length > 0 && (
          <div className="mt-3 divide-y divide-border">
            {visible.map((row) => {
              const isExpired = row.expiry.status === 'expired';
              const days = row.expiry.daysLeft;
              return (
                <div key={row.id} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                  <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full',
                    isExpired ? 'bg-destructive/10 text-destructive-strong' : 'bg-warning/10 text-warning-strong')}>
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{row.user.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {ROLE_LABEL[row.user.role] ?? row.user.role} · {row.type.name}
                      {row.number ? ` № ${row.number}` : ''}
                    </div>
                  </div>
                  <div className="text-right text-xs">
                    <div className={cn('font-semibold', isExpired ? 'text-destructive-strong' : 'text-warning-strong')}>
                      {isExpired
                        ? `Просрочен${days == null ? '' : ` на ${Math.abs(days)} дн.`}`
                        : `Истекает через ${days ?? 0} дн.`}
                    </div>
                    <div className="text-muted-foreground">
                      {row.expiresAt ? `до ${formatRuDate(row.expiresAt)}` : 'срок не указан'}
                    </div>
                  </div>
                  {/* Каждая строка заканчивается действием: продлить документ
                      можно только в карточке работника — туда и ведём. */}
                  <Button asChild variant="outline" className="h-8 text-2xs">
                    <Link href={`/admin/users/${row.user.id}#documents`}>Открыть карточку</Link>
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Кто что делает: тот же порядок, что на экране нарядов-допусков. */}
      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Документы прикладывает сам работник или администратор в карточке работника; сроки система
        проверяет ежедневно. Диспетчер и инженер ОТ следят за этим списком: просроченный документ —
        повод не допускать работника к смене, а истекающий — повод напомнить заранее.
        {props.bootstrap?.tenant.timezone ? ` Время тенанта: ${props.bootstrap.tenant.timezone}.` : ''}
      </p>
    </>
  );
}
