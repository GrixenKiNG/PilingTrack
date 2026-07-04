import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentTileEditor } from '../equipment-tile-editor';
import { EQUIPMENT_TILE_TEMPLATE_STORAGE_KEY } from '../equipment-tile-storage';
import { useEquipmentTileTemplate } from '../use-equipment-tile-template';

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} />,
}));

const card: FleetCard = {
  id: 'eq-1', name: 'Установка №12', model: 'Junttan', manufactureYear: 2022,
  kind: 'PILE_DRIVER', inventoryNumber: 'INV-12', serialNumber: null,
  engineHoursTotal: 1240, nextMaintenanceDate: null, nextMaintenanceAtHours: 1400,
  assignedSiteId: 'site-1', assignedSiteName: 'Северный мост', assignedOperatorName: 'Иванов', assignedCrewName: null,
  status: 'active', reportStatus: 'has_report', equipmentStatus: 'working', todaysReports: 1,
  todayTotals: { piles: 12, pileMeters: 144.5, drillingCount: 4, drillingMeters: 28.2, downtimeHours: 1.5 },
  downtimeReason: null, latestReport: null,
};

function Harness() {
  const controller = useEquipmentTileTemplate();
  return <EquipmentTileEditor card={card} controller={controller} />;
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
});
