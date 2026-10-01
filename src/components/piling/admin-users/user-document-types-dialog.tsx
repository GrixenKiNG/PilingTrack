'use client';

/**
 * Справочник видов документов работника.
 *
 * Утверждённый список («удостоверение машиниста», медосмотр, охрана труда,
 * промбезопасность) заведён сидом, но владелец просил «с возможностью
 * дополнения»: без этого экрана добавить вид можно было только правкой кода.
 *
 * Удаление доступно лишь для неиспользованного вида — вид, которым подшиты
 * документы, отключается. Иначе у живых документов пропал бы срок
 * предупреждения, по которому считается просрочка.
 */

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Plus, Trash2 } from '@/components/piling/icons/unified-icons';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';

/**
 * Границы полей совпадают с zod-схемой вида документа
 * (`app/api/user-document-types/schema.ts`): 1..600 месяцев, 0..365 дней.
 * Одни и те же значения используют форма создания и правка строки списка.
 */
const MONTHS_MIN = 1;
const MONTHS_MAX = 600;
const LEAD_DAYS_MIN = 0;
const LEAD_DAYS_MAX = 365;
const DEFAULT_LEAD_DAYS = 30;

/** Поля формы → тело запроса: пустой срок — «не задан», пустое предупреждение — 30 дней. */
const limitsBody = (months: string, leadDays: string) => ({
  defaultValidMonths: months ? Number(months) : null,
  leadTimeDays: leadDays ? Number(leadDays) : DEFAULT_LEAD_DAYS,
});

interface TypeRow {
  id: string;
  name: string;
  requiresExpiry: boolean;
  defaultValidMonths: number | null;
  leadTimeDays: number;
  requiredForOperator: boolean;
  isActive: boolean;
  documentCount: number;
}

