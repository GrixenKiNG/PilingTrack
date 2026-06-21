import { describe, it, expect } from 'vitest';
import {
  can,
  assertCan,
  assertRole,
  assertAnyRole,
  assertNotSelfAction,
  isPrivilegedRole,
  resolveUserScope,
} from '../authorization-service';
import { ServiceError } from '@/services/service-error';

describe('authorization-service', () => {
  describe('isPrivilegedRole', () => {
    it('returns true for ADMIN', () => {
      expect(isPrivilegedRole('ADMIN')).toBe(true);
    });

    it('returns true for DISPATCHER', () => {
      expect(isPrivilegedRole('DISPATCHER')).toBe(true);
    });

    it('returns false for OPERATOR', () => {
      expect(isPrivilegedRole('OPERATOR')).toBe(false);
    });

    it('returns false for ASSISTANT', () => {
      expect(isPrivilegedRole('ASSISTANT')).toBe(false);
    });
  });

  describe('can', () => {
    it('allows ADMIN to manage users', () => {
      expect(can({ role: 'ADMIN' }, 'users.manage')).toBe(true);
    });

    it('denies OPERATOR from managing users', () => {
      expect(can({ role: 'OPERATOR' }, 'users.manage')).toBe(false);
    });

    it('allows DISPATCHER to read analytics', () => {
      expect(can({ role: 'DISPATCHER' }, 'analytics.read')).toBe(true);
    });

    it('denies OPERATOR from reading analytics', () => {
      expect(can({ role: 'OPERATOR' }, 'analytics.read')).toBe(false);
    });

    it('allows only ADMIN to export reports', () => {
      expect(can({ role: 'ADMIN' }, 'reports.export')).toBe(true);
      expect(can({ role: 'DISPATCHER' }, 'reports.export')).toBe(false);
      expect(can({ role: 'OPERATOR' }, 'reports.export')).toBe(false);
    });

    it('allows ADMIN and DISPATCHER to manage crews', () => {
      expect(can({ role: 'ADMIN' }, 'crews.manage')).toBe(true);
      expect(can({ role: 'DISPATCHER' }, 'crews.manage')).toBe(true);
      expect(can({ role: 'OPERATOR' }, 'crews.manage')).toBe(false);
    });
  });

  describe('assertCan', () => {
    it('does not throw when allowed', () => {
      expect(() => assertCan({ role: 'ADMIN' }, 'users.manage')).not.toThrow();
    });

    it('throws ServiceError 403 when denied', () => {
      expect(() => assertCan({ role: 'OPERATOR' }, 'users.manage')).toThrow(ServiceError);
      expect(() => assertCan({ role: 'OPERATOR' }, 'users.manage')).toThrow('Доступ запрещён');
    });
  });

  describe('assertRole', () => {
    it('does not throw when role matches', () => {
      expect(() => assertRole({ role: 'ADMIN' }, 'ADMIN')).not.toThrow();
    });

    it('throws 403 when role does not match', () => {
      expect(() => assertRole({ role: 'OPERATOR' }, 'ADMIN')).toThrow(ServiceError);
    });
  });

  describe('assertAnyRole', () => {
    it('does not throw when role is in list', () => {
      expect(() => assertAnyRole({ role: 'DISPATCHER' }, ['ADMIN', 'DISPATCHER'])).not.toThrow();
    });

    it('throws 403 when role is not in list', () => {
      expect(() => assertAnyRole({ role: 'ASSISTANT' }, ['ADMIN', 'DISPATCHER'])).toThrow(
        ServiceError
      );
    });
  });

  describe('assertNotSelfAction', () => {
    it('does not throw when IDs differ', () => {
      expect(() => assertNotSelfAction('user-1', 'user-2', 'Cannot modify self')).not.toThrow();
    });

    it('throws 400 when IDs match', () => {
      expect(() => assertNotSelfAction('user-1', 'user-1', 'Cannot modify self')).toThrow(
        ServiceError
      );
      expect(() => assertNotSelfAction('user-1', 'user-1', 'Cannot modify self')).toThrow(
        'Cannot modify self'
      );
    });
  });

  describe('resolveUserScope', () => {
    it('returns session user id when no requested user', () => {
      const result = resolveUserScope({ id: 'actor-1', role: 'OPERATOR' });
      expect(result).toBe('actor-1');
    });

    it('returns requested user when it matches session user', () => {
      const result = resolveUserScope(
        { id: 'actor-1', role: 'OPERATOR' },
        'actor-1'
      );
      expect(result).toBe('actor-1');
    });

    it('allows ADMIN to access other user scope', () => {
      const result = resolveUserScope(
        { id: 'admin-1', role: 'ADMIN' },
        'other-user',
        'reports.read_cross_user'
      );
      expect(result).toBe('other-user');
    });

    it('denies OPERATOR from accessing other user scope', () => {
      expect(() =>
        resolveUserScope(
          { id: 'operator-1', role: 'OPERATOR' },
          'other-user',
          'reports.read_cross_user'
        )
      ).toThrow(ServiceError);
    });
  });
});
