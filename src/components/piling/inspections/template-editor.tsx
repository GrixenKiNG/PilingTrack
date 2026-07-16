'use client';

/**
 * TemplateEditor — создание и редактирование шаблона чек-листа.
 *
 * templateId === 'new'  → режим создания (POST /api/checklist-templates)
 * templateId === <uuid> → режим редактирования (GET /api/checklist-templates/[id], затем PUT)
 *
 * После сохранения — toast + navigate /admin/checklists.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LEVEL_LABEL, type InspectionLevel } from './inspection-labels';
import {
  BLOCK_LABEL, HAMMER_LABEL, SectionEditor, emptySection, uid,
  type AnswerType, type BlockType, type HammerKind, type SectionDraft,
} from './template-editor-parts';

// ─── Main component ───────────────────────────────────────────────────────────

interface TemplateEditorProps {
  templateId: string; // 'new' or uuid
}

export function TemplateEditor({ templateId }: TemplateEditorProps) {
  const router = useRouter();
  const isNew = templateId === 'new';

  const [name, setName] = useState('');
  const [level, setLevel] = useState<InspectionLevel>('EO');
  const [blockType, setBlockType] = useState<BlockType>('BASE');
  const [appliesToModel, setAppliesToModel] = useState('');
  const [appliesToHammerKind, setAppliesToHammerKind] = useState<Exclude<HammerKind, 'NONE'>>('HYDRAULIC');
  const [sections, setSections] = useState<SectionDraft[]>([emptySection()]);
  const [loading, setLoading] = useState(!isNew);
  const [busy, setBusy] = useState(false);

  // Load existing template
  const loadTemplate = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`/api/checklist-templates/${templateId}`);
      if (!res.ok) throw new Error();
      const { template } = await res.json();
      setName(template.name ?? '');
      setLevel(template.level as InspectionLevel);
      setBlockType((template.blockType ?? 'BASE') as BlockType);
      setAppliesToModel(template.appliesToModel ?? '');
      if (template.appliesToHammerKind && template.appliesToHammerKind !== 'NONE') {
        setAppliesToHammerKind(template.appliesToHammerKind as Exclude<HammerKind, 'NONE'>);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setSections((template.sections ?? []).map((s: any) => ({
        _key: uid(),
        title: s.title ?? '',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        items: (s.items ?? []).map((it: any) => ({
          _key: uid(),
          text: it.text ?? '',
          answerType: (it.answerType ?? 'YES_NO') as AnswerType,
          unit: it.unit ?? '',
          norm: it.norm ?? '',
          provenance: it.provenance ?? '',
          photoRequired: it.photoRequired ?? false,
          required: it.required ?? true,
        })),
      })));
    } catch {
      toast.error('Не удалось загрузить шаблон');
    } finally {
      setLoading(false);
    }
  }, [templateId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
    if (!isNew) void loadTemplate();
  }, [isNew, loadTemplate]);

  // Section helpers
  const updateSection = (i: number, patch: Partial<SectionDraft>) => {
    setSections((prev) => prev.map((s, idx) => idx === i ? { ...s, ...patch } : s));
  };
  const removeSection = (i: number) => setSections((prev) => prev.filter((_, idx) => idx !== i));
  const moveSection = (i: number, dir: -1 | 1) => {
    setSections((prev) => {
      const next = [...prev];
      const j = i + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };
  const addSection = () => setSections((prev) => [...prev, emptySection()]);

  // Submit
  const submit = async () => {
    if (!name.trim()) { toast.error('Введите название шаблона'); return; }
    for (const s of sections) {
      if (!s.title.trim()) { toast.error('Заполните заголовок каждого раздела'); return; }
      for (const it of s.items) {
        if (!it.text.trim()) { toast.error('Заполните текст каждого пункта'); return; }
      }
    }

    const payload = {
      name: name.trim(),
      level,
      blockType,
      appliesToModel: blockType === 'BASE' ? (appliesToModel.trim() || null) : null,
      appliesToHammerKind: blockType === 'HAMMER' ? appliesToHammerKind : null,
      sections: sections.map((s, si) => ({
        title: s.title.trim(),
        order: si,
        items: s.items.map((it, ii) => ({
          text: it.text.trim(),
          answerType: it.answerType,
          unit: it.unit.trim() || null,
          norm: it.norm.trim() || null,
          provenance: it.provenance.trim() || null,
          photoRequired: it.photoRequired,
          required: it.required,
          order: ii,
        })),
      })),
    };

    setBusy(true);
    try {
      const url = isNew ? '/api/checklist-templates' : `/api/checklist-templates/${templateId}`;
      const method = isNew ? 'POST' : 'PUT';
      const res = await authFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error || 'Ошибка сохранения');
      }
      toast.success(isNew ? 'Шаблон создан' : 'Шаблон обновлён');
      router.push('/admin/checklists');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-6">
        <p className="rounded-lg bg-slate-50 px-3 py-8 text-center text-sm text-slate-400">Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 space-y-6">
      {/* Heading */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold text-slate-800">
          {isNew ? 'Новый шаблон' : 'Редактировать шаблон'}
        </h1>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/admin/checklists')}
          disabled={busy}
        >
          Отмена
        </Button>
      </div>

      {/* General fields */}
      <div className="rounded-lg border bg-white p-4 space-y-3">
        <h2 className="text-sm font-medium text-slate-700">Основные параметры</h2>

        <div>
          <Label htmlFor="tpl-name">Название *</Label>
          <Input
            id="tpl-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Напр. ЕО — экскаватор-сваевдавливатель"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="tpl-level">Вид ТО *</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as InspectionLevel)}>
              <SelectTrigger id="tpl-level"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(LEVEL_LABEL) as InspectionLevel[]).map((k) => (
                  <SelectItem key={k} value={k}>{LEVEL_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="tpl-block">Тип блока *</Label>
            <Select value={blockType} onValueChange={(v) => setBlockType(v as BlockType)}>
              <SelectTrigger id="tpl-block"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(BLOCK_LABEL) as BlockType[]).map((k) => (
                  <SelectItem key={k} value={k}>{BLOCK_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Matcher depends on the block kind */}
        {blockType === 'BASE' && (
          <div>
            <Label htmlFor="tpl-model">Применимость (марка/модель)</Label>
            <Input
              id="tpl-model"
              value={appliesToModel}
              onChange={(e) => setAppliesToModel(e.target.value)}
              placeholder="Banut 655 (пусто = общий блок для всех)"
            />
          </div>
        )}
        {blockType === 'HAMMER' && (
          <div>
            <Label htmlFor="tpl-hammer">Тип молота *</Label>
            <Select value={appliesToHammerKind} onValueChange={(v) => setAppliesToHammerKind(v as Exclude<HammerKind, 'NONE'>)}>
              <SelectTrigger id="tpl-hammer"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(HAMMER_LABEL) as Exclude<HammerKind, 'NONE'>[]).map((k) => (
                  <SelectItem key={k} value={k}>{HAMMER_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {blockType === 'ROTARY' && (
          <p className="text-xs text-slate-500">Блок вращателя подбирается для комбинированных установок автоматически.</p>
        )}
      </div>

      {/* Sections */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-slate-700">
          Разделы ({sections.length})
        </h2>
        {sections.map((s, i) => (
          <SectionEditor
            key={s._key}
            section={s}
            index={i}
            total={sections.length}
            onChange={(patch) => updateSection(i, patch)}
            onRemove={() => removeSection(i)}
            onMoveUp={() => moveSection(i, -1)}
            onMoveDown={() => moveSection(i, 1)}
          />
        ))}

        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addSection}
          className={cn('border-dashed w-full text-slate-500')}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> Добавить раздел
        </Button>
      </div>

      {/* Save */}
      <div className="flex justify-end gap-2 pb-8">
        <Button
          variant="outline"
          onClick={() => router.push('/admin/checklists')}
          disabled={busy}
        >
          Отмена
        </Button>
        <Button
          onClick={() => void submit()}
          disabled={busy}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
          {isNew ? 'Создать шаблон' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}
