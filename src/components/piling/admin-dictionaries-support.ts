import { useEffect, useState } from 'react';
import { Clock, Drill, HardHat, Ruler } from '@/components/piling/icons/unified-icons';
import { type DictionaryKind, type RegistryItem } from './admin-dictionaries/dictionary-table';
import { type PilingIconName } from '@/components/piling/icons';

export type StatusFilter = 'active' | 'archived' | 'all';
export interface HistoryEntry {
  id: string;
  title: string;
  at: string;
  meta: string | null;
  changes?: Array<{ label: string; before: string; after: string }>;
}
export interface FormState { mode: 'create' | 'rename'; kind: DictionaryKind; item?: RegistryItem }
export interface LengthState { item: RegistryItem; value: string }
/** Откуда пришло изменение длины, чтобы после подтверждения довести именно его. */
export interface LengthConfirmState { item: RegistryItem; lengthMm: number; source: 'dialog' | 'panel' }

/*
  Длина марки у свай одна и истории не имеет — так решено сознательно.

  Погонные метры нигде не хранятся: отчёт держит только марку и количество свай,
  а метры считаются от текущей длины марки каждый раз, когда открывают отчёт,
  аналитику, сводку за период или печатают PDF. Значит правка длины у уже
  используемой марки — это не правка справочника, а пересчёт сданных документов
  за прошлые периоды.

  Версионировать длину не стали: у марки она одна (решение владельца 12.09.2026).
  Поэтому единственная защита — показать, что именно изменится, и спросить.
*/
export const lengthChangesHistory = (item: RegistryItem, lengthMm: number) =>
  (item.reportCount > 0 || item.planCount > 0) && item.lengthMm !== lengthMm;

export function useCompactInspector() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 1023px)');
    const update = () => setCompact(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return compact;
}

// `icon` — компактная линейная иконка для вкладок; `pilingIcon` — предметная
// иконка для плиток сводки (тот же набор и тот же вид, что в дашборде).
export const KINDS: Array<{ kind: DictionaryKind; title: string; summaryTitle: string; addLabel: string; icon: typeof HardHat; pilingIcon: PilingIconName }> = [
  { kind: 'pileGrade', title: 'Сваи', summaryTitle: 'Сортаменты свай', addLabel: 'Добавить марку сваи', icon: Ruler, pilingIcon: 'pile-group' },
  { kind: 'drillingType', title: 'Бурение', summaryTitle: 'Типы бурения', addLabel: 'Добавить тип бурения', icon: Drill, pilingIcon: 'drilling-auger' },
  { kind: 'downtimeReason', title: 'Простои', summaryTitle: 'Причины простоев', addLabel: 'Добавить причину простоя', icon: Clock, pilingIcon: 'downtime' },
];
