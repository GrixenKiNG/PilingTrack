'use client';

/**
 * Журнал дефектов установки.
 *
 * До этого дефекты существовали только в бэкенде: таблица, репозиторий, четыре
 * команды и четыре маршрута — и ни одного вызова из интерфейса. Завести
 * замечание в работающем приложении было нечем, поэтому счётчик критических
 * дефектов всегда показывал ноль, а блокирующий признак авторитетного расчёта
 * (незакрытый CRITICAL в readiness-score) не мог сработать ни разу.
 *
 * Панель закрывает весь цикл: зафиксировать → разобрать → устранить или
 * отклонить. Права те же, что на сервере: фиксирует любой участник смены,
 * разбирает диспетчер, механик и администратор (в том числе в режиме
 * замещения роли механика).
 */

import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Wrench } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authFetch } from '@/lib/api';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import {
  DEFECT_SEVERITIES,
  DEFECT_SEVERITY_HINTS,
  DEFECT_SEVERITY_LABELS,
  DEFECT_STATUS_LABELS,
  type DefectSeverity,
} from '@/modules/readiness/domain/defects/types';
import type { DefectDto } from '../api/contracts';
import { card } from '../settings/shared-ui';
import { CommandDialog } from '../shared/command-dialog';
import { commandFailure } from './shared';
import type { ReferenceUiProps } from './types';

type DefectCommand =
  | { kind: 'create' }
  | { kind: 'action'; defect: DefectDto; action: 'triage' | 'resolve' | 'reject' };

const SEVERITY_TONE: Record<DefectSeverity, string> = {
  CRITICAL: 'border-destructive/30 bg-destructive/10 text-destructive-strong',
  HIGH: 'border-warning/30 bg-warning/10 text-warning-strong',
  NORMAL: 'border-info/30 bg-info/10 text-info-strong',
  LOW: 'border-border bg-muted text-muted-foreground',
};

const ACTION_TITLE = {
  triage: 'Взять в работу',
  resolve: 'Отметить устранённым',
  reject: 'Отклонить замечание',
} as const;

/** Текст поля свободного ввода: у каждого действия он значит своё. */
const ACTION_FIELD = {
  triage: { label: 'Комментарий разбора', required: false, hint: 'Необязательно: что решили и кому передали.' },
  resolve: { label: 'Что сделано', required: true, hint: 'Обязательно: без описания устранение нечем подтвердить.' },
  reject: { label: 'Причина отклонения', required: true, hint: 'Обязательно: «отклонён без объяснения» — тупик для оператора.' },
} as const;

