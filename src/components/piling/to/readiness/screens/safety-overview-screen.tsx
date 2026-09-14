'use client';

/**
 * «Обзор» модуля «ТБ и допуски» — то, с чего инженер ОТ начинает утро.
 *
 * ТРИ КОЛОНКИ — ТРИ РАЗНЫХ ВОПРОСА. Слева «что требует внимания»: список
 * событий, у каждого из которых есть адресат и действие. В центре люди и их
 * допуск — состояние, а не события. Справа «что происходило сегодня»: счётчики
 * проведённых инструктажей по видам.
 *
 * ПЛИТКИ СЧИТАЮТСЯ, А НЕ ХРАНЯТСЯ. «Ожидают ознакомления» — это работники, не
 * читавшие ДЕЙСТВУЮЩУЮ редакцию обязательной им инструкции; «просроченные
 * инструктажи» — те, у кого со дня последнего прошло больше срока повторного.
 * Ни того, ни другого не нужно назначать: обязательность инструкции задана её
 * каталогом, а срок — её периодичностью. Отдельная таблица «назначений»
 * добавила бы третий источник правды к двум уже имеющимся.
 *
 * ЧЕГО ЗДЕСЬ НЕТ. Плитки «Назначены проверки знаний»: проверку работник
 * проходит сам после ознакомления, и назначать её некому. Её место заняла
 * честная «ожидают подтверждения» — записи журнала без двух отметок.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import {
  BRIEFING_TYPE_LABELS, BRIEFING_TYPE_ORDER, type BriefingType,
} from '@/modules/operator-mobile/contracts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { COMPACT_KPI_GRID, ScreenTitle, card } from '../settings/shared-ui';
import { kpiGridStyle } from '@/components/piling/kpi-tile';
import { RefKpi } from './shared';
import type { ReferenceUiProps } from './types';

interface ClearanceRow {
  userId: string;
  name: string;
  role: string;
  cleared: boolean;
  blockers: string[];
  warnings: string[];
  nextExpiryAt: string | null;
  knowledge: { status: 'valid' | 'expired' | 'never'; validUntil: string | null };
  lastInstructionAt: string | null;
  acquainted: boolean;
  pendingInstructions: string[];
  overdueBriefings: string[];
}

interface Overview {
  rows: ClearanceRow[];
  todayByType: Record<BriefingType, number>;
  incidents: { last30: number; previous30: number };
  totals: {
    people: number; cleared: number; blocked: number; expiring: number;
    knowledgeOverdue: number; briefingsOverdue: number; awaitingAcquaintance: number;
  };
  requiredTypesConfigured: boolean;
}

interface AttentionItem {
  id: string;
  icon: PilingIconName;
  tone: 'danger' | 'warning' | 'info';
  title: string;
  who: string;
}

/** Сколько строк показываем в каждой ленте: обзор, а не полный список. */
const PREVIEW_LIMIT = 7;

/**
 * Лента событий строится из того же расчёта, что и таблица.
 *
 * Отдельный источник «событий» означал бы, что лента и таблица могут не
 * сойтись: в ленте «просрочен медосмотр», а в строке человека — «допущен».
 * Препятствия идут раньше предупреждений — порядок здесь и есть срочность.
 */
function buildAttention(rows: ClearanceRow[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const row of rows) {
    for (const blocker of row.blockers) {
      items.push({ id: `${row.userId}-b-${blocker}`, icon: 'defect', tone: 'danger', title: blocker, who: row.name });
    }
  }
  for (const row of rows) {
    for (const overdue of row.overdueBriefings) {
      items.push({ id: `${row.userId}-o-${overdue}`, icon: 'risk', tone: 'danger', title: overdue, who: row.name });
    }
  }
  for (const row of rows) {
    for (const pending of row.pendingInstructions) {
      items.push({ id: `${row.userId}-p-${pending}`, icon: 'documents', tone: 'warning', title: pending, who: row.name });
    }
  }
  for (const row of rows) {
    if (row.knowledge.status !== 'valid') {
      items.push({
        id: `${row.userId}-k`,
        icon: 'risk',
        tone: 'warning',
        title: row.knowledge.status === 'expired'
          ? 'Просрочена проверка знаний по ТБ'
          : 'Проверка знаний не проходилась',
        who: row.name,
      });
    }
  }
  for (const row of rows) {
    for (const warning of row.warnings) {
      items.push({ id: `${row.userId}-w-${warning}`, icon: 'history', tone: 'info', title: warning, who: row.name });
    }
  }
  return items;
}

