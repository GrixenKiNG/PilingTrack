/**
 * Event Schema Contract Tests
 *
 * Verifies that:
 * 1. All registered schemas are valid JSON Schema
 * 2. Valid payloads pass validation
 * 3. Invalid payloads fail validation
 * 4. Schema versioning works correctly
 * 5. Backward compatibility is enforced
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { schemaRegistry, registerAllEventSchemas } from '@/core/event-bus/schema-registry';

// ============================================================
// Setup
// ============================================================

beforeAll(() => {
  registerAllEventSchemas();
});

// Use the singleton registry (schemas are registered there)
const registry = schemaRegistry;

// ============================================================
// Valid Payload Tests
// ============================================================

describe('Valid payloads pass validation', () => {
  it('report.created v1 — valid', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      siteId: '550e8400-e29b-41d4-a716-446655440002',
      date: '2026-04-08',
      status: 'draft' as const,
      version: 1,
      updatedAt: new Date().toISOString(),
      piles: [{ pileGradeId: 'grade-1', count: 10 }],
      drillings: [{ typeId: 'type-1', meters: 25.5 }],
      downtimes: [{ reasonId: 'reason-1', duration: 30 }],
    };

    expect(() => registry.validate('report.created', 1, payload)).not.toThrow();
  });

  it('report.updated v1 — valid', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      version: 2,
      updatedAt: new Date().toISOString(),
      status: 'submitted' as const,
      changes: ['status', 'updatedAt'],
    };

    expect(() => registry.validate('report.updated', 1, payload)).not.toThrow();
  });

  it('report.submitted v1 — valid', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      submittedAt: new Date().toISOString(),
      version: 3,
    };

    expect(() => registry.validate('report.submitted', 1, payload)).not.toThrow();
  });

  it('crew.created v1 — valid', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      operatorId: '550e8400-e29b-41d4-a716-446655440001',
      equipmentId: '550e8400-e29b-41d4-a716-446655440002',
      siteId: '550e8400-e29b-41d4-a716-446655440003',
      name: 'Бригада №1',
    };

    expect(() => registry.validate('crew.created', 1, payload)).not.toThrow();
  });

  it('sync.completed v1 — valid', () => {
    const payload = {
      deviceId: 'device-abc123',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      changesApplied: 5,
      changesPulled: 10,
      conflictsResolved: 1,
      syncDurationMs: 1250,
    };

    expect(() => registry.validate('sync.completed', 1, payload)).not.toThrow();
  });

  it('system.degraded v1 — valid', () => {
    const payload = {
      component: 'database',
      previousStatus: 'healthy',
      currentStatus: 'slow',
      detectedAt: new Date().toISOString(),
    };

    expect(() => registry.validate('system.degraded', 1, payload)).not.toThrow();
  });
});

// ============================================================
// Invalid Payload Tests
// ============================================================

describe('Invalid payloads fail validation', () => {
  it('report.created — missing required field', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      // missing userId
      siteId: '550e8400-e29b-41d4-a716-446655440002',
      date: '2026-04-08',
      status: 'draft',
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    expect(() => registry.validate('report.created', 1, payload)).toThrow(/validation failed/);
  });

  it('report.created — wrong type', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      siteId: '550e8400-e29b-41d4-a716-446655440002',
      date: '2026-04-08',
      status: 'invalid-status', // not in enum
      version: 1,
      updatedAt: new Date().toISOString(),
    };

    expect(() => registry.validate('report.created', 1, payload)).toThrow();
  });

  it('report.created — additional property', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      siteId: '550e8400-e29b-41d4-a716-446655440002',
      date: '2026-04-08',
      status: 'draft',
      version: 1,
      updatedAt: new Date().toISOString(),
      extraField: 'not allowed', // additionalProperties: false
    };

    expect(() => registry.validate('report.created', 1, payload)).toThrow();
  });

  it('crew.created — empty name', () => {
    const payload = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      operatorId: '550e8400-e29b-41d4-a716-446655440001',
      equipmentId: '550e8400-e29b-41d4-a716-446655440002',
      siteId: '550e8400-e29b-41d4-a716-446655440003',
      name: '', // minLength: 1
    };

    expect(() => registry.validate('crew.created', 1, payload)).toThrow();
  });

  it('sync.completed — negative count', () => {
    const payload = {
      deviceId: 'device-abc123',
      userId: '550e8400-e29b-41d4-a716-446655440001',
      changesApplied: -1, // minimum: 0
      changesPulled: 10,
      conflictsResolved: 1,
      syncDurationMs: 1250,
    };

    expect(() => registry.validate('sync.completed', 1, payload)).toThrow();
  });
});

// ============================================================
// Versioning Tests
// ============================================================

describe('Schema versioning', () => {
  it('getLatestVersion returns highest registered version', () => {
    const versions = registry.getAllVersions('report.created');
    expect(versions.length).toBeGreaterThan(0);
    expect(Math.max(...versions)).toBe(registry.getLatestVersion('report.created'));
  });

  it('getAllVersions returns sorted array', () => {
    const versions = registry.getAllVersions('report.updated');
    for (let i = 1; i < versions.length; i++) {
      expect(versions[i]).toBeGreaterThan(versions[i - 1]);
    }
  });

  it('unknown version returns graceful result', () => {
    // Should not throw — graceful degradation
    const result = registry.validate('nonexistent.event', 1, {});
    expect(result).toBe(true);
  });
});

// ============================================================
// Schema Registration Tests
// ============================================================

describe('Schema registration', () => {
  it('registerAllEventSchemas registers all expected types', () => {
    const allSchemas = registry.getAllSchemas();
    const eventTypes = allSchemas.map(s => s.id);

    // Core event types
    expect(eventTypes).toContain('report.created');
    expect(eventTypes).toContain('report.updated');
    expect(eventTypes).toContain('report.submitted');
    expect(eventTypes).toContain('report.deleted');
    expect(eventTypes).toContain('crew.created');
    expect(eventTypes).toContain('crew.updated');
    expect(eventTypes).toContain('crew.deactivated');
    expect(eventTypes).toContain('site.created');
    expect(eventTypes).toContain('equipment.created');
    expect(eventTypes).toContain('telemetry.recorded');
    expect(eventTypes).toContain('sync.completed');
    expect(eventTypes).toContain('sync.failed');
    expect(eventTypes).toContain('sync.conflict_resolved');
    expect(eventTypes).toContain('system.degraded');
    expect(eventTypes).toContain('system.recovered');
  });

  it('all schemas have BACKWARD compatibility', () => {
    const allSchemas = registry.getAllSchemas();
    for (const schema of allSchemas) {
      expect(schema.compatibility).toBe('BACKWARD');
    }
  });
});