export function UserDocumentTypesDialog({ open, onOpenChange }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [rows, setRows] = useState<TypeRow[] | null>(null);
  const [name, setName] = useState('');
  const [months, setMonths] = useState('');
  const [leadDays, setLeadDays] = useState(String(DEFAULT_LEAD_DAYS));
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<TypeRow | null>(null);
  /** Черновик правки строки списка; null — ни одна строка не редактируется. */
  const [draft, setDraft] = useState<{ id: string; name: string; months: string; leadDays: string } | null>(null);

  const load = useCallback(async () => {
    const response = await authFetch('/api/user-document-types?scope=all');
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      toast.error(body.error || 'Не удалось загрузить виды документов');
      return;
    }
    setRows(((await response.json()).types ?? []) as TypeRow[]);
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data when the dialog opens; the async loader sets state
  useEffect(() => { if (open) void load(); }, [open, load]);

  const create = async () => {
    if (!name.trim()) return toast.error('Укажите название вида документа');
    setBusy(true);
    const response = await authFetch('/api/user-document-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        ...limitsBody(months, leadDays),
      }),
    });
    setBusy(false);
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return toast.error(body.error || 'Не удалось создать вид документа');
    }
    toast.success('Вид документа добавлен');
    setName(''); setMonths(''); setLeadDays(String(DEFAULT_LEAD_DAYS));
    await load();
  };

  const patch = async (row: TypeRow, body: Record<string, unknown>): Promise<boolean> => {
    const response = await authFetch(`/api/user-document-types/${row.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      toast.error(payload.error || 'Не удалось сохранить');
      return false;
    }
    await load();
    return true;
  };

  const startEdit = (row: TypeRow) => setDraft({
    id: row.id,
    name: row.name,
    months: row.defaultValidMonths ? String(row.defaultValidMonths) : '',
    leadDays: String(row.leadTimeDays),
  });

  const saveEdit = async (row: TypeRow) => {
    if (!draft) return;
    const nextName = draft.name.trim();
    if (!nextName) return toast.error('Укажите название вида документа');
    setBusy(true);
    const saved = await patch(row, { name: nextName, ...limitsBody(draft.months, draft.leadDays) });
    setBusy(false);
    if (!saved) return;
    toast.success('Вид документа обновлён');
    setDraft(null);
  };

  const remove = async (row: TypeRow) => {
    const response = await authFetch(`/api/user-document-types/${row.id}`, { method: 'DELETE' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      return toast.error(body.error || 'Не удалось удалить');
    }
    toast.success('Вид документа удалён');
    await load();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Виды документов работников</DialogTitle>
          </DialogHeader>

          <div className="rounded-lg border border-border p-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_130px_auto] sm:items-end">
              <div>
                <Label htmlFor="dt-name">Название</Label>
                <Input id="dt-name" value={name} onChange={(event) => setName(event.target.value)}
                  placeholder="Напр. Удостоверение стропальщика" />
              </div>
              <div>
                <Label htmlFor="dt-months">Срок, мес.</Label>
                <Input id="dt-months" type="number" min={MONTHS_MIN} max={MONTHS_MAX} value={months}
                  onChange={(event) => setMonths(event.target.value)} placeholder="—" />
              </div>
              <div>
                <Label htmlFor="dt-lead">Предупредить за</Label>
                <Input id="dt-lead" type="number" min={LEAD_DAYS_MIN} max={LEAD_DAYS_MAX} value={leadDays}
                  onChange={(event) => setLeadDays(event.target.value)} />
              </div>
              <Button onClick={create} disabled={busy} className="bg-signal text-white hover:bg-signal-strong">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                Добавить
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              «Срок, мес.» подставляется в форму документа как дата окончания. «Предупредить за» —
              за сколько дней вид попадёт в контроль диспетчера.
            </p>
          </div>

          {rows === null ? (
            <div className="flex justify-center py-8 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((row) => {
                const editing = draft?.id === row.id;
                return (
                  <div key={row.id} className={cn('py-2 text-sm', !editing && 'flex flex-wrap items-center gap-3')}>
                    {editing ? (
                      /* Правка строки: на широком экране поля идут в одну строку с
                         названием, на узком (включая 375 px) переносятся под него. */
                      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_110px_130px_auto] sm:items-end">
                        <div>
                          <Label htmlFor={`dt-edit-name-${row.id}`}>Название</Label>
                          <Input id={`dt-edit-name-${row.id}`} value={draft.name}
                            onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
                        </div>
                        <div>
                          <Label htmlFor={`dt-edit-months-${row.id}`}>Срок действия, мес.</Label>
                          <Input id={`dt-edit-months-${row.id}`} type="number" min={MONTHS_MIN} max={MONTHS_MAX}
                            value={draft.months} placeholder="—"
                            onChange={(event) => setDraft({ ...draft, months: event.target.value })} />
                        </div>
                        <div>
                          <Label htmlFor={`dt-edit-lead-${row.id}`}>Предупредить за, дн.</Label>
                          <Input id={`dt-edit-lead-${row.id}`} type="number" min={LEAD_DAYS_MIN} max={LEAD_DAYS_MAX}
                            value={draft.leadDays}
                            onChange={(event) => setDraft({ ...draft, leadDays: event.target.value })} />
                        </div>
                        <div className="flex gap-2 sm:justify-end">
                          <Button onClick={() => void saveEdit(row)} disabled={busy}
                            className="h-11 text-2xs bg-signal text-white hover:bg-signal-strong sm:h-8">
                            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                            Сохранить
                          </Button>
                          <Button variant="outline" className="h-11 text-2xs sm:h-8" onClick={() => setDraft(null)}>
                            Отмена
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="min-w-0 flex-1">
                          <div className={cn('truncate font-medium', !row.isActive && 'text-muted-foreground line-through')}>
                            {row.name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {row.defaultValidMonths ? `${row.defaultValidMonths} мес.` : 'срок не задан'}
                            {' · '}предупреждение за {row.leadTimeDays} дн.
                            {' · '}документов: {row.documentCount}
                            {row.requiredForOperator && (
                              <span className="ml-1 font-semibold text-destructive-strong">· обязателен для смены</span>
                            )}
                          </div>
                        </div>
                        <Button variant="outline" className="h-11 text-2xs sm:h-8" onClick={() => startEdit(row)}>
                          Изменить
                        </Button>
                        {/* Обязательность останавливает работу людей: без действующего
                            документа оператор не начнёт смену. Поэтому переключатель
                            стоит рядом со списком, а не прячется в отдельной форме. */}
                        <Button variant="outline" className="h-11 text-2xs sm:h-8"
                          onClick={() => void patch(row, { requiredForOperator: !row.requiredForOperator })}>
                          {row.requiredForOperator ? 'Не требовать' : 'Требовать для смены'}
                        </Button>
                        <Button variant="outline" className="h-11 text-2xs sm:h-8"
                          onClick={() => void patch(row, { isActive: !row.isActive })}>
                          {row.isActive ? 'Отключить' : 'Включить'}
                        </Button>
                        {/* Кнопка есть всегда, но у используемого вида сервер ответит
                            отказом с объяснением — счётчик документов рядом. */}
                        <button
                          type="button"
                          onClick={() => setPendingDelete(row)}
                          aria-label={`Удалить вид «${row.name}»`}
                          className="flex h-11 w-11 items-center justify-center rounded-md text-destructive-strong hover:bg-destructive/10 sm:h-8 sm:w-8"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
              {rows.length === 0 && (
                <p className="py-8 text-center text-sm text-muted-foreground">Виды документов ещё не заведены.</p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(next) => !next && setPendingDelete(null)}
        title="Удалить вид документа?"
        description={pendingDelete
          ? `«${pendingDelete.name}». Использованный вид удалить нельзя — его можно отключить.`
          : ''}
        confirmLabel="Удалить"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </>
  );
}