export function DefectsPanel(props: ReferenceUiProps) {
  const [command, setCommand] = useState<DefectCommand | null>(null);
  const [title, setTitle] = useState('');
  const [node, setNode] = useState('');
  const [severity, setSeverity] = useState<DefectSeverity>('NORMAL');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  const capabilities = props.bootstrap?.capabilities.entities.defect;
  const canReport = Boolean(capabilities?.report) && Boolean(props.selectedId);
  const canManage = Boolean(capabilities?.manage);
  const timezone = props.bootstrap?.tenant.timezone;
  const equipmentName = (id: string) => props.equipment.find((item) => item.id === id)?.name ?? 'Установка вне списка';

  const forSelected = props.selectedId
    ? props.defects.filter((defect) => defect.equipmentId === props.selectedId)
    : props.defects;
  const open = forSelected.filter((defect) => defect.status === 'OPEN' || defect.status === 'IN_WORK');
  const shown = showClosed ? forSelected : open;

  const reset = () => { setTitle(''); setNode(''); setSeverity('NORMAL'); setText(''); setError(null); };

  const headers = (extra: Record<string, string> = {}) => ({
    'content-type': 'application/json',
    'idempotency-key': crypto.randomUUID(),
    ...(props.bootstrap?.actor.actingAs ? { 'x-readiness-acting-as': props.bootstrap.actor.actingAs } : {}),
    ...extra,
  });

  const submitCreate = async () => {
    if (!props.selectedId) return;
    if (title.trim().length < 3) { setError('Опишите замечание — не короче трёх символов.'); return; }
    setPending(true);
    const response = await authFetch('/api/readiness/defects', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        equipmentId: props.selectedId,
        severity,
        title: title.trim(),
        ...(text.trim() ? { description: text.trim() } : {}),
        ...(node.trim() ? { node: node.trim() } : {}),
      }),
    });
    setPending(false);
    if (!response.ok) { setError(await commandFailure(response)); if (response.status === 409) props.onRetry(); return; }
    toast.success('Замечание зафиксировано');
    setCommand(null);
    reset();
    props.onRetry();
  };

  const submitAction = async (defect: DefectDto, action: 'triage' | 'resolve' | 'reject') => {
    const field = ACTION_FIELD[action];
    if (field.required && text.trim().length < 3) { setError(`${field.label}: заполните поле.`); return; }
    setPending(true);
    const body: Record<string, unknown> = { expectedVersion: defect.version };
    if (action === 'triage' && text.trim()) body.comment = text.trim();
    if (action === 'resolve') body.resolution = text.trim();
    if (action === 'reject') body.reason = text.trim();
    const response = await authFetch(`/api/readiness/defects/${defect.id}/${action}`, {
      method: 'POST',
      headers: headers({ 'if-match': `"defect-${defect.id}-v${defect.version}"` }),
      body: JSON.stringify(body),
    });
    setPending(false);
    if (!response.ok) { setError(await commandFailure(response)); if (response.status === 409) props.onRetry(); return; }
    toast.success(action === 'triage' ? 'Замечание взято в работу' : action === 'resolve' ? 'Замечание устранено' : 'Замечание отклонено');
    setCommand(null);
    reset();
    props.onRetry();
  };

  const startAction = (defect: DefectDto, action: 'triage' | 'resolve' | 'reject') => {
    reset();
    setCommand({ kind: 'action', defect, action });
  };

  return (
    <section className={cn(card, 'p-3')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold">Журнал дефектов</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {props.selectedId ? equipmentName(props.selectedId) : 'Все установки'} · открытых {open.length}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 text-xs"
            aria-pressed={showClosed}
            onClick={() => setShowClosed((value) => !value)}
          >
            {showClosed ? 'Только открытые' : 'Показать закрытые'}
          </Button>
          <Button
            ref={openButtonRef}
            type="button"
            disabled={!canReport}
            title={canReport ? undefined : 'Выберите установку и убедитесь, что у роли есть право фиксировать дефекты'}
            className="min-h-11 bg-signal-strong hover:bg-signal-strong"
            onClick={() => { reset(); setCommand({ kind: 'create' }); }}
          >
            + Зафиксировать дефект
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {shown.length === 0 ? (
          <p className="rounded-lg border border-border p-4 text-center text-xs text-muted-foreground">
            {forSelected.length === 0
              ? 'Замечаний по этой установке не зафиксировано.'
              : 'Открытых замечаний нет — все разобраны.'}
          </p>
        ) : shown.map((defect) => {
          const blocking = defect.severity === 'CRITICAL' && (defect.status === 'OPEN' || defect.status === 'IN_WORK');
          return (
            <article
              key={defect.id}
              className={cn(
                'rounded-lg border-l-[3px] p-3',
                blocking
                  ? 'border-y border-r border-destructive/25 border-l-destructive bg-destructive/5'
                  : 'border-y border-r border-border border-l-border bg-card',
              )}
            >
              <div className="flex flex-wrap items-start gap-2">
                <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full', blocking ? 'bg-destructive/10 text-destructive-strong' : 'bg-muted text-muted-foreground')}>
                  {defect.status === 'CLOSED' ? <CheckCircle2 className="h-4 w-4" /> : blocking ? <AlertTriangle className="h-4 w-4" /> : <Wrench className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold">{defect.title}</h3>
                  <p className="mt-0.5 text-2xs text-muted-foreground">
                    {equipmentName(defect.equipmentId)}
                    {defect.node ? ` · ${defect.node}` : ''}
                    {' · '}
                    {formatDateTimeInTimezone(defect.reportedAt, timezone)}
                  </p>
                  {defect.description ? <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{defect.description}</p> : null}
                  {defect.resolution ? (
                    <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">
                      <b>{defect.status === 'REJECTED' ? 'Причина отклонения' : 'Устранено'}:</b> {defect.resolution}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className={cn('rounded border px-2 py-0.5 text-3xs font-semibold', SEVERITY_TONE[defect.severity])}>
                    {DEFECT_SEVERITY_LABELS[defect.severity]}
                  </span>
                  <span className="text-3xs text-muted-foreground">{DEFECT_STATUS_LABELS[defect.status]}</span>
                </div>
              </div>
              {blocking ? (
                <p className="mt-2 rounded bg-destructive/10 px-2 py-1 text-3xs font-semibold text-destructive-strong">
                  Незакрытый критичный дефект блокирует допуск установки к работе.
                </p>
              ) : null}
              {/*
                Кнопки строго по автомату переходов (domain/defects/defect.ts):
                OPEN → «Взять в работу» либо «Отклонить», IN_WORK → «Устранён».
                Изначально «Устранён» предлагался и у неразобранного дефекта —
                сервер такой переход не принимает и отвечает 409.
              */}
              {canManage && defect.status === 'OPEN' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" className="h-9 bg-signal-strong text-2xs hover:bg-signal-strong" onClick={() => startAction(defect, 'triage')}>
                    Взять в работу
                  </Button>
                  <Button type="button" variant="outline" className="h-9 text-2xs" onClick={() => startAction(defect, 'reject')}>
                    Отклонить
                  </Button>
                </div>
              ) : null}
              {canManage && defect.status === 'IN_WORK' ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button type="button" className="h-9 bg-success-strong text-2xs hover:bg-success-strong" onClick={() => startAction(defect, 'resolve')}>
                    Устранён
                  </Button>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      <CommandDialog
        open={command !== null}
        pending={pending}
        returnFocusRef={openButtonRef}
        title={command?.kind === 'create' ? 'Зафиксировать дефект' : command ? ACTION_TITLE[command.action] : ''}
        description={command?.kind === 'create'
          ? 'Запись попадёт в доказательный журнал и вызовет пересчёт готовности установки.'
          : 'Решение попадёт в доказательный журнал и вызовет пересчёт готовности установки.'}
        onClose={() => { if (!pending) { setCommand(null); reset(); } }}
        footer={
          <>
            <Button type="button" variant="outline" disabled={pending} onClick={() => { setCommand(null); reset(); }}>Отмена</Button>
            <Button
              type="button"
              disabled={pending}
              className="bg-signal-strong hover:bg-signal-strong"
              onClick={() => {
                if (!command) return;
                void (command.kind === 'create' ? submitCreate() : submitAction(command.defect, command.action));
              }}
            >
              {pending ? 'Сохраняем…' : 'Подтвердить'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {command?.kind === 'create' ? (
            <>
              <label className="grid gap-1 font-medium">
                Что не так
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Течь по штоку правого аутригера" className="font-normal" />
              </label>
              <label className="grid gap-1 font-medium">
                Узел <span className="font-normal text-muted-foreground">(необязательно)</span>
                <Input value={node} onChange={(event) => setNode(event.target.value)} placeholder="Гидросистема — распределитель вращения" className="font-normal" />
              </label>
              <fieldset className="grid gap-1">
                <legend className="mb-1 font-medium">Серьёзность</legend>
                <div className="grid gap-1">
                  {DEFECT_SEVERITIES.map((value) => (
                    <label key={value} className="flex items-start gap-2 rounded-md border border-border p-2">
                      <input type="radio" name="defect-severity" className="mt-1" checked={severity === value} onChange={() => setSeverity(value)} />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold">{DEFECT_SEVERITY_LABELS[value]}</span>
                        <span className="block text-3xs text-muted-foreground">{DEFECT_SEVERITY_HINTS[value]}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </>
          ) : null}
          {command ? (
            <label className="grid gap-1 font-medium">
              {command.kind === 'create' ? 'Подробности' : ACTION_FIELD[command.action].label}
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                className="min-h-24 rounded-md border border-input bg-background p-3 font-normal"
              />
              <span className="text-3xs font-normal text-muted-foreground">
                {command.kind === 'create' ? 'Необязательно: обстоятельства, при которых обнаружено.' : ACTION_FIELD[command.action].hint}
              </span>
            </label>
          ) : null}
          {error ? <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive-strong">{error}</p> : null}
        </div>
      </CommandDialog>
    </section>
  );
}
