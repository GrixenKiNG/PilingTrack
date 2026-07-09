import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentTileEditor } from '../equipment-tile-editor';
import { EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY } from '../equipment-tile-storage';
import { useEquipmentTileTemplate } from '../use-equipment-tile-template';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt ?? ''} {...props} />,
}));

/**
 * uploadEquipmentPhoto (Task 4) drives fetch directly: POST /api/media (presign) ->
 * PUT uploadUrl (S3) -> POST /api/media/:id/confirm. Stub fetch end-to-end so the
 * real validateEquipmentTileImageFile() gate still runs (keeps the "unsupported
 * file" test meaningful) while no real network call happens.
 */
function stubUploadFetch() {
  const calls: { url: string; method: string; body?: unknown }[] = [];
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (url === '/api/media' && method === 'POST') {
      return new Response(JSON.stringify({ mediaId: 'media-1', uploadUrl: 'https://s3.example/upload' }), { status: 200 });
    }
    if (url === 'https://s3.example/upload' && method === 'PUT') {
      return new Response(null, { status: 200 });
    }
    if (url === '/api/media/media-1/confirm' && method === 'POST') {
      return new Response(JSON.stringify({ id: 'media-1' }), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${method} ${url}`);
  }) as typeof fetch;
  return calls;
}

const card: FleetCard = {
  id: 'eq-1', name: 'Установка №12', model: 'Junttan', manufactureYear: 2022,
  kind: 'PILE_DRIVER', inventoryNumber: 'INV-12', serialNumber: null,
  engineHoursTotal: 1240, nextMaintenanceDate: null, nextMaintenanceAtHours: 1400,
  assignedSiteId: 'site-1', assignedSiteName: 'Северный мост', assignedOperatorName: 'Иванов', assignedCrewName: null,
  status: 'active', reportStatus: 'has_report', equipmentStatus: 'working', todaysReports: 1,
  todayTotals: { piles: 12, pileMeters: 144.5, drillingCount: 4, drillingMeters: 28.2, downtimeHours: 1.5 },
  downtimeReason: null, latestReport: null, photoUrl: null,
};

const secondCard: FleetCard = { ...card, id: 'eq-2', name: 'Установка №24', inventoryNumber: 'INV-24' };

function Harness({
  cards = [card],
}: {
  cards?: FleetCard[];
}) {
  const controller = useEquipmentTileTemplate();
  return <EquipmentTileEditor cards={cards} controller={controller} />;
}

describe('EquipmentTileEditor', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => void values.set(key, value),
        removeItem: (key: string) => void values.delete(key),
        clear: () => values.clear(),
      },
    });
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:editor-image') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    window.history.replaceState({}, '', '/monitoring');
  });

  it('stays hidden until design mode is unlocked', async () => {
    const { rerender } = render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Редактировать шаблон' })).not.toBeInTheDocument();

    window.history.replaceState({}, '', '/monitoring?design=1');
    rerender(<Harness />);

    expect(await screen.findByRole('button', { name: 'Редактировать шаблон' })).toBeInTheDocument();
  });

  it('adds and edits arbitrary text, then saves it locally', async () => {
    window.history.replaceState({}, '', '/monitoring?design=1');
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' }));

    const textInput = screen.getByLabelText('Текст блока');
    fireEvent.change(textInput, { target: { value: 'Контрольная подпись' } });
    fireEvent.change(screen.getByLabelText('Размер шрифта'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('Выравнивание текста'), { target: { value: 'center' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    const saved = JSON.parse(localStorage.getItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY) ?? '{}');
    expect(saved.blocks).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'text', text: 'Контрольная подпись', style: expect.objectContaining({ fontSize: 18, textAlign: 'center' }) }),
    ]));
  });

  it('undoes and redoes block creation', async () => {
    window.history.replaceState({}, '', '/monitoring?design=1');
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' }));
    expect(screen.getByDisplayValue('Новый текст')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));
    expect(screen.queryByDisplayValue('Новый текст')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(screen.getByDisplayValue('Новый текст')).toBeInTheDocument();
  });

  it('resets a saved customization to the default template', async () => {
    window.history.replaceState({}, '', '/monitoring?design=1');
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Добавить текст' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));
    fireEvent.click(screen.getByRole('button', { name: 'Редактировать шаблон' }));
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));

    await waitFor(() => expect(screen.queryByText('Новый текст')).not.toBeInTheDocument());
    expect(localStorage.getItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY)).toBeNull();
  });

  it('uploads a photo via the media API and saves its presentation settings', async () => {
    window.history.replaceState({}, '', '/monitoring?design=1');
    const calls = stubUploadFetch();
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));
    const file = new File(['image'], 'crane.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('Загрузить фото'), { target: { files: [file] } });

    const altInput = await screen.findByLabelText('Альтернативный текст');
    expect(altInput).toHaveValue('crane.png');
    fireEvent.change(altInput, { target: { value: 'Кран на объекте' } });
    fireEvent.change(screen.getByLabelText('Режим изображения'), { target: { value: 'cover' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить' }));

    const saved = JSON.parse(localStorage.getItem(EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY) ?? '{}');
    const imageBlock = saved.blocks.find((block: { kind: string }) => block.kind === 'image');
    expect(imageBlock).toEqual(expect.objectContaining({ alt: 'Кран на объекте', imageFit: 'cover' }));
    expect(imageBlock).not.toHaveProperty('assetId');

    const presign = calls.find((call) => call.url === '/api/media' && call.method === 'POST');
    expect(presign?.body).toEqual(expect.objectContaining({ entityType: 'equipment', entityId: card.id, fileName: 'crane.png' }));
    expect(calls.some((call) => call.url === 'https://s3.example/upload' && call.method === 'PUT')).toBe(true);
    expect(calls.some((call) => call.url === '/api/media/media-1/confirm' && call.method === 'POST')).toBe(true);
  });

  it('shows a validation error for an unsupported photo file', async () => {
    window.history.replaceState({}, '', '/monitoring?design=1');
    stubUploadFetch();
    render(<Harness />);
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));
    fireEvent.change(screen.getByLabelText('Загрузить фото'), {
      target: { files: [new File(['pdf'], 'manual.pdf', { type: 'application/pdf' })] },
    });

    expect(await screen.findByText('Поддерживаются только JPG, PNG и WebP')).toBeInTheDocument();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uploads the photo against the selected installation', async () => {
    window.history.replaceState({}, '', '/monitoring?design=1');
    const calls = stubUploadFetch();
    render(<Harness cards={[card, secondCard]} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Редактировать шаблон' }));

    fireEvent.change(screen.getByLabelText('Установка для фото'), { target: { value: secondCard.id } });
    fireEvent.change(screen.getByLabelText('Загрузить фото'), {
      target: { files: [new File(['second'], 'second.png', { type: 'image/png' })] },
    });

    const savedBlock = await screen.findByLabelText('Альтернативный текст');
    expect(savedBlock).toHaveValue('second.png');

    const presign = calls.find((call) => call.url === '/api/media' && call.method === 'POST');
    expect(presign?.body).toEqual(expect.objectContaining({ entityType: 'equipment', entityId: secondCard.id }));
  });
});
