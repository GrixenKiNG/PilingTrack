'use client';

import {useEffect, useRef, type ReactNode} from 'react';
import {cn} from '@/lib/utils';

/**
 * Части экрана машиниста.
 *
 * Оформление — токены продукта: `bg-card`, `border-border`, семантические
 * success/warning/destructive и бренд-оранжевый `signal` на первичном действии.
 * Отличие от остального приложения одно и намеренное: цель нажатия не меньше
 * 44 точек, а у главной кнопки — 48. Экран держат в перчатке на морозе, и
 * кнопка высотой 36 точек, нормальная для мыши, здесь промахивается.
 */

export function Screen({title, subtitle, children, footer, tabs}: {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Нижние вкладки. Появляются только после начала работы — см. TabBar. */
  tabs?: ReactNode;
}) {
  const main = useDensityFit([title, subtitle, children, footer, tabs]);
  return (
    <div className="operator-screen flex min-h-dvh flex-col bg-background text-foreground">
      <header className="operator-screen-header border-b px-4 pb-2.5 pt-3">
        <h1 className="text-[1.4rem] font-black leading-tight tracking-[-0.025em] text-balance">{title}</h1>
        {subtitle ? <p className="mt-0.5 text-2xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      {/*
        Снизу — только дыхание, а не место под панель.

        Раньше здесь стояло `pb-56` (224 px) «под прилипшую панель». Панель
        прилипшая, но она же — обычный элемент колонки и занимает свою строку
        ПОСЛЕ содержимого: замер показал 81 + 935 + 152 = 1168, то есть высота
        панели была посчитана дважды. Эти 224 px и были главной причиной
        прокрутки там, где всё помещалось (жалоба 17.09.2026).
      */}
      <main className="operator-screen-main flex-1 space-y-2.5 px-4 pb-3 pt-2.5"
        ref={main}>{children}</main>
      {/*
        Пустую панель не рисуем вовсе: с рамкой и тенью она выглядела как
        оборванный низ экрана.
      */}
      {footer || tabs ? (
        <div className="operator-screen-footer sticky bottom-0 z-20 border-t bg-card pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
          {footer ? <div className="space-y-2 px-4 py-1.5">{footer}</div> : null}
          {tabs}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Поджать содержимое вместо прокрутки.
 *
 * Экран из трёх карточек, который приходится листать, раздражает сильнее, чем
 * шрифт на десятую меньше: в рукавице прокрутка — это отдельное действие, а
 * половину смены человек смотрит на экран одной рукой. Поэтому при небольшом
 * перехлёсте содержимое сжимается — но не ниже 0,8: дальше страдает
 * читаемость на морозе, а осмотр с нечитаемым пунктом опаснее прокрутки.
 *
 * Сжимается ТОЛЬКО содержимое. Шапка и нижняя панель остаются в полный
 * размер: цель нажатия во вкладках не должна уезжать ниже 44 точек, ради чего
 * вкладок и оставлено четыре.
 *
 * `zoom`, а не `transform: scale` — масштаб должен менять занимаемое место, а
 * не рисовать уменьшенную картинку поверх прежнего. Коэффициент ставится прямо
 * на узел: это подгонка вида, перерисовка ради неё не нужна.
 */
function useDensityFit(deps: unknown[]) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;

    const fit = () => {
      /*
        Считаем по фактическому перехлёсту страницы, а не по сумме высот
        окружения. Складывать шапку приложения, полосу фаз, строку связи и
        нижнюю панель значит повторять в коде вёрстку — и ошибаться на
        десяток точек при любой её правке. Вопрос у нас ровно один: «страница
        сейчас листается?», и браузер отвечает на него сам.
      */
      node.style.removeProperty('zoom');
      const page = document.documentElement;
      const overflow = page.scrollHeight - page.clientHeight;
      if (overflow <= 0) return;

      const height = node.getBoundingClientRect().height;
      const target = height - overflow;
      if (height <= 0 || target <= 0) return;

      // Округляем ВНИЗ: лишняя сотая сжатия незаметна, недостающая оставляет
      // прокрутку — ровно то, ради чего всё и затевалось.
      node.style.zoom = String(Math.max(0.8, Math.floor((target / height) * 100) / 100));
    };

    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- пересчёт при любой смене содержимого экрана
  }, deps);

  return ref;
}

export interface TabDefinition<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** Число на значке: непрочитанное, несделанное, требующее внимания. */
  badge?: number;
  /** Значок красный, а не серый: там что-то, что нельзя пропустить. */
  alarming?: boolean;
}

