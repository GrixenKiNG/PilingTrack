'use client';

import { AdminDictionariesView } from './admin-dictionaries-view';
import { startDictionaryResize } from './admin-dictionaries-panels';

import {type StatusFilter, type HistoryEntry, type FormState, type LengthState, type LengthConfirmState, lengthChangesHistory, useCompactInspector, KINDS} from "./admin-dictionaries-support";


import { useCallback, useEffect, useMemo, useState } from 'react';
import { useDocumentTitle } from '@/components/piling/ops-shell';

import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { parseDecimalInput } from '@/lib/parse-decimal';
import { catchText, extractApiError } from '@/components/piling/admin-crews/crew-messages';
import { normalizeSearch } from '@/components/piling/to/readiness/shared/text-search';




import { Skeleton } from '@/components/ui/skeleton';


import { SheetContent } from '@/components/ui/sheet';
import { type DictionaryKind, type RegistryItem } from './admin-dictionaries/dictionary-table';
import { type DictionaryFormValue } from './admin-dictionaries/dictionary-form';


export function AdminDictionaries() {
  useDocumentTitle('Справочники');
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
  const [lengthConfirm, setLengthConfirm] = useState<LengthConfirmState | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ kind: DictionaryKind; item: RegistryItem } | null>(null);
  const [saving, setSaving] = useState(false);
  const [selectedItem, setSelectedItem] = useState<RegistryItem | null>(null);
  const [panelDraft, setPanelDraft] = useState<{ name: string; section: string; length: string; notes: string } | null>(null);
  const [inspectorTab, setInspectorTab] = useState<'general' | 'history'>('general');
  const [history, setHistory] = useState<HistoryEntry[] | null>(null);
  const [historyFailed, setHistoryFailed] = useState(false);
  /** Счётчик попыток: его изменение перезапускает загрузку журнала. */
  const [historyAttempt, setHistoryAttempt] = useState(0);
  /**
   * Категория берётся из адреса и туда же возвращается.
   *
   * Ссылки «Марки свай», «Типы бурения» и «Причины простоев» в настройках
   * техготовности вели на /admin/dictionaries без категории — человек из
   * «Причин простоев» неизменно попадал в «Сваи» и искал их заново. По той же
   * причине перезагрузка теряла выбранную вкладку.
   */
  const [activeKind, setActiveKind] = useState<DictionaryKind>(() => {
    if (typeof window === 'undefined') return 'pileGrade';
    const requested = new URLSearchParams(window.location.search).get('kind');
    return KINDS.some(({ kind }) => kind === requested) ? (requested as DictionaryKind) : 'pileGrade';
  });
  const [panelWidth, setPanelWidth] = useState(380);
  const compactInspector = useCompactInspector();
  const InspectorShell: React.ElementType = compactInspector ? SheetContent : 'aside';

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

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (activeKind === 'pileGrade') url.searchParams.delete('kind');
    else url.searchParams.set('kind', activeKind);
    window.history.replaceState(window.history.state, '', url.pathname + url.search);
  }, [activeKind]);

  /**
   * Смена категории закрывает карточку прежней.
   *
   * Иначе слева «Бурение», а справа — марка сваи с её историей: два разных
   * предмета на одном экране, и непонятно, к чему относятся кнопки.
   */
  const selectKind = (kind: DictionaryKind) => {
    setActiveKind(kind);
    setSelectedItem(null);
    setPanelDraft(null);
    setHistory(null);
    setHistoryFailed(false);
  };

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
         
        if (active) { setHistory(payload.entries ?? []); setHistoryFailed(false); }
      } catch {
        /*
          Пустой список тут был враньём: сбой загрузки журнала выглядел как
          «изменений не было». У значения с реальной историей правок экран
          сообщал, что её нет, — и это ровно тот ответ, ради которого сюда
          заходят («кто менял длину?»).
        */
        if (active) { setHistory(null); setHistoryFailed(true); }
      }
    })();
    return () => { active = false; };
  }, [inspectorTab, selectedId, historyAttempt]);

  const filtered = useMemo(() => {
    const query = normalizeSearch(search);
    return Object.fromEntries(KINDS.map(({ kind }) => [
      kind,
      data[kind]
        .filter((item) => filter === 'all' || (filter === 'active' ? item.isActive : !item.isActive))
        .filter((item) => !query || [item.name, item.code, item.sectionOrDiameter]
          .some((value) => value ? normalizeSearch(value).includes(query) : false)),
    ])) as Record<DictionaryKind, RegistryItem[]>;
  }, [data, search, filter]);

  const statusLabel = filter === 'active' ? 'активные' : filter === 'archived' ? 'архив' : 'все';

  const dictionarySummary = useMemo(() => KINDS.map(({ kind, summaryTitle, pilingIcon }) => ({
    kind, summaryTitle, pilingIcon,
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
    setPanelDraft(item ? { name: item.name, section: item.sectionOrDiameter || '', length: formatMetres(item.lengthMm), notes: item.notes || '' } : null);
    setInspectorTab('general');
    setHistory(null);
  };

  const panelDirty = !!(selectedItem && panelDraft && (
    panelDraft.name.trim() !== selectedItem.name ||
    (selectedKind === 'pileGrade' && (
      panelDraft.section.trim() !== (selectedItem.sectionOrDiameter || '') ||
      panelDraft.length.trim() !== formatMetres(selectedItem.lengthMm) ||
      panelDraft.notes.trim() !== (selectedItem.notes || '')
    ))
  ));

  const savePanel = async (confirmed = false) => {
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
      const notes = panelDraft.notes.trim();
      if (notes !== (selectedItem.notes || '')) payload.notes = notes;
      const lengthRaw = panelDraft.length.trim();
      if (!lengthRaw && selectedItem.lengthMm != null) {
        // Length is the single source for м.п. — clearing it would silently
        // zero the meters KPI, so refuse explicitly instead of ignoring.
        toast.error('Длина обязательна для марки сваи');
        return;
      }
      if (lengthRaw) {
        const metres = parseDecimalInput(lengthRaw);
        if (metres === null || metres <= 0) { toast.error('Введите положительную длину в метрах'); return; }
        const lengthMm = Math.round(metres * 1000);
        if (lengthMm !== selectedItem.lengthMm) payload.lengthMm = lengthMm;
        if (!confirmed && lengthChangesHistory(selectedItem, lengthMm)) {
          setLengthConfirm({ item: selectedItem, lengthMm, source: 'panel' });
          return;
        }
        // Сервер применяет смену длины используемой марки только с этим флагом.
        if (confirmed && payload.lengthMm !== undefined) payload.confirmRecalculate = true;
      }
    }
    if (!Object.keys(payload).some((key) => key !== 'type' && key !== 'id')) return;
    setSaving(true);
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error(await extractApiError(response, 'Не удалось сохранить'));
      toast.success('Сохранено');
      selectItem({
        ...selectedItem,
        ...(payload.name !== undefined ? { name: payload.name as string } : {}),
        ...(payload.sectionOrDiameter !== undefined ? { sectionOrDiameter: payload.sectionOrDiameter as string | null } : {}),
        ...(payload.notes !== undefined ? { notes: payload.notes as string } : {}),
        ...(payload.lengthMm !== undefined ? { lengthMm: payload.lengthMm as number } : {}),
      });
      await loadData();
    } catch (error) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-3).
      toast.error(catchText(error, 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  };

  // Drag the panel's left edge to widen it leftward (clamped) — same pattern as admin-equipment.
  const startResize = (event: React.MouseEvent) => startDictionaryResize(event, panelWidth, setPanelWidth);

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
      if (!response.ok) throw new Error(await extractApiError(response, 'Не удалось сохранить'));
      toast.success(isCreate ? 'Элемент добавлен' : 'Переименовано');
      setForm(null);
      await loadData();
    } catch (error) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-3).
      toast.error(catchText(error, 'Не удалось сохранить'));
    } finally {
      setSaving(false);
    }
  };

  // Архивация одной записи — без окна, но с «Отменить» в уведомлении (решение
  // владельца 28.09.2026). Восстановление по «Отменить» само отмены не предлагает.
  const setStatus = async (kind: DictionaryKind, item: RegistryItem, isActive: boolean, undoable = true) => {
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: kind, id: item.id, isActive }),
      });
      if (!response.ok) {
        toast.error(await extractApiError(response, 'Не удалось изменить статус'));
        return;
      }
      toast.success(
        isActive ? 'Восстановлено' : `Архивировано: ${item.name}`,
        !isActive && undoable
          ? { duration: 10_000, action: { label: 'Отменить', onClick: () => { void setStatus(kind, item, true, false); } } }
          : undefined,
      );
      // Keep the inspector in sync when the status of the selected item changed.
      if (selectedItem?.id === item.id) selectItem({ ...selectedItem, isActive });
      await loadData();
    } catch (error) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-3).
      toast.error(catchText(error, 'Не удалось изменить статус'));
    }
  };

  const setStatusBulk = async (kind: DictionaryKind, items: RegistryItem[], isActive: boolean) => {
    const results = await Promise.all(items.map(async (item) => {
      try {
        const response = await authFetch('/api/dictionary/manage', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: kind, id: item.id, isActive }),
        });
        return response.ok;
      } catch {
        return false;
      }
    }));
    const done = results.filter(Boolean).length;
    const failed = items.length - done;
    if (done) toast.success(`${isActive ? 'Восстановлено' : 'Архивировано'}: ${done}`);
    if (failed) toast.error(`Не удалось изменить статус: ${failed}`);
    if (!failed && selectedItem && items.some((item) => item.id === selectedItem.id)) selectItem({ ...selectedItem, isActive });
    await loadData();
  };

  const saveLength = async (confirmed = false) => {
    if (!lengthState) return;
    const metres = parseDecimalInput(lengthState.value);
    if (metres === null || metres <= 0) {
      toast.error('Введите положительную длину в метрах');
      return;
    }
    const lengthMm = Math.round(metres * 1000);
    if (!confirmed && lengthChangesHistory(lengthState.item, lengthMm)) {
      setLengthConfirm({ item: lengthState.item, lengthMm, source: 'dialog' });
      return;
    }
    setSaving(true);
    try {
      const response = await authFetch('/api/dictionary/manage', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'pileGrade', id: lengthState.item.id, lengthMm, ...(confirmed ? { confirmRecalculate: true } : {}) }),
      });
      if (!response.ok) throw new Error(await extractApiError(response, 'Не удалось сохранить длину'));
      toast.success('Длина сохранена');
      setLengthState(null);
      await loadData();
    } catch (error) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-3).
      toast.error(catchText(error, 'Не удалось сохранить длину'));
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
        toast.error(await extractApiError(response, 'Не удалось удалить'));
        return;
      }
      toast.success('Элемент удалён');
      setConfirmDelete(null);
      await loadData();
    } catch (error) {
      // Обрыв сети fetch бросает TypeError с английским «Failed to fetch» (F-R112-3).
      toast.error(catchText(error, 'Не удалось удалить'));
    }
  };

  if (loading) {
    return <div className="space-y-4 p-4 lg:p-6"><Skeleton className="h-8 w-48" /><Skeleton className="h-72 w-full" /></div>;
  }

  return <AdminDictionariesView
          panelWidth={panelWidth} search={search} setSearch={setSearch}
          filter={filter} setFilter={setFilter} activeDictionary={activeDictionary}
          setForm={setForm} activeKind={activeKind} loadError={loadError}
          loadData={loadData} selectKind={selectKind} dictionarySummary={dictionarySummary}
          statusLabel={statusLabel} filtered={filtered} setLengthState={setLengthState}
          setStatus={setStatus} setStatusBulk={setStatusBulk} setConfirmDelete={setConfirmDelete}
          selectItem={selectItem} selectedKind={selectedKind} selectedItem={selectedItem}
          compactInspector={compactInspector} InspectorShell={InspectorShell} startResize={startResize}
          setPanelWidth={setPanelWidth} inspectorTab={inspectorTab} setInspectorTab={setInspectorTab}
          panelDraft={panelDraft} selectedUsed={selectedUsed} setPanelDraft={setPanelDraft}
          saving={saving} panelDirty={panelDirty} savePanel={savePanel}
          historyFailed={historyFailed} setHistoryAttempt={setHistoryAttempt} history={history}
          form={form} submitForm={submitForm} lengthState={lengthState}
          saveLength={saveLength} lengthConfirm={lengthConfirm} setLengthConfirm={setLengthConfirm}
          formatMetres={formatMetres} confirmDelete={confirmDelete} deleteItem={deleteItem}
        />;
}
