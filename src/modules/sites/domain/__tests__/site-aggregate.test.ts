/**
 * Site Aggregate — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { SiteAggregate } from '../site.aggregate';

describe('SiteAggregate', () => {
  describe('create', () => {
    it('should create site with required fields', () => {
      const agg = SiteAggregate.create({ name: 'Площадка №1' });
      const state = agg.getState();

      expect(state.name).toBe('Площадка №1');
      expect(state.status).toBe('ACTIVE');
      expect(state.isActive).toBe(true);
      expect(state.plannedPiles).toBe(0);
      expect(state.plannedDrilling).toBe(0);
      expect(state.id).toBeDefined();
    });

    it('should create site with all fields', () => {
      const agg = SiteAggregate.create({
        name: 'Новый объект',
        tenantId: 'tenant-1',
        plannedPiles: 500,
        plannedDrilling: 1200,
        completionDate: '2026-12-31',
      });
      const state = agg.getState();

      expect(state.tenantId).toBe('tenant-1');
      expect(state.plannedPiles).toBe(500);
      expect(state.plannedDrilling).toBe(1200);
      expect(state.completionDate).toBe('2026-12-31');
    });

    it('should trim name whitespace', () => {
      const agg = SiteAggregate.create({ name: '  ЖК Весна  ' });
      expect(agg.getState().name).toBe('ЖК Весна');
    });

    it('should throw when name is too short', () => {
      expect(() => SiteAggregate.create({ name: 'A' })).toThrow(
        'Site name must be at least 2 characters'
      );
    });

    it('should throw when name is empty', () => {
      expect(() => SiteAggregate.create({ name: '' })).toThrow(
        'Site name must be at least 2 characters'
      );
    });

    it('should emit SiteCreated event', () => {
      const agg = SiteAggregate.create({ name: 'Площадка' }, 'user-1');
      const events = agg.getPendingEvents();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('SiteCreated');
      expect(events[0].aggregateId).toBe(agg.getState().id);
    });
  });

  describe('update', () => {
    it('should update name', () => {
      const agg = SiteAggregate.create({ name: 'Старое имя' });
      agg.update({ name: 'Новое имя' });
      expect(agg.getState().name).toBe('Новое имя');
    });

    it('should update plannedPiles', () => {
      const agg = SiteAggregate.create({ name: 'Site', plannedPiles: 100 });
      agg.update({ plannedPiles: 200 });
      expect(agg.getState().plannedPiles).toBe(200);
    });

    it('should throw when updated name is too short', () => {
      const agg = SiteAggregate.create({ name: 'Valid' });
      expect(() => agg.update({ name: 'X' })).toThrow(
        'Site name must be at least 2 characters'
      );
    });

    it('should emit SiteUpdated event', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.clearPendingEvents();
      agg.update({ plannedDrilling: 500 }, 'admin-1');

      const events = agg.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('SiteUpdated');
    });
  });

  describe('activate / deactivate', () => {
    it('should deactivate an active site', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.deactivate();

      expect(agg.getState().isActive).toBe(false);
      expect(agg.getState().status).toBe('INACTIVE');
    });

    it('should activate an inactive site', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.deactivate();
      agg.activate();

      expect(agg.getState().isActive).toBe(true);
      expect(agg.getState().status).toBe('ACTIVE');
    });

    it('should be idempotent — deactivating inactive site is a no-op', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.clearPendingEvents();
      agg.deactivate();
      const eventsAfterFirst = agg.getPendingEvents().length;

      agg.deactivate(); // second call
      expect(agg.getPendingEvents().length).toBe(eventsAfterFirst);
    });

    it('should be idempotent — activating active site is a no-op', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.clearPendingEvents();
      agg.activate();
      expect(agg.getPendingEvents()).toHaveLength(0);
    });

    it('should emit SiteDeactivated event', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.clearPendingEvents();
      agg.deactivate('admin-1');

      expect(agg.getPendingEvents()).toHaveLength(1);
      expect(agg.getPendingEvents()[0].type).toBe('SiteDeactivated');
    });

    it('should emit SiteActivated event', () => {
      const agg = SiteAggregate.create({ name: 'Site' });
      agg.deactivate();
      agg.clearPendingEvents();
      agg.activate('admin-1');

      expect(agg.getPendingEvents()).toHaveLength(1);
      expect(agg.getPendingEvents()[0].type).toBe('SiteActivated');
    });
  });

  describe('reconstitute', () => {
    it('should rebuild aggregate from state without events', () => {
      const state = {
        id: 'site-1',
        name: 'Test Site',
        tenantId: null,
        status: 'ACTIVE' as const,
        plannedPiles: 100,
        plannedDrilling: 500,
        completionDate: null,
        isActive: true,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const agg = SiteAggregate.reconstitute(state);
      expect(agg.getState()).toEqual(state);
      expect(agg.getPendingEvents()).toHaveLength(0);
    });
  });
});
