'use client';

import {useCallback, useEffect, useState} from 'react';
import {
  INCIDENT_CATEGORY_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_SIGN_LABELS,
  type IncidentCategory, type IncidentSeverity, type IncidentSign,
} from '@/modules/operator-mobile/contracts';
import {authFetch} from '@/lib/api';
import {cn} from '@/lib/utils';
import {usePilingStore} from '@/lib/store';
import {resolveEffectiveRole} from '@/lib/types';
import {can} from '@/services/auth/authorization-service';

/**
 * Разбор происшествий на сменах.
 *
 * ЗАЧЕМ ЭКРАН. Машинист заводит происшествие с телефона — и до этого экрана
 * прочитать его было негде. Красное висело у него в кабине, в чат уходило
 * сообщение, запись ложилась в базу; места, где происшествие разбирают и
 * закрывают выводом, не существовало. Учёт без разбора — это архив.
 *
 * ПОЧЕМУ ПО УМОЛЧАНИЮ ТОЛЬКО НЕРАЗОБРАННОЕ. Экран открывают, чтобы увидеть,
 * что требует решения сегодня. История нужна раз в квартал и живёт за
 * переключателем.
 */

interface IncidentRow {
  id: string;
  category: IncidentCategory;
  severity: IncidentSeverity;
  state: string;
  description: string;
  signs: IncidentSign[];
  injured: boolean;
  stopRequired: boolean;
  occurredAt: string;
  photos: number;
  reviewedAt: string | null;
  reviewNote: string | null;
  reportedBy: string;
  equipmentName: string;
  siteName: string;
}

const SEVERITY_TONE: Record<IncidentSeverity, string> = {
  CRITICAL: 'border-destructive/40 bg-destructive/5',
  HIGH: 'border-warning/40 bg-warning/5',
  NORMAL: 'border-border bg-card',
};

const formatMoment = (iso: string) => new Date(iso).toLocaleString('ru-RU', {
  day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/**
 * Текст отказа для человека. Серверный `error` показываем как есть, а не-JSON
 * ответ шлюза (502/504 HTML) — понятной строкой вместо английского SyntaxError.
 */
async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.error === 'string' && body.error) return body.error;
  } catch {
    // Страница ошибки прокси вместо JSON — ниже подставим понятный текст.
  }
  return 'Сервер вернул неожиданный ответ. Повторите попытку.';
}

async function fetchIncidents(
  scope: 'open' | 'all',
): Promise<{rows: IncidentRow[]} | {error: string}> {
  let response: Response;
  try {
    response = await authFetch(`/api/admin/incidents?scope=${scope}`);
  } catch {
    // Браузер отдаёт «Failed to fetch»/«NetworkError…» — человеку нужен русский текст.
    return {error: 'Нет связи с сервером. Проверьте интернет и повторите.'};
  }
  if (!response.ok) return {error: await readErrorMessage(response)};
  const body = await response.json().catch(() => null);
  if (!body || !Array.isArray(body.data)) {
    return {error: 'Сервер вернул неожиданный ответ. Повторите попытку.'};
  }
  return {rows: body.data as IncidentRow[]};
}

/**
 * Право на разбор считается по исполняемой роли — той же, по которой его
 * считает сервер (`incidents.review` в authorization-service). Экран здесь
 * только прячет кнопку: отказ всё равно придёт от API, и прятать кнопку нужно
 * ради того, чтобы её не искали, а не ради безопасности.
 */
const canReview = (user: { role: string } | null, actingAs: string | null) =>
  can({...user, role: resolveEffectiveRole(user?.role ?? '', actingAs)}, 'incidents.review');

