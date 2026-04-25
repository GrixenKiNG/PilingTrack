/**
 * Integration tests for the role/ability authorization matrix.
 *
 * The matrix in src/services/auth/authorization-service.ts is the single
 * source of truth for what each role can do. Tests pin every ability to
 * the explicit list of allowed roles so a silent matrix change shows up
 * here as a regression instead of as a production privilege escalation.
 */

import { describe, it, expect } from 'vitest';
import {
  can,
  assertCan,
  assertRole,
  assertAnyRole,
  isPrivilegedRole,
  type Ability,
} from '@/services/auth/authorization-service';

const A = (id: string, role: string) => ({ id, role });

describe('authorization — privileged role classification', () => {
  it('flags ADMIN and DISPATCHER as privileged', () => {
    expect(isPrivilegedRole('ADMIN')).toBe(true);
    expect(isPrivilegedRole('DISPATCHER')).toBe(true);
  });

  it('does not flag OPERATOR or ASSISTANT as privileged', () => {
    expect(isPrivilegedRole('OPERATOR')).toBe(false);
    expect(isPrivilegedRole('ASSISTANT')).toBe(false);
  });

  it('does not flag unknown roles', () => {
    expect(isPrivilegedRole('GUEST')).toBe(false);
    expect(isPrivilegedRole('')).toBe(false);
  });
});

describe('authorization — ability matrix snapshot', () => {
  // Pin every ability to its expected roles. If the matrix in
  // authorization-service.ts changes, this test fails loudly.
  const matrix: Record<Ability, string[]> = {
    'analytics.read': ['ADMIN', 'DISPATCHER'],
    'reports.read_all': ['ADMIN', 'DISPATCHER'],
    'reports.read_cross_user': ['ADMIN', 'DISPATCHER'],
    'reports.export': ['ADMIN'],
    'reports.manage_all': ['ADMIN', 'DISPATCHER'],
    'sites.read_all': ['ADMIN', 'DISPATCHER'],
    'sites.manage': ['ADMIN', 'DISPATCHER'],
    'sites.assign_users': ['ADMIN', 'DISPATCHER'],
    'sites.manage_hierarchy': ['ADMIN', 'DISPATCHER'],
    'users.manage': ['ADMIN'],
    'equipment.manage': ['ADMIN'],
    'crews.read': ['ADMIN', 'DISPATCHER'],
    'crews.manage': ['ADMIN', 'DISPATCHER'],
    'crews.legacy_manage': ['ADMIN'],
    'dictionary.manage': ['ADMIN'],
    'telegram.manage': ['ADMIN'],
    'system.read': ['ADMIN', 'DISPATCHER'],
    'media.upload': ['ADMIN', 'DISPATCHER', 'OPERATOR'],
  };

  const allRoles = ['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT'] as const;

  for (const [ability, allowed] of Object.entries(matrix) as [Ability, string[]][]) {
    for (const role of allRoles) {
      const shouldBeAllowed = allowed.includes(role);
      it(`${ability}: ${role} ${shouldBeAllowed ? 'allowed' : 'denied'}`, () => {
        expect(can(A('u1', role), ability)).toBe(shouldBeAllowed);
      });
    }
  }
});

describe('authorization — assertion helpers', () => {
  it('assertCan throws ServiceError 403 when ability denied', () => {
    expect(() => assertCan(A('u1', 'OPERATOR'), 'users.manage')).toThrow(/Доступ запрещён/);
  });

  it('assertCan does not throw when ability allowed', () => {
    expect(() => assertCan(A('u1', 'ADMIN'), 'users.manage')).not.toThrow();
  });

  it('assertRole rejects mismatched role', () => {
    expect(() => assertRole(A('u1', 'OPERATOR'), 'ADMIN')).toThrow(/Доступ запрещён/);
  });

  it('assertAnyRole accepts when role is in the list', () => {
    expect(() => assertAnyRole(A('u1', 'DISPATCHER'), ['ADMIN', 'DISPATCHER'])).not.toThrow();
  });

  it('assertAnyRole rejects when role is not in the list', () => {
    expect(() => assertAnyRole(A('u1', 'ASSISTANT'), ['ADMIN', 'DISPATCHER'])).toThrow();
  });
});

describe('authorization — least-privilege regressions', () => {
  it('OPERATOR cannot manage users', () => {
    expect(can(A('u1', 'OPERATOR'), 'users.manage')).toBe(false);
  });

  it('OPERATOR cannot read all reports (cross-user)', () => {
    expect(can(A('u1', 'OPERATOR'), 'reports.read_cross_user')).toBe(false);
  });

  it('DISPATCHER cannot manage users (admin-only)', () => {
    expect(can(A('u1', 'DISPATCHER'), 'users.manage')).toBe(false);
  });

  it('DISPATCHER cannot manage equipment (admin-only)', () => {
    expect(can(A('u1', 'DISPATCHER'), 'equipment.manage')).toBe(false);
  });

  it('DISPATCHER cannot export reports (admin-only)', () => {
    expect(can(A('u1', 'DISPATCHER'), 'reports.export')).toBe(false);
  });

  it('ASSISTANT has no privileged abilities at all', () => {
    const abilities: Ability[] = [
      'reports.manage_all',
      'sites.manage',
      'users.manage',
      'equipment.manage',
      'crews.manage',
    ];
    for (const ability of abilities) {
      expect(can(A('u1', 'ASSISTANT'), ability)).toBe(false);
    }
  });
});
