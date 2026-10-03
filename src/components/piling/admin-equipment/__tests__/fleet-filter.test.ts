import { describe, it, expect } from 'vitest';
import { buildFleetFilterOptions, applyFleetFilters } from '../fleet-filter';
import type { FleetCard } from '../fleet-types';
import type { FleetFilterState } from '../equipment-filters';

const EMPTY_FILTERS: FleetFilterState = {
  site: '',
  kind: '',
  status: '',
  equipmentStatus: '',
  reportStatus: '',
  crew: '',
  search: '',
};

function card(over: Partial<FleetCard>): FleetCard {
  return {
    id: 'x',
    name: 'X',
    model: 'M',
    manufactureYear: null,
    kind: 'PILE_DRIVER',
    inventoryNumber: null,
    serialNumber: null,
    engineHoursTotal: null,
    nextMaintenanceDate: null,
    nextMaintenanceAtHours: null,
    assignedSiteId: null,
    assignedSiteName: null,
    assignedOperatorName: null,
    assignedCrewName: null,
    status: 'idle',
    reportStatus: 'missing',
    equipmentStatus: 'idle',
    todaysReports: 0,
    todayTotals: null,
    downtimeReason: null,
    latestReport: null,
    photoUrl: null,
    ...over,
  };
}

describe('buildFleetFilterOptions', () => {
  it('returns distinct, sorted values and skips nulls', () => {
    const opts = buildFleetFilterOptions([
      card({ assignedSiteName: 'Объект Б', kind: 'DRILLING_RIG', assignedCrewName: 'Бр-2' }),
      card({ assignedSiteName: 'Объект А', kind: 'DRILLING_RIG', assignedCrewName: null }),
      card({ assignedSiteName: null, kind: 'PILE_DRIVER', assignedCrewName: 'Бр-2' }),
    ]);
    expect(opts.sites).toEqual(['Объект А', 'Объект Б']);
    expect(opts.crews).toEqual(['Бр-2']);
    expect(opts.kinds.map((k) => k.value)).toEqual(['DRILLING_RIG', 'PILE_DRIVER']);
  });

  it('maps kind codes to Russian labels', () => {
    const opts = buildFleetFilterOptions([card({ kind: 'PILE_DRIVER' })]);
    expect(opts.kinds[0]).toEqual({ value: 'PILE_DRIVER', label: 'Копёр' });
  });

  it('returns empty options for an empty fleet', () => {
    expect(buildFleetFilterOptions([])).toEqual({ sites: [], kinds: [], crews: [] });
  });
});

describe('applyFleetFilters', () => {
  const fleet = [
    card({
      id: 'a',
      assignedSiteName: 'Объект А',
      kind: 'PILE_DRIVER',
      status: 'active',
      reportStatus: 'has_report',
      equipmentStatus: 'working',
      assignedCrewName: 'Бр-1',
    }),
    card({
      id: 'b',
      assignedSiteName: 'Объект Б',
      kind: 'DRILLING_RIG',
      status: 'idle',
      reportStatus: 'missing',
      equipmentStatus: 'idle',
      assignedCrewName: 'Бр-2',
    }),
    card({
      id: 'c',
      assignedSiteName: 'Объект А',
      kind: 'DRILLING_RIG',
      status: 'active',
      reportStatus: 'has_report',
      equipmentStatus: 'repair',
      assignedCrewName: 'Бр-2',
    }),
  ];

  it('empty filters return every card', () => {
    expect(applyFleetFilters(fleet, EMPTY_FILTERS)).toHaveLength(3);
  });

  it('filters by a single dimension', () => {
    expect(applyFleetFilters(fleet, { ...EMPTY_FILTERS, status: 'active' }).map((c) => c.id)).toEqual(['a', 'c']);
    expect(applyFleetFilters(fleet, { ...EMPTY_FILTERS, kind: 'DRILLING_RIG' }).map((c) => c.id)).toEqual(['b', 'c']);
    expect(applyFleetFilters(fleet, { ...EMPTY_FILTERS, equipmentStatus: 'repair' }).map((c) => c.id)).toEqual(['c']);
    expect(applyFleetFilters(fleet, { ...EMPTY_FILTERS, reportStatus: 'missing' }).map((c) => c.id)).toEqual(['b']);
  });

  it('combines filters with AND', () => {
    const out = applyFleetFilters(fleet, { ...EMPTY_FILTERS, site: 'Объект А', kind: 'DRILLING_RIG' });
    expect(out.map((c) => c.id)).toEqual(['c']);
  });

  it('returns nothing when no card matches', () => {
    expect(applyFleetFilters(fleet, { ...EMPTY_FILTERS, crew: 'Бр-9' })).toEqual([]);
  });

  it('filters by free text over name, model and inventory number', () => {
    const rig = card({ id: 'r1', name: 'СП-49', model: 'Liebherr LRH 100', inventoryNumber: '12345' });
    const other = card({ id: 'r2', name: 'СГ-1', model: 'Sany', inventoryNumber: null });

    expect(applyFleetFilters([rig, other], { ...EMPTY_FILTERS, search: 'LRH 100' }).map((c) => c.id)).toEqual(['r1']);
    expect(applyFleetFilters([rig, other], { ...EMPTY_FILTERS, search: 'сп-49' }).map((c) => c.id)).toEqual(['r1']);
    expect(applyFleetFilters([rig, other], { ...EMPTY_FILTERS, search: '12345' }).map((c) => c.id)).toEqual(['r1']);
    expect(applyFleetFilters([rig, other], { ...EMPTY_FILTERS, search: 'чего-то нет' })).toEqual([]);
  });

  // Поиск один: он не должен различать «ё»/«е» и спотыкаться о лишние пробелы.
  it('search ignores «ё»/«е» and repeated spaces', () => {
    const kopior = card({ id: 'k', name: 'Копёр', model: '' });
    const other = card({ id: 'o', name: 'СГ-1', model: '' });

    expect(applyFleetFilters([kopior, other], { ...EMPTY_FILTERS, search: 'копер' }).map((c) => c.id)).toEqual(['k']);
    expect(applyFleetFilters([kopior, other], { ...EMPTY_FILTERS, search: '  копёр  ' }).map((c) => c.id)).toEqual(['k']);
  });
});