export function AdminIncidents() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const actingAs = usePilingStore((state) => state.actingAs);
  const allowReview = canReview(currentUser, actingAs);
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const [reloadToken, setReloadToken] = useState(0);
  // Перезагрузка чистит прошлый список и отказ: старые строки не должны
  // показываться под сообщением об ошибке нового отбора.
  const load = useCallback(() => {
    setRows(null);
    setError(null);
    setReloadToken((token) => token + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = await fetchIncidents(scope);
      if (cancelled) return;
      if ('error' in next) setError(next.error);
      else { setRows(next.rows); setError(null); }
    })();
    return () => { cancelled = true; };
  }, [scope, reloadToken]);

  const review = async (id: string) => {
    setBusy(true);
    setReviewError(null);
    setNotice(null);
    try {
      const response = await authFetch('/api/admin/incidents', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({id, note: note.trim()}),
      });
      if (response.status === 409) {
        // Происшествие разобрали, пока форма была открыта. Перечитываем список и
        // закрываем форму: иначе строка снова предложит «Разобрать», а повтор
        // упрётся в тот же отказ — круг без выхода.
        setOpenForm(null);
        setNote('');
        setNotice('Это происшествие уже разобрали — список обновлён');
        load();
        return;
      }
      if (!response.ok) {
        // Отказ показываем рядом с формой, а не вверху страницы: в длинном
        // списке верхний абзац остаётся за экраном.
        setReviewError(await readErrorMessage(response));
        return;
      }
      // Форма закрывается только после ответа сервера — вывод разбора человек
      // пишет один раз, и терять его из-за оборвавшегося запроса нельзя.
      setOpenForm(null);
      setNote('');
      load();
    } catch {
      setReviewError('Нет связи с сервером. Проверьте интернет и повторите.');
    } finally {
      setBusy(false);
    }
  };

  const unreviewed = rows?.filter((row) => row.reviewedAt === null).length ?? 0;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Происшествия</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {rows === null
              ? (error ? 'Не удалось загрузить — счёт неизвестен' : null)
              : unreviewed > 0
                ? `Ждут разбора: ${unreviewed}`
                : 'Неразобранных происшествий нет'}
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Что показывать">
          {([['open', 'Ждут разбора'], ['all', 'Все']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => {
                // Смена отбора начинается с чистого экрана: иначе при отказе
                // под ошибкой останутся строки прежней вкладки.
                if (id !== scope) { setRows(null); setError(null); }
                setScope(id);
                setNotice(null);
              }}
              className={cn(
                'min-h-9 rounded-md border px-3 text-sm font-medium transition-colors',
                scope === id ? 'border-signal bg-signal/10 text-signal' : 'bg-card hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {error ? (
        <div className="space-y-2">
          <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
          <button
            type="button"
            onClick={() => {setNotice(null); load();}}
            className="min-h-9 rounded-md border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
          >
            Повторить
          </button>
        </div>
      ) : null}

      {notice ? (
        <p className="rounded-md border border-signal/40 bg-signal/5 px-3 py-2 text-sm">{notice}</p>
      ) : null}

      {rows === null ? (
        error ? null : <p className="text-sm text-muted-foreground">Загружаем…</p>
      ) : rows.length === 0 ? (
        <p className="rounded-md border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
          {scope === 'open'
            ? 'Ничего не ждёт разбора. Это хорошая новость.'
            : 'Происшествий пока не заводили.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className={cn('rounded-lg border p-4 shadow-xs', SEVERITY_TONE[row.severity])}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-base font-semibold">
                  {INCIDENT_CATEGORY_LABELS[row.category] ?? row.category}
                </h2>
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-2xs font-bold uppercase tracking-wider',
                    row.severity === 'CRITICAL' ? 'bg-destructive text-white'
                      : row.severity === 'HIGH' ? 'bg-warning text-white'
                        : 'bg-muted text-muted-foreground',
                  )}
                >
                  {INCIDENT_SEVERITY_LABELS[row.severity] ?? row.severity}
                </span>
                {row.injured ? (
                  <span className="rounded-full bg-destructive px-2 py-0.5 text-2xs font-bold uppercase tracking-wider text-white">
                    Есть пострадавшие
                  </span>
                ) : null}
                {row.reviewedAt ? (
                  <span className="rounded-full bg-success px-2 py-0.5 text-2xs font-bold uppercase tracking-wider text-white">
                    Разобрано
                  </span>
                ) : null}
              </div>

              <p className="mt-2 text-sm">{row.description}</p>

              <dl className="mt-3 grid gap-x-6 gap-y-1 text-2xs text-muted-foreground sm:grid-cols-2">
                <div className="flex gap-2"><dt>Когда:</dt><dd className="font-medium text-foreground">{formatMoment(row.occurredAt)}</dd></div>
                <div className="flex gap-2"><dt>Записал:</dt><dd className="font-medium text-foreground">{row.reportedBy}</dd></div>
                <div className="flex gap-2"><dt>Установка:</dt><dd className="font-medium text-foreground">{row.equipmentName}</dd></div>
                <div className="flex gap-2"><dt>Объект:</dt><dd className="font-medium text-foreground">{row.siteName}</dd></div>
                <div className="flex gap-2 sm:col-span-2">
                  <dt>Признаки:</dt>
                  <dd className="font-medium text-foreground">
                    {row.signs.map((sign) => INCIDENT_SIGN_LABELS[sign] ?? sign).join(', ') || '—'}
                  </dd>
                </div>
                {row.photos > 0 ? (
                  <div className="flex gap-2"><dt>Снимков:</dt><dd className="font-medium text-foreground">{row.photos}</dd></div>
                ) : null}
              </dl>

              {row.stopRequired && !row.reviewedAt ? (
                <p className="mt-3 text-2xs font-semibold text-destructive">
                  Правило требовало прекратить работы и привести машину в безопасное состояние.
                </p>
              ) : null}

              {row.reviewNote ? (
                <div className="mt-3 rounded-md border border-success/40 bg-success/5 px-3 py-2">
                  <p className="text-2xs font-semibold uppercase tracking-wider text-success">
                    Вывод разбора{row.reviewedAt ? ` · ${formatMoment(row.reviewedAt)}` : ''}
                  </p>
                  <p className="mt-1 text-sm">{row.reviewNote}</p>
                </div>
              ) : null}

              {allowReview && !row.reviewedAt ? (
                openForm === row.id ? (
                  <div className="mt-3 space-y-2">
                    <label htmlFor={`note-${row.id}`} className="block text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
                      К чему пришли и что меняем
                    </label>
                    <textarea
                      id={`note-${row.id}`}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={3}
                      maxLength={4000}
                      placeholder="Разобрали с бригадой, зону оградили, инструктаж повторили"
                      className="w-full rounded-md border bg-card px-3 py-2 text-sm shadow-xs"
                    />
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => void review(row.id)}
                        disabled={note.trim().length < 10 || busy}
                        className="min-h-9 rounded-md border border-signal bg-signal px-4 text-sm font-semibold text-white transition-colors hover:bg-signal-strong disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {busy ? 'Записываем…' : 'Записать разбор'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {setOpenForm(null); setNote(''); setReviewError(null);}}
                        className="min-h-9 rounded-md border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        Отмена
                      </button>
                    </div>
                    {reviewError ? (
                      <p className="text-sm text-destructive">{reviewError}</p>
                    ) : null}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {setOpenForm(row.id); setNote(''); setReviewError(null);}}
                    className="mt-3 min-h-9 rounded-md border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
                  >
                    Разобрать
                  </button>
                )
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
