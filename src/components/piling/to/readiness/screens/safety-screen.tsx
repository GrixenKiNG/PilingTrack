'use client';

/**
 * «ТБ и допуски» — сводка по людям: кто допущен к работе сегодня.
 *
 * ТРЕТИЙ РАЗРЕЗ, А НЕ ЧЕТВЁРТАЯ КОПИЯ. Соседние вкладки отвечают на другие
 * вопросы: «Документы» — какие БУМАГИ просрочены (у одного работника три
 * строки, у благополучного ни одной), «Инструктажи» — что происходило за
 * период. Здесь строка на человека и итог «допущены N из M» — то, с чего
 * инженер ОТ начинает утро и чего в системе не было.
 *
 * Экран ничего не считает сам: допуск приходит готовым из
 * `/api/safety/clearance`, где его считает та же функция, по которой сервер
 * пускает смену. Второй расчёт на клиенте означал бы «допущен» на экране и
 * отказ по нажатию.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Search } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { ROLE_LABELS, type UserRole } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  knowledge: { status: 'valid' | 'expired' | 'never'; validUntil: string | null; result: string | null };
  lastInstructionAt: string | null;
  acquainted: boolean;
  pendingInstructions: string[];
  overdueBriefings: string[];
}

interface ClearanceOverview {
  rows: ClearanceRow[];
  totals: {
    people: number; cleared: number; blocked: number; expiring: number;
    knowledgeOverdue: number; briefingsOverdue: number; awaitingAcquaintance: number;
  };
  requiredTypesConfigured: boolean;
}

const KNOWLEDGE_LABEL: Record<ClearanceRow['knowledge']['status'], string> = {
  valid: 'Сдана',
  expired: 'Просрочена',
  never: 'Не сдавал',
};

/**
 * Худшие строки — первыми. Список открывают, чтобы найти тех, кого нельзя
 * пускать, а не чтобы читать его целиком по алфавиту.
 */
function severity(row: ClearanceRow): number {
  if (!row.cleared) return 0;
  // Просроченный повторный инструктаж — нарушение, а не предупреждение: он
  // идёт сразу за отсутствием допуска и раньше непройденной проверки знаний.
  if (row.overdueBriefings.length > 0) return 1;
  if (!row.acquainted) return 2;
  if (row.knowledge.status !== 'valid') return 3;
  if (row.warnings.length > 0) return 4;
  return 5;
}

