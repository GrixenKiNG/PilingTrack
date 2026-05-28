/**
 * Equipment Aggregate — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { EquipmentAggregate } from '../equipment.aggregate';

describe('EquipmentAggregate', () => {
  describe('create', () => {
    it('should create equipment with required fields', () => {
      const agg = EquipmentAggregate.create({ name: 'Буровая D5', tenantId: 'orion' });
      const state = agg.getState();

      expect(state.name).toBe('Буровая D5');
      expect(state.model).toBe('');
      expect(state.qty).toBe(1);
      expect(state.isActive).toBe(true);
      expect(state.tenantId).toBe('orion');
      expect(state.id).toBeDefined();
    });

    it('should create equipment with all fields', () => {
      const agg = EquipmentAggregate.create({
        name: 'Кран КС-55',
        model: 'KC-55713-1K',
        qty: 3,
        description: 'Автокран 25 тонн',
        tenantId: 'orion',
      });
      const state = agg.getState();

      expect(state.model).toBe('KC-55713-1K');
      expect(state.qty).toBe(3);
      expect(state.description).toBe('Автокран 25 тонн');
    });

    it('should trim name whitespace', () => {
      const agg = EquipmentAggregate.create({ name: '  Насос  ', tenantId: 'orion' });
      expect(agg.getState().name).toBe('Насос');
    });

    it('should throw when name is empty', () => {
      expect(() => EquipmentAggregate.create({ name: '', tenantId: 'orion' })).toThrow(
        'Equipment name is required'
      );
    });

    it('should throw when name is whitespace only', () => {
      expect(() => EquipmentAggregate.create({ name: '   ', tenantId: 'orion' })).toThrow(
        'Equipment name is required'
      );
    });

    it('should emit EquipmentCreated event', () => {
      const agg = EquipmentAggregate.create({ name: 'Сваебой', tenantId: 'orion' }, 'user-1');
      const events = agg.getPendingEvents();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('EquipmentCreated');
      expect(events[0].aggregateId).toBe(agg.getState().id);
    });

    it('should store tenantId in state and toPersistence', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'tenant-b' });
      expect(agg.getState().tenantId).toBe('tenant-b');
      expect(agg.toPersistence().tenantId).toBe('tenant-b');
    });
  });

  describe('update', () => {
    it('should update name', () => {
      const agg = EquipmentAggregate.create({ name: 'Old Name', tenantId: 'orion' });
      agg.update({ name: 'New Name' });
      expect(agg.getState().name).toBe('New Name');
    });

    it('should update qty', () => {
      const agg = EquipmentAggregate.create({ name: 'Pump', qty: 1, tenantId: 'orion' });
      agg.update({ qty: 5 });
      expect(agg.getState().qty).toBe(5);
    });

    it('should throw when updated name is empty', () => {
      const agg = EquipmentAggregate.create({ name: 'Valid', tenantId: 'orion' });
      expect(() => agg.update({ name: '' })).toThrow('Name required');
    });

    it('should emit EquipmentUpdated event', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'orion' });
      agg.clearPendingEvents();
      agg.update({ model: 'XR-2000' }, 'user-1');

      const events = agg.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('EquipmentUpdated');
    });
  });

  describe('retire', () => {
    it('should set isActive to false', () => {
      const agg = EquipmentAggregate.create({ name: 'Old Drill', tenantId: 'orion' });
      agg.retire();
      expect(agg.getState().isActive).toBe(false);
    });

    it('should emit EquipmentRetired event', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'orion' });
      agg.clearPendingEvents();
      agg.retire('admin-1');

      const events = agg.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('EquipmentRetired');
    });
  });

  describe('reconstitute', () => {
    it('should rebuild aggregate from state', () => {
      const state = {
        id: 'eq-1',
        name: 'Pump',
        model: 'P-100',
        qty: 2,
        description: '',
        isActive: true,
        tenantId: 'orion',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const agg = EquipmentAggregate.reconstitute(state);
      expect(agg.getState()).toEqual(state);
      expect(agg.getPendingEvents()).toHaveLength(0);
    });
  });

  describe('clearPendingEvents', () => {
    it('should clear all pending events', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'orion' });
      expect(agg.getPendingEvents()).toHaveLength(1);
      agg.clearPendingEvents();
      expect(agg.getPendingEvents()).toHaveLength(0);
    });
  });
});
