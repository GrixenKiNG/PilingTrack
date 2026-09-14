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
  BRIEFING_KIND_LABELS, BRIEFING_TYPE_LABELS, BRIEFING_TYPE_ORDER,
  currentMonthRange, dayRangeToInstants, formatJournalDay,
  formatJournalMoment, type BriefingJournalEntry, type BriefingKind,
  type BriefingJournalStatus, type BriefingType,
} from '@/modules/operator-mobile/contracts';
import { BriefingConductDialog } from './briefing-conduct-dialog';
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
type TypeFilter = BriefingType | '';
type StatusFilter = BriefingJournalStatus | '';

/**
 * Строка журнала плюс необязательный объект. `/api/briefings/journal` пока не
 * отдаёт площадку в каждой строке, поэтому поле добавлено как необязательное
 * расширение импортируемого типа — без изменения общей формы `BriefingJournalEntry`.
 */
type JournalRow = BriefingJournalEntry & { siteName?: string };

/** Отметка подписи в графе: дата или честное «нет». */
function signatureCell(iso: string | null) {
  return iso
    ? <span className="whitespace-nowrap text-success-strong">✓ {formatJournalDay(iso)}</span>
    : <span className="text-muted-foreground">—</span>;
}

/** Календарный день `ГГГГ-ММ-ДД` по местным часам — сравнение «сегодня/вчера». */
function dayKey(date: Date): string {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Шаги панели регистрации: путь от выбора человека до подписи. */
const REGISTRATION_STEPS = [
  { title: 'Выбор сотрудника', detail: 'Найти и выбрать сотрудника' },
  { title: 'Выбор вида инструктажа', detail: 'Вводный, первичный, повторный, внеплановый, целевой' },
  { title: 'Программа инструктажа', detail: 'Выбрать из шаблона или указать основание' },
  { title: 'Электронная подпись', detail: 'Подпись сотрудника и инструктора' },
];

/** Типовые программы инструктажа — витрина шаблонов. */
const PROGRAM_TEMPLATES = [
  'Общие требования охраны труда',
  'Работы на высоте',
  'Буровые и свайные работы',
  'Работы вблизи ЛЭП',
  'Пожарная безопасность',
];

/** Одно событие упрощённой истории изменений записи. */
interface HistoryEvent {
  at: string;
  action: string;
  user: string;
  role: string;
  comment: string;
}

export function BriefingsScreen(props: ReferenceUiProps) {
  const defaults = useMemo(() => currentMonthRange(), []);
  const [fromDay, setFromDay] = useState(defaults.from);
  const [toDay, setToDay] = useState(defaults.to);
  const [kind, setKind] = useState<KindFilter>('');
  const [type, setType] = useState<TypeFilter>('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [site, setSite] = useState('');
  const [instructor, setInstructor] = useState('');
  const [conducting, setConducting] = useState(false);
  const [employees, setEmployees] = useState<Array<{id: string; name: string; role: string}>>([]);
  const [rows, setRows] = useState<JournalRow[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    const period = dayRangeToInstants(fromDay, toDay);
    const search = new URLSearchParams({ from: period.from, to: period.to });
    if (kind) search.set('kind', kind);
    if (type) search.set('type', type);
    if (status) search.set('status', status);
    try {
      const response = await authFetch(`/api/briefings/journal?${search.toString()}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      const body = await response.json();
      setRows((body.rows ?? []) as JournalRow[]);
      setTruncated(Boolean(body.truncated));
      setFailed(null);
    } catch (error) {
      // Пустой список молча читался бы как «инструктажей не было» — для журнала
      // это худшая из ошибок: именно его отсутствие и есть нарушение.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить журнал');
      setRows(null);
    }
  }, [fromDay, toDay, kind, type, status]);

  /**
   * Кого можно инструктировать. Берём тот же список работников, что и сводка
   * допусков: инструктаж проводят действующим людям с площадки, а не всем
   * учётным записям организации.
   */
  const loadEmployees = useCallback(async () => {
    try {
      const response = await authFetch('/api/safety/clearance');
      if (!response.ok) return;
      const body = await response.json();
      setEmployees((body.rows ?? []).map((row: {userId: string; name: string; role: string}) => ({
        id: row.userId, name: row.name, role: row.role,
      })));
    } catch {
      // Список работников — удобство формы, а не данные журнала: его пропажа
      // не должна гасить сам журнал. Форма просто не откроется пустой — в ней
      // будет видно, что выбирать не из чего.
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount and on filter change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the employee picker once; the async loader sets state
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);

  const openPrintForm = () => {
    const period = dayRangeToInstants(fromDay, toDay);
    const search = new URLSearchParams({ from: period.from, to: period.to, fromDay, toDay });
    if (kind) search.set('kind', kind);
    window.open(`/print/briefing-journal?${search.toString()}`, '_blank', 'noopener');
  };

  const instructions = rows?.filter((row) => row.kind === 'INSTRUCTION') ?? [];
  const knowledge = rows?.filter((row) => row.kind === 'KNOWLEDGE') ?? [];
  const people = new Set((rows ?? []).map((row) => row.userId)).size;
  const awaiting = (rows ?? []).filter((row) => row.status === 'awaiting');

  /**
   * Дополнительные показатели журнала. Все числа считаются из уже загруженного
   * массива `rows` за выбранный период — ничего не дорисовываем.
   */
  const stats = useMemo(() => {
    const list = rows ?? [];
    const today = new Date();
    const todayKey = dayKey(today);
    const yesterdayKey = dayKey(new Date(today.getTime() - 86_400_000));
    const todayCount = list.filter((row) => dayKey(new Date(row.recordedAt)) === todayKey).length;
    const yesterdayCount = list.filter((row) => dayKey(new Date(row.recordedAt)) === yesterdayKey).length;
    const delta = todayCount - yesterdayCount;
    const inPeriod = (day: string) => fromDay <= day && day <= toDay;
    return {
      todayCount,
      // Сравнение с вчера честно, только если обе даты попали в выборку.
      todayDetail: inPeriod(todayKey) && inPeriod(yesterdayKey)
        ? `в сравнении со вчера: ${delta >= 0 ? '+' : ''}${delta}`
        : 'проведено за сегодня',
      unscheduled: list.filter((row) => row.type === 'UNSCHEDULED').length,
      targeted: list.filter((row) => row.type === 'TARGETED').length,
      objectBriefings: list.filter((row) => row.kind === 'INSTRUCTION').length,
    };
  }, [rows, fromDay, toDay]);

  /** Опции фильтра «Объект» — уникальные площадки из загруженных строк. */
  const siteOptions = useMemo(() => Array.from(new Set(
    (rows ?? []).map((row) => row.siteName).filter((value): value is string => Boolean(value)),
  )).sort((a, b) => a.localeCompare(b, 'ru')), [rows]);

  /** Опции фильтра «Инструктор» — уникальные инструкторы из загруженных строк. */
  const instructorOptions = useMemo(() => Array.from(new Set(
    (rows ?? []).map((row) => row.instructorName).filter(Boolean),
  )).sort((a, b) => a.localeCompare(b, 'ru')), [rows]);

  const needle = query.trim().toLocaleLowerCase('ru-RU');
  const visible = (rows ?? []).filter((row) => {
    if (needle) {
      const haystack = [
        row.userName,
        row.userRole,
        ROLE_LABELS[row.userRole as UserRole] ?? '',
        row.siteName ?? '',
        row.documentTitle,
        row.documentCode,
      ].join(' ').toLocaleLowerCase('ru-RU');
      if (!haystack.includes(needle)) return false;
    }
    if (site && (row.siteName ?? '') !== site) return false;
    if (instructor && row.instructorName !== instructor) return false;
    return true;
  });

  /**
   * Упрощённая производная история изменений записи: по последним строкам журнала
   * показываем факт создания записи и её текущее подтверждение. Это не серверный
   * аудит — подпись об этом стоит под таблицей.
   */
  const historyEvents = useMemo<HistoryEvent[]>(() => {
    const source = (rows ?? []).slice(-6).reverse();
    const events: HistoryEvent[] = [];
    for (const row of source) {
      events.push({
        at: row.recordedAt,
        action: 'Создана запись',
        user: row.instructorName || '—',
        role: 'Инструктор',
        comment: row.reason || '—',
      });
      events.push({
        at: row.instructorSignedAt ?? row.employeeSignedAt ?? row.recordedAt,
        action: 'Изменён статус',
        user: row.instructorName || '—',
        role: 'Инструктор',
        comment: row.status === 'signed' ? 'Подтверждён' : 'Ожидает',
      });
    }
    return events;
  }, [rows]);

  return (
    <>
      <ScreenTitle
        heading="Инструктажи"
        subtitle="Журнал ознакомлений с инструкциями и проверок знаний"
        actions={(
          <div className="flex gap-2">
            <Button onClick={() => setConducting(true)}>
              <PilingIcon name="add" size={14} decorative />
              Провести инструктаж
            </Button>
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

      <section className={COMPACT_KPI_GRID} style={kpiGridStyle(4)}>
        <RefKpi icon="documents" label="Ознакомлений" tone="info" value={instructions.length}
          detail="прочтений инструкции за период" />
        <RefKpi icon="accepted" label="Проверок знаний" tone="success" value={knowledge.length}
          detail="сданных проверок за период" />
        <RefKpi icon="users" label="Работников" tone="neutral" value={people}
          detail="человек в журнале за период" />
        <RefKpi icon="history" label="Ожидают подтверждения" tone="warning"
          value={awaiting.length} alert={awaiting.length > 0}
          detail="стоит меньше двух отметок" />
      </section>

      {/* Дополнительные показатели эталонного экрана. Считаются из rows. */}
      <section className={cn(COMPACT_KPI_GRID, 'mt-2')} style={kpiGridStyle(5)}>
        <RefKpi icon="calendar" label="Сегодня проведено" tone="info" value={stats.todayCount}
          detail={stats.todayDetail} />
        {/* Статуса просрочки в журнале нет: состояние только «подтверждён/ожидает». */}
        <RefKpi icon="history" label="Просрочены повторные" tone="warning" value={0}
          detail="статус просрочки в журнале не ведётся" />
        <RefKpi icon="shift-start" label="Внеплановые за месяц" tone="warning" value={stats.unscheduled}
          detail="внеплановых инструктажей за период" />
        <RefKpi icon="site" label="Инструктажи по объектам" tone="neutral" value={stats.objectBriefings}
          detail={`за период ${fromDay} — ${toDay}`} />
        <RefKpi icon="inspection" label="Целевые допуски" tone="success" value={stats.targeted}
          detail="целевых инструктажей за период" />
      </section>

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      <div className="mt-2 grid gap-2 xl:grid-cols-[minmax(0,1fr)_330px] xl:items-start">
        <section className={cn(card, 'p-3')}>
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
                Вид инструктажа
                <select aria-label="Вид инструктажа" value={type}
                  onChange={(event) => setType(event.target.value as TypeFilter)}
                  className="h-8 min-w-[150px] rounded-md border border-input bg-background px-3 text-xs text-foreground">
                  <option value="">Все виды</option>
                  {BRIEFING_TYPE_ORDER.map((value) => (
                    <option key={value} value={value}>{BRIEFING_TYPE_LABELS[value]}</option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-2xs text-muted-foreground">
                Состояние
                <select aria-label="Состояние записи" value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                  className="h-8 min-w-[170px] rounded-md border border-input bg-background px-3 text-xs text-foreground">
                  <option value="">Любое</option>
                  <option value="awaiting">Ожидает подтверждения</option>
                  <option value="signed">Подтверждён</option>
                </select>
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
              {/* Объект и инструктор фильтруются на клиенте: сервер их не принимает. */}
              <label className="grid gap-1 text-2xs text-muted-foreground">
                Объект
                <select aria-label="Объект" value={site}
                  onChange={(event) => setSite(event.target.value)}
                  className="h-8 min-w-[160px] rounded-md border border-input bg-background px-3 text-xs text-foreground">
                  <option value="">Все объекты</option>
                  {siteOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-2xs text-muted-foreground">
                Инструктор
                <select aria-label="Инструктор" value={instructor}
                  onChange={(event) => setInstructor(event.target.value)}
                  className="h-8 min-w-[160px] rounded-md border border-input bg-background px-3 text-xs text-foreground">
                  <option value="">Все инструкторы</option>
                  {instructorOptions.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
              </label>
            </div>
            <div className="relative min-w-[220px] sm:w-64">
              <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
              <Input aria-label="Поиск по журналу" className="h-8 bg-muted pl-9 text-xs"
                placeholder="Поиск по сотруднику, должности, объекту..." value={query}
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
              <table className="w-full min-w-[1280px] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-semibold">Дата и время</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Вид инструктажа</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Работник</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Должность</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Объект</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Инструктор</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Основание</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Инструкция</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Работник подтвердил</th>
                    <th scope="col" className="py-2 pr-3 font-semibold">Инструктор подтвердил</th>
                    <th scope="col" className="py-2 font-semibold">Состояние</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {visible.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2 pr-3 whitespace-nowrap">{formatJournalMoment(row.recordedAt)}</td>
                      <td className="py-2 pr-3">
                        {/* Вид есть только у инструктажа. У проверки знаний его
                            нет, и у записей до 13.09.2026 — тоже: показываем,
                            что вида нет, а не выдумываем «Повторный». */}
                        <div>{row.type ? BRIEFING_TYPE_LABELS[row.type] : BRIEFING_KIND_LABELS[row.kind]}</div>
                        {row.kind === 'KNOWLEDGE' && row.result && (
                          <div className="text-2xs text-muted-foreground">{row.result}</div>
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        <div className="font-medium">{row.userName}</div>
                        <div className="text-2xs text-muted-foreground">
                          {ROLE_LABELS[row.userRole as UserRole] ?? row.userRole}
                        </div>
                      </td>
                      <td className="py-2 pr-3 whitespace-nowrap">
                        {ROLE_LABELS[row.userRole as UserRole] ?? row.userRole}
                      </td>
                      <td className="py-2 pr-3">
                        {row.siteName ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-3">
                        {row.instructorName || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-3 max-w-[200px]">
                        {row.reason || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="py-2 pr-3">
                        <div>{row.documentTitle}</div>
                        <div className="text-2xs text-muted-foreground">
                          {row.documentCode}, в. {row.documentVersion}
                          {row.validUntil ? ` · до ${formatJournalDay(row.validUntil)}` : ''}
                        </div>
                      </td>
                      <td className="py-2 pr-3">{signatureCell(row.employeeSignedAt)}</td>
                      <td className="py-2 pr-3">{signatureCell(row.instructorSignedAt)}</td>
                      <td className="py-2 whitespace-nowrap">
                        <span className={cn(
                          'rounded-full px-2 py-0.5 text-2xs font-semibold',
                          row.status === 'signed'
                            ? 'bg-success/10 text-success-strong'
                            : 'bg-warning/10 text-warning-strong',
                        )}>
                          {row.status === 'signed' ? 'Подтверждён' : 'Ожидает'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Правый блок эталона: действие, шаги регистрации, шаблоны, печать. */}
        <aside className="grid gap-2">
          <Button onClick={() => setConducting(true)} className="w-full">
            <PilingIcon name="add" size={14} decorative />
            Провести инструктаж
          </Button>

          <section className={cn(card, 'p-3')}>
            <h2 className="text-sm font-semibold text-foreground">Панель регистрации</h2>
            <ol className="mt-2 grid gap-2">
              {REGISTRATION_STEPS.map((step, index) => (
                <li key={step.title} className="flex gap-2">
                  <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <div>
                    <div className="text-xs font-medium text-foreground">{step.title}</div>
                    <div className="text-2xs text-muted-foreground">{step.detail}</div>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section className={cn(card, 'p-3')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-foreground">Шаблоны программ</h2>
              <button type="button" className="text-2xs font-medium text-primary hover:underline">
                Все шаблоны →
              </button>
            </div>
            <ul className="mt-2 grid gap-1.5">
              {PROGRAM_TEMPLATES.map((name) => (
                <li key={name} className="flex items-center gap-2 text-xs text-foreground">
                  <PilingIcon name="documents" size={14} decorative className="text-muted-foreground" />
                  {name}
                </li>
              ))}
            </ul>
          </section>

          <section className={cn(card, 'p-3')}>
            <h2 className="text-sm font-semibold text-foreground">Выгрузка и печать</h2>
            <Button variant="outline" className="mt-2 w-full" onClick={openPrintForm}
              disabled={!rows || rows.length === 0}>
              <PilingIcon name="print" size={14} decorative />
              Печатная форма журнала
            </Button>
          </section>
        </aside>
      </div>

      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-xs leading-relaxed text-muted-foreground">
        Записи появляются двумя путями: работник читает инструкцию и сдаёт проверку знаний сам на
        своём рабочем месте перед сменой, либо инструктор заносит проведённый инструктаж кнопкой
        «Провести инструктаж». Запись считается подтверждённой, когда отметки поставили оба —
        и работник, и инструктор. Отметка в приложении фиксирует, кто и когда подтвердил; это
        внутренний журнал, а не квалифицированная электронная подпись. Задним числом журнал не
        правится: действующие подтверждения и сроки показывает вкладка «Документы».
        {props.bootstrap?.tenant.timezone ? ` Время тенанта: ${props.bootstrap.tenant.timezone}.` : ''}
      </p>

      <section className={cn(card, 'mt-2 p-3')}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-foreground">История изменений записи</h2>
          <button type="button" className="text-2xs font-medium text-primary hover:underline">
            Все события →
          </button>
        </div>

        {historyEvents.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Событий за выбранный период нет.</p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-semibold">Дата и время</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Действие</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Пользователь</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Роль</th>
                  <th scope="col" className="py-2 font-semibold">Комментарий</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {historyEvents.map((event, index) => (
                  <tr key={`${event.at}-${event.action}-${index}`}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatJournalMoment(event.at)}</td>
                    <td className="py-2 pr-3">{event.action}</td>
                    <td className="py-2 pr-3">{event.user}</td>
                    <td className="py-2 pr-3">{event.role}</td>
                    <td className="py-2 max-w-[280px]">{event.comment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-2xs text-muted-foreground">
              Упрощённая производная история: события построены по загруженным записям журнала
              и не заменяют серверный аудит.
            </p>
          </div>
        )}
      </section>

      <BriefingConductDialog
        open={conducting}
        employees={employees}
        onClose={() => setConducting(false)}
        onDone={() => { setRows(null); void load(); }}
      />
    </>
  );
}
