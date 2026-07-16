/**
 * Generic block/card property inspector (shared editor engine). Image tools
 * (replace photo) appear only for surfaces that provide them. Extracted from
 * the monitoring equipment-tile inspector.
 */

import type { LayoutBlock, LayoutTemplate } from './layout-template';

const inputClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20';

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1 text-xs font-medium text-slate-600">
      <span>{label}</span>
      <input className={inputClass} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

export interface LayoutInspectorImageTools {
  subjectName: string;
  onReplaceImage: (file: File) => Promise<void>;
  error: string | null;
}

export function LayoutInspector({
  block,
  card,
  onChange,
  onCardChange,
  onDelete,
  imageTools,
}: {
  block: LayoutBlock | null;
  card: LayoutTemplate['card'];
  onChange: (patch: Partial<LayoutBlock>) => void;
  onCardChange: (patch: Partial<LayoutTemplate['card']>) => void;
  onDelete: () => void;
  imageTools?: LayoutInspectorImageTools;
}) {
  if (!block) {
    return (
      <section aria-label="Свойства плитки" className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900">Размер плитки</h3>
        <NumberField label="Ширина плитки" value={card.width} min={200} max={1200} onChange={(width) => onCardChange({ width })} />
        <NumberField label="Минимальная высота" value={card.minHeight} min={240} max={2400} onChange={(minHeight) => onCardChange({ minHeight })} />
        <NumberField label="Высота строки сетки" value={card.rowHeight} min={12} max={96} onChange={(rowHeight) => onCardChange({ rowHeight })} />
      </section>
    );
  }

  const changeStyle = (patch: Partial<LayoutBlock['style']>) => onChange({ style: { ...block.style, ...patch } });
  return (
    <section aria-label="Свойства блока" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-slate-900">Блок: {block.id}</h3>
        <button type="button" className="min-h-11 rounded-lg border border-red-200 px-3 text-xs font-semibold text-red-700 hover:bg-red-50" onClick={onDelete}>Удалить</button>
      </div>
      {block.kind === 'text' && (
        <label className="space-y-1 text-xs font-medium text-slate-600">
          <span>Текст блока</span>
          <textarea className={`${inputClass} min-h-24 py-2`} value={block.text ?? ''} onChange={(event) => onChange({ text: event.target.value })} />
        </label>
      )}
      {block.kind === 'image' && (
        <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
          {imageTools && <p className="text-xs font-semibold text-slate-700">Фото: {imageTools.subjectName}</p>}
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Альтернативный текст</span>
            <input className={inputClass} value={block.alt ?? ''} onChange={(event) => onChange({ alt: event.target.value })} />
          </label>
          <label className="space-y-1 text-xs font-medium text-slate-600">
            <span>Режим изображения</span>
            <select className={inputClass} value={block.imageFit ?? 'contain'} onChange={(event) => onChange({ imageFit: event.target.value as 'contain' | 'cover' })}>
              <option value="contain">Вписать</option><option value="cover">Заполнить</option>
            </select>
          </label>
          {imageTools && (
            <label className="block min-h-11 cursor-pointer rounded-lg border border-slate-200 px-3 py-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Заменить фото
              <input
                aria-label="Заменить фото"
                className="sr-only"
                type="file"
                accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void imageTools.onReplaceImage(file);
                  event.target.value = '';
                }}
              />
            </label>
          )}
          {imageTools?.error && <p role="alert" className="text-xs font-medium text-red-700">{imageTools.error}</p>}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Колонка" value={block.x + 1} min={1} max={12} onChange={(value) => onChange({ x: value - 1 })} />
        <NumberField label="Строка" value={block.y + 1} min={1} max={1000} onChange={(value) => onChange({ y: value - 1 })} />
        <NumberField label="Ширина блока" value={block.width} min={1} max={12} onChange={(width) => onChange({ width })} />
        <NumberField label="Высота блока" value={block.height} min={1} max={100} onChange={(height) => onChange({ height })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Размер шрифта" value={block.style.fontSize} min={8} max={96} onChange={(fontSize) => changeStyle({ fontSize })} />
        <NumberField label="Толщина границы" value={block.style.borderWidth} min={0} max={12} onChange={(borderWidth) => changeStyle({ borderWidth })} />
        <NumberField label="Скругление" value={block.style.borderRadius} min={0} max={64} onChange={(borderRadius) => changeStyle({ borderRadius })} />
        <NumberField label="Внутренний отступ" value={block.style.padding} min={0} max={64} onChange={(padding) => changeStyle({ padding })} />
      </div>
      <label className="space-y-1 text-xs font-medium text-slate-600">
        <span>Выравнивание текста</span>
        <select className={inputClass} value={block.style.textAlign} onChange={(event) => changeStyle({ textAlign: event.target.value as LayoutBlock['style']['textAlign'] })}>
          <option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option>
        </select>
      </label>
      <label className="space-y-1 text-xs font-medium text-slate-600">
        <span>Начертание</span>
        <select className={inputClass} value={block.style.fontWeight} onChange={(event) => changeStyle({ fontWeight: Number(event.target.value) as LayoutBlock['style']['fontWeight'] })}>
          <option value="400">Обычное</option><option value="500">Среднее</option><option value="600">Полужирное</option><option value="700">Жирное</option>
        </select>
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs font-medium text-slate-600"><span>Цвет текста</span><input aria-label="Цвет текста" className={`${inputClass} p-1`} type="color" value={block.style.color} onChange={(event) => changeStyle({ color: event.target.value })} /></label>
        <label className="space-y-1 text-xs font-medium text-slate-600"><span>Цвет фона</span><input aria-label="Цвет фона" className={`${inputClass} p-1`} type="color" value={block.style.background} onChange={(event) => changeStyle({ background: event.target.value })} /></label>
        <label className="space-y-1 text-xs font-medium text-slate-600"><span>Цвет границы</span><input aria-label="Цвет границы" className={`${inputClass} p-1`} type="color" value={block.style.borderColor} onChange={(event) => changeStyle({ borderColor: event.target.value })} /></label>
      </div>
    </section>
  );
}
