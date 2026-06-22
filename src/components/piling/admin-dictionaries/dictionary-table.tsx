import { Archive, Pencil, RotateCcw, Ruler, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';

export type DictionaryKind = 'pileGrade' | 'drillingType' | 'downtimeReason';

export interface RegistryItem {
  id: string;
  name: string;
  code?: string;
  sectionOrDiameter?: string | null;
  notes?: string;
  isActive: boolean;
  updatedAt: string;
  reportCount: number;
  planCount: number;
  lengthMm?: number | null;
}

interface DictionaryTableProps {
  kind: DictionaryKind;
  title: string;
  items: RegistryItem[];
  onRename: (item: RegistryItem) => void;
  onLength: (item: RegistryItem) => void;
  onStatus: (item: RegistryItem, isActive: boolean) => void;
  onDelete: (item: RegistryItem) => void;
}

function lengthLabel(lengthMm?: number | null): string {
  if (lengthMm == null) return 'Не задана';
  const metres = lengthMm / 1000;
  return `${Number.isInteger(metres) ? metres : metres.toFixed(1)} м`;
}

export function DictionaryTable({
  kind, title, items, onRename, onLength, onStatus, onDelete,
}: DictionaryTableProps) {
  const isPileGrade = kind === 'pileGrade';

  return (
    <Card className="overflow-hidden rounded-md">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-auto text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="px-3 py-2 font-medium">Название</th>
              {isPileGrade && <th className="px-3 py-2 font-medium">Код / сечение</th>}
              {isPileGrade && <th className="px-3 py-2 font-medium">Длина</th>}
              <th className="px-3 py-2 text-center font-medium">Отчёты</th>
              <th className="px-3 py-2 text-center font-medium">Планы</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Обновлено</th>
              <th className="px-3 py-2 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={isPileGrade ? 8 : 6} className="px-3 py-8 text-center text-xs text-slate-400">
                  {title}: ничего не найдено
                </td>
              </tr>
            ) : items.map((item) => {
              const used = item.reportCount > 0 || item.planCount > 0;
              return (
                <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50/70">
                  <td className={`px-3 py-2 font-medium ${item.isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                    {item.name}
                  </td>
                  {isPileGrade && (
                    <td className="px-3 py-2 text-xs text-slate-600">
                      <div>{item.code || '—'}</div>
                      <div className="text-slate-400">{item.sectionOrDiameter || '—'}</div>
                    </td>
                  )}
                  {isPileGrade && (
                    <td className={`px-3 py-2 ${item.lengthMm == null ? 'font-medium text-amber-600' : 'text-slate-600'}`}>
                      {lengthLabel(item.lengthMm)}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-center tabular-nums ${item.reportCount ? 'font-medium text-blue-600' : 'text-slate-300'}`}>
                    {item.reportCount}
                  </td>
                  <td className={`px-3 py-2 text-center tabular-nums ${item.planCount ? 'font-medium text-emerald-600' : 'text-slate-300'}`}>
                    {item.planCount}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={item.isActive ? 'default' : 'secondary'} className="text-3xs">
                      {item.isActive ? 'Активен' : 'Архив'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {new Date(item.updatedAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        aria-label={`Переименовать ${item.name}`}
                        title={used ? 'Используемое значение нельзя переименовать' : 'Переименовать'}
                        disabled={used}
                        onClick={() => onRename(item)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 enabled:hover:bg-slate-100 enabled:hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-35"
                      ><Pencil className="h-3.5 w-3.5" /></button>
                      {isPileGrade && (
                        <button
                          type="button"
                          aria-label={`Изменить длину ${item.name}`}
                          title="Изменить длину"
                          onClick={() => onLength(item)}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                        ><Ruler className="h-3.5 w-3.5" /></button>
                      )}
                      <button
                        type="button"
                        aria-label={`${item.isActive ? 'Архивировать' : 'Восстановить'} ${item.name}`}
                        title={item.isActive ? 'Архивировать' : 'Восстановить'}
                        onClick={() => onStatus(item, !item.isActive)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      >{item.isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}</button>
                      <button
                        type="button"
                        aria-label={`Удалить ${item.name}`}
                        title={used ? 'Используемое значение можно только архивировать' : 'Удалить навсегда'}
                        disabled={used}
                        onClick={() => onDelete(item)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 enabled:hover:bg-red-50 enabled:hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-35"
                      ><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
