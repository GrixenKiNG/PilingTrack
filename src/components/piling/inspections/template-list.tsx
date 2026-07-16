'use client';

/**
 * TemplateList — список шаблонов чек-листов (/admin/checklists).
 *
 * Загружает GET /api/checklist-templates.
 * «Новый шаблон» → /admin/checklists/new.
 * Клик по строке → /admin/checklists/[id].
 * Иконка корзины деактивирует шаблон (DELETE).
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, ClipboardCheck } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { LEVEL_LABEL, LEVEL_STYLE, type InspectionLevel } from './inspection-labels';

interface TemplateRow {
  id: string;
  name: string;
  level: InspectionLevel;
  appliesToModel: string | null;
  isActive: boolean;
  _count?: { sections?: number };
}

export function TemplateList() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/checklist-templates');
      if (!res.ok) throw new Error();
      setTemplates(((await res.json()).templates ?? []) as TemplateRow[]);
    } catch {
      toast.error('Не удалось загрузить шаблоны');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm('Деактивировать шаблон?')) return;
    setDeletingId(id);
    try {
      const res = await authFetch(`/api/checklist-templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success('Шаблон деактивирован');
      setTemplates((prev) => prev.filter((t) => t.id !== id));
    } catch {
      toast.error('Не удалось деактивировать шаблон');
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-800">Шаблоны чек-листов</h1>
        <Button asChild size="sm" className="bg-orange-500 hover:bg-orange-600 text-white">
          <Link href="/admin/checklists/new">
            <Plus className="w-3.5 h-3.5 mr-1" /> Новый шаблон
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">Загрузка…</p>
      ) : templates.length === 0 ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-500">
          Шаблонов пока нет.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/checklists/${t.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors hover:border-orange-300 hover:bg-orange-50/30"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <ClipboardCheck className="w-3.5 h-3.5 shrink-0 text-slate-400" />
                  <span className="min-w-0 font-medium truncate">{t.name}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', LEVEL_STYLE[t.level])}>
                    {LEVEL_LABEL[t.level]}
                  </span>
                  {t.appliesToModel && (
                    <span className="text-xs text-slate-500 truncate">{t.appliesToModel}</span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Деактивировать"
                  disabled={deletingId === t.id}
                  onClick={(e) => void handleDelete(e, t.id)}
                  className="shrink-0 rounded p-1 text-slate-400 hover:text-red-500 disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
