'use client';

import {useCallback, useEffect, useState} from 'react';
import {
  INCIDENT_CATEGORY_LABELS, INCIDENT_SEVERITY_LABELS, INCIDENT_SIGN_LABELS,
  type IncidentCategory, type IncidentSeverity, type IncidentSign,
} from '@/modules/operator-mobile/contracts';
import {cn} from '@/lib/utils';
import {usePilingStore} from '@/lib/store';
import {resolveEffectiveRole} from '@/lib/types';

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

async function fetchIncidents(
  scope: 'open' | 'all',
): Promise<{rows: IncidentRow[]} | {error: string}> {
  try {
    const response = await fetch(`/api/admin/incidents?scope=${scope}`, {credentials: 'same-origin'});
    const body = await response.json();
    if (!response.ok) return {error: body?.error ?? 'Не удалось загрузить происшествия'};
    return {rows: body.data as IncidentRow[]};
  } catch (error) {
    return {error: error instanceof Error ? error.message : 'Не удалось загрузить происшествия'};
  }
}

/**
 * Право на разбор считается по исполняемой роли — той же, по которой его
 * считает сервер. Экран здесь только прячет кнопку: отказ всё равно придёт
 * от API, и прятать кнопку нужно ради того, чтобы её не искали, а не ради
 * безопасности.
 */
const REVIEWERS = new Set(['ADMIN', 'DISPATCHER', 'SAFETY_ENGINEER']);

export function AdminIncidents() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const actingAs = usePilingStore((state) => state.actingAs);
  const canReview = REVIEWERS.has(resolveEffectiveRole(currentUser?.role ?? '', actingAs));
  const [scope, setScope] = useState<'open' | 'all'>('open');
  const [rows, setRows] = useState<IncidentRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(() => setReloadToken((token) => token + 1), []);

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
    setError(null);
    try {
      const response = await fetch('/api/admin/incidents', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        credentials: 'same-origin',
        body: JSON.stringify({id, note: note.trim()}),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error ?? 'Не удалось записать разбор');
      // Форма закрывается только после ответа сервера — вывод разбора человек
      // пишет один раз, и терять его из-за оборвавшегося запроса нельзя.
      setOpenForm(null);
      setNote('');
      load();
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : 'Не удалось записать разбор');
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
            {unreviewed > 0
              ? `Ждут разбора: ${unreviewed}`
              : 'Неразобранных происшествий нет'}
          </p>
        </div>
        <div className="flex gap-2" role="group" aria-label="Что показывать">
          {([['open', 'Ждут разбора'], ['all', 'Все']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setScope(id)}
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
        <p className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {rows === null ? (
        <p className="text-sm text-muted-foreground">Загружаем…</p>
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

              {canReview && !row.reviewedAt ? (
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
                        onClick={() => {setOpenForm(null); setNote('');}}
                        className="min-h-9 rounded-md border bg-card px-4 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        Отмена
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {setOpenForm(row.id); setNote('');}}
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
