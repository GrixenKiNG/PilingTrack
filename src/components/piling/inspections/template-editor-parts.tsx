'use client';

/**
 * Черновые типы и под-компоненты редактора шаблонов чек-листов.
 * Вынесены из template-editor.tsx, чтобы держать основной файл < 500 строк.
 * Чистый перенос: разметка и поведение не менялись.
 */

import { Plus, Trash2, ChevronUp, ChevronDown } from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

// ─── Types ────────────────────────────────────────────────────────────────────

export type AnswerType = 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';
export type BlockType = 'BASE' | 'HAMMER' | 'ROTARY';
export type HammerKind = 'HYDRAULIC' | 'DIESEL' | 'NONE';

const ANSWER_LABEL: Record<AnswerType, string> = {
  YES_NO: 'Да / Нет',
  STATUS4: '4 статуса',
  DONE: 'Выполнено',
  MEASURE: 'Замер',
};

export const BLOCK_LABEL: Record<BlockType, string> = {
  BASE: 'База (по марке/модели)',
  HAMMER: 'Молот (по типу молота)',
  ROTARY: 'Вращатель',
};

export const HAMMER_LABEL: Record<Exclude<HammerKind, 'NONE'>, string> = {
  HYDRAULIC: 'Гидравлический',
  DIESEL: 'Дизельный',
};

export interface ItemDraft {
  _key: string;
  text: string;
  answerType: AnswerType;
  unit: string;
  norm: string;
  provenance: string;
  photoRequired: boolean;
  required: boolean;
}

export interface SectionDraft {
  _key: string;
  title: string;
  items: ItemDraft[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _seq = 0;
export const uid = () => `k${++_seq}`;

export const emptyItem = (): ItemDraft => ({
  _key: uid(),
  text: '',
  answerType: 'YES_NO',
  unit: '',
  norm: '',
  provenance: '',
  photoRequired: false,
  required: true,
});

export const emptySection = (): SectionDraft => ({
  _key: uid(),
  title: '',
  items: [emptyItem()],
});

// ─── Sub-components ───────────────────────────────────────────────────────────

interface ItemRowProps {
  item: ItemDraft;
  onChange: (patch: Partial<ItemDraft>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ItemRow({ item, onChange, onRemove, canRemove }: ItemRowProps) {
  return (
    <div className="rounded-md border bg-slate-50 p-3 space-y-2">
      <div className="flex gap-2">
        <div className="flex-1">
          <Label className="text-xs text-slate-500">Текст пункта *</Label>
          <Textarea
            rows={2}
            value={item.text}
            onChange={(e) => onChange({ text: e.target.value })}
            placeholder="Проверить уровень масла…"
            className="text-sm"
          />
        </div>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="shrink-0 self-start mt-5 rounded p-1 text-slate-400 hover:text-red-500"
            aria-label="Удалить пункт"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div>
          <Label className="text-xs text-slate-500">Тип ответа</Label>
          <Select value={item.answerType} onValueChange={(v) => onChange({ answerType: v as AnswerType })}>
            <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(ANSWER_LABEL) as AnswerType[]).map((k) => (
                <SelectItem key={k} value={k}>{ANSWER_LABEL[k]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-xs text-slate-500">Ед. изм.</Label>
          <Input
            value={item.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
            placeholder="мм, л, кПа…"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Норма</Label>
          <Input
            value={item.norm}
            onChange={(e) => onChange({ norm: e.target.value })}
            placeholder="≥ 0.5"
            className="h-8 text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-slate-500">Источник</Label>
          <Input
            value={item.provenance}
            onChange={(e) => onChange({ provenance: e.target.value })}
            placeholder="ГОСТ…"
            className="h-8 text-sm"
          />
        </div>
      </div>

      <div className="flex gap-4">
        <label className="flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <input
            type="checkbox"
            checked={item.required}
            onChange={(e) => onChange({ required: e.target.checked })}
            className="rounded"
          />
          Обязательный
        </label>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs select-none">
          <input
            type="checkbox"
            checked={item.photoRequired}
            onChange={(e) => onChange({ photoRequired: e.target.checked })}
            className="rounded"
          />
          Требуется фото
        </label>
      </div>
    </div>
  );
}

interface SectionEditorProps {
  section: SectionDraft;
  index: number;
  total: number;
  onChange: (patch: Partial<SectionDraft>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}

export function SectionEditor({
  section, index, total, onChange, onRemove, onMoveUp, onMoveDown,
}: SectionEditorProps) {
  const updateItem = (i: number, patch: Partial<ItemDraft>) => {
    const items = section.items.map((it, idx) => idx === i ? { ...it, ...patch } : it);
    onChange({ items });
  };
  const removeItem = (i: number) => {
    onChange({ items: section.items.filter((_, idx) => idx !== i) });
  };
  const addItem = () => {
    onChange({ items: [...section.items, emptyItem()] });
  };

  return (
    <div className="rounded-lg border bg-white p-4 space-y-3">
      {/* Section header */}
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <Label className="text-xs text-slate-500">Раздел {index + 1} — заголовок *</Label>
          <Input
            value={section.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Напр. Двигатель"
            className="text-sm"
          />
        </div>
        <div className="flex shrink-0 items-center gap-1 mt-5">
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            aria-label="Переместить вверх"
          >
            <ChevronUp className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            className="rounded p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30"
            aria-label="Переместить вниз"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onRemove}
            disabled={total === 1}
            className="rounded p-1 text-slate-400 hover:text-red-500 disabled:opacity-30"
            aria-label="Удалить раздел"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Items */}
      <div className="space-y-2 pl-2 border-l-2 border-slate-100">
        {section.items.map((item, i) => (
          <ItemRow
            key={item._key}
            item={item}
            onChange={(patch) => updateItem(i, patch)}
            onRemove={() => removeItem(i)}
            canRemove={section.items.length > 1}
          />
        ))}
      </div>

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addItem}
        className="text-xs"
      >
        <Plus className="w-3 h-3 mr-1" /> Добавить пункт
      </Button>
    </div>
  );
}
