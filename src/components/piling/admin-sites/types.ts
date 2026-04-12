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

export interface SiteFullData extends SiteWithTreeDTO {
  users?: AssignedUser[];
  pilePlans?: SitePilePlanDTO[];
  drillingPlans?: SiteDrillingPlanDTO[];
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
