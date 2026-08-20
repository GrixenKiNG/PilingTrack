'use client';

/**
 * Monitoring wrapper around the shared useLayoutTemplate hook: binds the
 * 'monitoring-equipment-tile' surface and adds the monitoring-only concerns —
 * design unlock, one-time localStorage seed migration, equipment photo upload
 * and local image-asset GC. Public API unchanged.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  useLayoutTemplate,
  type LayoutController,
} from '@/components/piling/layout-editor/use-layout-template';
import type { LayoutBlock } from '@/components/piling/layout-editor/layout-template';
import {
  DEFAULT_EQUIPMENT_TILE_TEMPLATE,
  validateEquipmentTileTemplate,
  type EquipmentTileTemplate,
} from './equipment-tile-template';
import { loadEquipmentTileTemplate } from './equipment-tile-storage';
import { migrateLegacyCardDesign } from './design-tuning-panel';
import {
  getDefaultEquipmentTileAssetStorage,
  isEquipmentTileImageAssetId,
  type EquipmentTileAssetStorage,
} from './equipment-tile-asset-storage';
import { uploadEquipmentPhoto } from './equipment-photo-upload';

function imageBlockIds(template: EquipmentTileTemplate): Set<string> {
  return new Set(template.blocks.filter((block) => block.kind === 'image').map((block) => block.id));
}

function deleteUnreferencedImageAssets(
  source: EquipmentTileTemplate,
  retained: EquipmentTileTemplate,
  storage: EquipmentTileAssetStorage,
): void {
  const sourceIds = imageBlockIds(source);
  const retainedIds = imageBlockIds(retained);
  const removedIds = [...sourceIds].filter((blockId) => !retainedIds.has(blockId));
  if (removedIds.length === 0) return;
  void storage.list().then(async (records) => {
    await Promise.all(records
      .filter((record) => removedIds.some((blockId) => isEquipmentTileImageAssetId(record.id, blockId)))
      .map((record) => storage.delete(record.id)));
  });
}

export interface EquipmentTileTemplateController extends LayoutController<EquipmentTileTemplate> {
  assetStorage: EquipmentTileAssetStorage;
  addImage(file: File, equipmentId: string): Promise<LayoutBlock>;
  replaceImage(blockId: string, file: File, equipmentId: string): Promise<void>;
}

export function useEquipmentTileTemplate(
  providedAssetStorage?: EquipmentTileAssetStorage,
  onPhotoUploaded?: () => void,
): EquipmentTileTemplateController {
  const [assetStorage] = useState(() => providedAssetStorage ?? getDefaultEquipmentTileAssetStorage());

  // Скрытого замка (?design=1 и флажок в localStorage) больше нет: редактор
  // переехал в «Настройки → Шаблоны плиток», где вход и так закрыт ролью
  // администратора. На экране мониторинга шаблон теперь только отрисовывается.
  useEffect(() => {
    migrateLegacyCardDesign(localStorage);
  }, []);

  const core = useLayoutTemplate<EquipmentTileTemplate>({
    surfaceId: 'monitoring-equipment-tile',
    defaultTemplate: DEFAULT_EQUIPMENT_TILE_TEMPLATE,
    validate: validateEquipmentTileTemplate,
    loadLocalSeed: () => {
      // No row saved server-side yet — migrate a pre-existing local customization once.
      migrateLegacyCardDesign(localStorage);
      return loadEquipmentTileTemplate(localStorage);
    },
    onDraftDiscarded: (discarded, kept) => deleteUnreferencedImageAssets(discarded, kept, assetStorage),
    onBeforeSave: (previous, next) => deleteUnreferencedImageAssets(previous, next, assetStorage),
    onAfterReset: () => {
      void assetStorage.clear();
    },
  });

  const addImage = useCallback(async (file: File, equipmentId: string) => {
    await uploadEquipmentPhoto(file, equipmentId);
    onPhotoUploaded?.();
    const baseStyle = DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks[1].style;
    return core.addBlock('image', undefined, {
      imageFit: 'contain',
      alt: file.name,
      width: 12,
      height: 8,
      style: { ...baseStyle, padding: 0 },
    });
  }, [core, onPhotoUploaded]);

  const replaceImage = useCallback(async (blockId: string, file: File, equipmentId: string) => {
    const block = core.draft.blocks.find((candidate) => candidate.id === blockId && candidate.kind === 'image');
    if (!block) throw new TypeError('Image block not found');
    await uploadEquipmentPhoto(file, equipmentId);
    onPhotoUploaded?.();
    core.updateBlock(blockId, { alt: block.alt || 'Фото установки' });
  }, [core, onPhotoUploaded]);

  return {
    ...core,
    assetStorage,
    addImage,
    replaceImage,
  };
}
