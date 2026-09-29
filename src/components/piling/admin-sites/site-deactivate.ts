import { pluralizeRu } from '@/lib/format';
import type { SiteOverviewRow } from './use-sites-overview';

/** Что изменится для людей, если объект деактивировать: сколько бригад и машин на нём сейчас. */
export function deactivateDescription(row: Pick<SiteOverviewRow, 'crewCount' | 'rigNames'>): string {
  const base = 'Объект пропадёт из выбора при назначении бригад. Отчёты и история сохранятся, объект можно активировать обратно.';
  if (row.crewCount == null) return `${base} Бригады объекта не загрузились — проверьте их перед деактивацией.`;
  if (row.crewCount === 0) return `${base} Бригад на объекте нет.`;
  const crews = `${row.crewCount} ${pluralizeRu(row.crewCount, ['бригада', 'бригады', 'бригад'])}`;
  const rigs = row.rigNames.length ? ` (установки: ${row.rigNames.join(', ')})` : '';
  return `${base} Сейчас на объекте ${crews}${rigs}.`;
}
