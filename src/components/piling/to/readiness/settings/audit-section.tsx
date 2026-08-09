'use client';

import Link from 'next/link';
import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronRight, Search } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatDateTimeInTimezone } from '@/lib/timezone';
import { cn } from '@/lib/utils';
import type { ReadinessAuditEnvelope, ReadinessAuditEventDto, ReadinessBootstrap } from '../api/contracts';
import { handoverRoleLabel } from '../handover-journal';
import { auditActionLabel, auditEntityLabel, isCriticalAuditAction } from './audit-labels';
import { InfoRow, ScreenTitle, SettingsKpis, StatusPill, card } from './shared-ui';

interface AuditSettingsProps {
  audit: ReadinessAuditEnvelope | null;
  bootstrap: ReadinessBootstrap | null;
  canExport: boolean;
  onExport: (events: ReadinessAuditEventDto[]) => void;
  filtersBar: React.ReactNode;
}

/** Срок хранения журнала — политика контура, а не настройка модуля. */
const RETENTION_YEARS = 5;

export function AuditSettings({ audit, bootstrap, canExport, onExport, filtersBar }: AuditSettingsProps) {
  const events = audit?.data ?? [];
  const verification = audit?.verification;
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const normalized = query.trim().toLocaleLowerCase('ru-RU');
  const visible = events.filter((event) => !normalized || [
    auditActionLabel(event.action),
    auditEntityLabel(event.entity.type),
    event.actor.name ?? '',
    event.action,
  ].join(' ').toLocaleLowerCase('ru-RU').includes(normalized));

  const selected = visible.find((event) => event.id === selectedId) ?? visible[0] ?? null;
  const lastDay = events.filter((event) => Date.now() - new Date(event.occurredAt).getTime() < 86_400_000);
  const criticalCount = events.filter((event) => isCriticalAuditAction(event.action)).length;

  return (
    <>
      <ScreenTitle
        heading="Аудит"
        subtitle="Неизменяемая история действий, решений и изменений данных"
        actions={<Button asChild variant="outline"><Link href="/admin/settings">Политика хранения</Link></Button>}
      />
      <SettingsKpis items={[
        { icon: 'history', label: 'Событий за 24 ч', value: lastDay.length },
        { icon: 'reports', label: 'Всего в журнале', value: verification?.eventCount ?? events.length },
        { icon: 'risk', label: 'Критических действий', value: criticalCount, alert: criticalCount > 0 },
        { icon: 'documents', label: 'Срок хранения', value: `${RETENTION_YEARS} лет` },
      ]} />
      <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <section className={cn(card, 'overflow-hidden')}>
          <div className="p-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-lg font-bold">Доказательный журнал</h2>
              <StatusPill tone={verification?.valid ? 'success' : 'danger'}>
                {verification?.valid ? 'Цепочка цела' : 'Требуется проверка цепочки'}
              </StatusPill>
            </div>
            <div className="relative mt-3">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                aria-label="Поиск по журналу аудита"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Поиск по действию, объекту, пользователю…"
                className="min-h-11 pl-9 text-xs"
              />
            </div>
            {filtersBar}
          </div>
          <div className="overflow-x-auto">
            <div className="hidden min-w-[820px] grid-cols-[128px_140px_minmax(0,1fr)_150px_96px_20px] gap-2 border-y border-border px-4 py-2 text-3xs font-semibold uppercase text-muted-foreground md:grid">
              <span>Время</span><span>Пользователь</span><span>Действие</span><span>Объект</span><span>Результат</span><span />
            </div>
            <div className="hidden max-h-[520px] min-w-[820px] divide-y divide-border overflow-y-auto md:block">
              {visible.map((event) => {
                const critical = isCriticalAuditAction(event.action);
                return (
                  <button
                    key={event.id}
                    type="button"
                    onClick={() => setSelectedId(event.id)}
                    aria-current={selected?.id === event.id}
                    className={cn(
                      'grid w-full grid-cols-[128px_140px_minmax(0,1fr)_150px_96px_20px] items-center gap-2 px-4 py-2 text-left text-2xs transition hover:bg-signal/5',
                      selected?.id === event.id && 'bg-signal/10',
                    )}
                  >
                    <span className="text-muted-foreground">{formatDateTimeInTimezone(event.occurredAt, bootstrap?.tenant.timezone)}</span>
                    <span className="min-w-0">
                      <b className="block truncate">{event.actor.name || 'Система'}</b>
                      <small className="block text-muted-foreground">{handoverRoleLabel(event.actor.actingAs || event.actor.role) ?? 'PilingTrack'}</small>
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      {critical
                        ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive-strong" />
                        : <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success-strong" />}
                      <span className="min-w-0 leading-snug">{auditActionLabel(event.action)}</span>
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate">{auditEntityLabel(event.entity.type)}</span>
                      <small className="block truncate font-mono text-muted-foreground">{event.entity.id.slice(0, 12) || '—'}</small>
                    </span>
                    <span>{critical ? <StatusPill tone="danger">Критично</StatusPill> : <StatusPill tone="success">Успешно</StatusPill>}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2 p-3 md:hidden">
            {visible.map((event) => (
              <article key={event.id} className="rounded-lg border border-border p-3 text-xs">
                <div className="flex items-start justify-between gap-2">
                  <b className="min-w-0">{auditActionLabel(event.action)}</b>
                  {isCriticalAuditAction(event.action) ? <StatusPill tone="danger">Критично</StatusPill> : <StatusPill tone="success">Успешно</StatusPill>}
                </div>
                <div className="mt-2 text-muted-foreground">{event.actor.name || 'Система'} · {handoverRoleLabel(event.actor.actingAs || event.actor.role) ?? 'PilingTrack'}</div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                  <span>{formatDateTimeInTimezone(event.occurredAt, bootstrap?.tenant.timezone)}</span>
                  <span>{auditEntityLabel(event.entity.type)}</span>
                </div>
              </article>
            ))}
          </div>
          {visible.length === 0 && <div className="py-10 text-center text-sm text-muted-foreground">{events.length === 0 ? 'События аудита недоступны в текущем источнике.' : 'По запросу ничего не найдено.'}</div>}
          <div className="border-t border-border p-3 text-xs text-muted-foreground">
            Показано {visible.length} из {verification?.eventCount ?? events.length} событий
          </div>
        </section>

        <aside className="space-y-3">
          <section className={cn(card, 'p-4')}>
            <h2 className="font-bold">Событие {selected ? `#${selected.sequence}` : '—'}</h2>
            <div className="mt-4 space-y-3 text-xs">
              <InfoRow label="Автор" value={selected?.actor.name || 'Система'} />
              <InfoRow label="Роль" value={handoverRoleLabel(selected?.actor.actingAs || selected?.actor.role || null) ?? '—'} />
              <InfoRow label="Дата и время" value={selected ? formatDateTimeInTimezone(selected.occurredAt, bootstrap?.tenant.timezone) : '—'} />
              <InfoRow label="Действие" value={selected ? auditActionLabel(selected.action) : '—'} />
              <InfoRow label="Объект" value={selected ? `${auditEntityLabel(selected.entity.type)} · ${selected.entity.id.slice(0, 12)}` : '—'} />
            </div>
            <div className="mt-4 overflow-x-auto rounded-lg bg-primary p-3 font-mono text-3xs leading-relaxed">
              <div className="text-border/70">SHA-256</div>
              <div className="mt-2 break-all text-success-foreground">{selected?.hash || '—'}</div>
            </div>
          </section>
          <section className={cn(card, 'p-4')}>
            <h2 className="font-bold">Целостность журнала</h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {verification?.valid
                ? `Цепочка проверена: ${verification.eventCount} событий, разрывов не обнаружено.`
                : `Проверка не пройдена${verification?.reason ? `: ${verification.reason}` : '.'}`}
            </p>
            <p className="mt-2 text-2xs text-muted-foreground">Каждая запись подписана хешем предыдущей — задним числом журнал не переписать.</p>
          </section>
          <Button
            disabled={!canExport}
            className="min-h-11 w-full bg-signal-strong hover:bg-signal-strong"
            onClick={() => onExport(events)}
          >
            Экспорт журнала
          </Button>
        </aside>
      </div>
    </>
  );
}