export function SafetyScreen(props: ReferenceUiProps) {
  const [data, setData] = useState<ClearanceOverview | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try {
      const response = await authFetch('/api/safety/clearance');
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setData((await response.json()) as ClearanceOverview);
      setFailed(null);
    } catch (error) {
      // Пустой список вместо ошибки читался бы как «все допущены» — на экране
      // допусков это худшая из возможных подмен.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить допуски');
      setData(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const visible = useMemo(() => {
    const rows = data?.rows ?? [];
    return rows
      .filter((row) => !needle
        || row.name.toLocaleLowerCase('ru-RU').includes(needle)
        || (ROLE_LABELS[row.role as UserRole] ?? row.role).toLocaleLowerCase('ru-RU').includes(needle))
      .slice()
      .sort((left, right) => severity(left) - severity(right) || left.name.localeCompare(right.name, 'ru-RU'));
  }, [data, needle]);

  const totals = data?.totals;

  return (
    <>
      <ScreenTitle
        heading="ТБ и допуски"
        subtitle="Кто допущен к работе сегодня — по обязательным документам и проверке знаний"
        actions={(
          <Button variant="outline" onClick={() => { setData(null); void load(); }}>Обновить</Button>
        )}
      />

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(5)}>
        <RefKpi
          icon="accepted"
          label="Допущены к работе"
          tone="success"
          value={totals ? `${totals.cleared} из ${totals.people}` : '—'}
          detail="все обязательные документы действуют"
        />
        <RefKpi
          icon="defect"
          label="Нет допуска"
          tone="danger"
          value={totals?.blocked ?? '—'}
          alert={Boolean(totals?.blocked)}
          detail="работать нельзя до продления"
        />
        <RefKpi
          icon="history"
          label="Истекают документы"
          tone="warning"
          value={totals?.expiring ?? '—'}
          detail="в пределах срока предупреждения"
        />
        <RefKpi
          icon="documents"
          label="Ожидают ознакомления"
          tone="warning"
          value={totals?.awaitingAcquaintance ?? '—'}
          detail="не читали действующую редакцию"
        />
        <RefKpi
          icon="risk"
          label="Проверка знаний"
          tone="info"
          value={totals?.knowledgeOverdue ?? '—'}
          detail="просрочена или не сдавалась"
        />
      </section>

      {/* Ни одного обязательного вида документа — значит допуск не проверяется
          ничем, и «допущены все» получается само собой. Молчать об этом
          нельзя: зелёная плитка на непроверенных людях хуже пустого экрана. */}
      {data && !data.requiredTypesConfigured && (
        <p role="alert" className="mt-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-warning-strong">
          Обязательные виды документов не заданы, поэтому допуск сейчас не проверяется ничем и все
          работники числятся допущенными. Отметьте нужные виды как обязательные в карточке работника
          — раздел «Виды документов».
        </p>
      )}

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-bold">Работники и статус допуска</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Действующие работники, выходящие на площадку. Сначала те, кого нельзя допускать.
            </p>
          </div>
          <div className="relative min-w-[220px] sm:w-64">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              aria-label="Поиск по работникам"
              className="h-8 bg-muted pl-9 text-xs"
              placeholder="Фамилия или роль"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        {data === null && !failed && (
          <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
        )}

        {data !== null && visible.length === 0 && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            {data.rows.length === 0
              ? 'Действующих работников на площадке не найдено.'
              : 'По запросу ничего не найдено.'}
          </p>
        )}

        {visible.length > 0 && (
          <div className="mt-3 divide-y divide-border">
            {visible.map((row) => (
              <div key={row.userId} className="flex flex-wrap items-start gap-3 py-2 text-sm">
                <span
                  className={cn(
                    'mt-0.5 shrink-0 rounded-full px-2 py-0.5 text-2xs font-semibold',
                    row.cleared
                      ? 'bg-success/10 text-success-strong'
                      : 'bg-destructive/10 text-destructive-strong',
                  )}
                >
                  {row.cleared ? 'Допущен' : 'Нет допуска'}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{row.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {ROLE_LABELS[row.role as UserRole] ?? row.role}
                  </div>
                  {/* Препятствия и предупреждения приходят готовыми строками из
                      того же расчёта, что видит сам работник на своём экране. */}
                  {row.blockers.map((blocker) => (
                    <div key={blocker} className="mt-1 text-xs text-destructive-strong">{blocker}</div>
                  ))}
                  {row.overdueBriefings.map((overdue) => (
                    <div key={overdue} className="mt-1 text-xs text-destructive-strong">{overdue}</div>
                  ))}
                  {row.pendingInstructions.map((pending) => (
                    <div key={pending} className="mt-1 text-xs text-warning-strong">{pending}</div>
                  ))}
                  {row.warnings.map((warning) => (
                    <div key={warning} className="mt-1 text-xs text-warning-strong">{warning}</div>
                  ))}
                </div>

                <div className="w-40 shrink-0 text-xs">
                  <div className="text-muted-foreground">Проверка знаний</div>
                  <div
                    className={cn(
                      'font-semibold',
                      row.knowledge.status === 'valid' ? 'text-success-strong' : 'text-warning-strong',
                    )}
                  >
                    {KNOWLEDGE_LABEL[row.knowledge.status]}
                    {row.knowledge.result ? ` · ${row.knowledge.result}` : ''}
                  </div>
                  <div className="text-muted-foreground">
                    {row.knowledge.validUntil ? `до ${formatRuDate(row.knowledge.validUntil)}` : 'срок не указан'}
                  </div>
                </div>

                <div className="w-36 shrink-0 text-xs">
                  <div className="text-muted-foreground">Инструктаж</div>
                  <div className={cn('font-semibold',
                    row.overdueBriefings.length ? 'text-destructive-strong' : '')}>
                    {row.lastInstructionAt ? formatRuDate(row.lastInstructionAt) : 'нет записей'}
                  </div>
                  <div className={row.acquainted ? 'text-success-strong' : 'text-warning-strong'}>
                    {row.acquainted ? 'ознакомлен' : 'ждёт ознакомления'}
                  </div>
                </div>

                {/* Строка заканчивается действием: продлевают документы и
                    заводят записи в карточке работника — туда и ведём. */}
                <Button asChild variant="outline" className="h-8 text-2xs">
                  <Link href="/admin/users">Карточка</Link>
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Допуск к смене держат обязательные документы: пока хоть один просрочен или отсутствует,
        смена не откроется. Проверка знаний показана отдельной колонкой и на допуск не влияет — её
        просрочка это повод назначить проверку, а не запрет на работу. Подробности по бумагам — на
        вкладке «Документы», история проведённых инструктажей — на вкладке «Инструктажи».
        {props.bootstrap?.tenant.timezone ? ` Время тенанта: ${props.bootstrap.tenant.timezone}.` : ''}
      </p>
    </>
  );
}
