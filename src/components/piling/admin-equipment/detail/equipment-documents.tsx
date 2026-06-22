'use client';

/**
 * EquipmentDocuments — CRUD list for /admin/equipment/[id].
 *
 * Documents have type (PASSPORT/OTS/INSURANCE/INSPECTION/CERTIFICATE/
 * MAINTENANCE_LOG/OTHER), title, issuedAt, expiresAt, notes. Edit/delete
 * happens through a small in-place dialog; create reuses the same form.
 */

import { useState } from 'react';
import { Pencil, Trash2, Plus, FileText, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { formatRuDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

export type DocumentTypeId =
  | 'PASSPORT' | 'OTS' | 'INSURANCE' | 'INSPECTION'
  | 'CERTIFICATE' | 'MAINTENANCE_LOG' | 'OTHER';

const TYPE_LABEL: Record<DocumentTypeId, string> = {
  PASSPORT: 'Паспорт',
  OTS: 'ОТС',
  INSURANCE: 'Страховка',
  INSPECTION: 'Тех. осмотр',
  CERTIFICATE: 'Сертификат',
  MAINTENANCE_LOG: 'Журнал ТО',
  OTHER: 'Прочее',
};

export interface DocumentRow {
  id: string;
  type: string;
  title: string;
  issuedAt: string | null;
  expiresAt: string | null;
  notes: string;
}

interface Props {
  equipmentId: string;
  documents: DocumentRow[];
  onChanged: () => void | Promise<void>;
}

interface FormState {
  type: DocumentTypeId;
  title: string;
  issuedAt: string;
  expiresAt: string;
  notes: string;
}

const EMPTY_FORM: FormState = {
  type: 'PASSPORT',
  title: '',
  issuedAt: '',
  expiresAt: '',
  notes: '',
};

const toInputDate = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');

export function EquipmentDocuments({ equipmentId, documents, onChanged }: Props) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<DocumentRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (doc: DocumentRow) => {
    setEditing(doc);
    setForm({
      type: (doc.type as DocumentTypeId) || 'OTHER',
      title: doc.title,
      issuedAt: toInputDate(doc.issuedAt),
      expiresAt: toInputDate(doc.expiresAt),
      notes: doc.notes,
    });
    setDialogOpen(true);
  };

  const submit = async () => {
    if (!form.title.trim()) {
      toast.error('Заполните название документа');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        type: form.type,
        title: form.title.trim(),
        issuedAt: form.issuedAt || null,
        expiresAt: form.expiresAt || null,
        notes: form.notes.trim(),
      };
      const url = editing
        ? `/api/equipment/${equipmentId}/documents/${editing.id}`
        : `/api/equipment/${equipmentId}/documents`;
      const res = await authFetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка сохранения');
      }
      toast.success(editing ? 'Документ обновлён' : 'Документ добавлен');
      setDialogOpen(false);
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (doc: DocumentRow) => {
    if (!confirm(`Удалить документ "${doc.title}"?`)) return;
    setDeletingId(doc.id);
    try {
      const res = await authFetch(`/api/equipment/${equipmentId}/documents/${doc.id}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Удаление не удалось');
      toast.success('Документ удалён');
      await onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          Паспорт, ОТС, страховка, акты ТО. Срок действия отслеживается отдельно
          и подсвечивается, если истекает.
        </p>
        <Button onClick={openCreate} size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
          <Plus className="w-3.5 h-3.5 mr-1" /> Добавить
        </Button>
      </div>

      {documents.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
          Документы не загружены.
        </p>
      ) : (
        <ul className="space-y-2">
          {documents.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="font-medium truncate">{d.title}</span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs text-slate-500">
                  <span className="font-medium text-slate-600">
                    {TYPE_LABEL[d.type as DocumentTypeId] ?? d.type}
                  </span>
                  {d.issuedAt && <span>выдан {formatRuDate(d.issuedAt.slice(0, 10))}</span>}
                  {d.expiresAt && <ExpiresIndicator iso={d.expiresAt} />}
                </div>
                {d.notes && <p className="text-xs text-slate-400 mt-0.5">{d.notes}</p>}
              </div>
              <div className="flex items-center gap-0.5 shrink-0">
                <button
                  onClick={() => openEdit(d)}
                  className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                  title="Редактировать"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => remove(d)}
                  disabled={deletingId === d.id}
                  className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors disabled:opacity-50"
                  title="Удалить"
                >
                  {deletingId === d.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактировать документ' : 'Новый документ'}</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div>
              <Label htmlFor="doc-type">Тип</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setForm((p) => ({ ...p, type: v as DocumentTypeId }))}
              >
                <SelectTrigger id="doc-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(TYPE_LABEL) as DocumentTypeId[]).map((k) => (
                    <SelectItem key={k} value={k}>{TYPE_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="doc-title">Название *</Label>
              <Input
                id="doc-title"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Напр. Полис ОСАГО АО Альфа №..."
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="doc-issued">Выдан</Label>
                <Input
                  id="doc-issued"
                  type="date"
                  value={form.issuedAt}
                  onChange={(e) => setForm((p) => ({ ...p, issuedAt: e.target.value }))}
                />
              </div>
              <div>
                <Label htmlFor="doc-expires">Действует до</Label>
                <Input
                  id="doc-expires"
                  type="date"
                  value={form.expiresAt}
                  onChange={(e) => setForm((p) => ({ ...p, expiresAt: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="doc-notes">Заметки</Label>
              <Textarea
                id="doc-notes"
                value={form.notes}
                onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button onClick={submit} disabled={busy} className="bg-orange-500 hover:bg-orange-600 text-white">
              {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ExpiresIndicator({ iso }: { iso: string }) {
  const d = new Date(iso);
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000);
  if (days < 0) return <span className={cn('rounded px-1.5 py-0.5 text-rose-700 bg-rose-100')}>Истёк {Math.abs(days)} дн. назад</span>;
  if (days <= 30) return <span className={cn('rounded px-1.5 py-0.5 text-amber-700 bg-amber-100')}>истекает через {days} дн.</span>;
  return <span>до {formatRuDate(iso.slice(0, 10))}</span>;
}

