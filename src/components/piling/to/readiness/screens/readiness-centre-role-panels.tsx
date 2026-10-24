import { ROLE_FLOW, stepOwner, type RoleFlowProgress } from './readiness-centre-role-flow';
import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight } from '@/components/piling/icons/unified-icons';



import { cn } from '@/lib/utils';



import type { ReadinessAbility } from '../api/contracts';



import type { ReferenceView } from './types';

/**
 * Подсказка «что делать сейчас» по нажатию на карточку роли.
 *
 * Состояния шагов — из того же `roleProgress`, что рисует цепочку: второго
 * источника нет. Первый невыполненный шаг подсвечен и подписан «Сделайте это
 * сейчас»; у шага, на который у смотрящего нет права, вместо кнопки — строка
 * «Этот шаг выполняет <роль>».
 */
function RoleStepsPanel({ roleIndex, progress, onViewChange, abilities }: {
  roleIndex: number;
  progress: RoleFlowProgress[];
  onViewChange: (view: ReferenceView) => void;
  abilities: readonly ReadinessAbility[];
}) {
  const role = ROLE_FLOW[roleIndex];
  const steps = progress[roleIndex]?.steps ?? [];
  // «Сделайте это сейчас» ставим только на шаг, который смотрящий реально может
  // закрыть: чужой шаг (есть исполнитель) и шаг без данных не подсвечиваем.
  const firstPending = steps.findIndex((step, index) =>
    !step.done && step.known !== false && !role.steps[index]?.executor);
  return (
    <section aria-label={`Что делать сейчас: ${role.label}`} className="mt-2 rounded-lg border border-border bg-card p-3 shadow-sm">
      <h2 className="text-sm font-extrabold">Что делать сейчас: {role.label}</h2>
      <ul className="mt-2 space-y-2">
        {role.steps.map((step, index) => {
          const done = steps[index]?.done ?? false;
          const known = steps[index]?.known !== false;
          const now = index === firstPending;
          const hasTarget = Boolean(step.target.view || step.target.href);
          // Чужой шаг: его закрывает другая роль — кнопки «сделать» у него нет.
          const foreign = Boolean(step.executor);
          const allowed = !foreign && (!step.ability || abilities.includes(step.ability));
          const performedBy = step.executor ?? stepOwner(step);
          const pill = done
            ? { text: 'Выполнено', cls: 'bg-success/10 text-success-strong' }
            : !known
              ? { text: 'Нет данных', cls: 'bg-muted text-muted-foreground' }
              : now
                ? { text: 'Сейчас', cls: 'bg-signal text-white' }
                : { text: 'Впереди', cls: 'bg-muted text-muted-foreground' };
          return (
            <li key={step.key} className={cn('rounded-lg border p-2.5', now ? 'border-signal ring-2 ring-signal/30' : 'border-border')}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn('rounded px-2 py-0.5 text-3xs font-bold', pill.cls)}>
                  {pill.text}
                </span>
                <span className="text-xs font-bold">{step.title}</span>
                {now && <span className="ml-auto text-3xs font-bold text-signal-strong">Сделайте это сейчас</span>}
              </div>
              <p className="mt-1 text-2xs leading-relaxed text-muted-foreground">{step.hint}</p>
              {allowed && hasTarget ? (
                step.target.href ? (
                  <Link href={step.target.href} aria-label={`${step.title}: перейти`} className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-signal-strong">
                    Перейти<ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => step.target.view && onViewChange(step.target.view)}
                    aria-label={`${step.title}: перейти`}
                    className="mt-2 inline-flex items-center gap-1 text-2xs font-semibold text-signal-strong"
                  >
                    Перейти<ChevronRight className="h-3.5 w-3.5" />
                  </button>
                )
              ) : performedBy ? (
                <p className="mt-2 text-2xs text-muted-foreground">Выполняет {performedBy}</p>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export function RoleFlowFooter({ progress, owner, onViewChange, abilities }: {
  progress: RoleFlowProgress[];
  owner: string | null;
  onViewChange: (view: ReferenceView) => void;
  abilities: readonly ReadinessAbility[];
}) {
  const [openRole, setOpenRole] = useState<number | null>(null);
  return (
    <>
      <section aria-label="Роли процесса технической готовности" className="mt-2 grid grid-cols-1 items-stretch gap-2 sm:grid-cols-2 2xl:grid-cols-[1fr_24px_1fr_24px_1fr_24px_1fr] 2xl:gap-0">
        {ROLE_FLOW.map((role, index) => {
          const RoleIcon = role.lucide;
          const roleProgress = progress[index];
          // Роль, на которой стоит процесс: без этой отметки лента показывала
          // четыре равнозначные карточки, и кто именно держит ход — не читалось.
          const holding = owner === role.label;
          const open = openRole === index;
          return (
            <div key={role.label} className="contents">
              <article className={cn(
                'flex flex-col overflow-hidden rounded-lg border bg-card shadow-sm',
                holding ? 'border-signal ring-2 ring-signal/30' : role.border,
              )}>
                {/* Карточка роли теперь открывает подсказку «что делать сейчас». */}
                <button
                  type="button"
                  onClick={() => setOpenRole(open ? null : index)}
                  aria-expanded={open}
                  aria-label={`${role.label}: что делать сейчас`}
                  className="flex flex-1 flex-col text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <header className={cn('flex items-center gap-2 border-b px-3 py-1.5', role.header)}>
                    <RoleIcon className="h-4 w-4" />
                    <h2 className="text-sm font-extrabold">{role.label}</h2>
                    {holding && (
                      <span className="ml-auto rounded bg-signal px-2 py-0.5 text-3xs font-bold text-white">
                        Сейчас ход
                      </span>
                    )}
                    <ChevronRight className={cn('h-4 w-4', holding ? '' : 'ml-auto', open && 'rotate-90')} />
                  </header>
                  <div className="flex flex-1 items-center gap-2 px-3 py-2">
                    <div className="min-w-0 flex-1 space-y-1 text-2xs leading-[1.35] text-muted-foreground">
                      {role.steps.map((step) => <div key={step.key} className="flex gap-1.5"><span className="text-muted-foreground">•</span><span>{step.title}</span></div>)}
                    </div>
                    {roleProgress && (
                      <div className="shrink-0 rounded-[10px] border border-border px-2.5 py-1.5 text-center text-2xs">
                        <div className="text-muted-foreground">{roleProgress.state}</div>
                        <div className="font-bold tabular-nums">{roleProgress.done}/{roleProgress.total} шагов</div>
                      </div>
                    )}
                    {/* The handoff uses the approved PNG directly in this footer. */}
                    { }
                    <img src={`/icons/pilingtrack/${role.icon}.png`} alt="" className="h-[34px] w-[34px] shrink-0 object-contain" />
                  </div>
                </button>
              </article>
              {index < ROLE_FLOW.length - 1 && <div className="hidden items-center justify-center text-xl text-muted-foreground 2xl:flex">→</div>}
            </div>
          );
        })}
      </section>
      {openRole !== null && (
        <RoleStepsPanel roleIndex={openRole} progress={progress} onViewChange={onViewChange} abilities={abilities} />
      )}
    </>
  );
}

/** Этап цепочки: ведёт либо на страницу другого модуля, либо на вкладку контура. */
export function StageLink({target, label, onViewChange, children}: {
  target: {href?: string; view?: ReferenceView};
  label: string;
  onViewChange: (view: ReferenceView) => void;
  children: React.ReactNode;
}) {
  // flex, а не block: у <button> браузер центрирует содержимое по вертикали,
  // и в сетке цепочки кружки шагов с однострочной подписью съезжали на 8px
  // ниже кружков со «Техническое обслуживание» — ряд переставал быть линией.
  const shared = 'flex min-h-11 flex-col items-center justify-start rounded-lg px-2 py-1 text-center transition hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  if (!target.href && !target.view) return <div className={shared}>{children}</div>;
  return target.href
    ? <Link href={target.href} className={shared} aria-label={`${label}: открыть`}>{children}</Link>
    : <button type="button" onClick={() => target.view && onViewChange(target.view)} className={shared} aria-label={`${label}: открыть`}>{children}</button>;
}
