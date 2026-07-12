import { Archive, CalendarDays, FileText, MoreHorizontal, Pencil, RotateCcw, Ruler, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

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
  siteCount: number;
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
  onSelect: (item: RegistryItem) => void;
  selectedId?: string;
}

function lengthLabel(lengthMm?: number | null): string {
  if (lengthMm == null) return 'Не задана';
  return (lengthMm / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DictionaryTable({
  kind, title, items, onRename, onLength, onStatus, onDelete, onSelect, selectedId,
}: DictionaryTableProps) {
  const isPileGrade = kind === 'pileGrade';
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const checkedAll = items.length > 0 && items.every((item) => checkedIds.includes(item.id));

  const toggleItem = (id: string, checked: boolean) => {
    setCheckedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

  const toggleAll = (checked: boolean) => {
    setCheckedIds(checked ? items.map((item) => item.id) : []);
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-base font-semibold text-slate-900">{title} — активные</h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{items.filter((item) => item.isActive).length}</span>
      </div>
    <Card className="overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-auto text-sm">
          <thead className="bg-slate-50">
            <tr className="border-b text-left text-xs text-slate-500">
              <th className="w-10 px-3 py-2.5"><Checkbox aria-label="Выбрать все" checked={checkedAll} onCheckedChange={(checked) => toggleAll(checked === true)} /></th>
              <th className="px-3 py-2 font-medium">Название</th>
              {isPileGrade && <th className="px-3 py-2 font-medium">Код / сечение</th>}
              {isPileGrade && <th className="px-3 py-2 font-medium">Длина, м</th>}
              <th className="px-3 py-2 text-center font-medium">Отчёты</th>
              <th className="px-3 py-2 text-center font-medium">Планы</th>
              <th className="px-3 py-2 font-medium">Статус</th>
              <th className="px-3 py-2 font-medium">Обновлено ↓</th>
              <th className="px-3 py-2 text-right font-medium">Действия</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={isPileGrade ? 9 : 7} className="px-3 py-8 text-center text-xs text-slate-400">
                  {title}: ничего не найдено
                </td>
              </tr>
            ) : [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((item) => {
              const used = item.reportCount > 0 || item.planCount > 0;
              return (
                <tr key={item.id} onClick={() => onSelect(item)} className={`cursor-pointer border-b last:border-0 hover:bg-sky-50/70 ${selectedId === item.id ? 'bg-sky-50/70 ring-1 ring-inset ring-sky-400' : ''}`}>
                  <td className="px-3 py-2"><Checkbox aria-label={`Выбрать ${item.name}`} checked={checkedIds.includes(item.id)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => toggleItem(item.id, checked === true)} /></td>
                  <td className={`px-3 py-2 font-medium ${item.isActive ? 'text-slate-800' : 'text-slate-400'}`}>
                    {item.name}
                  </td>
                  {isPileGrade && (
                    <td className="px-3 py-2 text-xs text-slate-600">
                      {item.sectionOrDiameter || item.code || '—'}
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
                    <Badge variant={item.isActive ? 'default' : 'secondary'} className={item.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : 'text-3xs'}>
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
    {items.length === 0 && <div className="mt-5 rounded-lg border border-dashed border-slate-300 p-5 text-sm text-slate-500"><p className="font-medium text-slate-700">Ничего не найдено</p><p className="mt-1 text-xs">Попробуйте изменить параметры поиска или фильтра.</p></div>}
    </div>
  );
}
