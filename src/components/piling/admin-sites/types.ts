import type { SiteDTO, SiteWithTreeDTO, UserDTO, PileGradeDTO, SitePilePlanDTO, SiteDrillingPlanDTO } from '@/lib/types';

export interface AssignedUser {
  id: string;
  userId: string;
  user: { id: string; email: string; name: string; role: string; isActive: boolean };
}

export interface SiteListItem extends SiteDTO {
  _count?: {
    pilePlans: number;
    drillingPlans: number;
  };
}

/**
 * Бригада на объекте вместе с закреплённой установкой.
 *
 * `equipmentState` считает сервер по фактам — идёт ли смена и открыта ли
 * поломка, — а не хранит полем: см. `resolveEquipmentStates`.
 */
export interface SiteCrew {
  id: string;
  name: string;
  operator: { id: string; name: string } | null;
  assistants: { id: string; name: string }[];
  equipment: { id: string; name: string; model: string | null; isActive: boolean } | null;
  equipmentState: 'WORKING' | 'REPAIR' | 'IDLE' | null;
}

export interface SiteFullData extends SiteWithTreeDTO {
  users?: AssignedUser[];
  pilePlans?: SitePilePlanDTO[];
  drillingPlans?: SiteDrillingPlanDTO[];
  crews?: SiteCrew[];
}

export interface PilePlanRow {
  tempId: string;
  pileGradeId: string;
  count: number;
  metersPerUnit: number;
}

export interface DrillingPlanRow {
  tempId: string;
  diameter: number;
  count: number;
  metersPerUnit: number;
}

export { authFetch } from '@/lib/api';
export { toast } from 'sonner';
export type { UserDTO, PileGradeDTO, SitePilePlanDTO, SiteDrillingPlanDTO };
