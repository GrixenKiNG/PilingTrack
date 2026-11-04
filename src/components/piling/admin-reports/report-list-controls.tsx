import { ArrowUpDown } from '@/components/piling/icons/unified-icons';
import { cn } from '@/lib/utils';

export type QuickFilter = 'all' | 'today' | 'yesterday' | 'week' | 'drafts' | 'submitted' | 'downtime' | 'withPhotos' | 'edited';

export const QUICK_FILTERS: Array<{ key: QuickFilter; label: string }> = [
  { key: 'all', label: 'Все' },
  { key: 'today', label: 'Сегодня' },
  { key: 'yesterday', label: 'Вчера' },
  { key: 'week', label: '7 дней' },
  { key: 'drafts', label: 'Черновики' },
  { key: 'submitted', label: 'Сданные' },
  { key: 'downtime', label: 'С простоем' },
  { key: 'withPhotos', label: 'С фото' },
  { key: 'edited', label: 'Изменены вручную' },
];

export type SortKey = 'date' | 'site' | 'user' | 'piles' | 'drilling' | 'downtime';

/**
 * R140 №3: колонки были статичными подписями — список всегда шёл по дате вниз,
 * и диспетчер не мог разложить его по оператору, объекту или сваям. Заголовок
 * теперь кнопка: клик сортирует по своей колонке, повторный — меняет
 * направление (↑/↓). Сортировка загруженных строк, как и прочие фильтры экрана.
 */
export function SortHeader({
  label, column, sortKey, sortDir, onSort, right,
}: {
  label: string;
  column: SortKey;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (k: SortKey) => void;
  right?: boolean;
}) {
  const active = column === sortKey;
  return (
    <div className={cn(right && 'flex justify-end')}>
      <button
        type="button"
        onClick={() => onSort(column)}
        aria-label={`Сортировать по: ${label}`}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground',
          active && 'text-foreground',
        )}
      >
        {label}
        <ArrowUpDown className="h-3 w-3 opacity-50" />
        {active ? <span className="text-3xs">{sortDir === 'asc' ? '↑' : '↓'}</span> : null}
      </button>
    </div>
  );
}

/** Строк данных в CSV: первая строка — шапка, пустые строки не считаем. */
export function countCsvDataRows(text: string): number {
  return text.split('\n').slice(1).filter((line) => line.trim() !== '').length;
}
