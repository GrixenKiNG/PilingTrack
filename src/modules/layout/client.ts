/**
 * Client-safe entry: pure data and functions, no database, no node:*.
 * Purity is enforced by src/modules/__tests__/client-entry-purity.test.ts.
 */
export * from './domain/layout-template';
export * from './domain/page-layout-template';
export * from './domain/equipment-tile-template';
export * from './domain/equipment-card-template';
export * from './domain/analytics-dashboard-catalog';
export * from './domain/main-dashboard-catalog';
