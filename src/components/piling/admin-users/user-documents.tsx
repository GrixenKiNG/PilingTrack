'use client';

/**
 * Документы работника — вкладка в карточке пользователя.
 *
 * Права на управление установкой, медосмотр, охрана труда, аттестация по
 * промбезопасности. Оператор прикладывает свои сам, чужие ведёт администратор
 * (проверка на сервере, см. services/users/user-documents.ts).
 *
 * Срок годности показываем не датой, а состоянием: «просрочен» и «истекает
 * через N дней» — это то, ради чего документ вообще заводится в систему.
 * Считает состояние та же функция, что и сервер (lib/document-expiry), чтобы
 * экран и выборка диспетчера не разошлись.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Loader2, FileText } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';
import { DOCUMENT_EXPIRY_LABELS, type DocumentExpiryStatus } from '@/lib/document-expiry';
import { cn } from '@/lib/utils';

interface DocumentType {
  id: string;
  name: string;
  requiresExpiry: boolean;
  defaultValidMonths: number | null;
  leadTimeDays: number;
}

interface DocumentRow {
  id: string;
  number: string;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string;
  type: { id: string; name: string; leadTimeDays: number; requiresExpiry: boolean };
  expiry: { status: DocumentExpiryStatus; daysLeft: number | null };
}

const STATUS_STYLE: Record<DocumentExpiryStatus, string> = {
  expired: 'bg-destructive/15 text-destructive',
  expiring: 'bg-amber-500/15 text-amber-700 dark:text-amber-500',
  ok: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-500',
  perpetual: 'bg-muted text-muted-foreground',
};

function statusText(expiry: DocumentRow['expiry']): string {
  if (expiry.status === 'expired') return `просрочен на ${Math.abs(expiry.daysLeft ?? 0)} дн.`;
  if (expiry.status === 'expiring') return `истекает через ${expiry.daysLeft} дн.`;
  return DOCUMENT_EXPIRY_LABELS[expiry.status];
}

const EMPTY_FORM = { typeId: '', number: '', issuedAt: '', expiresAt: '', notes: '' };

const toInputDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

export function UserDocuments({ userId }: { userId: string }) {
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [types, setTypes] = useState<DocumentType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<DocumentRow | null>(null);
  /**
   * Правка вместо заведения нового: продлённое удостоверение — тот же
   * документ с новым сроком, и плодить дубли на каждое продление незачем.
   * Изменение срока попадает в журнал (services/users/user-documents.ts).
   */
  const [editing, setEditing] = useState<DocumentRow | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (doc: DocumentRow) => {
    setEditing(doc);
    setForm({
      typeId: doc.type.id,
      number: doc.number,
      issuedAt: toInputDate(doc.issuedAt),
      expiresAt: toInputDate(doc.expiresAt),
      notes: doc.notes,
    });
    setDialogOpen(true);
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [docsRes, typesRes] = await Promise.all([
        authFetch(`/api/users/${userId}/documents`),
        authFetch('/api/user-document-types'),
      ]);
      if (!docsRes.ok) throw new Error('Не удалось загрузить документы');
      const docsBody = await docsRes.json();
      setDocuments(docsBody.documents ?? []);
      if (typesRes.ok) setTypes((await typesRes.json()).types ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    void load();
  }, [load]);

  /**
   * Дата окончания подставляется из срока действия вида документа: медосмотр
   * на год, удостоверение на пять лет. Поле остаётся редактируемым — в
   * документе может стоять своя дата.
   */
  const onIssuedChange = (issuedAt: string) => {
    const type = types.find((item) => item.id === form.typeId);
    if (!issuedAt || !type?.defaultValidMonths || form.expiresAt) {
      setForm((prev) => ({ ...prev, issuedAt }));
      return;
    }
    const expires = new Date(issuedAt);
    expires.setMonth(expires.getMonth() + type.defaultValidMonths);
    setForm((prev) => ({ ...prev, issuedAt, expiresAt: expires.toISOString().slice(0, 10) }));
  };

  const submit = async () => {
    if (!form.typeId) { toast.error('Выберите вид документа'); return; }
    setBusy(true);
    try {
      const res = await authFetch(
        editing ? `/api/users/${userId}/documents/${editing.id}` : `/api/users/${userId}/documents`,
        {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            typeId: form.typeId,
            number: form.number.trim(),
            issuedAt: form.issuedAt || null,
            expiresAt: form.expiresAt || null,
            notes: form.notes.trim(),
          }),
        },
      );
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Ошибка сохранения');
      toast.success(editing ? 'Документ обновлён' : 'Документ добавлен');
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: DocumentRow) => {
    try {
      const res = await authFetch(`/api/users/${userId}/documents/${doc.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Удаление не удалось');
      toast.success('Документ удалён');
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-border p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка документов…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {documents.length ? `Документов: ${documents.length}` : 'Документов нет'}
        </span>
        <Button size="sm" variant="outline" onClick={openCreate}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Добавить
        </Button>
      </div>

      {documents.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          Права на управление установкой, медосмотр и удостоверения — приложите, чтобы система следила за сроками.
        </div>
      ) : (
        <ul className="divide-y rounded-md border border-border">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between gap-3 p-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{doc.type.name}</div>
                <div className="text-xs text-muted-foreground">
                  {doc.number ? `№ ${doc.number} · ` : ''}
                  {doc.expiresAt ? `до ${formatRuDate(doc.expiresAt)}` : 'бессрочный'}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', STATUS_STYLE[doc.expiry.status])}>
                  {statusText(doc.expiry)}
                </span>
                <Button size="icon" variant="ghost" onClick={() => openEdit(doc)} aria-label="Изменить документ">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="icon" variant="ghost" onClick={() => setPendingDelete(doc)} aria-label="Удалить документ">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Изменить документ' : 'Документ работника'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Вид документа</Label>
              <Select value={form.typeId} onValueChange={(typeId) => setForm((prev) => ({ ...prev, typeId }))}>
                <SelectTrigger><SelectValue placeholder="Выберите вид" /></SelectTrigger>
                <SelectContent>
                  {types.map((type) => (
                    <SelectItem key={type.id} value={type.id}>{type.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Номер</Label>
              <Input value={form.number} onChange={(e) => setForm((prev) => ({ ...prev, number: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Выдан</Label>
                <Input type="date" value={form.issuedAt} onChange={(e) => onIssuedChange(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>Действует до</Label>
                <Input type="date" value={form.expiresAt} onChange={(e) => setForm((prev) => ({ ...prev, expiresAt: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Примечание</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Отмена</Button>
            <Button onClick={submit} disabled={busy}>
              {busy ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null} Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmActionDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
        title="Удалить документ?"
        description={pendingDelete ? `${pendingDelete.type.name}${pendingDelete.number ? ` № ${pendingDelete.number}` : ''}` : ''}
        confirmLabel="Удалить"
        onConfirm={async () => {
          if (pendingDelete) await remove(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
