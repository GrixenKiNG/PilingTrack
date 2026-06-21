'use client';

import { useCallback, useEffect, useState } from 'react';
import { Clock, Drill, HardHat, Loader2, Pencil, Plus, RotateCcw, Ruler, Settings, Trash2, Archive, Search } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

type DictionaryKind = 'pileGrade' | 'drillingType' | 'downtimeReason';
type StatusFilter = 'active' | 'archived' | 'all';

interface RegistryItem {
  id: string;
  name: string;
  isActive: boolean;
  updatedAt: string;
  reportCount: number;
  planCount: number;
  lengthMm?: number | null; // pileGrade only
}

interface FormState { mode: 'create' | 'rename'; kind: DictionaryKind; id?: string; value: string }
interface LengthForm { id: string; name: string; value: string } // value in metres

/** "30 м" / "9.5 м" / "—" from millimetres. */
function lengthLabel(lengthMm?: number | null): string {
  if (lengthMm == null) return '—';
  const m = lengthMm / 1000;
  return `${Number.isInteger(m) ? m : m.toFixed(1)} м`;
}

const KINDS: Array<{ kind: DictionaryKind; title: string; icon: typeof HardHat; placeholder: string }> = [
  { kind: 'pileGrade', title: 'Сваи', icon: HardHat, placeholder: 'Новая марка, например С120-30' },
  { kind: 'drillingType', title: 'Бурение', icon: Drill, placeholder: 'Новый тип, например d=620 мм' },
  { kind: 'downtimeReason', title: 'Простои', icon: Clock, placeholder: 'Новая причина, например Поломка копра' },
];

function usageLabel(it: RegistryItem): { text: string; used: boolean } {
  if (it.reportCount > 0) return { text: `${it.reportCount} отч.`, used: true };
  if (it.planCount > 0) return { text: `${it.planCount} план.`, used: true };
  return { text: '—', used: false };
}

