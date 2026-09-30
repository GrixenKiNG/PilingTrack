/**
 * R73 (экран /admin/piles — Журнал забивки): кнопки, фильтры и «Сбросить» были
 * 32px — ниже 44px на телефоне. Мастер решает судьбу сваи стоя у машины, и
 * промах по паре «Принять сваю» / «На добивку» стоит ему неверной сваи.
 * Правка — только телефон: `h-11 … sm:h-8` у кнопок фиксированной высоты,
 * `min-h-11 … sm:min-h-8` у чипов-фильтров. На десктопе вид не меняется.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PilePassportRow } from '@/modules/reports/application/queries/pile-passport.service';

const mocks = vi.hoisted(() => ({ authFetch: vi.fn() }));

vi.mock('@/lib/api', () => ({ authFetch: mocks.authFetch }));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { PileJournal } from '../index';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function pileRow(): PilePassportRow {
  return {
    id: 'pile-1',
    pileNumber: 'С-130',
    drivenAt: '2026-09-28T09:00:00.000Z',
    siteName: 'Объект «Север»',
    shiftType: 'DAY',
    locationName: 'Куст 4, пикет 12',
    operatorName: 'Машинист',
    equipmentName: 'СП-49',
    recordedByForeman: false,
    pileGradeName: 'С 100.30-8',
    pileSection: null,
    pileLengthM: 12,
    designHeadLevelM: null,
    actualHeadLevelM: null,
    drivenDepthM: 11.5,
    followerUsed: false,
    redriven: false,
    headCutOff: false,
    refusalSetPenetrationMm: 18,
    refusalSetBlows: 10,
    designRefusalMm: 20,
    refusalMm: 1.8,
    refusalSetsUsed: 3,
    sets: [],
    drivingComplete: true,
    totalBlows: null,
    blowsLastMeter: null,
    planDeviationMm: null,
    tiltPercent: null,
    hammerType: null,
    hammerEnergyKj: null,
    dropHeightM: null,
    note: null,
    acceptance: 'PENDING',
    acceptanceNote: null,
    acceptedAt: null,
    acceptedByName: null,
    redriveReadyAt: null,
    suggestion: null,
  };
}

const header = {
  siteNames: ['Объект «Север»'],
  equipmentNames: ['СП-49'],
  hammerTypes: [],
  hammerEnergyKj: [],
  designRefusalMm: [20],
  dateFrom: '2026-09-28',
  dateTo: '2026-09-28',
  pilesTotal: 1,
  accepted: 0,
  needsRedrive: 0,
  pending: 1,
  overRefusal: 0,
};

async function renderJournal() {
  mocks.authFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/sites/all')) return json({ sites: [] });
    return json({ data: [pileRow()], header, truncated: false });
  });
  const view = render(<PileJournal />);
  await screen.findByText('С-130');
  return view;
}

describe('журнал забивки: цель нажатия на телефоне (R73)', () => {
  beforeEach(() => {
    mocks.authFetch.mockReset();
  });

  it('кнопки и фильтры не ниже 44px на телефоне, на десктопе без изменений', async () => {
    const { container } = await renderJournal();

    expect(screen.getByRole('button', { name: /Выгрузить журнал/ })).toHaveClass('h-11', 'text-xs', 'sm:h-8');
    for (const label of ['Не разобранные', 'На добивку', 'Принятые', 'Все']) {
      expect(screen.getByRole('button', { name: label })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8');
    }
    expect(screen.getByRole('button', { name: 'Сбросить' })).toHaveClass('min-h-11', 'text-xs', 'sm:min-h-8');

    expect(screen.getByRole('combobox')).toHaveClass('min-h-11', 'text-xs', 'sm:h-8');
    for (const input of container.querySelectorAll('input[type="date"]')) {
      expect(input).toHaveClass('min-h-11', 'text-xs', 'sm:h-8');
    }
    expect(screen.getByPlaceholderText('С-130')).toHaveClass('min-h-11', 'text-xs', 'sm:h-8');
  });

  it('решение по свае («Принять сваю» / «На добивку») на телефоне — 44px', async () => {
    await renderJournal();

    fireEvent.click(screen.getByText('С-130'));

    const accept = await screen.findByRole('button', { name: 'Принять сваю' });
    expect(accept).toHaveClass('h-11', 'text-xs', 'sm:h-8');

    // «На добивку» есть и в фильтре статуса, поэтому ищем в паре решения мастера.
    const decisions = within(accept.parentElement as HTMLElement);
    expect(decisions.getByRole('button', { name: 'На добивку' })).toHaveClass('h-11', 'text-xs', 'sm:h-8');
  });
});
