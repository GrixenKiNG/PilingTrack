'use client';

/**
 * Экраны шагов смены — то, что оператор видит на каждом из семи шагов.
 *
 * ПОЧЕМУ У ШАГОВ РАЗНЫЙ ВИД, А НЕ ОДНА КАРТОЧКА НА ВСЕ. Раньше все шаги
 * показывались одинаково: заголовок, подпись, кнопка. Для «продолжить осмотр»
 * этого хватало, а для приёмки машины — нет: расписываясь за установку, человек
 * должен видеть саму установку, у кого он её принимает, наработку и что
 * предыдущая смена о ней написала. Одинаковая карточка молчала обо всём этом.
 *
 * Правило, КАКОЙ шаг показывать, здесь не живёт — оно в `shift-phase.ts` и
 * покрыто тестами. Здесь только показ.
 */

import { useEffect, useState } from 'react';
import { getEquipmentPhoto } from '@/components/piling/admin-equipment/equipment-photo';
import { PilingIcon } from '@/components/piling/icons';
import { Check } from '@/components/piling/icons/unified-icons';
import { formatNumber } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { OperatorShiftFacts } from '@/modules/readiness/application/operator-shift-query';
import { PHASE_COUNT, type ShiftPhase } from './shift-phase';

/** Полоса из семи делений — единственное место, где виден весь путь смены. */
export function ShiftPhaseStrip({ phase }: { phase: number }) {
  return (
    <div className="flex gap-1" role="img" aria-label={`Смена: шаг ${phase} из ${PHASE_COUNT}`}>
      {Array.from({ length: PHASE_COUNT }, (_, index) => index + 1).map((step) => (
        <span
          key={step}
          className={cn('h-1.5 flex-1 rounded-full',
            step < phase ? 'bg-success-strong' : step === phase ? 'bg-signal' : 'bg-border')}
        />
      ))}
    </div>
  );
}

const cardShell = 'rounded-2xl border border-border bg-card p-5 shadow-sm';

function StepHeading({ phase }: { phase: ShiftPhase }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        Шаг {phase.phase} из {PHASE_COUNT}
      </p>
      <h2 className="mt-1 text-xl font-bold tracking-tight text-foreground">{phase.title}</h2>
    </div>
  );
}

function PrimaryButton({ label, onClick, disabled, busy, tone = 'signal' }: {
  label: string; onClick: () => void; disabled?: boolean; busy?: boolean;
  tone?: 'signal' | 'success';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      className={cn(
        'mt-4 flex min-h-14 w-full items-center justify-center rounded-xl px-4 text-base font-semibold text-white transition active:scale-[0.99]',
        'disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground',
        tone === 'success' ? 'bg-success-strong' : 'bg-signal',
      )}
    >
      {busy ? 'Секунду…' : label}
    </button>
  );
}

function Blockers({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="mt-4 space-y-1 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2">
      {items.map((item) => (
        <li key={item} className="text-sm text-destructive-strong">{item}</li>
      ))}
    </ul>
  );
}

/** Пара «подпись — значение» для сводок. */
function Row({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn('text-sm font-semibold',
        tone === 'ok' ? 'text-success-strong' : tone === 'warn' ? 'text-warning-strong' : 'text-foreground')}>
        {value}
      </span>
    </div>
  );
}

/**
 * Остаток до ближайшего ТО в процентах.
 *
 * Возвращает `null`, когда порог не задан: показывать «100 %» для машины без
 * регламента — значит утверждать, что до ТО далеко, ничего об этом не зная.
 */
function maintenanceLeft(facts: OperatorShiftFacts): { percent: number; left: number } | null {
  const total = facts.equipment?.engineHoursTotal;
  const next = facts.equipment?.nextMaintenanceAtHours;
  if (total == null || next == null || next <= 0) return null;
  const left = next - total;
  return { percent: Math.max(0, Math.min(100, Math.round((total / next) * 100))), left };
}

