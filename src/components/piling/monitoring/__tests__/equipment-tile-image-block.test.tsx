import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryEquipmentTileAssetStorage } from '../equipment-tile-asset-storage';
import { EquipmentTileImageBlock } from '../equipment-tile-image-block';

describe('EquipmentTileImageBlock', () => {
  const createObjectURL = vi.fn((blob: Blob) => `blob:${blob.size}:${createObjectURL.mock.calls.length}`);
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders a stored image with alt text and fit mode', async () => {
    const storage = createMemoryEquipmentTileAssetStorage();
    const assetId = await storage.put(new File(['image'], 'machine.png', { type: 'image/png' }));

    render(<EquipmentTileImageBlock storage={storage} assetId={assetId} alt="Фото установки" fit="cover" />);

    const image = await screen.findByRole('img', { name: 'Фото установки' });
    expect(image).toHaveStyle({ objectFit: 'cover' });
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('shows a neutral placeholder for a missing asset', async () => {
    const storage = createMemoryEquipmentTileAssetStorage();
    render(<EquipmentTileImageBlock storage={storage} assetId="missing" alt="" fit="contain" />);

    expect(await screen.findByText('Фото не загружено')).toBeInTheDocument();
  });

  it('revokes object URLs after replacement and unmount', async () => {
    const storage = createMemoryEquipmentTileAssetStorage();
    const first = await storage.put(new File(['first'], 'first.png', { type: 'image/png' }));
    const second = await storage.put(new File(['second'], 'second.png', { type: 'image/png' }));
    const { rerender, unmount } = render(<EquipmentTileImageBlock storage={storage} assetId={first} alt="Первое" fit="contain" />);
    await screen.findByRole('img', { name: 'Первое' });

    rerender(<EquipmentTileImageBlock storage={storage} assetId={second} alt="Второе" fit="contain" />);
    await screen.findByRole('img', { name: 'Второе' });
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:5:1'));

    unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:6:2');
  });
});
