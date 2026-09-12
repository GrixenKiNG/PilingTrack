import {describe, expect, it} from 'vitest';
import {isPublicModuleEntry, isModuleServerEntry} from '../../scripts/lib/module-boundaries';
describe('module public API boundary', () => {
  it('allows the public API and its separate server entry point', () => {
    expect(isPublicModuleEntry('@/modules/equipment')).toBe(true);
    expect(isPublicModuleEntry('@/modules/readiness/server')).toBe(true);
  });
  it.each(['@/modules/readiness/application/readiness-score', '@/modules/reports/domain/downtime-hours', '@/modules/readiness/server/private', '@/modules/../lib/db'])('rejects implementation access: %s', path => {
    expect(isPublicModuleEntry(path)).toBe(false);
  });
  it('distinguishes server exports from the client-safe entry point', () => {
    expect(isModuleServerEntry('@/modules/readiness/server')).toBe(true);
    expect(isModuleServerEntry('@/modules/readiness')).toBe(false);
  });
});
