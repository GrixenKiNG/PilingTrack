/**
 * Public entry points are the documented module API; internal paths stay private.
 *
 *   @/modules/<x>         — the module facade.
 *   @/modules/<x>/server  — server-only API (database, transactions). Components must not import it.
 *   @/modules/<x>/client  — client-safe API: pure data and functions only (no db, no node:*).
 *                           Enforced by src/modules/__tests__/client-entry-purity.test.ts.
 */
export function isPublicModuleEntry(importPath: string): boolean {
  return /^@\/modules\/[a-z0-9-]+(?:\/(?:server|client))?$/.test(importPath);
}
export function isModuleServerEntry(importPath: string): boolean {
  return /^@\/modules\/[a-z0-9-]+\/server$/.test(importPath);
}
