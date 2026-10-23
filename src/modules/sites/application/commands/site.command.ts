/**
 * Site Command DTOs
 */

export interface UpdateSiteCommand {
  siteId: string;
  name?: string;
  plannedPiles?: number;
  plannedDrilling?: number;
  /** Координаты площадки: `null` — стереть, `undefined` — не трогать. */
  latitude?: number | null;
  longitude?: number | null;
  completionDate?: string | null;
  userId?: string;
}

export interface SiteCommandContext {
  tenantId: string;
  actorId: string;
}
