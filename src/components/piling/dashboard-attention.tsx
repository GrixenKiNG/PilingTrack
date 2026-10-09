'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import {
  fetchCurrentReadiness, fetchReadinessDefects, fetchReadinessShifts, fetchWorkPermits,
} from './to/readiness/api/client';
import { buildAttentionItems, type AttentionInput, type DocumentControlRow } from './dashboard-attention-items';

const MAX_ROWS = 5;

type Sources = Omit<AttentionInput, 'equipmentName' | 'now'>;

/** Источник, который роли недоступен или не ответил, остаётся `null`: по нему ничего не утверждаем. */
async function loadSources(): Promise<Sources> {
  const safe = async <T,>(read: () => Promise<T>): Promise<T | null> => {
    try { return await read(); } catch { return null; }
  };
  const [permits, shifts, current, defects, documents] = await Promise.all([
    safe(() => fetchWorkPermits()),
    safe(() => fetchReadinessShifts()),
    safe(() => fetchCurrentReadiness()),
    safe(() => fetchReadinessDefects()),
    safe(async () => {
      const response = await authFetch('/api/user-documents/control');
      if (!response.ok) throw new Error(String(response.status));
      return ((await response.json()).documents ?? []) as DocumentControlRow[];
    }),
  ]);
  return { permits, shifts, current, defects, documents };
}

/**
 * «Требует решения сейчас» — то, что нельзя оставить на потом: каждая строка
 * называет проблему, роль и действие, а нажатие открывает вкладку, где есть
 * подсказка следующего шага. Роль без права на источник его просто не видит.
 */
export function DashboardAttention({ equipmentName, refreshKey }: {
  equipmentName: (equipmentId: string) => string;
  refreshKey: number;
}) {
  const router = useRouter();
  const [sources, setSources] = useState<Sources | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadSources().then((next) => { if (!cancelled) setSources(next); });
    return () => { cancelled = true; };
  }, [refreshKey]);

  const items = useMemo(
    () => sources ? buildAttentionItems({ ...sources, equipmentName, now: new Date() }) : [],
    [sources, equipmentName],
  );

  if (!sources) return null;
  // Ни один источник не прочитан (например, роль без прав) — блок не нужен.
  if (Object.values(sources).every((value) => value === null)) return null;

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success-strong" role="status">
        Срочных решений нет
      </div>
    );
  }

  const shown = items.slice(0, MAX_ROWS);
  return (
    <section aria-label="Требует решения сейчас" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-destructive-strong">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        Требует решения сейчас · {items.length}
      </h2>
      <ul className="mt-2 space-y-1.5">
        {shown.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              onClick={() => router.push(item.href)}
              className="flex min-h-11 w-full flex-col items-start rounded-md bg-card px-3 py-2 text-left hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-sm font-medium text-foreground">{item.problem}</span>
              <span className="text-xs text-muted-foreground">{item.role} · {item.action} →</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length > shown.length && (
        <p className="mt-2 text-xs text-muted-foreground">Ещё {items.length - shown.length} — в разделах техготовности и ТБ.</p>
      )}
    </section>
  );
}
