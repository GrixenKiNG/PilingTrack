'use client';

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { cn } from '@/lib/utils';

/**
 * Единая KPI-плитка для всех модулей.
 *
 * Один вид везде: белая плитка, значок в цветном чипе слева, подпись и крупное
 * значение справа. Размеры фиксированы намеренно — раньше каждый модуль рисовал
 * плитку по-своему (иконка то слева, то справа, 16/28/36/74px).
 *
 * Геометрия (почему именно так):
 *   чип 48×48 + зазор 12 + поля 32 = 92px постоянных, остальное отдано тексту.
 *   Значок больше не растягивается на всю высоту плитки: в макете он размером
 *   с подпись, а первым читается число, поэтому 80×80 картинка перевешивала.
 *   Подпись — min-w-0, иначе длинное слово не даёт строке сжаться и выталкивает
 *   значок за край.
 *
 * Плитке нужно ≥220px ширины (92 постоянных + ~130 текст) — см. KPI_GRID.
 */
/** Lucide/unified-иконка: принимаем любой компонент, принимающий className. */
type IconComponent = ComponentType<{ className?: string }>;

/**
 * Смысловой тон плитки. Задаёт цвет подложки под иконкой — по макету значок
 * KPI цветной, а не серый: красный у критических дефектов, зелёный у
 * готовности, оранжевый у ожидания. Значение и подпись остаются нейтральными,
 * чтобы цвет нёс состояние, а не украшал.
 */
export type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE_CHIP: Record<KpiTone, string> = {
  neutral: 'bg-muted',
  success: 'bg-success/10',
  warning: 'bg-warning/10',
  danger: 'bg-destructive/10',
  info: 'bg-info/10',
};

export interface KpiTileProps {
  /** Имя предметной иконки либо любой Lucide/unified-компонент. */
  icon: PilingIconName | IconComponent;
  label: string;
  value: ReactNode;
  detail?: string;
  /** Точка «требует внимания» рядом с подписью; включает оранжевый тон значка. */
  alert?: boolean;
  /** Смысловой тон значка. Явный `tone` сильнее, чем `alert`. */
  tone?: KpiTone;
  /** Прогресс-бар и прочее под описанием. */
  children?: ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * Сетка KPI-плиток: все плитки в один ряд равными долями.
 *
 * На узких экранах (<lg) ряд бы схлопнулся в нечитаемые огрызки, поэтому там
 * остаётся перенос по 2 в ряд, а «один ряд» включается с lg. Чтобы плитке
 * хватало ширины, KPI-бар должен идти во всю ширину страницы — над областью с
 * боковой панелью, а не внутри левой колонки (иначе 6 плиток дают ~130px, и
 * иконка с подписью не помещаются).
 */
export const KPI_GRID = 'grid grid-cols-2 gap-3 lg:[grid-template-columns:repeat(var(--kpi-cols),minmax(0,1fr))]';

/** Ровно `count` колонок в один ряд, начиная с lg. Передавайте в style сетки. */
export function kpiGridStyle(count: number): CSSProperties {
  return { '--kpi-cols': String(count) } as CSSProperties;
}

function renderIcon(Icon: IconComponent) {
  return <Icon className="h-7 w-7 text-foreground" />;
}

export function KpiTile({
  icon, label, value, detail, alert, tone, children, className, onClick,
}: KpiTileProps) {
  const Wrapper = onClick ? 'button' : 'div';
  const chipTone: KpiTone = tone ?? (alert ? 'warning' : 'neutral');
  const iconNode = typeof icon === 'string'
    ? <PilingIcon name={icon} size={30} decorative />
    : renderIcon(icon);

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-full min-h-24 min-w-0 items-center gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition',
        onClick && 'hover:border-signal/30 hover:shadow-md',
        className,
      )}
    >
      {/* Значок в цветном чипе, а не серой картинкой во всю высоту: по макету
          тон значка и есть индикатор состояния, а крупная цифра — то, что
          читают первым. Раньше иконка занимала 80px и перевешивала значение. */}
      <span
        className={cn(
          'flex h-12 w-12 shrink-0 items-center justify-center rounded-xl',
          TONE_CHIP[chipTone],
        )}
      >
        {iconNode}
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <span className="min-w-0 break-words">{label}</span>
          {alert && <span className="h-2 w-2 shrink-0 rounded-full bg-signal" aria-label="Требует внимания" />}
        </span>
        <span className="mt-0.5 break-words text-2xl font-semibold tabular-nums leading-tight text-foreground">
          {value}
        </span>
        {detail && <span className="mt-1 break-words text-xs text-muted-foreground">{detail}</span>}
        {children}
      </div>
    </Wrapper>
  );
}
