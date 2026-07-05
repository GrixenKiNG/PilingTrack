'use client';

import { useState } from 'react';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentTileBlockLibrary } from './equipment-tile-block-library';
import { EquipmentTileCanvas } from './equipment-tile-canvas';
import { EquipmentTileInspector } from './equipment-tile-inspector';
import type { EquipmentTileBlockKind, EquipmentTileDataKey } from './equipment-tile-template';
import type { EquipmentTileTemplateController } from './use-equipment-tile-template';

const toolbarButton = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export function EquipmentTileEditor({ cards, controller }: { cards: FleetCard[]; controller: EquipmentTileTemplateController }) {
  const [selectedCardId, setSelectedCardId] = useState(() => cards[0]?.id ?? '');
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'library' | 'inspector' | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const selectedCard = cards.find((card) => card.id === selectedCardId) ?? cards[0] ?? null;
  const selectedBlock = controller.draft.blocks.find((block) => block.id === selectedBlockId) ?? null;

  if (!selectedCard) return null;
  if (!controller.unlocked) return null;
  if (!controller.editing) {
    return (
      <button type="button" className="fixed bottom-4 right-4 z-40 min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={controller.startEditing}>
        Редактировать шаблон
      </button>
    );
  }

  const addBlock = (kind: EquipmentTileBlockKind, dataKey?: EquipmentTileDataKey) => {
    const block = controller.addBlock(kind, dataKey);
    setSelectedBlockId(block.id);
    setMobilePanel('inspector');
  };

  const uploadImage = async (file: File) => {
    setImageError(null);
    try {
      const block = await controller.addImage(file, selectedCard.id);
      setSelectedBlockId(block.id);
      setMobilePanel('inspector');
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Не удалось сохранить изображение');
    }
  };

  const replaceImage = async (file: File) => {
    if (!selectedBlockId) return;
    setImageError(null);
    try {
      await controller.replaceImage(selectedBlockId, file, selectedCard.id);
    } catch (error) {
      setImageError(error instanceof Error ? error.message : 'Не удалось заменить изображение');
    }
  };

  const closeEditor = () => {
    if (!controller.dirty || window.confirm('Отменить несохранённые изменения?')) controller.cancelEditing();
  };

  const updateSelectedBlock = (patch: Parameters<typeof controller.updateBlock>[1]) => {
    if (!selectedBlock) return;
    if (patch.x != null || patch.y != null) {
      controller.moveBlock(selectedBlock.id, patch.x ?? selectedBlock.x, patch.y ?? selectedBlock.y);
      return;
    }
    if (patch.width != null || patch.height != null) {
      controller.resizeBlock(selectedBlock.id, patch.width ?? selectedBlock.width, patch.height ?? selectedBlock.height);
      return;
    }
    controller.updateBlock(selectedBlock.id, patch);
  };

  const deleteSelectedBlock = () => {
    if (!selectedBlock) return;
    if (selectedBlock.kind === 'data' && !window.confirm('Удалить блок данных из шаблона? Его можно вернуть из библиотеки.')) return;
    controller.removeBlock(selectedBlock.id);
    setSelectedBlockId(null);
  };

  return (
    <div className="fixed inset-0 z-50 flex min-h-0 flex-col bg-slate-100 text-slate-950" role="dialog" aria-label="Редактор шаблона плитки">
      <header className="relative z-40 flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white p-3 shadow-sm">
        <strong className="mr-auto text-sm">Редактор плитки установки</strong>
        <label className="flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-medium text-slate-600">
          <span className="hidden sm:inline">Установка для фото</span>
          <select
            aria-label="Установка для фото"
            className="max-w-48 bg-transparent font-semibold text-slate-900 focus:outline-none"
            value={selectedCard.id}
            onChange={(event) => { setSelectedCardId(event.target.value); setImageError(null); }}
          >
            {cards.map((card) => <option key={card.id} value={card.id}>{card.name}</option>)}
          </select>
        </label>
        <button type="button" className={toolbarButton} disabled={!controller.canUndo} onClick={controller.undo}>Отменить</button>
        <button type="button" className={toolbarButton} disabled={!controller.canRedo} onClick={controller.redo}>Повторить</button>
        <button type="button" className={toolbarButton} aria-pressed={preview} onClick={() => setPreview((value) => !value)}>Предпросмотр</button>
        <button type="button" className={toolbarButton} onClick={() => { controller.reset(); setSelectedBlockId(null); }}>Сбросить</button>
        <button type="button" className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={controller.saveDraft}>Сохранить</button>
        {!preview && <button type="button" className={`${toolbarButton} lg:hidden`} onClick={() => setMobilePanel('library')}>Блоки</button>}
        {!preview && <button type="button" className={`${toolbarButton} lg:hidden`} onClick={() => setMobilePanel('inspector')}>Свойства</button>}
        <button type="button" className={toolbarButton} onClick={closeEditor}>Закрыть</button>
      </header>
      <div className={`relative grid min-h-0 flex-1 ${preview ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[240px_minmax(320px,1fr)_300px]'}`}>
        {!preview && (
          <aside className={`${mobilePanel === 'library' ? 'absolute inset-y-0 left-0 z-30 block w-[min(90vw,320px)] shadow-2xl' : 'hidden'} overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 lg:static lg:block lg:w-auto lg:shadow-none`}>
            <button type="button" className={`${toolbarButton} mb-3 w-full lg:hidden`} onClick={() => setMobilePanel(null)}>Закрыть панель</button>
            <EquipmentTileBlockLibrary onAdd={addBlock} onUploadImage={uploadImage} uploadError={imageError} />
          </aside>
        )}
        <main className="overflow-auto p-4 sm:p-8">
          <EquipmentTileCanvas
            card={selectedCard}
            template={controller.draft}
            selectedBlockId={selectedBlockId}
            preview={preview}
            assetStorage={controller.assetStorage}
            onSelectBlock={setSelectedBlockId}
            onMoveBlock={controller.moveBlock}
            onResizeBlock={controller.resizeBlock}
          />
        </main>
        {!preview && (
          <aside className={`${mobilePanel === 'inspector' ? 'absolute inset-y-0 right-0 z-30 block w-[min(90vw,340px)] shadow-2xl' : 'hidden'} overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 lg:static lg:block lg:w-auto lg:shadow-none`}>
            <button type="button" className={`${toolbarButton} mb-3 w-full lg:hidden`} onClick={() => setMobilePanel(null)}>Закрыть панель</button>
            <EquipmentTileInspector
              block={selectedBlock}
              card={controller.draft.card}
              onChange={updateSelectedBlock}
              onCardChange={controller.updateCard}
              onDelete={deleteSelectedBlock}
              onReplaceImage={replaceImage}
              equipmentName={selectedCard.name}
              imageError={imageError}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
