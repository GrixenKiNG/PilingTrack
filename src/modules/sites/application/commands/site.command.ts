/**
 * Site Command DTOs
 */

export interface CreateSiteCommand {
  name: string;
  tenantId?: string | null;
  plannedPiles?: number;
  plannedDrilling?: number;
  completionDate?: string | null;
  userId?: string;
}

export interface UpdateSiteCommand {
  siteId: string;
  name?: string;
  plannedPiles?: number;
  plannedDrilling?: number;
  completionDate?: string | null;
  userId?: string;
}

export interface SiteCommandContext {
  tenantId: string;
  actorId: string;
}
