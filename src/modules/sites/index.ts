/**
 * Sites Module — DDD Bounded Context
 */

// Domain
export { SiteAggregate } from './domain/site.aggregate';
export type { SiteInfo, SiteStatus, SiteCreateData } from './domain/site.aggregate';
export { createSiteEvent } from './domain/site.events';
export type { SiteDomainEvent, SiteDomainEventType } from './domain/site.events';

// Application
export {
  createSite,
  updateSite,
  activateSite,
  deactivateSite,
  createSiteWithPlans,
  hardDeleteSite,
  setSiteCompleted,
  assignUserToSite,
  unassignUserFromSite,
  createSiteHierarchyItem,
  deleteSiteHierarchyItem,
} from './application/commands';
export type { CreateSiteCommand, UpdateSiteCommand } from './application/commands/site.command';

export {
  getAccessibleSites,
  getSiteWithHierarchy,
  listAllSitesForAdmin,
} from './application/queries';

// Infrastructure
export { getSiteRepository } from './infrastructure';
export type { SiteRepository } from './infrastructure';
