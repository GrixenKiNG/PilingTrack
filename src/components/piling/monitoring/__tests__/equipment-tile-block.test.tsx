import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { createMemoryEquipmentTileAssetStorage } from '../equipment-tile-asset-storage';
import { EquipmentTileBlockContent } from '../equipment-tile-block';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE, type EquipmentTileBlock } from '../equipment-tile-template';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));

const card: FleetCard = {
  id: 'eq-1',
  name: 'Установка №1',
  model: 'Junttan',
  manufactureYear: 2022,
  kind: 'PILE_DRIVER',
  inventoryNumber: 'INV-1',
  serialNumber: null,
  engineHoursTotal: 100,
  nextMaintenanceDate: null,
  nextMaintenanceAtHours: 200,
  assignedSiteId: 'site-1',
  assignedSiteName: 'Объект №1',
  assignedOperatorName: 'Иванов',
  assignedCrewName: null,
  status: 'active',
  reportStatus: 'has_report',
  equipmentStatus: 'working',
  todaysReports: 1,
  todayTotals: { piles: 2, pileMeters: 20, drillingCount: 1, drillingMeters: 5, downtimeHours: 0 },
  downtimeReason: null,
  latestReport: null,
  photoUrl: '/api/media/eq-1/download',
};

const imageBlock: EquipmentTileBlock = {
  ...structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE.blocks[1]),
  id: 'installation-photo',
  kind: 'image',
  dataKey: undefined,
  imageFit: 'cover',
  alt: 'Фото установки',
  y: 24,
  width: 12,
  height: 6,
};

const assetStorage = createMemoryEquipmentTileAssetStorage();

function renderBlock(overrides: Partial<FleetCard> = {}) {
  return render(<EquipmentTileBlockContent block={imageBlock} card={{ ...card, ...overrides }} assetStorage={assetStorage} />);
}

/**
 * R101 №4: отказ выдачи ссылки на фото не должен выглядеть как «фото нет».
 * Ссылка приходит через /api/media, поэтому 403/500/обрыв — это сбой чтения,
 * а «Фото не загружено» честно только для установки без фото.
 */
describe('EquipmentTileBlockContent — фото', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
    // Как в соседнем fleet-dashboard-template.test: у мока всегда есть
    // реализация по умолчанию — «голый» сброшенный vi.fn() заставляет Vitest
    // выдавать пойманный тестом throw из мока за необработанную ошибку.
    mocks.authFetch.mockImplementation(async () => ({ ok: true, json: async () => ({ url: 'https://s3/default.jpg' }) }));
  });

  it('показывает фото по presigned-ссылке', async () => {
    mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://s3/foto.jpg' }) });

    renderBlock();

    const image = await screen.findByAltText('Фото установки');
    expect(image).toHaveAttribute('src', 'https://s3/foto.jpg');
  });

  it('отказ сервера — «Не удалось загрузить фото», а не «Фото не загружено» (R101 №4)', async () => {
    mocks.authFetch.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });

    renderBlock();

    expect(await screen.findByText('Не удалось загрузить фото')).toBeInTheDocument();
    expect(screen.queryByText('Фото не загружено')).not.toBeInTheDocument();
  });

  it('обрыв сети — тот же отказ чтения, а не «фото нет» (R101 №4)', async () => {
    mocks.authFetch.mockImplementation(() => { throw new TypeError('Failed to fetch'); });

    renderBlock();

    expect(await screen.findByText('Не удалось загрузить фото')).toBeInTheDocument();
    expect(screen.queryByText('Фото не загружено')).not.toBeInTheDocument();
  });

  it('ответ без ссылки считается отказом чтения (R101 №4)', async () => {
    mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    renderBlock();

    expect(await screen.findByText('Не удалось загрузить фото')).toBeInTheDocument();
  });

  it('«Фото не загружено» остаётся только для установки без фото (R101 №4)', () => {
    renderBlock({ photoUrl: null });

    expect(screen.getByText('Фото не загружено')).toBeInTheDocument();
    expect(mocks.authFetch).not.toHaveBeenCalled();
  });

  it('пока ссылка получается — «Загрузка фото…», а не «Фото не загружено» (F-M4-TILE)', async () => {
    // Запрос за presigned-ссылкой ещё висит: это не «фото нет».
    mocks.authFetch.mockImplementation(() => new Promise(() => {}));

    renderBlock();

    expect(await screen.findByText('Загрузка фото…')).toBeInTheDocument();
    expect(screen.queryByText('Фото не загружено')).not.toBeInTheDocument();
  });

  it('сбой самого снимка после получения ссылки — «Фото не загрузилось» (F-M4-TILE)', async () => {
    mocks.authFetch.mockResolvedValue({ ok: true, json: async () => ({ url: 'https://s3/broken.jpg' }) });

    renderBlock();

    const image = await screen.findByAltText('Фото установки');
    fireEvent.error(image);

    expect(await screen.findByText('Фото не загрузилось')).toBeInTheDocument();
    expect(screen.queryByAltText('Фото установки')).not.toBeInTheDocument();
  });
});
