/**
 * F-R114-1: «Обзор» карточки техники печатал даты сырым ISO — «Ближайшее ТО:
 * 2026-10-26» и «Последний отчёт: 2026-09-25» (`String(...).slice(0,10)` и
 * `timeline[0]?.date` без форматтера). Это были единственные такие места в
 * админке. Теперь обе строки идут через formatRuDate из @/lib/format, который
 * режет дату без `new Date()` — то есть дата без времени не съезжает на сутки
 * в поясе западнее UTC.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverviewTiles } from '../equipment-detail-overview';
import type { TimelineRow } from '../equipment-detail-parts';
import type { EquipmentDTO } from '@/lib/types';

const stats = {
  reportCount: 1,
  piles: 10,
  pileMeters: 100,
  drillingCount: 0,
  drillingMeters: 0,
  downtimeHours: 0,
};

function equipment(p: Record<string, unknown> = {}): EquipmentDTO & Record<string, unknown> {
  return {
    id: 'eq-1',
    name: 'СГ-1',
    kind: 'PILE_DRIVER',
    isActive: true,
    model: null,
    inventoryNumber: '001',
    engineHoursTotal: 1200,
    nextMaintenanceAtHours: 1500,
    ...p,
  } as unknown as EquipmentDTO & Record<string, unknown>;
}

function row(date: string): TimelineRow {
  return {
    reportId: `r-${date}`,
    date,
    shiftType: 'DAY',
    status: 'submitted',
    siteName: null,
    operatorId: null,
    operatorName: null,
    updatedAt: '2026-09-25T18:00:00.000Z',
    piles: null,
    drillingMeters: null,
    downtimeHours: null,
  };
}

describe('OverviewTiles — даты обзора (F-R114-1)', () => {
  it('«Ближайшее ТО» и «Последний отчёт» печатаются как ДД.ММ.ГГГГ', () => {
    render(
      <OverviewTiles
        eq={equipment({ nextMaintenanceDate: '2026-10-26T00:00:00.000Z' })}
        crew={null}
        stats={stats}
        timeline={[row('2026-09-25')]}
        devicesCount={0}
      />,
    );

    expect(screen.getByText('26.10.2026')).toBeInTheDocument();
    expect(screen.getByText('25.09.2026')).toBeInTheDocument();
    expect(screen.queryByText('2026-10-26')).toBeNull();
    expect(screen.queryByText('2026-09-25')).toBeNull();
  });

  it('дата без времени не съезжает на сутки: 26.10.2026 при сроке в 00:00 UTC', () => {
    render(
      <OverviewTiles
        eq={equipment({ nextMaintenanceDate: '2026-10-26' })}
        crew={null}
        stats={stats}
        timeline={[]}
        devicesCount={0}
      />,
    );

    expect(screen.getByText('26.10.2026')).toBeInTheDocument();
    expect(screen.queryByText('25.10.2026')).toBeNull();
  });

  it('без данных — прочерк, а не пустая строка', () => {
    render(
      <OverviewTiles eq={equipment()} crew={null} stats={stats} timeline={[]} devicesCount={0} />,
    );

    // Обе ячейки (Ближайшее ТО, Последний отчёт) — прочерк.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });
});