/**
 * Crew Aggregate — Domain Tests
 *
 * Tests the core domain logic:
 * - Business rules enforcement
 * - State transitions (create, update, deactivate, reactivate)
 * - Event generation
 * - Idempotency / edge cases
 */

import { describe, it, expect } from 'vitest';
import { CrewAggregate } from '../crew.aggregate';

// ============================================================
// Helpers
// ============================================================

function createTestCrew() {
  return CrewAggregate.create({
    name: 'Test Crew',
    operatorId: 'operator-1',
    equipmentId: 'equip-1',
    siteId: 'site-1',
  }, 'user-1');
}

// ============================================================
// Tests
// ============================================================

describe('CrewAggregate', () => {
  // --------------------------------------------------------
  // 1. Creation
  // --------------------------------------------------------
  describe('creation', () => {
    it('should create crew with active status', () => {
      const crew = createTestCrew();
      expect(crew.getState().isActive).toBe(true);
      expect(crew.getState().name).toBe('Test Crew');
      expect(crew.getState().operatorId).toBe('operator-1');
    });

    it('should generate CrewCreated event', () => {
      const crew = createTestCrew();
      const events = crew.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('CrewCreated');
    });

    it('should require a name', () => {
      expect(() =>
        CrewAggregate.create({
          name: '',
          operatorId: 'operator-1',
          equipmentId: 'equip-1',
          siteId: 'site-1',
        }, 'user-1')
      ).toThrow('Crew name is required');
    });

    it('should require an operator', () => {
      expect(() =>
        CrewAggregate.create({
          name: 'Test',
          operatorId: '',
          equipmentId: 'equip-1',
          siteId: 'site-1',
        }, 'user-1')
      ).toThrow('Operator is required');
    });

    it('should require equipment', () => {
      expect(() =>
        CrewAggregate.create({
          name: 'Test',
          operatorId: 'operator-1',
          equipmentId: '',
          siteId: 'site-1',
        }, 'user-1')
      ).toThrow('Equipment is required');
    });

    it('should require a site', () => {
      expect(() =>
        CrewAggregate.create({
          name: 'Test',
          operatorId: 'operator-1',
          equipmentId: 'equip-1',
          siteId: '',
        }, 'user-1')
      ).toThrow('Site is required');
    });
  });

  // --------------------------------------------------------
  // 2. Update
  // --------------------------------------------------------
  describe('update', () => {
    it('should update crew name', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();

      crew.update({ name: 'New Name' }, 'user-1');
      expect(crew.getState().name).toBe('New Name');

      const events = crew.getPendingEvents();
      expect(events.some(e => e.type === 'CrewUpdated')).toBe(true);
    });

    it('should trim crew name', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();

      crew.update({ name: '  Trimmed  ' }, 'user-1');
      expect(crew.getState().name).toBe('Trimmed');
    });

    it('should reject empty name', () => {
      const crew = createTestCrew();
      expect(() => crew.update({ name: '' }, 'user-1'))
        .toThrow('Crew name cannot be empty');
    });

    it('should reject whitespace-only name', () => {
      const crew = createTestCrew();
      expect(() => crew.update({ name: '   ' }, 'user-1'))
        .toThrow('Crew name cannot be empty');
    });
  });

  // --------------------------------------------------------
  // 3. Soft delete (deactivate/reactivate)
  // --------------------------------------------------------
  describe('deactivate', () => {
    it('should deactivate an active crew', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();

      crew.deactivate('user-1');
      expect(crew.getState().isActive).toBe(false);

      const events = crew.getPendingEvents();
      expect(events.some(e => e.type === 'CrewDeactivated')).toBe(true);
    });

    it('should reject double deactivation (idempotency)', () => {
      const crew = createTestCrew();
      crew.deactivate('user-1');

      expect(() => crew.deactivate('user-1'))
        .toThrow('Crew is already deactivated');
    });

    it('should generate CrewDeactivated event', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();
      crew.deactivate('user-1');

      const events = crew.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('CrewDeactivated');
    });
  });

  describe('reactivate', () => {
    it('should reactivate a deactivated crew', () => {
      const crew = createTestCrew();
      crew.deactivate('user-1');
      crew.clearPendingEvents();

      crew.reactivate('user-1');
      expect(crew.getState().isActive).toBe(true);

      const events = crew.getPendingEvents();
      expect(events.some(e => e.type === 'CrewReactivated')).toBe(true);
    });

    it('should reject double reactivation (idempotency)', () => {
      const crew = createTestCrew();

      expect(() => crew.reactivate('user-1'))
        .toThrow('Crew is already active');
    });

    it('should generate CrewReactivated event', () => {
      const crew = createTestCrew();
      crew.deactivate('user-1');
      crew.clearPendingEvents();
      crew.reactivate('user-1');

      const events = crew.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('CrewReactivated');
    });
  });

  // --------------------------------------------------------
  // 4. Site assignment
  // --------------------------------------------------------
  describe('assignToSite', () => {
    it('should assign crew to a new site', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();

      crew.assignToSite('site-2', 'user-1');
      expect(crew.getState().siteId).toBe('site-2');

      const events = crew.getPendingEvents();
      expect(events.some(e => e.type === 'CrewAssigned')).toBe(true);
    });

    it('should generate CrewAssigned event', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();
      crew.assignToSite('site-2', 'user-1');

      const events = crew.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('CrewAssigned');
    });
  });

  // --------------------------------------------------------
  // 5. Event lifecycle
  // --------------------------------------------------------
  describe('event lifecycle', () => {
    it('should accumulate multiple events', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();

      crew.update({ name: 'Updated' }, 'user-1');
      crew.deactivate('user-1');

      const events = crew.getPendingEvents();
      expect(events).toHaveLength(2);
      expect(events[0].type).toBe('CrewUpdated');
      expect(events[1].type).toBe('CrewDeactivated');
    });

    it('should clear pending events after persistence', () => {
      const crew = createTestCrew();
      crew.clearPendingEvents();
      crew.update({ name: 'Updated' }, 'user-1');
      expect(crew.getPendingEvents().length).toBeGreaterThan(0);

      crew.clearPendingEvents();
      expect(crew.getPendingEvents()).toHaveLength(0);
    });
  });

  // --------------------------------------------------------
  // 6. Reconstitution (from persistence)
  // --------------------------------------------------------
  describe('reconstitution', () => {
    it('should reconstitute aggregate from persisted state', () => {
      const state = {
        id: 'crew-123',
        name: 'Persisted Crew',
        operatorId: 'operator-1',
        equipmentId: 'equip-1',
        siteId: 'site-1',
        isActive: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      };

      const crew = CrewAggregate.reconstitute(state);
      expect(crew.getState()).toEqual(state);
      expect(crew.getPendingEvents()).toHaveLength(0);
    });
  });
});
