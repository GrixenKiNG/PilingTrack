import type * as React from 'react';
import { type StatusFilter, type HistoryEntry, type FormState, type LengthState, type LengthConfirmState, KINDS } from "./admin-dictionaries-support";
import { AlertCircle, AlertTriangle, Archive, Filter, Plus, Save, Search, X } from '@/components/piling/icons/unified-icons';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetTitle } from '@/components/ui/sheet';
import { DictionaryTable, type DictionaryKind, type RegistryItem } from './admin-dictionaries/dictionary-table';
import { DictionaryForm, type DictionaryFormValue } from './admin-dictionaries/dictionary-form';
import { PilingIcon } from '@/components/piling/icons';
import type { PilingIconName } from '@/components/piling/icons';
import { DictionaryResizeHandle, DictionaryHistoryPanel, DictionaryLengthConfirmation } from './admin-dictionaries-panels';

interface AdminDictionariesViewProps {
  panelWidth: number;
  search: string;
  setSearch: React.Dispatch<React.SetStateAction<string>>;
  filter: StatusFilter;
  setFilter: React.Dispatch<React.SetStateAction<StatusFilter>>;
  activeDictionary: (typeof KINDS)[number];
  setForm: React.Dispatch<React.SetStateAction<FormState | null>>;
  activeKind: DictionaryKind;
  loadError: boolean;
  loadData: () => Promise<void>;
  selectKind: (kind: DictionaryKind) => void;
  dictionarySummary: Array<{ kind: DictionaryKind; summaryTitle: string; pilingIcon: PilingIconName; active: number; archived: number; objects: number }>;
  statusLabel: "активные" | "архив" | "все";
  filtered: Record<DictionaryKind, RegistryItem[]>;
  setLengthState: React.Dispatch<React.SetStateAction<LengthState | null>>;
  setStatus: (kind: DictionaryKind, item: RegistryItem, isActive: boolean, undoable?: boolean) => Promise<void>;
  setStatusBulk: (kind: DictionaryKind, items: RegistryItem[], isActive: boolean) => Promise<void>;
  setConfirmDelete: React.Dispatch<React.SetStateAction<{ kind: DictionaryKind; item: RegistryItem; } | null>>;
  selectItem: (item: RegistryItem | null) => void;
  selectedKind: DictionaryKind;
  selectedItem: RegistryItem | null;
  compactInspector: boolean;
  InspectorShell: React.ElementType;
  startResize: (event: React.MouseEvent) => void;
  setPanelWidth: React.Dispatch<React.SetStateAction<number>>;
  inspectorTab: "history" | "general";
  setInspectorTab: React.Dispatch<React.SetStateAction<"history" | "general">>;
  panelDraft: { name: string; section: string; length: string; notes: string; } | null;
  selectedUsed: boolean;
  setPanelDraft: React.Dispatch<React.SetStateAction<{ name: string; section: string; length: string; notes: string; } | null>>;
  saving: boolean;
  panelDirty: boolean;
  savePanel: (confirmed?: boolean) => Promise<void>;
  historyFailed: boolean;
  setHistoryAttempt: React.Dispatch<React.SetStateAction<number>>;
  history: HistoryEntry[] | null;
  form: FormState | null;
  submitForm: (value: DictionaryFormValue) => Promise<void>;
  lengthState: LengthState | null;
  saveLength: (confirmed?: boolean) => Promise<void>;
  lengthConfirm: LengthConfirmState | null;
  setLengthConfirm: React.Dispatch<React.SetStateAction<LengthConfirmState | null>>;
  formatMetres: (lengthMm: number | null | undefined) => string;
  confirmDelete: { kind: DictionaryKind; item: RegistryItem; } | null;
  deleteItem: () => Promise<void>;
}

