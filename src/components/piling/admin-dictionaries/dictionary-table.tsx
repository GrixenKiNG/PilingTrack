import { Archive, Pencil, RotateCcw, Ruler, Trash2 } from '@/components/piling/icons/unified-icons';
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
  statusLabel: string;
  items: RegistryItem[];
  onRename: (item: RegistryItem) => void;
  onLength: (item: RegistryItem) => void;
  onStatus: (item: RegistryItem, isActive: boolean) => void;
  onDelete: (item: RegistryItem) => void;
  onSelect: (item: RegistryItem) => void;
  selectedId?: string;
  compact?: boolean;
}

function lengthLabel(lengthMm?: number | null): string {
  if (lengthMm == null) return 'Не задана';
  return (lengthMm / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function DictionaryTable({
  kind, title, statusLabel, items, onRename, onLength, onStatus, onDelete, onSelect, selectedId, compact = false,
}: DictionaryTableProps) {
  const isPileGrade = kind === 'pileGrade';
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const checkedAll = items.length > 0 && items.every((item) => checkedIds.includes(item.id));
  // Selection may reference rows hidden by a newer filter/search — act only on visible ones.
  const checkedItems = items.filter((item) => checkedIds.includes(item.id));
  const sortedItems = [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const toggleItem = (id: string, checked: boolean) => {
    setCheckedIds((current) => checked ? [...new Set([...current, id])] : current.filter((value) => value !== id));
  };

  const toggleAll = (checked: boolean) => {
    setCheckedIds(checked ? items.map((item) => item.id) : []);
  };

  const bulkStatus = (isActive: boolean) => {
    for (const item of checkedItems.filter((it) => it.isActive !== isActive)) onStatus(item, isActive);
    setCheckedIds([]);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">{title} — {statusLabel}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{items.length}</span>
        {checkedItems.length > 0 && (
          <div className="flex w-full flex-wrap items-center gap-2 text-xs sm:ml-auto sm:w-auto">
            <span className="text-muted-foreground">Выбрано: {checkedItems.length}</span>
            {checkedItems.some((item) => item.isActive) && (
              <button type="button" onClick={() => bulkStatus(false)} className="min-h-11 rounded-md border border-signal/30 px-3 font-medium text-signal-strong hover:bg-signal/10 sm:min-h-9">Архивировать</button>
            )}
            {checkedItems.some((item) => !item.isActive) && (
              <button type="button" onClick={() => bulkStatus(true)} className="min-h-11 rounded-md border border-border px-3 font-medium text-foreground hover:bg-muted sm:min-h-9">Восстановить</button>
            )}
          </div>
        )}
      </div>
    {compact && <div className="space-y-3">
      {sortedItems.map((item) => {
        const used = item.reportCount > 0 || item.planCount > 0;
        return (
          <article
            key={item.id}
            className={`overflow-hidden rounded-xl border bg-card ${selectedId === item.id ? 'border-info/30 ring-1 ring-info/30' : 'border-border'}`}
          >
            <div className="flex items-start gap-2 p-3">
              <label className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg">
                <Checkbox
                  aria-label={`Выбрать ${item.name}`}
                  checked={checkedIds.includes(item.id)}
                  onCheckedChange={(checked) => toggleItem(item.id, checked === true)}
                />
              </label>
              <button type="button" onClick={() => onSelect(item)} className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30 focus-visible:ring-offset-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className={`truncate text-base font-semibold ${item.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>{item.name}</p>
                    {isPileGrade && (
                      <p className="mt-1 text-sm text-muted-foreground">
                        {item.sectionOrDiameter || item.code || 'Сечение не указано'}
                        {' · '}
                        {item.lengthMm == null ? 'Длина не задана' : `${lengthLabel(item.lengthMm)} м`}
                      </p>
                    )}
                    {!isPileGrade && item.code && <p className="mt-1 text-sm text-muted-foreground">{item.code}</p>}
                  </div>
                  <Badge variant={item.isActive ? 'default' : 'secondary'} className={item.isActive ? 'shrink-0 bg-success/10 text-success-strong hover:bg-success/10' : 'shrink-0'}>
                    {item.isActive ? 'Активен' : 'Архив'}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                  <div><dt className="text-muted-foreground">Отчёты</dt><dd className="mt-0.5 font-semibold tabular-nums text-foreground">{item.reportCount}</dd></div>
                  <div><dt className="text-muted-foreground">Планы</dt><dd className="mt-0.5 font-semibold tabular-nums text-foreground">{item.planCount}</dd></div>
                  <div><dt className="text-muted-foreground">Обновлено</dt><dd className="mt-0.5 font-medium text-foreground">{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</dd></div>
                </dl>
                <span className="mt-3 inline-flex text-sm font-medium text-info-strong">Открыть сведения</span>
              </button>
            </div>
            <div className="grid grid-cols-4 border-t border-border bg-muted/70 p-1">
              <button
                type="button"
                aria-label={`Переименовать ${item.name}`}
                title={used ? 'Используемое значение нельзя переименовать' : 'Переименовать'}
                disabled={used}
                onClick={() => onRename(item)}
                className="flex min-h-11 items-center justify-center rounded-lg text-muted-foreground enabled:hover:bg-card enabled:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30 disabled:cursor-not-allowed disabled:opacity-35"
              ><Pencil className="h-4 w-4" /></button>
              {isPileGrade ? (
                <button
                  type="button"
                  aria-label={`Изменить длину ${item.name}`}
                  title="Изменить длину"
                  onClick={() => onLength(item)}
                  className="flex min-h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
                ><Ruler className="h-4 w-4" /></button>
              ) : <span aria-hidden />}
              <button
                type="button"
                aria-label={`${item.isActive ? 'Архивировать' : 'Восстановить'} ${item.name}`}
                title={item.isActive ? 'Архивировать' : 'Восстановить'}
                onClick={() => onStatus(item, !item.isActive)}
                className="flex min-h-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30"
              >{item.isActive ? <Archive className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}</button>
              <button
                type="button"
                aria-label={`Удалить ${item.name}`}
                title={used ? 'Используемое значение можно только архивировать' : 'Удалить навсегда'}
                disabled={used}
                onClick={() => onDelete(item)}
                className="flex min-h-11 items-center justify-center rounded-lg text-destructive-strong enabled:hover:bg-destructive/10 enabled:hover:text-destructive-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive/30 disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-35"
              ><Trash2 className="h-4 w-4" /></button>
            </div>
          </article>
        );
      })}
    </div>}
    {!compact && <Card className="overflow-hidden rounded-lg">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] table-auto text-sm">
          <thead className="bg-muted">
            <tr className="border-b text-left text-xs text-muted-foreground">
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
                <td colSpan={isPileGrade ? 9 : 7} className="px-3 py-8 text-center text-xs text-muted-foreground">
                  {title}: ничего не найдено
                </td>
              </tr>
            ) : sortedItems.map((item) => {
              const used = item.reportCount > 0 || item.planCount > 0;
              return (
                <tr key={item.id} onClick={() => onSelect(item)} className={`cursor-pointer border-b last:border-0 hover:bg-info/10/70 ${selectedId === item.id ? 'bg-info/10/70 ring-1 ring-inset ring-info/30' : ''}`}>
                  <td className="px-3 py-2"><Checkbox aria-label={`Выбрать ${item.name}`} checked={checkedIds.includes(item.id)} onClick={(event) => event.stopPropagation()} onCheckedChange={(checked) => toggleItem(item.id, checked === true)} /></td>
                  <td className={`px-3 py-2 font-medium ${item.isActive ? 'text-foreground' : 'text-muted-foreground'}`}>
                    {item.name}
                  </td>
                  {isPileGrade && (
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {item.sectionOrDiameter || item.code || '—'}
                    </td>
                  )}
                  {isPileGrade && (
                    <td className={`px-3 py-2 ${item.lengthMm == null ? 'font-medium text-warning-strong' : 'text-muted-foreground'}`}>
                      {lengthLabel(item.lengthMm)}
                    </td>
                  )}
                  <td className={`px-3 py-2 text-center tabular-nums ${item.reportCount ? 'font-medium text-info-strong' : 'text-muted-foreground'}`}>
                    {item.reportCount}
                  </td>
                  <td className={`px-3 py-2 text-center tabular-nums ${item.planCount ? 'font-medium text-success-strong' : 'text-muted-foreground'}`}>
                    {item.planCount}
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={item.isActive ? 'default' : 'secondary'} className={item.isActive ? 'bg-success/10 text-success-strong hover:bg-success/10' : 'text-3xs'}>
                      {item.isActive ? 'Активен' : 'Архив'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {new Date(item.updatedAt).toLocaleDateString('ru-RU')}
                  </td>
                  <td className="px-3 py-2">
                    <div className="row-actions">
                      <button
                        type="button"
                        aria-label={`Переименовать ${item.name}`}
                        title={used ? 'Используемое значение нельзя переименовать' : 'Переименовать'}
                        disabled={used}
                        onClick={(event) => { event.stopPropagation(); onRename(item); }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-muted enabled:hover:text-foreground disabled:cursor-not-allowed disabled:opacity-35"
                      ><Pencil className="h-3.5 w-3.5" /></button>
                      {isPileGrade && (
                        <button
                          type="button"
                          aria-label={`Изменить длину ${item.name}`}
                          title="Изменить длину"
                          onClick={(event) => { event.stopPropagation(); onLength(item); }}
                          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                        ><Ruler className="h-3.5 w-3.5" /></button>
                      )}
                      <button
                        type="button"
                        aria-label={`${item.isActive ? 'Архивировать' : 'Восстановить'} ${item.name}`}
                        title={item.isActive ? 'Архивировать' : 'Восстановить'}
                        onClick={(event) => { event.stopPropagation(); onStatus(item, !item.isActive); }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                      >{item.isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}</button>
                      <button
                        type="button"
                        aria-label={`Удалить ${item.name}`}
                        title={used ? 'Используемое значение можно только архивировать' : 'Удалить навсегда'}
                        disabled={used}
                        onClick={(event) => { event.stopPropagation(); onDelete(item); }}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground enabled:hover:bg-destructive/10 enabled:hover:text-destructive-strong disabled:cursor-not-allowed disabled:opacity-35"
                      ><Trash2 className="h-3.5 w-3.5" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>}
    {items.length === 0 && <div className="mt-5 rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground"><p className="font-medium text-foreground">Ничего не найдено</p><p className="mt-1 text-xs">Попробуйте изменить параметры поиска или фильтра.</p></div>}
    </div>
  );
}