/**
 * Нижние вкладки рабочего места.
 *
 * ПОЧЕМУ ТОЛЬКО ПОСЛЕ НАЧАЛА РАБОТЫ. До этого экран ведёт человека по порядку:
 * допуск, приём, осмотр, пуск, площадка. Порядок здесь — не интерфейсное
 * удобство, а безопасность: отказы дешевле находить на земле, чем на четвёртой
 * свае, и давать возможность «сходить в другую вкладку» посреди осмотра значит
 * дать возможность его не закончить. Когда работа началась, ведение
 * заканчивается: дальше машинист сам решает, посмотреть ли карточку машины,
 * записать ли происшествие или проверить свои допуски.
 */
export function TabBar<T extends string>({tabs, active, onSelect}: {
  tabs: TabDefinition<T>[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    /*
      Колонок ровно столько, сколько вкладок. Жёсткое `grid-cols-4` ломалось на
      пятой вкладке («ТБ»): она уезжала во второй ряд, и панель становилась
      двухэтажной.
    */
    <nav
      className="operator-tab-bar grid border-t"
      style={{gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))`}}
      aria-label="Разделы смены"
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          aria-current={tab.id === active ? 'page' : undefined}
          className={cn(
            'relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-1.5 text-3xs font-bold transition-colors',
            tab.id === active
              ? 'border-t-2 border-signal -mt-px text-signal'
              : 'text-muted-foreground hover:bg-secondary',
          )}
        >
          {tab.icon ? <span className="[&>svg]:size-[18px]" aria-hidden>{tab.icon}</span> : null}
          <span>{tab.label}</span>
          {tab.badge ? (
            <span
              className={cn(
                'ml-1 inline-flex min-w-4 items-center justify-center rounded-full px-1 text-3xs font-bold text-white',
                tab.alarming ? 'bg-destructive' : 'bg-muted-foreground',
              )}
            >
              {tab.badge}
            </span>
          ) : null}
        </button>
      ))}
    </nav>
  );
}

export function BigButton({children, onClick, disabled, tone = 'primary', type = 'button'}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: 'primary' | 'ghost' | 'danger';
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'operator-big-button min-h-12 w-full rounded-xl border px-4 text-base font-bold shadow-sm transition-all active:translate-y-px',
        'disabled:cursor-not-allowed disabled:opacity-50',
        tone === 'primary' && 'border-signal bg-signal text-white hover:bg-signal-strong',
        tone === 'ghost' && 'bg-card text-foreground hover:bg-secondary',
        tone === 'danger' && 'border-destructive bg-destructive text-white hover:bg-destructive-strong',
      )}
    >
      {children}
    </button>
  );
}

export type PanelTone = 'plain' | 'ok' | 'warning' | 'danger';

export function Panel({children, tone = 'plain', className}: {
  children: ReactNode;
  tone?: PanelTone;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'operator-panel rounded-xl border bg-card p-4 shadow-xs',
        tone === 'ok' && 'border-success/45 bg-success/8',
        tone === 'warning' && 'border-warning/50 bg-warning/10',
        tone === 'danger' && 'border-destructive/45 bg-destructive/8',
        className,
      )}
    >
      {children}
    </section>
  );
}

export function PanelTitle({children, tone = 'plain'}: {children: ReactNode; tone?: PanelTone}) {
  return (
    <h2
      className={cn(
        'text-base font-semibold leading-snug tracking-tight',
        tone === 'ok' && 'text-success-strong',
        tone === 'warning' && 'text-warning-strong',
        tone === 'danger' && 'text-destructive-strong',
      )}
    >
      {children}
    </h2>
  );
}

/** Строка «показатель — значение». Значение крупнее подписи и моноширинное. */
export function Fact({label, value, unit}: {label: string; value: ReactNode; unit?: string}) {
  return (
    <div className="operator-fact flex items-baseline justify-between gap-3 border-b py-2.5 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right">
        <span className="text-base font-semibold tabular-nums">{value}</span>
        {unit ? <span className="ml-1 text-2xs text-muted-foreground">{unit}</span> : null}
      </span>
    </div>
  );
}

/** Объём работ в двух единицах сразу: штуки и метры погонные. */
export function VolumeFact({label, count, meters}: {label: string; count: number; meters: number}) {
  return (
    <div className="operator-fact flex items-baseline justify-between gap-3 border-b py-2.5 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-right tabular-nums">
        <span className="text-base font-semibold">{count}</span>
        <span className="ml-1 text-2xs text-muted-foreground">шт</span>
        <span className="mx-1.5 text-muted-foreground">·</span>
        <span className="text-base font-semibold">{meters.toFixed(1)}</span>
        <span className="ml-1 text-2xs text-muted-foreground">м.п.</span>
      </span>
    </div>
  );
}

/**
 * Полоса хода смены. Пройденные шаги можно открыть и посмотреть.
 *
 * ПОЧЕМУ ТОЛЬКО ПРОЙДЕННЫЕ И ТОЛЬКО ПОСМОТРЕТЬ. Фазу выводит сервер из
 * записанных фактов, и «вернуться» в смысле отменить — значит развести экран с
 * фактами. Но человеку нужно другое: свериться, что он записал на осмотре, уже
 * стоя на площадке. Это чтение, и оно ничего не меняет.
 *
 * Без `onOpen` полоса остаётся прежней — просто индикатор.
 */
export function PhaseBar({progress, onOpen}: {
  progress: {phase: string; label: string; done: boolean; current: boolean}[];
  onOpen?: (phase: string) => void;
}) {
  const current = progress.find((step) => step.current);
  const currentIndex = progress.findIndex((step) => step.current);
  const completed = progress.length > 0 && progress.every((step) => step.done);
  const displayedStep = currentIndex >= 0
    ? currentIndex + 1
    : completed
      ? progress.length
      : Math.min(progress.filter((step) => step.done).length + 1, progress.length);
  return (
    <div className="operator-phase-bar border-b border-white/10 bg-[#121a22] px-4 pb-1.5 pt-1.5 text-white">
      {/* Шаг и его название — одной строкой. Тремя строками («Шаг 2 из 7»,
          «Приём», «Контроль смены») этот заголовок занимал больше места, чем
          сама шкала под ним, а подпись «Контроль смены» не сообщала ничего,
          чего не видно из шкалы. */}
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-3xs font-bold uppercase tracking-[0.18em] text-white/55">
          {completed ? `${progress.length} из ${progress.length}` : `Шаг ${displayedStep} из ${progress.length}`}
        </span>
        <span className="min-w-0 truncate text-sm font-bold">{current?.label ?? 'Смена завершена'}</span>
      </div>
      <ol
        className="grid"
        style={{gridTemplateColumns: `repeat(${progress.length}, minmax(0, 1fr))`}}
        aria-label="Ход смены"
      >
        {progress.map((step, index) => {
          const openable = Boolean(onOpen) && step.done && !step.current;
          const mark = (
            <span className={cn(
              'relative z-10 flex size-6 items-center justify-center rounded-full border text-3xs font-black tabular-nums',
              step.done && 'border-success bg-success text-white',
              step.current && 'border-signal bg-signal text-white ring-4 ring-signal/20',
              !step.done && !step.current && 'border-white/30 bg-[#121a22] text-white/45',
            )}>
              {step.done ? '✓' : index + 1}
            </span>
          );
          return (
            <li
              key={step.phase}
              aria-label={`${step.label} — ${step.done ? 'выполнено' : step.current ? 'текущий этап' : 'впереди'}`}
              className={cn(
                'relative flex min-w-0 flex-col items-center',
                index > 0 && 'before:absolute before:right-1/2 before:top-3 before:h-0.5 before:w-full before:bg-white/20',
                index > 0 && (step.done || step.current) && 'before:bg-success/80',
              )}
            >
              {openable ? (
                <button
                  type="button"
                  // Палец в перчатке меньше 44 px не попадает: кружок 24 px
                  // расширяем прозрачной областью, не двигая саму полосу.
                  className="relative -m-2.5 flex size-11 items-center justify-center p-2.5"
                  onClick={() => onOpen?.(step.phase)}
                  title={`Посмотреть: ${step.label}`}
                >
                  {mark}
                </button>
              ) : mark}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function ErrorNote({message}: {message: string | null}) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-lg border border-destructive/45 bg-destructive/8 p-3 text-sm font-medium text-destructive-strong">
      {message}
    </p>
  );
}

/** Кружок со знаком: цвет читают не все, галочку и восклицательный знак — все. */
export function Sign({tone}: {tone: 'ok' | 'warning' | 'danger'}) {
  return (
    <span
      aria-hidden
      className={cn(
        'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-bold text-white',
        tone === 'ok' && 'bg-success',
        tone === 'warning' && 'bg-warning text-warning-foreground',
        tone === 'danger' && 'bg-destructive',
      )}
    >
      {tone === 'ok' ? '✓' : tone === 'warning' ? '!' : '✕'}
    </span>
  );
}