export function AdminDictionariesView({ panelWidth, search, setSearch, filter, setFilter, activeDictionary, setForm, activeKind, loadError, loadData, selectKind, dictionarySummary, statusLabel, filtered, setLengthState, setStatus, setStatusBulk, setConfirmDelete, selectItem, selectedKind, selectedItem, compactInspector, InspectorShell, startResize, setPanelWidth, inspectorTab, setInspectorTab, panelDraft, selectedUsed, setPanelDraft, saving, panelDirty, savePanel, historyFailed, setHistoryAttempt, history, form, submitForm, lengthState, saveLength, lengthConfirm, setLengthConfirm, formatMetres, confirmDelete, deleteItem }: AdminDictionariesViewProps) {
  return (
(
    <div className="p-4 lg:p-6">
      <div
        style={{ '--panel-w': `${panelWidth}px` } as React.CSSProperties}
        className="grid grid-cols-1 gap-4 lg:[grid-template-columns:minmax(0,1fr)_var(--panel-w)]"
      >
      <div className="min-w-0 space-y-4">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div><h1 className="text-3xl font-bold tracking-tight text-foreground">Справочники</h1><p className="mt-1 text-sm text-muted-foreground">Рабочие значения вашей организации для отчётов и планирования</p></div>
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"><div className="relative min-w-0 sm:w-80"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Поиск по справочникам" aria-label="Поиск по справочникам" className="h-12 pl-9 pr-16" /><kbd className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 py-0.5 text-2xs font-medium text-muted-foreground sm:block">Ctrl + K</kbd></div><div className="relative w-full sm:w-auto"><Filter className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><select aria-label="Статус" value={filter} onChange={(event) => setFilter(event.target.value as StatusFilter)} className="h-12 w-full rounded-md border border-border bg-card py-0 pl-9 pr-3 text-sm sm:w-auto"><option value="active">Активные</option><option value="archived">Архив</option><option value="all">Все</option></select></div><Button aria-label={activeDictionary.addLabel} className="h-12 w-full bg-signal text-white hover:bg-signal-strong sm:w-auto" onClick={() => setForm({ mode: 'create', kind: activeKind })}><Plus className="h-4 w-4" />{activeDictionary.addLabel}</Button></div>
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
        <Tabs value={activeKind} onValueChange={(value) => selectKind(value as DictionaryKind)}>
          {/* overflow-x-auto: панель вкладок шире 390px и на мобильном распирала
              страницу горизонтально — теперь прокручивается внутри себя. */}
          <div className="overflow-x-auto border-b border-border">
            <TabsList className="h-12 rounded-none bg-transparent p-0">
              {KINDS.map(({ kind, title, icon: Icon }) => (
                <TabsTrigger key={kind} value={kind} className="h-12 rounded-none border-b-2 border-transparent px-6 data-[state=active]:border-signal/30 data-[state=active]:bg-card data-[state=active]:shadow-none"><Icon className="mr-1.5 h-4 w-4" />{title}</TabsTrigger>
              ))}
            </TabsList>
          </div>

          <section aria-label="Сводка справочников" className="mt-4 grid gap-3 md:grid-cols-3">
            {dictionarySummary.map(({ kind, summaryTitle, pilingIcon, active, archived, objects }) => (
              <button key={kind} type="button" className="rounded-xl border border-border bg-card p-4 text-left transition hover:border-signal/30 hover:shadow-sm" onClick={() => { selectKind(kind); setSearch(''); }}>
                {/* Иконка во всю высоту плитки + описание — как в дашборде. */}
                <div className="flex items-stretch gap-4"><span className="relative w-20 shrink-0 self-stretch"><PilingIcon name={pilingIcon} fill decorative className="absolute inset-0" /></span><div><p className="text-sm font-semibold text-foreground">{summaryTitle}</p><div className="mt-2 flex items-end gap-4"><div><p className="text-2xl font-bold text-info-strong">{active}</p><p className="text-xs text-info-strong max-sm:text-sm">активных</p></div><div className="border-l border-border pl-4"><p className="text-lg font-semibold text-muted-foreground">{archived}</p><p className="text-xs text-muted-foreground max-sm:text-sm">архивных</p></div></div></div></div>
                <p className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground max-sm:text-sm">Используются в {objects} объектах</p>
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
                onBulkStatus={(items, isActive) => void setStatusBulk(kind, items, isActive)}
                onDelete={(item) => setConfirmDelete({ kind, item })}
                onSelect={selectItem}
                selectedId={selectedKind === kind ? selectedItem?.id : undefined}
                compact={compactInspector}
              />
            </TabsContent>
          ))}
        </Tabs>
      )}
      </div>

      {/* Desktop: persistent resizable column. Mobile/tablet: focused side sheet. */}
      <Sheet
        open={compactInspector && selectedItem !== null}
        onOpenChange={(open) => {
          if (!open) selectItem(null);
        }}
      >
      <InspectorShell
        {...(compactInspector ? { side: 'right' } : {})}
        className={compactInspector
          ? 'w-full gap-0 overflow-hidden p-0 sm:max-w-md [&>button]:hidden'
          : 'relative hidden lg:block'}
      >
        {compactInspector && (
          <SheetTitle className="sr-only">
            {selectedItem ? `Сведения: ${selectedItem.name}` : 'Сведения из справочника'}
          </SheetTitle>
        )}
        {/* drag handle — widen the panel leftward */}
        <DictionaryResizeHandle
          startResize={startResize} setPanelWidth={setPanelWidth} panelWidth={panelWidth}
        />

        <div className={compactInspector ? 'h-full overflow-y-auto' : 'lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto'}>
        <div data-testid="dictionary-inspector" data-active-tab={inspectorTab} className={selectedItem ? (compactInspector ? 'flex min-h-full flex-col bg-card p-4' : 'flex min-h-[calc(100vh-7rem)] flex-col rounded-xl border border-border bg-card p-4') : 'flex min-h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-muted/50 p-8 text-center'}>
          {selectedItem ? <><div className="flex items-start justify-between gap-3 pr-1"><div><h2 className="mt-1 text-lg font-semibold text-foreground">{selectedItem.name}</h2></div><div className="flex items-center gap-2"><Badge className={selectedItem.isActive ? 'bg-success/10 text-success-strong hover:bg-success/10' : ''} variant={selectedItem.isActive ? 'default' : 'secondary'}>{selectedItem.isActive ? 'Активный' : 'Архив'}</Badge><button type="button" aria-label="Закрыть панель" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted" onClick={() => selectItem(null)}><X className="h-4 w-4 text-muted-foreground" /></button></div></div>
          <div className="mt-3 flex border-b border-border text-sm" role="tablist" aria-label="Сведения о значении"><button type="button" role="tab" aria-selected={inspectorTab === 'general'} onClick={() => setInspectorTab('general')} className={inspectorTab === 'general' ? 'min-h-11 border-b-2 border-signal/30 px-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30' : 'min-h-11 px-3 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30'}>Общие</button><button type="button" role="tab" aria-selected={inspectorTab === 'history'} onClick={() => setInspectorTab('history')} className={inspectorTab === 'history' ? 'min-h-11 border-b-2 border-signal/30 px-3 font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30' : 'min-h-11 px-3 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30'}>История</button></div>{inspectorTab === 'general' ? <><div className="mt-5 space-y-3 text-sm">
          <label className="block"><span className="text-muted-foreground">Название</span>
            <Input aria-label="Название" value={panelDraft?.name ?? ''} disabled={selectedUsed} title={selectedUsed ? 'Используемое значение нельзя переименовать' : undefined} onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, name: event.target.value }))} className="mt-1 h-11 font-medium" />
          </label>
          {selectedKind === 'pileGrade' ? <>
          <label className="block"><span className="text-muted-foreground">Код/сечение</span>
            <Input aria-label="Код/сечение" value={panelDraft?.section ?? ''} placeholder="120×120 мм" onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, section: event.target.value }))} className="mt-1 h-11" />
          </label>
          <label className="block"><span className="text-muted-foreground">Длина, м</span>
            <Input aria-label="Длина, м" value={panelDraft?.length ?? ''} inputMode="decimal" placeholder="35,00" onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, length: event.target.value }))} className="mt-1 h-11" />
            <p className="mt-1 text-xs text-muted-foreground max-sm:text-sm">Указываются по проектной длине.</p>
            {selectedUsed && (
              <p className="mt-1.5 flex gap-1.5 rounded-md border border-warning/30 bg-warning/10 p-2 text-xs text-warning-strong max-sm:text-sm">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                <span>Погонные метры считаются от этой длины. Если её изменить, цифры в уже сданных отчётах ({selectedItem.reportCount}) и в аналитике за прошлые периоды станут другими.</span>
              </p>
            )}
          </label>
          <label className="block"><span className="text-muted-foreground">Примечание</span>
            <Input aria-label="Примечание" value={panelDraft?.notes ?? ''} maxLength={500} placeholder="Например: для мостовых свай" onChange={(event) => setPanelDraft((draft) => draft && ({ ...draft, notes: event.target.value }))} className="mt-1 h-11" />
          </label>
          </> : (selectedItem.code ? <div><span className="text-muted-foreground">Код</span><div className="mt-1 rounded-md border border-border bg-muted p-2 font-medium text-foreground">{selectedItem.code}</div></div> : null)}
          </div>
          <div className="mt-5 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-strong">{selectedItem.reportCount || selectedItem.planCount ? <><p className="flex items-center gap-2 font-medium"><AlertTriangle className="h-4 w-4" />Значение используется в отчётах и планах</p><p className="mt-2">Использование: отчётов — {selectedItem.reportCount}, планов — {selectedItem.planCount}.</p><p className="mt-2 font-medium">Можно только архивировать.</p></> : 'Значение не используется: его можно изменить или удалить.'}</div><section className="mt-5 space-y-2 text-sm"><h3 className="font-semibold text-foreground">Использование</h3><p className="flex justify-between border-b border-dashed pb-2 text-muted-foreground"><span>Объекты</span><b>{selectedItem.siteCount}</b></p><p className="flex justify-between border-b border-dashed pb-2 text-muted-foreground"><span>Отчёты</span><b>{selectedItem.reportCount}</b></p><p className="flex justify-between border-b border-dashed pb-2 text-muted-foreground"><span>Планы</span><b>{selectedItem.planCount}</b></p></section>
          <div className="mt-auto border-t border-border pt-5"><div className="grid grid-cols-2 gap-2"><Button className="min-h-11 bg-signal text-white hover:bg-signal-strong" disabled={saving || !panelDirty} onClick={() => void savePanel()}><Save className="mr-1.5 h-4 w-4" />Сохранить</Button><Button variant="outline" className="min-h-11 border-signal/30 text-signal-strong hover:bg-signal/10" onClick={() => void setStatus(selectedKind, selectedItem, !selectedItem.isActive)}><Archive className="mr-1.5 h-4 w-4" />{selectedItem.isActive ? 'Архивировать' : 'Восстановить'}</Button></div><p className="mt-5 text-xs text-muted-foreground max-sm:text-sm">Подсказка: используемые значения нельзя удалить. Архивированные записи скрываются из активных фильтров.</p></div></> : <DictionaryHistoryPanel
          historyFailed={historyFailed} setHistoryAttempt={setHistoryAttempt} history={history}
        />}</> : <><Search className="mx-auto mb-3 h-10 w-10 text-muted-foreground" /><p className="text-sm text-muted-foreground">Выберите запись</p><p className="mt-1 text-xs text-muted-foreground max-sm:text-sm">Сведения откроются здесь, в этом же окне</p></>}
        </div>
        </div>
      </InspectorShell>
      </Sheet>
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
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Длина сваи — {lengthState?.item.name}</DialogTitle></DialogHeader>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">
            Длина, м
            <Input aria-label="Длина сваи, м" value={lengthState?.value || ''} onChange={(event) => setLengthState((state) => state && ({ ...state, value: event.target.value }))} inputMode="decimal" />
          </label>
          {lengthState && (lengthState.item.reportCount > 0 || lengthState.item.planCount > 0) && (
            <p className="flex gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning-strong">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>Марка уже используется: отчётов — {lengthState.item.reportCount}, планов — {lengthState.item.planCount}. Погонные метры нигде не хранятся, их считают от длины марки — новая длина изменит цифры и за прошлые периоды.</span>
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLengthState(null)}>Отмена</Button>
            <Button onClick={() => void saveLength()} disabled={saving} className="bg-signal text-white hover:bg-signal-strong">Сохранить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DictionaryLengthConfirmation
          lengthConfirm={lengthConfirm} setLengthConfirm={setLengthConfirm} formatMetres={formatMetres}
          saving={saving} savePanel={savePanel} saveLength={saveLength}
        />

      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Удалить навсегда?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Элемент «{confirmDelete?.item.name}» будет удалён без возможности восстановления.</p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>Отмена</Button>
            <Button onClick={() => void deleteItem()} className="bg-destructive-strong text-white hover:bg-destructive-strong">Удалить</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
  );
}
