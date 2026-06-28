'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Clock, Drill, HardHat, Plus, Search, Settings } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DictionaryTable,
  type DictionaryKind,
  type RegistryItem,
} from './admin-dictionaries/dictionary-table';
import {
  DictionaryForm,
  type DictionaryFormValue,
} from './admin-dictionaries/dictionary-form';

type StatusFilter = 'active' | 'archived' | 'all';
interface FormState { mode: 'create' | 'rename'; kind: DictionaryKind; item?: RegistryItem }
interface LengthState { item: RegistryItem; value: string }

const KINDS: Array<{ kind: DictionaryKind; title: string; addLabel: string; icon: typeof HardHat }> = [
  { kind: 'pileGrade', title: 'Сваи', addLabel: 'Добавить марку сваи', icon: HardHat },
  { kind: 'drillingType', title: 'Бурение', addLabel: 'Добавить тип бурения', icon: Drill },
  { kind: 'downtimeReason', title: 'Простои', addLabel: 'Добавить причину простоя', icon: Clock },
];

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}

export function AdminDictionaries() {
  const [data, setData] = useState<Record<DictionaryKind, RegistryItem[]>>({
    pileGrade: [], drillingType: [], downtimeReason: [],
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [lengthState, setLengthState] = useState<LengthState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: DictionaryKind; item: RegistryItem } | null>(null);
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const response = await authFetch(`/api/dictionary/manage?filter=${filter}`);
      if (!response.ok) throw new Error('load');
      const payload = await response.json();
      setData({
        pileGrade: payload.pileGrades || [],
        drillingType: payload.drillingTypes || [],
        downtimeReason: payload.downtimeReasons || [],
      });
    } catch {
      setLoadError(true);
      toast.error('Ошибка загрузки справочников');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async registry load on mount/filter change
  useEffect(() => { void loadData(); }, [loadData]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru');
    return Object.fromEntries(KINDS.map(({ kind }) => [
      kind,
      data[kind].filter((item) => !query || [item.name, item.code, item.sectionOrDiameter]
        .some((value) => value?.toLocaleLowerCase('ru').includes(query))),
    ])) as Record<DictionaryKind, RegistryItem[]>;
  }, [data, search]);

  const submitForm = async (value: DictionaryFormValue) => {
    if (!form) return;
    setSaving(true);
    try {
      const isCreate = form.mode === 'create';
      const response = await authFetch('/api/dictionary/manage', {
        method: isCreate ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isCreate
          ? { type: form.kind, ...value }
          : { type: form.kind, id: form.item?.id, name: value.name }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Не удалось сохранить'));
      toast.success(isCreate ? 'Элемент добавлен' : 'Переименовано');
      setForm(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (kind: DictionaryKind, item: RegistryItem, isActive: boolean) => {
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, id: item.id, isActive }),
      });
      if (!response.ok) {
        toast.error(await responseError(response, 'Не удалось изменить статус'));
        return;
      }
      toast.success(isActive ? 'Восстановлено' : 'Архивировано');
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось изменить статус');
    }
  };

  const saveLength = async () => {
    if (!lengthState) return;
    const metres = Number(lengthState.value.replace(',', '.'));
    if (!Number.isFinite(metres) || metres <= 0) {
      toast.error('Введите положительную длину в метрах');
      return;
    }
    setSaving(true);
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pileGrade', id: lengthState.item.id, lengthMm: Math.round(metres * 1000) }),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Не удалось сохранить длину'));
      toast.success('Длина сохранена');
      setLengthState(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить длину');
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = async () => {
    if (!confirmDelete) return;
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: confirmDelete.kind, id: confirmDelete.item.id }),
      });
      if (!response.ok) {
        toast.error(await responseError(response, 'Не удалось удалить'));
        return;
      }
      toast.success('Элемент удалён');
      setConfirmDelete(null);
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить');
    }
  };

  if (loading) {
    return <div className="space-y-4 p-4 lg:p-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-72 w-full" /></div>;
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <header>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Settings className="h-5 w-5 text-orange-500" />Справочники
        </h1>
        <p className="mt-1 text-sm text-slate-500">Рабочие значения вашей организации для отчётов и планирования</p>
      </header>

      {loadError ? (
        <Alert variant="destructive">
          <AlertCircle />
          <AlertTitle>Не удалось загрузить справочники</AlertTitle>
          <AlertDescription>
            <Button size="sm" variant="outline" onClick={() => void loadData()}>Повторить</Button>
          </AlertDescription>
        </Alert>
      ) : (
        <Tabs defaultValue="pileGrade">
          <div className="flex flex-col gap-3 border-b pb-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList>
              {KINDS.map(({ kind, title, icon: Icon }) => (
                <TabsTrigger key={kind} value={kind}><Icon className="mr-1.5 h-4 w-4" />{title}</TabsTrigger>
              ))}
            </TabsList>
            <div className="flex min-w-0 flex-1 items-center gap-2 lg:max-w-xl">
              <div className="relative min-w-0 flex-1">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Название, код или сечение" className="pl-8" />
              </div>
              <select aria-label="Статус" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm">
                <option value="active">Активные</option>
                <option value="archived">Архив</option>
                <option value="all">Все</option>
              </select>
            </div>
          </div>

          {KINDS.map(({ kind, title, addLabel }) => (
            <TabsContent key={kind} value={kind} className="mt-3">
              <div className="mb-2 flex justify-end">
                <Button size="sm" aria-label={addLabel} className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => setForm({ mode: 'create', kind })}>
                  <Plus className="h-4 w-4" />Добавить
                </Button>
              </div>
              <DictionaryTable
                kind={kind}
                title={title}
                items={filtered[kind]}
                onRename={(item) => setForm({ mode: 'rename', kind, item })}
                onLength={(item) => setLengthState({ item, value: item.lengthMm == null ? '' : String(item.lengthMm / 1000) })}
                onStatus={(item, isActive) => void setStatus(kind, item, isActive)}
                onDelete={(item) => setConfirmDelete({ kind, item })}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}

      {form && (
        <DictionaryForm
          key={`${form.mode}-${form.kind}-${form.item?.id || 'new'}`}
          mode={form.mode}
          kind={form.kind}
          item={form.item}
          saving={saving}
          onClose={() => setForm(null)}
          onSubmit={(value) => void submitForm(value)}
        />
      )}

      <Dialog open={lengthState !== null} onOpenChange={(open) => !open && setLengthState(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Длина сваи — {lengthState?.item.name}</DialogTitle></DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium text-slate-700">
            Длина, м
            <Input aria-label="Длина сваи, м" value={lengthState?.value || ''} onChange={(event) => setLengthState((state) => state && ({ ...state, value: event.target.value }))} inputMode="decimal" />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLengthState(null)}>Отмена</Button>
            <Button onClick={() => void saveLength()} disabled={saving} className="bg-orange-500 text-white hover:bg-orange-600">Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Удалить навсегда?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Элемент «{confirmDelete?.item.name}» будет удалён без возможности восстановления.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Отмена</Button>
            <Button onClick={() => void deleteItem()} className="bg-red-600 text-white hover:bg-red-700">Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