export function AdminDictionaries() {
  const [data, setData] = useState<Record<DictionaryKind, RegistryItem[]>>({ pileGrade: [], drillingType: [], downtimeReason: [] });
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: DictionaryKind; item: RegistryItem } | null>(null);
  const [lengthForm, setLengthForm] = useState<LengthForm | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/dictionary/manage?filter=${filter}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setData({ pileGrade: d.pileGrades || [], drillingType: d.drillingTypes || [], downtimeReason: d.downtimeReasons || [] });
    } catch {
      toast.error('Ошибка загрузки справочников');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void loadData(); }, [loadData]);

  const filtered = useCallback((kind: DictionaryKind) => {
    const q = search.trim().toLowerCase();
    return data[kind].filter((it) => !q || it.name.toLowerCase().includes(q));
  }, [data, search]);

  const submitForm = async () => {
    if (!form || !form.value.trim()) { toast.error('Введите название'); return; }
    setSaving(true);
    try {
      if (form.mode === 'create') {
        const res = await authFetch('/api/dictionary/manage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: form.kind, name: form.value.trim() }) });
        if (!res.ok) throw new Error();
        toast.success('Элемент добавлен');
      } else {
        const res = await authFetch('/api/dictionary/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: form.kind, id: form.id, name: form.value.trim() }) });
        if (!res.ok) throw new Error();
        toast.success('Переименовано');
      }
      setForm(null);
      await loadData();
    } catch {
      toast.error('Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  const setStatus = async (kind: DictionaryKind, item: RegistryItem, isActive: boolean) => {
    try {
      const res = await authFetch('/api/dictionary/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: kind, id: item.id, isActive }) });
      if (!res.ok) throw new Error();
      toast.success(isActive ? 'Восстановлено' : 'Архивировано');
      await loadData();
    } catch {
      toast.error('Не удалось изменить статус');
    }
  };

  const saveLength = async () => {
    if (!lengthForm) return;
    const raw = lengthForm.value.trim().replace(',', '.');
    let lengthMm: number | null;
    if (raw === '') {
      lengthMm = null; // clears the length (= unknown)
    } else {
      const metres = Number(raw);
      if (!Number.isFinite(metres) || metres < 0) { toast.error('Введите длину в метрах'); return; }
      lengthMm = Math.round(metres * 1000);
    }
    setSaving(true);
    try {
      const res = await authFetch('/api/dictionary/manage', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'pileGrade', id: lengthForm.id, lengthMm }) });
      if (!res.ok) throw new Error();
      toast.success('Длина сохранена');
      setLengthForm(null);
      await loadData();
    } catch {
      toast.error('Не удалось сохранить длину');
    } finally {
      setSaving(false);
    }
  };

  const doDelete = async () => {
    if (!confirmDelete) return;
    try {
      const res = await authFetch('/api/dictionary/manage', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: confirmDelete.kind, id: confirmDelete.item.id }) });
      if (res.status === 409) { toast.error('Элемент используется — удаление недоступно'); setConfirmDelete(null); return; }
      if (!res.ok) throw new Error();
      toast.success('Элемент удалён');
      setConfirmDelete(null);
      await loadData();
    } catch {
      toast.error('Не удалось удалить');
    }
  };

  if (loading) {
    return <div className="space-y-4 p-4 lg:p-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900"><Settings className="h-5 w-5 text-orange-500" />Справочники</h1>
        <p className="mt-1 text-sm text-slate-500">Реестр марок свай, типов бурения и причин простоя</p>
      </div>

      <Tabs defaultValue="pileGrade">
        <TabsList>
          {KINDS.map(({ kind, title, icon: Icon }) => (
            <TabsTrigger key={kind} value={kind}><Icon className="mr-1.5 h-4 w-4" />{title}</TabsTrigger>
          ))}
        </TabsList>

        <div className="my-3 flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию" className="pl-8" />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value as StatusFilter)} className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm">
            <option value="active">Активные</option>
            <option value="archived">Архив</option>
            <option value="all">Все</option>
          </select>
        </div>

        {KINDS.map(({ kind, title }) => (
          <TabsContent key={kind} value={kind}>
            <div className="mb-2 flex justify-end">
              <Button size="sm" className="bg-orange-500 text-white hover:bg-orange-600" onClick={() => setForm({ mode: 'create', kind, value: '' })}>
                <Plus className="mr-1 h-4 w-4" />Добавить
              </Button>
            </div>
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-slate-500">
                      <th className="p-2.5 font-medium">Название</th>
                      {kind === 'pileGrade' && <th className="p-2.5 font-medium">Длина</th>}
                      <th className="p-2.5 font-medium">Статус</th>
                      <th className="p-2.5 font-medium">Используется</th>
                      <th className="p-2.5 font-medium">Обновлено</th>
                      <th className="p-2.5 text-right font-medium">Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered(kind).length === 0 ? (
                      <tr><td colSpan={kind === 'pileGrade' ? 6 : 5} className="py-6 text-center text-xs text-slate-400">{title}: ничего не найдено</td></tr>
                    ) : filtered(kind).map((item) => {
                      const usage = usageLabel(item);
                      return (
                        <tr key={item.id} className="border-b last:border-0 hover:bg-slate-50">
                          <td className={`p-2.5 font-medium ${item.isActive ? 'text-slate-800' : 'text-slate-400'}`}>{item.name}</td>
                          {kind === 'pileGrade' && (
                            <td className={`p-2.5 ${item.lengthMm == null ? 'text-amber-600' : 'text-slate-600'}`}>{lengthLabel(item.lengthMm)}</td>
                          )}
                          <td className="p-2.5">
                            <Badge variant={item.isActive ? 'default' : 'secondary'} className="text-3xs">{item.isActive ? 'Активен' : 'Архив'}</Badge>
                          </td>
                          <td className={`p-2.5 ${usage.used ? 'text-blue-600' : 'text-slate-300'}`}>{usage.text}</td>
                          <td className="p-2.5 text-slate-500">{new Date(item.updatedAt).toLocaleDateString('ru-RU')}</td>
                          <td className="p-2.5">
                            <div className="flex justify-end gap-1">
                              <button onClick={() => setForm({ mode: 'rename', kind, id: item.id, value: item.name })} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Переименовать"><Pencil className="h-3.5 w-3.5" /></button>
                              {kind === 'pileGrade' && (
                                <button onClick={() => setLengthForm({ id: item.id, name: item.name, value: item.lengthMm == null ? '' : String(item.lengthMm / 1000) })} className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600" title="Длина сваи"><Ruler className="h-3.5 w-3.5" /></button>
                              )}
                              {item.isActive ? (
                                <button onClick={() => setStatus(kind, item, false)} className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100" title="Архивировать"><Archive className="h-3.5 w-3.5" />Архив</button>
                              ) : (
                                <button onClick={() => setStatus(kind, item, true)} className="flex h-7 items-center gap-1 rounded-lg px-2 text-xs text-slate-500 hover:bg-slate-100" title="Восстановить"><RotateCcw className="h-3.5 w-3.5" />Вернуть</button>
                              )}
                              <button
                                onClick={() => setConfirmDelete({ kind, item })}
                                disabled={usage.used}
                                title={usage.used ? `Используется (${usage.text}) — удаление недоступно` : 'Удалить навсегда'}
                                className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 enabled:hover:bg-red-100 enabled:hover:text-red-500 disabled:opacity-40"
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
          </TabsContent>
        ))}
      </Tabs>

      <Dialog open={form !== null} onOpenChange={(open) => !open && setForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form?.mode === 'create' ? 'Добавить элемент' : 'Переименовать'}</DialogTitle></DialogHeader>
          <Input value={form?.value || ''} onChange={(e) => setForm((f) => f && { ...f, value: e.target.value })} placeholder={KINDS.find((k) => k.kind === form?.kind)?.placeholder} autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void submitForm(); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setForm(null)}>Отмена</Button>
            <Button onClick={submitForm} disabled={saving || !form?.value.trim()} className="bg-orange-500 text-white hover:bg-orange-600">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={lengthForm !== null} onOpenChange={(open) => !open && setLengthForm(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Длина сваи — {lengthForm?.name}</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-500">Длина одной сваи этой марки в метрах. Используется для расчёта м.п. на дашборде, в отчётах и PDF. Пусто — длина не задана (считается как 0).</p>
          <Input value={lengthForm?.value ?? ''} onChange={(e) => setLengthForm((f) => f && { ...f, value: e.target.value })} placeholder="например 30" inputMode="decimal" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') void saveLength(); }} />
          <DialogFooter>
            <Button variant="outline" onClick={() => setLengthForm(null)}>Отмена</Button>
            <Button onClick={saveLength} disabled={saving} className="bg-orange-500 text-white hover:bg-orange-600">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Удалить навсегда?</DialogTitle></DialogHeader>
          <p className="text-sm text-slate-600">Элемент «{confirmDelete?.item.name}» будет удалён без возможности восстановления.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Отмена</Button>
            <Button onClick={doDelete} className="bg-red-500 text-white hover:bg-red-600">Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