/** ШАГ 2 — приёмка машины. Карточка установки, а не строка текста. */
function AcceptanceStep({ facts, phase, onAction, busy }: StepProps) {
  const photo = getEquipmentPhoto(facts.equipment?.model);
  const maintenance = maintenanceLeft(facts);
  const handover = facts.incomingHandover;
  return (
    <section className={cardShell} aria-label="Текущий шаг смены">
      <StepHeading phase={phase} />
      <h3 className="mt-3 text-lg font-semibold text-foreground">{facts.equipment?.name}</h3>

      {photo && (
         
        <img src={photo} alt={facts.equipment?.name ?? 'Установка'}
          className="mt-3 h-40 w-full rounded-xl object-cover" />
      )}

      <div className="mt-4">
        {handover?.submittedByName && (
          <Row label="Предыдущий оператор" value={handover.submittedByName} />
        )}
        {maintenance && (
          <Row
            label="Наработка до ТО"
            value={`${maintenance.percent}% · осталось ${formatNumber(maintenance.left)} м.ч.`}
            tone={maintenance.left <= 0 ? 'warn' : undefined}
          />
        )}
        {facts.meterCurrent != null && (
          <Row label="Моточасы" value={`${formatNumber(facts.meterCurrent)} м.ч.`} />
        )}
        <Row
          label="Состояние"
          value={phase.blockers.length > 0 ? `замечаний: ${phase.blockers.length}` : 'Исправна'}
          tone={phase.blockers.length > 0 ? 'warn' : 'ok'}
        />
      </div>

      {handover?.summary && (
        <div className="mt-3 rounded-xl border border-border bg-secondary/60 px-3 py-2.5">
          <p className="text-xs font-medium text-muted-foreground">Что передали</p>
          <p className="mt-1 text-sm text-foreground">{handover.summary}</p>
        </div>
      )}

      <Blockers items={phase.blockers} />
      <PrimaryButton label={phase.action} onClick={onAction} busy={busy} disabled={phase.target === null} />
    </section>
  );
}

/** ШАГ 4 — пуск. Зелёная галка вместо списка того, что уже позади. */
function StartStep({ facts, phase, onAction, busy }: StepProps) {
  const allowed = phase.blockers.length === 0;
  return (
    <section className={cardShell} aria-label="Текущий шаг смены">
      <StepHeading phase={phase} />

      <div className="mt-5 flex flex-col items-center text-center">
        <div className={cn('flex h-20 w-20 items-center justify-center rounded-full',
          allowed ? 'bg-success/15' : 'bg-destructive/10')}>
          {allowed
            ? <Check className="h-11 w-11 text-success-strong" />
            : <PilingIcon name="defect" size={44} decorative />}
        </div>
        <p className={cn('mt-3 text-base font-semibold',
          allowed ? 'text-success-strong' : 'text-destructive-strong')}>
          {allowed ? 'Все обязательные условия выполнены' : 'Пуск закрыт контуром готовности'}
        </p>
        {facts.meterCurrent != null && (
          <p className="mt-3 text-2xl font-bold tabular-nums text-foreground">
            {formatNumber(facts.meterCurrent)} <span className="text-base font-medium text-muted-foreground">м/ч</span>
          </p>
        )}
        <p className="text-xs text-muted-foreground">на старт</p>
      </div>

      <Blockers items={phase.blockers} />
      {facts.startWaiver && (
        <p className="mt-3 rounded-xl border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning-strong">
          Разрешение диспетчера: {facts.startWaiver.reason}
        </p>
      )}
      <PrimaryButton
        label={phase.action}
        onClick={onAction}
        busy={busy}
        disabled={phase.target === null}
        tone={allowed ? 'success' : 'signal'}
      />
    </section>
  );
}

/**
 * Время с момента пуска, тикающее раз в секунду.
 *
 * Считается в эффекте, а не при отрисовке: время на сервере и на клиенте
 * разное, и прямой расчёт ломал бы гидратацию.
 */
