export type ShiftJournalEntryState = 'CONFIRMED' | 'PENDING' | 'CONFLICT';

export interface ShiftJournalEntry {
  id: string;
  occurredAt: string;
  title: string;
  details: string | null;
  state: ShiftJournalEntryState;
}

const STATE_LABELS: Record<ShiftJournalEntryState, {label: string; symbol: string}> = {
  CONFIRMED: {label: 'Подтверждено сервером', symbol: '✓'},
  PENDING: {label: 'Ожидает отправки', symbol: '○'},
  CONFLICT: {label: 'Требует проверки', symbol: '!'},
};

export function ShiftJournal({entries}: {entries: ShiftJournalEntry[]}) {
  return <section aria-labelledby="operator-v3-journal-title" className="rounded-xl border bg-card p-5"><h2 id="operator-v3-journal-title" className="text-lg font-semibold">Журнал смены</h2>{entries.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">Записей пока нет</p> : <ol className="mt-4 space-y-3">{entries.map((entry) => { const state = STATE_LABELS[entry.state]; return <li key={entry.id} className="grid grid-cols-[2rem_1fr] gap-3 rounded-lg border bg-background p-3"><span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full bg-muted font-semibold">{state.symbol}</span><div><div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"><p className="font-medium">{entry.title}</p><time className="text-xs text-muted-foreground" dateTime={entry.occurredAt}>{new Intl.DateTimeFormat('ru-RU', {hour: '2-digit', minute: '2-digit'}).format(new Date(entry.occurredAt))}</time></div>{entry.details && <p className="mt-1 text-sm text-muted-foreground">{entry.details}</p>}<p className="mt-2 text-xs font-medium">{state.label}</p></div></li>; })}</ol>}</section>;
}
