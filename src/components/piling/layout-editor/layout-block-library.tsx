/**
 * Generic block library (shared editor engine): the surface supplies its
 * addable data blocks; the photo-upload affordance appears only when the
 * surface supports image blocks. Extracted from the monitoring equipment-tile
 * block library.
 */

import type { LayoutBlockKind } from './layout-template';

export interface LayoutDataBlockDef {
  key: string;
  label: string;
}

export function LayoutBlockLibrary({
  dataBlocks,
  onAdd,
  onUploadImage,
  uploadError,
}: {
  dataBlocks: readonly LayoutDataBlockDef[];
  onAdd: (kind: LayoutBlockKind, dataKey?: string) => void;
  onUploadImage?: (file: File) => Promise<void>;
  uploadError?: string | null;
}) {
  const buttonClass = 'min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium text-slate-700 hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';
  return (
    <section aria-label="Библиотека блоков" className="space-y-2">
      <h3 className="text-sm font-semibold text-slate-900">Добавить блок</h3>
      <button type="button" className={buttonClass} onClick={() => onAdd('text')}>Добавить текст</button>
      <button type="button" className={buttonClass} onClick={() => onAdd('divider')}>Добавить разделитель</button>
      {onUploadImage && (
        <label className={`${buttonClass} block cursor-pointer`}>
          Добавить фото
          <input
            aria-label="Загрузить фото"
            className="sr-only"
            type="file"
            accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onUploadImage(file);
              event.target.value = '';
            }}
          />
        </label>
      )}
      {uploadError && <p role="alert" className="text-xs font-medium text-red-700">{uploadError}</p>}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
        {dataBlocks.map((item) => (
          <button key={item.key} type="button" className={buttonClass} onClick={() => onAdd('data', item.key)}>
            {item.label}
          </button>
        ))}
      </div>
    </section>
  );
}