function useElapsed(startedAt: string | null): string | null {
  // В состоянии — только «который час», а строка считается при отрисовке.
  // Так в эффекте нет синхронного setState, и лишних перерисовок не будет:
  // значение меняется ровно раз в секунду и только пока смена идёт.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!startedAt) return;
    // Первое значение — отложенной задачей, а не сразу: прямой вызов в теле
    // эффекта — это каскадная перерисовка, и правило проекта её запрещает.
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [startedAt]);

  if (!startedAt || now === null) return null;
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return null;
  const seconds = Math.max(0, Math.floor((now - started) / 1000));
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}`;
}

/** ШАГ 5 — работа. Счётчики смены и быстрые действия под рукой. */
function WorkStep({ facts, phase, onAction, busy, onQuick }: StepProps & {
  onQuick: (action: 'defect' | 'downtime' | 'pile') => void;
}) {
  const elapsed = useElapsed(facts.shift?.startedAt ?? null);
  return (
    <section className={cardShell} aria-label="Текущий шаг смены">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-success-strong" aria-hidden />
        <p className="text-sm font-semibold text-success-strong">Смена активна</p>
      </div>
      {elapsed && (
        <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-foreground">{elapsed}</p>
      )}

      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-border px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Моточасы</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">
            {facts.meterCurrent != null ? formatNumber(facts.meterCurrent) : '—'}
          </p>
        </div>
        <div className="rounded-xl border border-border px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Сваи сегодня</p>
          <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{facts.pilesToday} шт</p>
        </div>
      </div>

      <button
        type="button"
        onClick={() => onQuick('pile')}
        className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-signal text-base font-semibold text-white active:scale-[0.99]"
      >
        + Новая свая
      </button>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button type="button" onClick={() => onQuick('defect')}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground active:scale-[0.99]">
          <PilingIcon name="defect" size={22} decorative /> Дефект
        </button>
        <button type="button" onClick={() => onQuick('downtime')}
          className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-sm font-medium text-foreground active:scale-[0.99]">
          <PilingIcon name="downtime" size={22} decorative /> Простой
        </button>
      </div>

      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Следующий шаг — {phase.title}
        </p>
        <Blockers items={phase.blockers} />
        <PrimaryButton label={phase.action} onClick={onAction} busy={busy} disabled={phase.target === null} />
      </div>
    </section>
  );
}

/** Обычный шаг: заголовок, подпись, кнопка. Осмотр, отчёт, сдача. */
function PlainStep({ phase, onAction, busy }: StepProps) {
  return (
    <section className={cardShell} aria-label="Текущий шаг смены">
      <StepHeading phase={phase} />
      {phase.progress && <p className="mt-1.5 text-sm text-muted-foreground">{phase.progress}</p>}
      <Blockers items={phase.blockers} />
      <PrimaryButton label={phase.action} onClick={onAction} busy={busy} disabled={phase.target === null} />
    </section>
  );
}

interface StepProps {
  facts: OperatorShiftFacts;
  phase: ShiftPhase;
  onAction: () => void;
  busy?: boolean;
}

/**
 * Выбор вида шага.
 *
 * Приёмка, пуск и работа получают свой экран — на них человек принимает
 * решение и ему нужны факты. Осмотр, отчёт и сдача ведут в работу шага, и
 * лишнее на карточке им только мешает.
 */
export function ShiftStepScreen(props: StepProps & {
  onQuick: (action: 'defect' | 'downtime' | 'pile') => void;
}) {
  const { phase, facts } = props;
  if (phase.phase === 2 && facts.equipment) return <AcceptanceStep {...props} />;
  if (phase.phase === 4) return <StartStep {...props} />;
  if (phase.phase === 5 && facts.shift?.state === 'STARTED') return <WorkStep {...props} />;
  return <PlainStep {...props} />;
}

/** Сводка закрытой смены — последний экран макета «Смена закрыта». */
export function ShiftClosedCard({ facts, onOpenReport }: {
  facts: OperatorShiftFacts;
  onOpenReport: () => void;
}) {
  return (
    <section className={cardShell} aria-label="Смена закрыта">
      <div className="flex flex-col items-center text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success/15">
          <Check className="h-11 w-11 text-success-strong" />
        </div>
        <h2 className="mt-3 text-xl font-bold text-foreground">Смена передана</h2>
        <p className="mt-1 text-sm text-muted-foreground">Ждёт приёмки следующим оператором</p>
      </div>
      <div className="mt-4">
        <Row label="Сваи выполнено" value={`${facts.pilesToday} шт`} />
        {facts.meterCurrent != null && (
          <Row label="Моточасы" value={`${formatNumber(facts.meterCurrent)} м.ч.`} />
        )}
        <Row
          label="Осмотр после работ"
          value={facts.inspection.postShift?.status === 'COMPLETED' ? 'закрыт' : 'не проводился'}
          tone={facts.inspection.postShift?.status === 'COMPLETED' ? 'ok' : 'warn'}
        />
      </div>
      <button
        type="button"
        onClick={onOpenReport}
        className="mt-4 flex min-h-12 w-full items-center justify-center rounded-xl border border-border bg-card text-base font-medium text-foreground active:scale-[0.99]"
      >
        Посмотреть отчёт
      </button>
    </section>
  );
}
