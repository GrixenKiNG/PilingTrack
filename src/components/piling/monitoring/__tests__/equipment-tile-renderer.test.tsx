import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import { EquipmentTileRenderer } from '../equipment-tile-renderer';
import { DEFAULT_EQUIPMENT_TILE_TEMPLATE } from '../equipment-tile-template';

vi.mock('next/image', () => ({
  default: ({ alt, ...props }: React.ImgHTMLAttributes<HTMLImageElement>) => <img alt={alt ?? ''} {...props} />,
}));

const card: FleetCard = {
  id: 'eq-1',
  name: 'Установка №12',
  model: 'Junttan PMx22',
  manufactureYear: 2022,
  kind: 'PILE_DRIVER',
  inventoryNumber: 'INV-12',
  serialNumber: null,
  engineHoursTotal: 1240,
  nextMaintenanceDate: null,
  nextMaintenanceAtHours: 1400,
  assignedSiteId: 'site-1',
  assignedSiteName: 'Северный мост',
  assignedOperatorName: 'Иванов',
  assignedCrewName: null,
  status: 'active',
  reportStatus: 'has_report',
  equipmentStatus: 'working',
  todaysReports: 1,
  todayTotals: { piles: 12, pileMeters: 144.5, drillingCount: 4, drillingMeters: 28.2, downtimeHours: 1.5 },
  downtimeReason: null,
  latestReport: null,
};

describe('EquipmentTileRenderer', () => {
  it('renders live card values using template positions', () => {
    render(<EquipmentTileRenderer card={card} template={DEFAULT_EQUIPMENT_TILE_TEMPLATE} />);

    expect(screen.getByText('Северный мост')).toBeInTheDocument();
    expect(screen.getByText('Иванов')).toBeInTheDocument();
    const siteBlock = screen.getByTestId('equipment-tile-block-site');
    expect(siteBlock.style.gridColumn).toBe('1 / span 6');
    expect(siteBlock.style.gridRow).toBe('10 / span 3');
  });

  it('renders arbitrary text and omits hidden blocks', () => {
    const template = structuredClone(DEFAULT_EQUIPMENT_TILE_TEMPLATE);
    template.blocks = template.blocks.map((block) => block.id === 'operator' ? { ...block, visible: false } : block);
    template.blocks.push({
      ...structuredClone(template.blocks[1]),
      id: 'custom-text',
      kind: 'text',
      dataKey: undefined,
      text: 'Контрольная подпись',
      y: 20,
      width: 12,
    });

    render(<EquipmentTileRenderer card={card} template={template} />);

    expect(screen.getByText('Контрольная подпись')).toBeInTheDocument();
    expect(screen.queryByText('Иванов')).not.toBeInTheDocument();
  });

  it('allows selecting a block in editing mode', () => {
    const onSelectBlock = vi.fn();
    render(
      <EquipmentTileRenderer
        card={card}
        template={DEFAULT_EQUIPMENT_TILE_TEMPLATE}
        editing
        selectedBlockId="site"
        onSelectBlock={onSelectBlock}
      />,
    );

    const siteBlock = screen.getByTestId('equipment-tile-block-site');
    expect(siteBlock).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(siteBlock);
    expect(onSelectBlock).toHaveBeenCalledWith('site');
  });
});
