'use client';

/**
 * Печатная форма журнала инструктажей.
 *
 * ЧТО ЭТО ЗА ДОКУМЕНТ. Лист, который инженер ОТ распечатывает, подписывает и
 * подшивает: проверяющий просит журнал на бумаге, а не экран. Поэтому здесь нет
 * ни навигации, ни кнопок — только то, что должно лечь на лист.
 *
 * ПОЧЕМУ ОТДЕЛЬНАЯ СТРАНИЦА, А НЕ `window.print()` С ЭКРАНА. Рабочий экран
 * живёт внутри администраторской оболочки: шапка, полоса вкладок, прокручиваемые
 * контейнеры. При печати оболочка попадает на лист, а таблица обрезается по
 * краю области прокрутки — на бумаге пропадают правые графы. Документ собирается
 * своей страницей, без оболочки.
 *
 * ГРАФА «ПОДПИСЬ» ПУСТАЯ ОСОЗНАННО. Ознакомление в системе подтверждается
 * действием в рабочем месте, а не подписью на бумаге. Подделывать подпись
 * распечаткой нельзя: графа оставлена под живую подпись, если порядок у
 * заказчика её требует, а в примечании под таблицей прямо сказано, чем
 * подтверждена каждая строка.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BRIEFING_KIND_LABELS, formatJournalDay, formatJournalMoment,
  type BriefingJournalEntry, type BriefingKind,
} from '@/modules/operator-mobile/contracts';
import { formatRuDate } from '@/lib/format';
import { ROLE_LABELS, type UserRole } from '@/lib/types';

interface PrintParams {
  from: string;
  to: string;
  fromDay: string;
  toDay: string;
  kind: BriefingKind | null;
}

function readParams(): PrintParams {
  const search = new URLSearchParams(window.location.search);
  const kind = search.get('kind');
  return {
    from: search.get('from') ?? '',
    to: search.get('to') ?? '',
    fromDay: search.get('fromDay') ?? '',
    toDay: search.get('toDay') ?? '',
    kind: kind === 'INSTRUCTION' || kind === 'KNOWLEDGE' ? kind : null,
  };
}

export function BriefingJournalPrint() {
  const [params, setParams] = useState<PrintParams | null>(null);
  const [rows, setRows] = useState<BriefingJournalEntry[] | null>(null);
  const [company, setCompany] = useState('');
  const [truncated, setTruncated] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const printed = useRef(false);

  const load = useCallback(async () => {
    const current = readParams();
    setParams(current);
    if (!current.from || !current.to) {
      setFailed('В ссылке не указан период журнала.');
      return;
    }

    const search = new URLSearchParams({ from: current.from, to: current.to });
    if (current.kind) search.set('kind', current.kind);

    try {
      // Обычный fetch, а не authFetch: тот при 401 выходит из системы, и
      // случайный отказ во вспомогательной вкладке закрыл бы рабочую сессию.
      const [journal, settings] = await Promise.all([
        fetch(`/api/briefings/journal?${search.toString()}`, { credentials: 'same-origin' }),
        fetch('/api/settings', { credentials: 'same-origin' }),
      ]);
      if (!journal.ok) {
        const body = await journal.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${journal.status}`);
      }
      const body = await journal.json();
      // Хронология: журнал читают и подписывают сверху вниз по возрастанию даты.
      const entries = ((body.rows ?? []) as BriefingJournalEntry[])
        .slice()
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
      setRows(entries);
      setTruncated(Boolean(body.truncated));
      if (settings.ok) {
        setCompany(((await settings.json()) as { companyName?: string }).companyName ?? '');
      }
      setFailed(null);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить журнал');
      setRows(null);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads the document on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  // Диалог печати открываем сам и только один раз — страницу открывают ровно
  // для того, чтобы напечатать. Пустой журнал и отказ не печатаем: на лист ушла
  // бы ошибка.
  useEffect(() => {
    if (printed.current || failed || !rows || rows.length === 0) return;
    printed.current = true;
    window.print();
  }, [rows, failed]);

  // Период в заголовке — это календарные дни, которые выбрал человек
  // (`fromDay`/`toDay`). Мгновения границ в запасном варианте переводим в дни
  // местными часами, иначе конец периода 23:59 показался бы следующим днём.
  const period = params && params.fromDay && params.toDay
    ? `${formatRuDate(params.fromDay)} — ${formatRuDate(params.toDay)}`
    : params?.from && params?.to
      ? `${formatJournalDay(params.from)} — ${formatJournalDay(params.to)}`
      : '—';

  if (failed) {
    return (
      <main className="journal-sheet">
        <p role="alert" className="journal-error">{failed}</p>
      </main>
    );
  }

  if (!rows) {
    return (
      <main className="journal-sheet">
        <p>Журнал загружается…</p>
      </main>
    );
  }

  return (
    <main className="journal-sheet">
      <header className="journal-head">
        <h1>Журнал регистрации инструктажей по охране труда</h1>
        <dl className="journal-meta">
          <div><dt>Организация</dt><dd>{company || '—'}</dd></div>
          <div><dt>Период</dt><dd>{period}</dd></div>
          <div>
            <dt>Вид записей</dt>
            <dd>{params?.kind ? BRIEFING_KIND_LABELS[params.kind] : 'ознакомления и проверки знаний'}</dd>
          </div>
        </dl>
      </header>

      {truncated && (
        <p className="journal-warning">
          Внимание: записей за период больше, чем вошло в выборку — в журнале последние 1000.
          Для полного журнала распечатайте его частями по более узким периодам.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="journal-empty">За указанный период записей нет.</p>
      ) : (
        <table className="journal-table">
          <thead>
            <tr>
              <th scope="col">№</th>
              <th scope="col">Дата и время</th>
              <th scope="col">Фамилия, имя, отчество</th>
              <th scope="col">Должность</th>
              <th scope="col">Вид записи</th>
              <th scope="col">Инструкция</th>
              <th scope="col">Результат</th>
              <th scope="col">Действует до</th>
              <th scope="col">Подпись</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.id}>
                <td>{index + 1}</td>
                <td>{formatJournalMoment(row.recordedAt)}</td>
                <td>{row.userName}</td>
                <td>{ROLE_LABELS[row.userRole as UserRole] ?? row.userRole}</td>
                <td>{BRIEFING_KIND_LABELS[row.kind]}</td>
                <td>
                  {row.documentTitle}
                  <span className="journal-code"> ({row.documentCode}, в. {row.documentVersion})</span>
                </td>
                <td>{row.result ?? '—'}</td>
                <td>{row.validUntil ? formatJournalDay(row.validUntil) : 'бессрочно'}</td>
                <td className="journal-sign" />
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer className="journal-foot">
        <p>
          Всего записей за период: {rows.length}. Каждая строка — действие самого работника в
          рабочем месте: он прочитал инструкцию указанной версии либо ответил верно на все вопросы
          проверки знаний. Записи формируются системой и задним числом не изменяются.
        </p>
        <div className="journal-signatures">
          <span>Ответственный за охрану труда ____________________ / ____________________</span>
          <span>Дата составления: {formatJournalDay(new Date().toISOString())}</span>
        </div>
      </footer>
    </main>
  );
}
