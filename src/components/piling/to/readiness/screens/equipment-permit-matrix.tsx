'use client';

/**
 * «Матрица допусков» — на чём работник вправе работать и что делать.
 *
 * ПОЧЕМУ ОТДЕЛЬНО ОТ ДОКУМЕНТОВ. Медосмотр и удостоверение отвечают «можно ли
 * этому человеку работать вообще»; матрица — «на чём именно». Машинист с
 * полным комплектом бумаг может не иметь допуска к буровой, и это нормальное
 * состояние, а не нарушение.
 *
 * ПРОСРОЧЕННЫЙ ДОПУСК ПОКАЗЫВАЕТСЯ КАК ОТСУТСТВУЮЩИЙ. Зелёная строка со
 * вчерашней датой — самый дорогой вид вранья на этом экране: по ней человека
 * выпустят на машину.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { card } from '../settings/shared-ui';
import {
  EQUIPMENT_KIND_LABELS, EQUIPMENT_KIND_ORDER, PERMIT_STATUS_LABELS,
  WORK_SCOPE_LABELS, WORK_SCOPE_ORDER, permitStatusClass,
} from './equipment-permit-labels';

interface PermitRow {
  id: string;
  equipmentKind: string;
  equipmentModel: string;
  scope: string;
  status: string;
  restriction: string;
  validUntil: string | null;
  notes: string;
  grantedByName: string;
  expired: boolean;
}

const FIELD = 'h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground';

export function EquipmentPermitMatrix({
  userId,
  userName,
  editable,
}: {
  /** Чей это раздел. Пусто — свой (маршрут подставит себя из сессии). */
  userId?: string;
  userName?: string;
  /** Может ли текущий пользователь выдавать допуски (`users.manage`). */
  editable: boolean;
}) {
  const [rows, setRows] = useState<PermitRow[] | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<string>('PILE_DRIVER');
  const [model, setModel] = useState('');
  const [scope, setScope] = useState<string>('OPERATION');
  const [status, setStatus] = useState<string>('ALLOWED');
  const [restriction, setRestriction] = useState('');
  const [validUntil, setValidUntil] = useState('');

  const load = useCallback(async () => {
    try {
      const search = userId ? `?userId=${encodeURIComponent(userId)}` : '';
      const response = await authFetch(`/api/safety/equipment-permits${search}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setRows(((await response.json()).rows ?? []) as PermitRow[]);
      setFailed(null);
    } catch (error) {
      // Пустая матрица читается как «допусков нет» — а это другое утверждение,
      // чем «не удалось спросить». Разница решает, выпустят ли человека.
      setFailed(error instanceof Error ? error.message : 'Не удалось загрузить допуски');
      setRows(null);
    }
  }, [userId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    if (!userId) return;
    setBusy(true);
    setFailed(null);
    try {
      const response = await authFetch('/api/safety/equipment-permits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          equipmentKind: kind,
          equipmentModel: model.trim(),
          scope,
          status,
          restriction: restriction.trim(),
          // Конец дня: допуск «до 15.12» действует весь пятнадцатое, а не до
          // полуночи предыдущей ночи.
          validUntil: validUntil ? new Date(`${validUntil}T23:59:59`).toISOString() : null,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      setAdding(false);
      setModel('');
      setRestriction('');
      setValidUntil('');
      await load();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Не удалось сохранить допуск');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const response = await authFetch(`/api/safety/equipment-permits/${id}`, { method: 'DELETE' });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Сервер вернул ${response.status}`);
      }
      await load();
    } catch (error) {
      setFailed(error instanceof Error ? error.message : 'Не удалось удалить допуск');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={cn(card, 'p-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Матрица допусков</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {userName ? `${userName} — на ` : 'На '}
            чём вправе работать и что делать. Допуск даётся на вид техники; модель
            указывают, когда он сужен до неё.
          </p>
        </div>
        {editable && userId && (
          <Button onClick={() => setAdding((open) => !open)} variant={adding ? 'outline' : 'default'}>
            {adding ? 'Отмена' : 'Назначить допуск'}
          </Button>
        )}
      </div>

      {adding && editable && userId && (
        <div className="mt-3 grid gap-2 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs text-muted-foreground">
            Вид техники
            <select className={FIELD} value={kind} onChange={(event) => setKind(event.target.value)}>
              {EQUIPMENT_KIND_ORDER.map((value) => (
                <option key={value} value={value}>{EQUIPMENT_KIND_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Модель — необязательно
            <Input value={model} onChange={(event) => setModel(event.target.value)}
              placeholder="С-200 · пусто = весь вид техники" />
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Вид работ
            <select className={FIELD} value={scope} onChange={(event) => setScope(event.target.value)}>
              {WORK_SCOPE_ORDER.map((value) => (
                <option key={value} value={value}>{WORK_SCOPE_LABELS[value]}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-xs text-muted-foreground">
            Состояние
            <select className={FIELD} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="ALLOWED">Допущен</option>
              <option value="LIMITED">Ограничен</option>
              <option value="DENIED">Не допущен</option>
            </select>
          </label>
          {status === 'LIMITED' && (
            <label className="grid gap-1 text-xs text-muted-foreground sm:col-span-2">
              Чем ограничен
              <Input value={restriction} onChange={(event) => setRestriction(event.target.value)}
                placeholder="Без подъёма людей, до 8 тонн" />
            </label>
          )}
          <label className="grid gap-1 text-xs text-muted-foreground">
            Действует до — пусто значит бессрочно
            <Input type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
          </label>
          <div className="flex items-end">
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? 'Сохраняем…' : 'Сохранить допуск'}
            </Button>
          </div>
        </div>
      )}

      {failed && (
        <p role="alert" className="mt-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive-strong">
          {failed}
        </p>
      )}

      {rows === null && !failed && (
        <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Допуски к технике не назначены. Пока матрица пуста, она ничего не утверждает —
          ни что человек допущен, ни что нет.
        </p>
      )}

      {rows !== null && rows.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-2xs uppercase text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-semibold">Тип техники</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Вид работ</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Состояние</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Действует до</th>
                <th scope="col" className="py-2 pr-3 font-semibold">Кто выдал</th>
                {editable && <th scope="col" className="py-2 font-semibold">Действие</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="py-2 pr-3">
                    <div className="font-medium">
                      {EQUIPMENT_KIND_LABELS[row.equipmentKind] ?? row.equipmentKind}
                    </div>
                    <div className="text-2xs text-muted-foreground">
                      {row.equipmentModel || 'весь вид техники'}
                    </div>
                  </td>
                  <td className="py-2 pr-3">{WORK_SCOPE_LABELS[row.scope] ?? row.scope}</td>
                  <td className="py-2 pr-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-2xs font-semibold',
                      permitStatusClass(row.status, row.expired))}>
                      {row.expired ? 'Срок вышел' : PERMIT_STATUS_LABELS[row.status] ?? row.status}
                    </span>
                    {row.restriction && (
                      <div className="mt-1 text-2xs text-warning-strong">{row.restriction}</div>
                    )}
                  </td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    <span className={row.expired ? 'font-semibold text-destructive-strong' : ''}>
                      {row.validUntil ? formatRuDate(row.validUntil) : 'бессрочно'}
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted-foreground">
                    {row.grantedByName || '—'}
                  </td>
                  {editable && (
                    <td className="py-2">
                      <Button variant="outline" className="h-8 text-2xs" disabled={busy}
                        onClick={() => void remove(row.id)}>
                        Убрать
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-2 rounded-lg border border-border bg-muted/40 p-3 text-2xs leading-relaxed text-muted-foreground">
        Матрица пока не участвует в пуске смены: допуск к работе держат обязательные документы и
        блокировки контура готовности. Включение матрицы в этот расчёт — отдельное решение, и
        принимать его стоит, когда она наполнится по всем работникам.
      </p>
    </section>
  );
}
