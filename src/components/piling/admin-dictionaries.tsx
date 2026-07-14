'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, AlertTriangle, Archive, Clock, Drill, Filter, HardHat, Plus, Ruler, Save, Search, X } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
interface HistoryEntry {
  id: string;
  title: string;
  at: string;
  meta: string | null;
  changes?: Array<{ label: string; before: string; after: string }>;
}
interface FormState { mode: 'create' | 'rename'; kind: DictionaryKind; item?: RegistryItem }
interface LengthState { item: RegistryItem; value: string }

const KINDS: Array<{ kind: DictionaryKind; title: string; summaryTitle: string; addLabel: string; icon: typeof HardHat }> = [
  { kind: 'pileGrade', title: 'Сваи', summaryTitle: 'Сортаменты свай', addLabel: 'Добавить марку сваи', icon: Ruler },
  { kind: 'drillingType', title: 'Бурение', summaryTitle: 'Типы бурения', addLabel: 'Добавить тип бурения', icon: Drill },
  { kind: 'downtimeReason', title: 'Простои', summaryTitle: 'Причины простоев', addLabel: 'Добавить причину простоя', icon: Clock },
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
  const [objectTotals, setObjectTotals] = useState<Record<DictionaryKind, number>>({
    pileGrade: 0, drillingType: 0, downtimeReason: 0,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [filter, setFilter] = useState<StatusFilter>('active');
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<FormState | null>(null);
  const [lengthState, setLengthState] = useState<LengthState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: DictionaryKind; item: RegistryItem } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [panelDraft, setPanelDraft] = useState<{ name: string; section: string; length: string } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'general' | 'history'>('general');
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [activeKind, setActiveKind] = useState<DictionaryKind>('pileGrade');
  const [panelWidth, setPanelWidth] = useState(380);

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      // Always fetch everything: summary cards must show real archived counts
      // regardless of the table's status filter (which is applied client-side).
      const response = await authFetch('/api/dictionary/manage?filter=all');
      if (!response.ok) throw new Error('load');
      const payload = await response.json();
      setData({
        pileGrade: payload.pileGrades || [],
        drillingType: payload.drillingTypes || [],
        downtimeReason: payload.downtimeReasons || [],
      });
      setObjectTotals({
        pileGrade: payload.objectTotals?.pileGrade ?? 0,
        drillingType: payload.objectTotals?.drillingType ?? 0,
        downtimeReason: payload.objectTotals?.downtimeReason ?? 0,
      });
    } catch {
      setLoadError(true);
      toast.error('Ошибка загрузки справочников');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- async registry load on mount/filter change
  useEffect(() => { void loadData(); }, [loadData]);

  // Real change history from the audit log, loaded when the tab is opened.
  const selectedId = selectedItem?.id;
  useEffect(() => {
    if (inspectorTab !== 'history' || !selectedId) return;
    let active = true;
    void (async () => {
      try {
        const response = await authFetch(`/api/audit?scope=dictionaries&targetId=${encodeURIComponent(selectedId)}&limit=20`);
        if (!response.ok) throw new Error('audit');
        const payload = await response.json() as { entries?: HistoryEntry[] };
         
        if (active) setHistory(payload.entries ?? []);
      } catch {
        if (active) setHistory([]);
      }
    })();
    return () => { active = false; };
  }, [inspectorTab, selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru');
    return Object.fromEntries(KINDS.map(({ kind }) => [
      kind,
      data[kind]
        .filter((item) => filter === 'all' || (filter === 'active' ? item.isActive : !item.isActive))
        .filter((item) => !query || [item.name, item.code, item.sectionOrDiameter]
          .some((value) => value?.toLocaleLowerCase('ru').includes(query))),
    ])) as Record<DictionaryKind, RegistryItem[]>;
  }, [data, search, filter]);

  const statusLabel = filter === 'active' ? 'активные' : filter === 'archived' ? 'архив' : 'все';

  const dictionarySummary = useMemo(() => KINDS.map(({ kind, summaryTitle, icon: Icon }) => ({
    kind, summaryTitle, Icon,
    active: data[kind].filter((item) => item.isActive).length,
    archived: data[kind].filter((item) => !item.isActive).length,
    objects: objectTotals[kind],
  })), [data, objectTotals]);

  const selectedKind = useMemo<DictionaryKind>(() => {
    if (!selectedItem) return 'pileGrade';
    return KINDS.find(({ kind }) => data[kind].some((item) => item.id === selectedItem.id))?.kind || 'pileGrade';
  }, [data, selectedItem]);

  const activeDictionary = KINDS.find(({ kind }) => kind === activeKind) || KINDS[0];
  const selectedUsed = !!selectedItem && (selectedItem.reportCount > 0 || selectedItem.planCount > 0);

  const formatMetres = (lengthMm: number | null | undefined) =>
    lengthMm != null ? (lengthMm / 1000).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '';

  // Selecting a row seeds the inline-edit draft for the inspector.
  const selectItem = (item: RegistryItem | null) => {
    setSelectedItem(item);
    setPanelDraft(item ? { name: item.name, section: item.sectionOrDiameter || '', length: formatMetres(item.lengthMm) } : null);
    setInspectorTab('general');
    setHistory(null);
  };

  const panelDirty = !!(selectedItem && panelDraft && (
    panelDraft.name.trim() !== selectedItem.name ||
    (selectedKind === 'pileGrade' && (
      panelDraft.section.trim() !== (selectedItem.sectionOrDiameter || '') ||
      panelDraft.length.trim() !== formatMetres(selectedItem.lengthMm)
    ))
  ));

  const savePanel = async () => {
    if (!selectedItem || !panelDraft) return;
    const payload: Record<string, unknown> = { type: selectedKind, id: selectedItem.id };
    const nextName = panelDraft.name.trim();
    if (nextName && nextName !== selectedItem.name) {
      if (selectedUsed) { toast.error('Используемое значение нельзя переименовать'); return; }
      payload.name = nextName;
    }
    if (selectedKind === 'pileGrade') {
      const section = panelDraft.section.trim();
      if (section !== (selectedItem.sectionOrDiameter || '')) payload.sectionOrDiameter = section || null;
      const lengthRaw = panelDraft.length.trim();
      if (!lengthRaw && selectedItem.lengthMm != null) {
        // Length is the single source for м.п. — clearing it would silently
        // zero the meters KPI, so refuse explicitly instead of ignoring.
        toast.error('Длина обязательна для марки сваи');
        return;
      }
      if (lengthRaw) {
        const metres = Number(lengthRaw.replace(',', '.'));
        if (!Number.isFinite(metres) || metres <= 0) { toast.error('Введите положительную длину в метрах'); return; }
        const lengthMm = Math.round(metres * 1000);
        if (lengthMm !== selectedItem.lengthMm) payload.lengthMm = lengthMm;
      }
    }
    if (!Object.keys(payload).some((key) => key !== 'type' && key !== 'id')) return;
    setSaving(true);
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await responseError(response, 'Не удалось сохранить'));
      toast.success('Сохранено');
      selectItem({
        ...selectedItem,
        ...(payload.name !== undefined ? { name: payload.name as string } : {}),
        ...(payload.sectionOrDiameter !== undefined ? { sectionOrDiameter: payload.sectionOrDiameter as string | null } : {}),
        ...(payload.lengthMm !== undefined ? { lengthMm: payload.lengthMm as number } : {}),
      });
      await loadData();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      setSaving(false);
    }
  };

  // Drag the panel's left edge to widen it leftward (clamped) — same pattern as admin-equipment.
  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startW = panelWidth;
    const onMove = (moveEvent: MouseEvent) => {
      setPanelWidth(Math.min(720, Math.max(320, startW + (startX - moveEvent.clientX))));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

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
      // Keep the inspector in sync when the status of the selected item changed.
      if (selectedItem?.id === item.id) selectItem({ ...selectedItem, isActive });
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
    <div className="p-4 lg:p-6">
      <div
        style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties}
        className="grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]"
      >
      <div className="min-w-0 space-y-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight text-slate-950">Справочники</h1><p className="mt-1 text-sm text-slate-500">Рабочие значения вашей организации для отчётов и планирования</p></div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><div className="relative min-w-0 sm:w-80"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по справочникам" className="h-12 pl-9 pr-16" /><kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-2xs font-medium text-slate-400">Ctrl + K</kbd></div><div className="relative"><Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" /><select aria-label="Статус" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} className="h-12 rounded-md border border-slate-200 bg-white py-0 pl-9 pr-3 text-sm"><option value="active">Активные / Архив / Все</option><option value="archived">Архив</option><option value="all">Все</option></select></div><Button aria-label={activeDictionary.addLabel} className="h-12 bg-orange-500 text-white hover:bg-orange-600" onClick={() => setForm({ mode: 'create', kind: activeKind })}><Plus className="h-4 w-4" />Добавить</Button></div>
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
        <Tabs value={activeKind} onValueChange={(value) => setActiveKind(value as DictionaryKind)}>
          <div className="border-b border-slate-200">
            <TabsList className="h-12 rounded-none bg-transparent p-0">
              {KINDS.map(({ kind, title, icon: Icon }) => (
                <TabsTrigger key={kind} value={kind} className="h-12 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-orange-500 data-[state=active]:bg-white data-[state=active]:shadow-none"><Icon className="mr-1.5 h-4 w-4" />{title}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          <section aria-label="Сводка справочников" className="mt-4 grid gap-3 md:grid-cols-3">
            {dictionarySummary.map(({ kind, summaryTitle, Icon, active, archived, objects }) => (
              <button key={kind} type="button" className="rounded-xl border border-slate-200 bg-white p-4 text-left transition hover:border-orange-300 hover:shadow-sm" onClick={() => { setActiveKind(kind); setSearch(''); }}>
                <div className="flex items-center gap-4"><Icon className="h-10 w-10 shrink-0 text-sky-500" /><div><p className="text-sm font-semibold text-slate-800">{summaryTitle}</p><div className="mt-2 flex items-end gap-4"><div><p className="text-2xl font-bold text-sky-600">{active}</p><p className="text-xs text-sky-600">активных</p></div><div className="border-l border-slate-200 pl-4"><p className="text-lg font-semibold text-slate-500">{archived}</p><p className="text-xs text-slate-400">архивных</p></div></div></div></div>
                <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">Используются в {objects} объектах</p>
              </button>
            ))}
          </section>

          {KINDS.map(({ kind, title }) => (
            <TabsContent key={kind} value={kind} className="mt-3">
              <DictionaryTable
                kind={kind}
                title={title}
                statusLabel={statusLabel}
                items={filtered[kind]}
                onRename={(item) => setForm({ mode: 'rename', kind, item })}
                onLength={(item) => setLengthState({ item, value: item.lengthMm == null ? '' : String(item.lengthMm / 1000) })}
                onStatus={(item, isActive) => void setStatus(kind, item, isActive)}
                onDelete={(item) => setConfirmDelete({ kind, item })}
                onSelect={selectItem}
                selectedId={selectedKind === kind ? selectedItem?.id : undefined}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
      </div>

      {/* Right: persistent, resizable inspector column — same pattern as admin-equipment */}
      <aside className="relative">
        {/* drag handle — widen the panel leftward */}
        <div
          onMouseDown={startResize}
          title="Потяните, чтобы изменить ширину"
          className="absolute -left-2.5 top-0 z-10 hidden h-full w-2.5 cursor-col-resize lg:block"
        >
          <div className="mx-auto h-full w-px bg-slate-200 transition-colors hover:bg-blue-400" />
        </div>

        <div className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
        <div data-testid="dictionary-inspector" data-active-tab={inspectorTab} className={selectedItem ? 'flex min-h-[calc(100vh-7rem)] flex-col rounded-xl border border-slate-200 bg-white p-4' : 'flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-slate-50/50 p-8 text-center'}>
          {selectedItem ? <><div className="flex items-start justify-between gap-3"><div><h2 className="mt-1 text-lg font-semibold text-slate-900">{selectedItem.name}</h2></div><div className="flex items-center gap-3"><Badge className={selectedItem.isActive ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-100' : ''} variant={selectedItem.isActive ? 'default' : 'secondary'}>{selectedItem.isActive ? 'Активный' : 'Архив'}</Badge><button type="button" aria-label="Закрыть панель" onClick={() => selectItem(null)}><X className="h-4 w-4 text-slate-400" /></button></div></div>
          <div className="mt-4 flex gap-5 border-b border-slate-200 text-sm"><button type="button" onClick={() => setInspectorTab('general')} className={inspectorTab === 'general' ? 'border-b-2 border-orange-500 pb-2 font-medium text-slate-900' : 'pb-2 text-slate-500'}>Общие</button><button type="button" onClick={() => setInspectorTab('history')} className={inspectorTab === 'history' ? 'border-b-2 border-orange-500 pb-2 font-medium text-slate-900' : 'pb-2 text-slate-500'}>История</button></div>{inspectorTab === 'general' ? <><div className="mt-5 space-y-3 text-sm">
          <label className="block"><span className="text-slate-500">Название</span>
            <Input aria-label="Название" value={panelDraft?.name ?? ''} disabled={selectedUsed} title={selectedUsed ? 'Используемое значение нельзя переименовать' : undefined} onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, name: event.target.value }))} className="mt-1 font-medium" />
          </label>
          {selectedKind === 'pileGrade' ? <>
          <label className="block"><span className="text-slate-500">Код/сечение</span>
            <Input aria-label="Код/сечение" value={panelDraft?.section ?? ''} placeholder="120×120 мм" onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, section: event.target.value }))} className="mt-1" />
          </label>
          <label className="block"><span className="text-slate-500">Длина, м</span>
            <Input aria-label="Длина, м" value={panelDraft?.length ?? ''} inputMode="decimal" placeholder="35,00" onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, length: event.target.value }))} className="mt-1" />
            <p className="mt-1 text-xs text-slate-500">Указываются по проектной длине.</p>
          </label>
          </> : (selectedItem.code ? <div><span className="text-slate-500">Код</span><div className="mt-1 rounded-md border border-slate-200 bg-slate-50 p-2 font-medium text-slate-800">{selectedItem.code}</div></div> : null)}
          </div>
          <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{selectedItem.reportCount || selectedItem.planCount ? <><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Значение используется в отчётах и планах</p><p className="mt-2">Этот сортамент уже используется в {selectedItem.reportCount} отчётах и {selectedItem.planCount} планах.</p><p className="mt-2 font-medium">Можно только архивировать.</p></> : 'Значение не используется: его можно изменить или удалить.'}</div><section className="mt-5 space-y-2 text-sm"><h3 className="font-semibold text-slate-800">Использование</h3><p className="flex justify-between border-b border-dashed pb-2 text-slate-600"><span>Объекты</span><b>{selectedItem.siteCount}</b></p><p className="flex justify-between border-b border-dashed pb-2 text-slate-600"><span>Отчёты</span><b>{selectedItem.reportCount}</b></p><p className="flex justify-between border-b border-dashed pb-2 text-slate-600"><span>Планы</span><b>{selectedItem.planCount}</b></p></section>
          <div className="mt-auto border-t border-slate-100 pt-5"><div className="grid grid-cols-2 gap-2"><Button className="bg-orange-500 text-white hover:bg-orange-600" disabled={saving || !panelDirty} onClick={() => void savePanel()}><Save className="mr-1.5 h-4 w-4" />Сохранить</Button><Button variant="outline" className="border-orange-400 text-orange-600 hover:bg-orange-50" onClick={() => void setStatus(selectedKind, selectedItem, !selectedItem.isActive)}><Archive className="mr-1.5 h-4 w-4" />{selectedItem.isActive ? 'Архивировать' : 'Восстановить'}</Button></div><p className="mt-5 text-xs text-slate-500">Подсказка: используемые значения нельзя удалить. Архивированные записи скрываются из активных фильтров.</p></div></> : <div className="mt-4 text-sm text-slate-600">
            {history === null ? <p className="py-6 text-center text-slate-400">Загрузка истории…</p>
              : history.length === 0 ? <p className="py-6 text-center text-slate-400">Записей аудита по элементу нет.</p>
              : <ul className="space-y-3">
                  {history.map((entry) => (
                    <li key={entry.id} className="rounded-lg border border-slate-100 p-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium text-slate-800">{entry.title}</span>
                        <span className="shrink-0 text-xs text-slate-400">{entry.at}</span>
                      </div>
                      {entry.meta && <p className="mt-0.5 text-xs text-slate-500">{entry.meta}</p>}
                      {entry.changes && entry.changes.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                          {entry.changes.map((change, index) => (
                            <li key={index}>{change.label}: <s className="text-slate-400">{change.before}</s> → <b className="text-slate-700">{change.after}</b></li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>}
          </div>}</> : <><Search className="mx-auto mb-3 h-10 w-10 text-slate-300" /><p className="text-sm text-slate-500">Выберите запись</p><p className="mt-1 text-xs text-slate-400">Сведения откроются здесь, в этом же окне</p></>}
        </div>
        </div>
      </aside>
      </div>

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
