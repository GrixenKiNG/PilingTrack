'use client';

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { cn } from '@/lib/utils';

/**
 * Единая KPI-плитка для всех модулей.
 *
 * Один вид везде: белая плитка, крупный значок слева во всю высоту, подпись и
 * значение справа. Размеры фиксированы намеренно — раньше каждый модуль рисовал
 * плитку по-своему (иконка то слева, то справа, 16/28/36/74px).
 *
 * Геометрия (почему именно так):
 *   min-h-28 (112px) − p-4 (32px) = 80px содержимого → значок ровно 80×80.
 *   Он позиционируется абсолютно внутри колонки шириной w-20, поэтому его
 *   собственный размер не может раздуть плитку, а ширина колонки не даёт ему
 *   вылезти. Подпись — min-w-0, иначе длинное слово не даёт строке сжаться и
 *   выталкивает значок за край.
 *
 * Плитке нужно ≥250px ширины (80 значок + 16 зазор + 32 поля + ~120 текст) —
 * см. KPI_GRID.
 *
 * Про подложку. С 17.07 по 18.08.2026 значок жил в цветном чипе 48×48 и был
 * ужат до 28px. Владелец сравнил с продом и вернул продовый вид: значок
 * крупный, без рамки и без фона. Тон при этом не потерян — он переехал с
 * подложки на сам значок (см. TONE_ICON).
 */
/** Lucide/unified-иконка: принимаем любой компонент, принимающий className. */
type IconComponent = ComponentType<{ className?: string }>;

/**
 * Смысловой тон плитки: красный у критических дефектов, зелёный у готовности,
 * оранжевый у ожидания. Значение и подпись остаются нейтральными, чтобы цвет
 * нёс состояние, а не украшал.
 */
export type KpiTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

/**
 * Тон красит сам значок, а не подложку под ним.
 *
 * Работает только для векторных иконок. Доменные значки (свая, бурение,
 * простой) — растровые вырезки из утверждённого листа, текстовым цветом их не
 * перекрасить, и они остаются как нарисованы. Раньше цвет для них нёс фон
 * чипа; чип убран по требованию владельца, так что для растровых значков тон
 * теперь не виден — состояние у них показывает точка «требует внимания».
 */
const TONE_ICON: Record<KpiTone, string> = {
  neutral: 'text-muted-foreground',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-destructive',
  info: 'text-info',
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

function renderIcon(Icon: IconComponent, tone: KpiTone) {
  return <Icon className={cn('absolute inset-0 h-full w-full', TONE_ICON[tone])} />;
}

export function KpiTile({
  icon, label, value, detail, alert, tone, children, className, onClick,
}: KpiTileProps) {
  const Wrapper = onClick ? 'button' : 'div';
  const iconTone: KpiTone = tone ?? (alert ? 'warning' : 'neutral');
  const iconNode = typeof icon === 'string'
    ? <PilingIcon name={icon} fill decorative className="absolute inset-0" />
    : renderIcon(icon, iconTone);

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-full min-h-28 min-w-0 flex-col rounded-xl border border-border bg-card p-4 text-left shadow-sm transition',
        onClick && 'hover:border-signal/30 hover:shadow-md',
        className,
      )}
    >
      <div className="flex flex-1 items-stretch gap-4">
        {/* Колонка фиксированной ширины с абсолютно позиционированным значком:
            так его собственный размер не может раздуть плитку, а колонка не
            даёт ему вылезти за край. */}
        <span className="relative w-20 shrink-0 self-stretch">{iconNode}</span>
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
      </div>
    </Wrapper>
  );
}