const TONE_CLASS: Record<AttentionItem['tone'], string> = {
  danger: 'bg-destructive/10 text-destructive-strong',
  warning: 'bg-warning/10 text-warning-strong',
  info: 'bg-info/10 text-info-strong',
};

export function SafetyOverviewScreen(props: ReferenceUiProps) {
  const [data, setData] = useState<Overview | null>(null);
  const [awaiting, setAwaiting] = useState<number | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/safety/clearance');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setData((await response.json()) as Overview);
      setFailed(null);
    } catch (error) {
      // Пустой обзор читается как «всё в порядке» — на экране охраны труда
      // это худшая из подмен.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить сводку');
      setData(null);
    }
  }, []);

  /** Незакрытые подписи — отдельный вопрос к журналу, а не к допускам. */
  const loadAwaiting = useCallback(async () => {
    try {
      const response = await authFetch('/api/briefings/journal?status=awaiting');
      if (!response.ok) return;
      const body = await response.json();
      setAwaiting((body.rows ?? []).length);
    } catch {
      // Счётчик подписей — дополнение к обзору. Его пропажа показывается
      // прочерком, а не гасит экран: допуски важнее.
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loaders set state
  useEffect(() => { void load(); void loadAwaiting(); }, [load, loadAwaiting]);

  const totals = data?.totals;
  const attention = data ? buildAttention(data.rows) : [];
  const worstFirst = (data?.rows ?? []).slice().sort((left, right) =>
    Number(left.cleared) - Number(right.cleared) || left.name.localeCompare(right.name, 'ru-RU'));
  const incidentDelta = data ? data.incidents.last30 - data.incidents.previous30 : 0;

  return (
    <>
      <ScreenTitle
        heading="ТБ и допуски"
        subtitle="Допуски сотрудников, журнал инструктажей и проверка знаний"
        actions={(
          <Button variant="outline" onClick={() => { setData(null); void load(); void loadAwaiting(); }}>
            Обновить
          </Button>
        )}
      />

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(6)}>
        <RefKpi icon="accepted" label="Допущены к работе" tone="success"
          value={totals ? `${totals.cleared} из ${totals.people}` : '—'}
          detail="все обязательные документы действуют" />
        <RefKpi icon="defect" label="Нет допуска" tone="danger" value={totals?.blocked ?? '—'}
          alert={Boolean(totals?.blocked)} detail="работать нельзя до продления" />
        <RefKpi icon="history" label="Истекают допуски" tone="warning" value={totals?.expiring ?? '—'}
          detail="в окне предупреждения" />
        <RefKpi icon="risk" label="Просроченные инструктажи" tone="danger"
          value={totals?.briefingsOverdue ?? '—'} alert={Boolean(totals?.briefingsOverdue)}
          detail="повторный не проведён в срок" />
        <RefKpi icon="documents" label="Ожидают ознакомления" tone="warning"
          value={totals?.awaitingAcquaintance ?? '—'}
          detail="с действующей редакцией инструкции" />
        <RefKpi icon="accepted" label="Ожидают подтверждения" tone="info" value={awaiting ?? '—'}
          detail="записей журнала без двух отметок" />
        <RefKpi icon="risk" label="Происшествия за месяц" tone="danger"
          value={data?.incidents.last30 ?? '—'}
          detail={data
            ? incidentDelta === 0
              ? 'столько же, сколько месяцем ранее'
              : `${incidentDelta > 0 ? '+' : ''}${incidentDelta} к прошлому месяцу`
            : undefined} />
      </section>

      {data && !data.requiredTypesConfigured && (
        <p role="alert" className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
          Обязательные виды документов не заданы, поэтому допуск сейчас не проверяется ничем и все
          работники числятся допущенными.
        </p>
      )}

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      {data === null && !failed && (
        <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}

      {data && (
        <div className="mt-2 grid grid-cols-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)_300px]">
          <section className={cn(card, 'p-3')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">Что требует внимания</h2>
              <span className={cn(
                'rounded-full px-2 py-0.5 text-2xs font-bold',
                attention.length ? 'bg-destructive/10 text-destructive-strong' : 'bg-success/10 text-success-strong',
              )}>
                {attention.length}
              </span>
            </div>
            {attention.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Ничего не требует решения. Это хорошая новость.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-border">
                {attention.slice(0, PREVIEW_LIMIT).map((item) => (
                  <li key={item.id} className="flex gap-2 py-2">
                    <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full', TONE_CLASS[item.tone])}>
                      <PilingIcon name={item.icon} size={13} decorative />
                    </span>
                    <div className="min-w-0">
                      <div className="text-sm leading-snug">{item.title}</div>
                      <div className="text-2xs text-muted-foreground">{item.who}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {attention.length > PREVIEW_LIMIT && (
              <button type="button" onClick={() => props.onViewChange('employees')}
                className="mt-2 w-full text-right text-xs font-medium text-info hover:underline">
                Ещё {attention.length - PREVIEW_LIMIT} — все сотрудники →
              </button>
            )}
          </section>

          <section className={cn(card, 'min-w-0 p-3')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-bold">Сотрудники и статус допуска</h2>
              <button type="button" onClick={() => props.onViewChange('employees')}
                className="text-xs font-medium text-info hover:underline">
                Все сотрудники →
              </button>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-semibold">Сотрудник</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Роль</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Инструктаж</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Ознакомление</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Проверка знаний</th>
                    <th scope="col" className="py-2 font-semibold">Статус допуска</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {worstFirst.slice(0, PREVIEW_LIMIT).map((row) => (
                    <tr key={row.userId}>
                      <td className="py-2 pr-3 font-medium">{row.name}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {ROLE_LABELS[row.role as UserRole] ?? row.role}
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        <span className={row.overdueBriefings.length ? 'font-semibold text-destructive-strong' : ''}>
                          {row.lastInstructionAt ? formatRuDate(row.lastInstructionAt) : '—'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        <span className={row.acquainted ? 'text-success-strong' : 'text-warning-strong'}>
                          {row.acquainted ? 'Да' : 'Нет'}
                        </span>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap text-xs">
                        <span className={row.knowledge.status === 'valid' ? 'text-success-strong' : 'text-warning-strong'}>
                          {row.knowledge.status === 'valid' ? 'Пройдена' : row.knowledge.status === 'expired' ? 'Просрочена' : 'Не сдавал'}
                        </span>
                      </td>
                      <td className="py-2 whitespace-nowrap">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-2xs font-semibold',
                          row.cleared ? 'bg-success/10 text-success-strong' : 'bg-destructive/10 text-destructive-strong',
                        )}>
                          {row.cleared ? 'Допущен' : 'Нет допуска'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-2xs text-muted-foreground">
              Показано {Math.min(PREVIEW_LIMIT, worstFirst.length)} из {worstFirst.length} сотрудников
            </p>
          </section>

          <div className="space-y-3">
            <section className={cn(card, 'p-3')}>
              <h2 className="font-bold">Журнал за сегодня</h2>
              <ul className="mt-2 divide-y divide-border">
                {BRIEFING_TYPE_ORDER.map((type) => (
                  <li key={type} className="flex items-center justify-between py-2 text-sm">
                    <span className="flex items-center gap-2">
                      <PilingIcon name="documents" size={14} tone="neutral" decorative />
                      {BRIEFING_TYPE_LABELS[type]}
                    </span>
                    {/* Ноль — это ответ «сегодня такого не проводили», а не
                        пустота: скрытая строка читалась бы как «не считали». */}
                    <span className="font-bold tabular-nums">{data.todayByType[type] ?? 0}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className={cn(card, 'p-3')}>
              <h2 className="font-bold">Быстрые действия</h2>
              <div className="mt-2 grid gap-2">
                <Button className="justify-start" onClick={() => props.onViewChange('briefings')}>
                  <PilingIcon name="add" size={14} decorative />
                  Провести инструктаж
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => props.onViewChange('briefings')}>
                  <PilingIcon name="documents" size={14} decorative />
                  Открыть журнал
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => props.onViewChange('instructions')}>
                  <PilingIcon name="reports" size={14} decorative />
                  Инструкции и регламенты
                </Button>
                <Button variant="outline" className="justify-start" onClick={() => props.onViewChange('incidents')}>
                  <PilingIcon name="risk" size={14} decorative />
                  Происшествия
                </Button>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
