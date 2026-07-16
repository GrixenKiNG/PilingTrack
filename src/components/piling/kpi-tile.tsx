'use client';

import type { ComponentType, CSSProperties, ReactNode } from 'react';
import { PilingIcon, type PilingIconName } from '@/components/piling/icons';
import { cn } from '@/lib/utils';

/**
 * Единая KPI-плитка для всех модулей.
 *
 * Один вид везде: белая плитка, иконка слева во всю высоту, описание справа.
 * Размеры фиксированы намеренно — раньше каждый модуль рисовал плитку по-своему
 * (иконка то слева, то справа, 16/28/36/74px), и они не совпадали между собой.
 *
 * Геометрия (почему именно так):
 *   min-h-28 (112px) − p-4 (32px) = 80px содержимого → иконка ровно 80×80,
 *   как в дашборде. Иконка позиционируется абсолютно внутри колонки шириной
 *   w-20, поэтому её собственный размер не может раздуть плитку, а ширина
 *   колонки не даёт ей вылезти. Подпись — min-w-0, иначе длинное слово не даёт
 *   строке сжаться и выталкивает иконку за край.
 *
 * Плитке нужно ≥250px ширины (80 иконка + 16 зазор + 32 поля + ~120 текст) —
 * см. KPI_GRID.
 */
/** Lucide/unified-иконка: принимаем любой компонент, принимающий className. */
type IconComponent = ComponentType<{ className?: string }>;

export interface KpiTileProps {
  /** Имя предметной иконки либо любой Lucide/unified-компонент. */
  icon: PilingIconName | IconComponent;
  label: string;
  value: ReactNode;
  detail?: string;
  /** Точка «требует внимания» рядом с подписью. */
  alert?: boolean;
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
  return <Icon className="absolute inset-0 h-full w-full text-slate-500" />;
}

export function KpiTile({ icon, label, value, detail, alert, children, className, onClick }: KpiTileProps) {
  const Wrapper = onClick ? 'button' : 'div';
  const iconNode = typeof icon === 'string'
    ? <PilingIcon name={icon} fill decorative className="absolute inset-0" />
    : renderIcon(icon);

  return (
    <Wrapper
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex h-full min-h-28 min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition',
        onClick && 'hover:border-orange-300 hover:shadow-md',
        className,
      )}
    >
      <div className="flex flex-1 items-stretch gap-4">
        <span className="relative w-20 shrink-0 self-stretch">{iconNode}</span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            <span className="min-w-0 break-words">{label}</span>
            {alert && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" aria-label="Требует внимания" />}
          </span>
          <span className="mt-1 break-words font-mono text-xl font-bold tabular-nums leading-tight text-slate-900">{value}</span>
          {detail && <span className="mt-1 break-words text-xs text-slate-500">{detail}</span>}
          {children}
        </div>
      </div>
    </Wrapper>
  );
}
