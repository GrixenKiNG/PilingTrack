/**
 * Pure fleet-list logic — building the filter dropdown options and applying the
 * active filters to the cards. Extracted from admin-equipment.tsx so the screen
 * carries no business logic and this is unit-testable.
 */
import type { FleetCard } from './fleet-types';
import type { FleetFilterState } from './equipment-filters';
import { KIND_LABEL } from './equipment-status';

export interface FleetFilterOptions {
  sites: string[];
  kinds: { value: string; label: string }[];
  crews: string[];
}

/** Distinct, sorted site/kind/crew values present in the fleet (nulls skipped). */
export function buildFleetFilterOptions(cards: FleetCard[]): FleetFilterOptions {
  const sites = new Set<string>();
  const kinds = new Set<string>();
  const crews = new Set<string>();
  for (const c of cards) {
    if (c.assignedSiteName) sites.add(c.assignedSiteName);
    if (c.kind) kinds.add(c.kind);
    if (c.assignedCrewName) crews.add(c.assignedCrewName);
  }
  return {
    sites: [...sites].sort(),
    kinds: [...kinds].sort().map((k) => ({ value: k, label: KIND_LABEL[k as keyof typeof KIND_LABEL] ?? k })),
    crews: [...crews].sort(),
  };
}

/** Keep only cards matching every set filter; an empty field means "no filter". */
export function applyFleetFilters(cards: FleetCard[], filters: FleetFilterState): FleetCard[] {
  return cards.filter((c) => {
    if (filters.site && c.assignedSiteName !== filters.site) return false;
    if (filters.kind && c.kind !== filters.kind) return false;
    if (filters.equipmentStatus && c.equipmentStatus !== filters.equipmentStatus) return false;
    if (filters.reportStatus && c.reportStatus !== filters.reportStatus) return false;
    if (
      filters.status &&
      c.status !== filters.status &&
      c.equipmentStatus !== filters.status &&
      c.reportStatus !== filters.status
    ) {
      return false;
    }
    if (filters.crew && c.assignedCrewName !== filters.crew) return false;
    return true;
  });
}
