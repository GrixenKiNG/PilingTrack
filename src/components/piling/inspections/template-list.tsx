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
import { QueryErrorBanner } from '@/components/piling/async-ui';
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';
import { cn } from '@/lib/utils';
import { LEVEL_LABEL, LEVEL_STYLE, type InspectionLevel } from './inspection-labels';
import { InspectionLoadError, isRetryableLoadError, loadErrorText, catchText } from './inspection-api-error';

interface TemplateRow {
  id: string;
  name: string;
  level: InspectionLevel;
  blockType?: string | null;
  appliesToModel: string | null;
  isActive: boolean;
  _count?: { sections?: number };
}

/**
 * Что произойдёт при деактивации — до нажатия, а не после.
 *
 * Голое «Деактивировать шаблон?» не объясняло последствий: снятие блока «База»
 * тихо ломает заводку новых осмотров этих машин («Нет блока «База»…» всплывало
 * уже у механика), а сам шаблон исчезает из сборки чек-листов (R123 №7).
 */
function deactivateDescription(target: TemplateRow, all: TemplateRow[]): string {
  const base = `Шаблон «${target.name}» будет снят с действия и перестанет попадать в новые осмотры. Уже заведённые осмотры сохранят свою версию.`;
  if ((target.blockType ?? 'BASE') !== 'BASE') return base;
  const siblings = all.filter((other) =>
    other.id !== target.id
    && (other.blockType ?? 'BASE') === 'BASE'
    && other.appliesToModel === target.appliesToModel);
  if (siblings.length > 0) return base;
  const subject = target.appliesToModel ? `модели «${target.appliesToModel}»` : 'общих блоков (модель не задана)';
  return `${base} Это последний действующий блок «База» для ${subject}: новые осмотры этих машин заводиться не будут.`;
}

export function TemplateList() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Подтверждение — проектный диалог: он объясняет последствие деактивации,
  // чего не делал браузерный confirm (R123 №7).
  const [pendingDelete, setPendingDelete] = useState<TemplateRow | null>(null);
  // Почему список пуст: отказ чтения вместо «шаблонов нет» (R100 №3).
  const [loadError, setLoadError] = useState<InspectionLoadError | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/checklist-templates');
      // 403 (у раскладки раздела право `inspection.perform`, у API —
      // `maintenance.manage`) раньше выглядел как «Шаблонов пока нет.».
      if (!res.ok) {
        setLoadError(new InspectionLoadError(res.status));
        setTemplates([]);
        return;
      }
      setTemplates(((await res.json()).templates ?? []) as TemplateRow[]);
      setLoadError(null);
    } catch {
      setLoadError(new InspectionLoadError(null));
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  const handleDelete = async (target: TemplateRow) => {
    setDeletingId(target.id);
    try {
      const res = await authFetch(`/api/checklist-templates/${target.id}`, { method: 'DELETE' });
      if (res.ok) {
        toast.success('Шаблон деактивирован');
        setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      } else if (res.status === 404) {
        // Шаблон уже снят (повторное нажатие, чужая правка): раньше тост был
        // общий «Не удалось…» и человек жал снова, не зная исхода (R123 №9).
        toast.error('Шаблон уже деактивирован или не найден — обновите список.');
        setTemplates((prev) => prev.filter((t) => t.id !== target.id));
      } else if (res.status === 403) {
        toast.error('Нет прав на деактивацию шаблона. Обратитесь к администратору.');
      } else {
        toast.error('Не удалось деактивировать шаблон');
      }
    } catch (err) {
      toast.error(catchText(err, 'Не удалось деактивировать шаблон'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 field-type">
      <div className="mb-4 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-foreground">Шаблоны чек-листов</h1>
        <Button asChild size="sm" className="bg-signal hover:bg-signal-strong text-white">
          <Link href="/admin/checklists/new">
            <Plus className="w-3.5 h-3.5 mr-1" /> Новый шаблон
          </Link>
        </Button>
      </div>

      {loading ? (
        <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">Загрузка…</p>
      ) : loadError ? (
        <QueryErrorBanner
          title="Не удалось загрузить шаблоны"
          message={loadErrorText(loadError, {
            forbidden: 'Нет прав на чек-листы. Обратитесь к администратору.',
            notFound: 'Шаблоны не найдены.',
            server: 'Не удалось загрузить шаблоны. Сервер вернул ошибку.',
          })}
          onRetry={isRetryableLoadError(loadError) ? () => void load() : undefined}
        />
      ) : templates.length === 0 ? (
        <p className="rounded-lg bg-muted px-3 py-6 text-center text-sm text-muted-foreground">
          Шаблонов пока нет.
        </p>
      ) : (
        <ul className="space-y-2">
          {templates.map((t) => (
            <li key={t.id}>
              <Link
                href={`/admin/checklists/${t.id}`}
                className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm transition-colors hover:border-signal/30 hover:bg-signal/10/30"
              >
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                  <ClipboardCheck className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 font-medium truncate">{t.name}</span>
                  <span className={cn('rounded px-1.5 py-0.5 text-2xs font-medium', LEVEL_STYLE[t.level])}>
                    {LEVEL_LABEL[t.level]}
                  </span>
                  {t.appliesToModel && (
                    <span className="text-xs text-muted-foreground truncate">{t.appliesToModel}</span>
                  )}
                </div>
                <button
                  type="button"
                  aria-label="Деактивировать"
                  disabled={deletingId === t.id}
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setPendingDelete(t); }}
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive-strong disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <ConfirmActionDialog
        open={Boolean(pendingDelete)}
        onOpenChange={(open) => { if (!open) setPendingDelete(null); }}
        title="Деактивировать шаблон?"
        description={pendingDelete ? deactivateDescription(pendingDelete, templates) : ''}
        confirmLabel="Деактивировать шаблон"
        busy={pendingDelete !== null && deletingId === pendingDelete.id}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await handleDelete(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
