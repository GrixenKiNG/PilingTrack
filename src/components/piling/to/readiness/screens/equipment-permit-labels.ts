/**
 * Русские названия для матрицы допусков.
 *
 * Живут отдельным файлом, а не внутри экрана: те же подписи нужны карточке
 * работника, его личному разделу и печатной форме. Разъехавшись, они дадут
 * «Управление» в одном месте и «Эксплуатация» в другом — про одну и ту же
 * строку допуска.
 */

export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  PILE_DRIVER: 'Сваебойная установка',
  DRILLING_RIG: 'Буровая установка',
  VIBRO_HAMMER: 'Вибропогружатель',
  HYBRID: 'Комбинированная установка',
  OTHER: 'Прочая техника',
};

export const EQUIPMENT_KIND_ORDER = [
  'PILE_DRIVER', 'DRILLING_RIG', 'VIBRO_HAMMER', 'HYBRID', 'OTHER',
] as const;

export const WORK_SCOPE_LABELS: Record<string, string> = {
  OPERATION: 'Управление',
  ASSEMBLY: 'Монтаж и демонтаж',
  MAINTENANCE: 'Обслуживание и ремонт',
  RIGGING: 'Стропальные работы',
  SUPPORT: 'Вспомогательные работы',
};

export const WORK_SCOPE_ORDER = [
  'OPERATION', 'ASSEMBLY', 'MAINTENANCE', 'RIGGING', 'SUPPORT',
] as const;

export const PERMIT_STATUS_LABELS: Record<string, string> = {
  ALLOWED: 'Допущен',
  LIMITED: 'Ограничен',
  DENIED: 'Не допущен',
};

/** Цвет строки по состоянию. Просроченный допуск красим как «не допущен». */
export function permitStatusClass(status: string, expired: boolean): string {
  if (expired || status === 'DENIED') return 'bg-destructive/10 text-destructive-strong';
  if (status === 'LIMITED') return 'bg-warning/10 text-warning-strong';
  return 'bg-success/10 text-success-strong';
}
