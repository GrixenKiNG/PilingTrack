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
import { formatDateInTimezone } from '@/lib/timezone';
import { ROLE_LABELS, type UserRole } from '@/lib/types';

/**
 * Стили печати журнала инструктажей (R134, находки 7 и 22).
 *
 * Находка 7: добавлены CSS-счётчики @page для автоматической нумерации листов
 * «Лист N из M» вместо ручного «Лист ___ из ___». Браузеры печатают счётчики
 * в @page margin-boxes (нижний колонтитул).
 *
 * Находка 22: переопределяем .journal-code { white-space: nowrap } из print.css,
 * чтобы длинные коды/версии инструкций переносились и не вылезали за колонку.
 *
 * Стили записаны строкой в компоненте: print.css лежит вне разрешённых путей
 * (src/app/print/briefing-journal/), а импорт CSS из компонента роняет vitest.
 */
const JOURNAL_PRINT_CSS = `
@page {
  /* Нижний колонтитул с нумерацией страниц: «Лист 1 / 3» */
  @bottom-center {
    content: "Лист " counter(page) " / " counter(pages);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 8pt;
    color: #000;
  }
}

/* Находка 22: позволяем коду инструкции переноситься */
.journal-code {
  white-space: normal !important;
  word-break: break-word;
}
`;

export function JournalPrintStyles() {
  return <style dangerouslySetInnerHTML={{ __html: JOURNAL_PRINT_CSS }} />;
}

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

/**
 * Мгновение записи на листе — по поясу тенанта из настроек, а не по часам
 * браузера: инструктаж проходят до начала смены, и сдвиг часов менял бы дату
 * записи в подшиваемом журнале. Пока пояс не загружен (или настройки
 * недоступны), остаётся прежний формат по часам браузера.
 */
function sheetMoment(iso: string, timezone: string): string {
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '—';
  if (!timezone) return formatJournalMoment(iso);
  const day = formatDateInTimezone(moment, timezone, { day: '2-digit', month: '2-digit', year: 'numeric' });
  const time = formatDateInTimezone(moment, timezone, { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** День мгновения на листе — по поясу тенанта. */
function sheetDay(iso: string | null, timezone: string): string {
  if (!iso) return '—';
  if (!timezone) return formatJournalDay(iso);
  const moment = new Date(iso);
  if (Number.isNaN(moment.getTime())) return '—';
  return formatDateInTimezone(moment, timezone, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function BriefingJournalPrint() {
  const [params, setParams] = useState<PrintParams | null>(null);
  const [rows, setRows] = useState<BriefingJournalEntry[] | null>(null);
  const [company, setCompany] = useState('');
  const [inn, setInn] = useState('');
  const [timezone, setTimezone] = useState('');
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
      ]).catch(() => {
        // Обрыв сети fetch отдаёт браузерной строкой «Failed to fetch» — на
        // листе журнала по охране труда такая строка попадать не должна.
        throw new Error('Нет связи с сервером. Журнал не загружен.');
      });
      if (!journal.ok) {
        // 401 приходит английским «Unauthorized» — заменяем на понятное человеку
        // у принтера действие. Остальные отказы сервера уже на русском, их берём
        // как есть, без технического «Сервер вернул N».
        if (journal.status === 401) {
          throw new Error('Сессия истекла — откройте журнал заново из приложения.');
        }
        const body = await journal.json().catch(() => ({}));
        throw new Error(body.error || 'Сервер временно недоступен. Повторите позже.');
      }
      const body = await journal.json();
      // Хронология: журнал читают и подписывают сверху вниз по возрастанию даты.
      const entries = ((body.rows ?? []) as BriefingJournalEntry[])
        .slice()
        .sort((left, right) => left.recordedAt.localeCompare(right.recordedAt));
      setRows(entries);
      setTruncated(Boolean(body.truncated));
      if (settings.ok) {
        const config = (await settings.json()) as {
          companyName?: string; inn?: string; timezone?: string;
        };
        setCompany(config.companyName ?? '');
        setInn(config.inn ?? '');
        setTimezone(config.timezone ?? '');
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
      <JournalPrintStyles />
      <header className="journal-head">
        <h1>Журнал регистрации инструктажей по охране труда</h1>
        <dl className="journal-meta">
          <div><dt>Организация</dt><dd>{company || '—'}</dd></div>
          <div><dt>ИНН</dt><dd>{inn || '—'}</dd></div>
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
                <td>{sheetMoment(row.recordedAt, timezone)}</td>
                <td>{row.userName}</td>
                <td>{ROLE_LABELS[row.userRole as UserRole] ?? row.userRole}</td>
                <td>{BRIEFING_KIND_LABELS[row.kind]}</td>
                <td>
                  {row.documentTitle}
                  <span className="journal-code"> ({row.documentCode}, в. {row.documentVersion})</span>
                </td>
                <td>{row.result ?? '—'}</td>
                <td>{row.validUntil ? sheetDay(row.validUntil, timezone) : 'бессрочно'}</td>
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
          <span>Дата составления: {sheetDay(new Date().toISOString(), timezone)}</span>
        </div>
        {/* Нумерация листов: @page-счётчики в JournalPrintStyles печатают
            «Лист N / M» в нижнем колонтитуле. Ручная заготовка остаётся как
            фолбэк для браузеров без поддержки counter(pages). */}
        <p>Лист ___ из ___</p>
      </footer>
    </main>
  );
}
