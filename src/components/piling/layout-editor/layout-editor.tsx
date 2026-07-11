'use client';

/**
 * Generic full-screen layout editor (shared editor engine): toolbar with
 * undo/redo/preview/reset/save, block library (left), canvas (center),
 * inspector (right), mobile slide-in panels. Surface specifics — block
 * content rendering, addable data blocks, optional image upload — come in as
 * props. Extracted from the monitoring equipment-tile editor.
 */

import { useEffect, useRef, useState } from 'react';
import { LayoutBlockLibrary, type LayoutDataBlockDef } from './layout-block-library';
import { LayoutCanvas } from './layout-canvas';
import { LayoutInspector } from './layout-inspector';
import type { RenderBlockContent } from './layout-renderer';
import type { LayoutBlock, LayoutBlockKind } from './layout-template';
import type { LayoutController } from './use-layout-template';

const toolbarButton = 'min-h-11 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500';

export interface LayoutEditorImageSupport {
  /** Shown in the inspector next to the photo tools. */
  subjectName: string;
  /** Extra toolbar control (e.g. subject selector for photo uploads). */
  headerControl?: React.ReactNode;
  /** Uploads the file and returns the created image block. Throws on failure. */
  uploadImage: (file: File) => Promise<LayoutBlock>;
  replaceImage: (blockId: string, file: File) => Promise<void>;
}

export function LayoutEditor({
  title,
  controller,
  renderBlockContent,
  dataBlocks,
  visible,
  imageSupport,
  headerControl,
  autoOpen = false,
  onClose,
}: {
  title: string;
  controller: LayoutController;
  renderBlockContent: RenderBlockContent;
  dataBlocks: readonly LayoutDataBlockDef[];
  /** Caller-side gate (role/unlock). When false the editor renders nothing. */
  visible: boolean;
  imageSupport?: LayoutEditorImageSupport;
  /** Extra toolbar control (e.g. a scope switcher), independent of imageSupport. */
  headerControl?: React.ReactNode;
  /** Open the editor immediately on mount (parent-driven modal flow). */
  autoOpen?: boolean;
  /** Fired when the editor closes (after save or cancel) in autoOpen mode. */
  onClose?: () => void;
}) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<'library' | 'inspector' | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const selectedBlock = controller.draft.blocks.find((block) => block.id === selectedBlockId) ?? null;

  const openedRef = useRef(false);
  useEffect(() => {
    if (autoOpen && !openedRef.current) {
      openedRef.current = true;
      controller.startEditing();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once on mount in modal mode
  }, [autoOpen]);
  // Fire onClose only after the editor has actually been open (editing true),
  // so the initial pre-open render doesn't immediately close it.
  const wasEditingRef = useRef(false);
  useEffect(() => {
    if (controller.editing) {
      wasEditingRef.current = true;
      return;
    }
    if (wasEditingRef.current && onClose) onClose();
  }, [controller.editing, onClose]);

  if (!visible) return null;
  if (!controller.editing) {
    // In modal mode the parent controls mounting; don't show the floating entry.
    if (autoOpen) return null;
    return (
      <button type="button" className="fixed bottom-4 right-4 z-40 min-h-11 rounded-xl bg-slate-950 px-4 text-sm font-semibold text-white shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={controller.startEditing}>
        Редактировать шаблон
      </button>
    );
  }

  const addBlock = (kind: LayoutBlockKind, dataKey?: string) => {
    const block = controller.addBlock(kind, dataKey);
    setSelectedBlockId(block.id);
    setMobilePanel('inspector');
  };

  const uploadImage = imageSupport
    ? async (file: File) => {
        setImageError(null);
        try {
          const block = await imageSupport.uploadImage(file);
          setSelectedBlockId(block.id);
          setMobilePanel('inspector');
        } catch (error) {
          setImageError(error instanceof Error ? error.message : 'Не удалось сохранить изображение');
        }
      }
    : undefined;

  const replaceImage = imageSupport
    ? async (file: File) => {
        if (!selectedBlockId) return;
        setImageError(null);
        try {
          await imageSupport.replaceImage(selectedBlockId, file);
        } catch (error) {
          setImageError(error instanceof Error ? error.message : 'Не удалось заменить изображение');
        }
      }
    : undefined;

  const closeEditor = () => {
    if (!controller.dirty || window.confirm('Отменить несохранённые изменения?')) controller.cancelEditing();
  };

  const updateSelectedBlock = (patch: Partial<LayoutBlock>) => {
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
        <strong className="mr-auto text-sm">{title}</strong>
        {headerControl}
        {imageSupport?.headerControl}
        <button type="button" className={toolbarButton} disabled={!controller.canUndo} onClick={controller.undo}>Отменить</button>
        <button type="button" className={toolbarButton} disabled={!controller.canRedo} onClick={controller.redo}>Повторить</button>
        <button type="button" className={toolbarButton} aria-pressed={preview} onClick={() => setPreview((value) => !value)}>Предпросмотр</button>
        <button type="button" className={toolbarButton} onClick={() => { void controller.reset(); setSelectedBlockId(null); }}>Сбросить</button>
        <button type="button" className="min-h-11 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500" onClick={() => void controller.saveDraft()}>Сохранить</button>
        {!preview && <button type="button" className={`${toolbarButton} lg:hidden`} onClick={() => setMobilePanel('library')}>Блоки</button>}
        {!preview && <button type="button" className={`${toolbarButton} lg:hidden`} onClick={() => setMobilePanel('inspector')}>Свойства</button>}
        <button type="button" className={toolbarButton} onClick={closeEditor}>Закрыть</button>
      </header>
      <div className={`relative grid min-h-0 flex-1 ${preview ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-[240px_minmax(320px,1fr)_300px]'}`}>
        {!preview && (
          <aside className={`${mobilePanel === 'library' ? 'absolute inset-y-0 left-0 z-30 block w-[min(90vw,320px)] shadow-2xl' : 'hidden'} overflow-y-auto border-r border-slate-200 bg-slate-50 p-4 lg:static lg:block lg:w-auto lg:shadow-none`}>
            <button type="button" className={`${toolbarButton} mb-3 w-full lg:hidden`} onClick={() => setMobilePanel(null)}>Закрыть панель</button>
            <LayoutBlockLibrary dataBlocks={dataBlocks} onAdd={addBlock} onUploadImage={uploadImage} uploadError={imageError} />
          </aside>
        )}
        <main className="overflow-auto p-4 sm:p-8">
          <LayoutCanvas
            template={controller.draft}
            renderBlockContent={renderBlockContent}
            selectedBlockId={selectedBlockId}
            preview={preview}
            onSelectBlock={setSelectedBlockId}
            onMoveBlock={controller.moveBlock}
            onResizeBlock={controller.resizeBlock}
          />
        </main>
        {!preview && (
          <aside className={`${mobilePanel === 'inspector' ? 'absolute inset-y-0 right-0 z-30 block w-[min(90vw,340px)] shadow-2xl' : 'hidden'} overflow-y-auto border-l border-slate-200 bg-slate-50 p-4 lg:static lg:block lg:w-auto lg:shadow-none`}>
            <button type="button" className={`${toolbarButton} mb-3 w-full lg:hidden`} onClick={() => setMobilePanel(null)}>Закрыть панель</button>
            <LayoutInspector
              block={selectedBlock}
              card={controller.draft.card}
              onChange={updateSelectedBlock}
              onCardChange={controller.updateCard}
              onDelete={deleteSelectedBlock}
              imageTools={imageSupport && replaceImage ? { subjectName: imageSupport.subjectName, onReplaceImage: replaceImage, error: imageError } : undefined}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
