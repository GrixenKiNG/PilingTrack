import { describe, expect, it } from 'vitest';
import {
  createMemoryEquipmentTileAssetStorage,
  MAX_EQUIPMENT_TILE_IMAGE_BYTES,
  validateEquipmentTileImageFile,
} from '../equipment-tile-asset-storage';

describe('equipment tile image asset storage', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])('accepts %s files', (type) => {
    const file = new File(['image'], 'machine-image', { type });
    expect(validateEquipmentTileImageFile(file)).toBeNull();
  });

  it('rejects unsupported files', () => {
    const file = new File(['<svg/>'], 'image.svg', { type: 'image/svg+xml' });
    expect(validateEquipmentTileImageFile(file)).toBe('Поддерживаются только JPG, PNG и WebP');
  });

  it('rejects files larger than 12 MB', () => {
    const file = new File(
      [new Uint8Array(MAX_EQUIPMENT_TILE_IMAGE_BYTES + 1)],
      'huge.jpg',
      { type: 'image/jpeg' },
    );
    expect(validateEquipmentTileImageFile(file)).toBe('Размер изображения не должен превышать 12 МБ');
  });

  it('stores, retrieves, replaces, lists and deletes blobs', async () => {
    const storage = createMemoryEquipmentTileAssetStorage();
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const assetId = await storage.put(first);

    expect(await storage.get(assetId)).toMatchObject({ name: 'first.png', type: 'image/png' });
    expect(await storage.list()).toHaveLength(1);

    const second = new File(['second'], 'second.webp', { type: 'image/webp' });
    await storage.put(second, assetId);
    expect(await storage.get(assetId)).toMatchObject({ name: 'second.webp', type: 'image/webp' });

    await storage.delete(assetId);
    expect(await storage.get(assetId)).toBeNull();
    expect(await storage.list()).toEqual([]);
  });

  it('clears every stored asset', async () => {
    const storage = createMemoryEquipmentTileAssetStorage();
    await storage.put(new File(['a'], 'a.png', { type: 'image/png' }));
    await storage.put(new File(['b'], 'b.jpg', { type: 'image/jpeg' }));

    await storage.clear();

    expect(await storage.list()).toEqual([]);
  });
});
