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

    // Читать список работников и распоряжаться им — разные права. Диспетчер
    // закрепляет людей за объектом (`sites.assign_users`) и смотрит чужие
    // отчёты; исполнить это, не видя списка людей, невозможно. Раньше список
    // требовал `users.manage`, и диспетчеру приходил 403, а экран рисовал его
    // как «0 пользователей». Заводить и удалять работников по-прежнему может
    // только администратор — это и проверяет вторая половина теста.
    it('separates reading the staff roster from managing it', () => {
      expect(can({ role: 'ADMIN' }, 'users.read')).toBe(true);
      expect(can({ role: 'DISPATCHER' }, 'users.read')).toBe(true);
      expect(can({ role: 'FOREMAN' }, 'users.read')).toBe(true);
      expect(can({ role: 'SAFETY_ENGINEER' }, 'users.read')).toBe(true);
      expect(can({ role: 'OPERATOR' }, 'users.read')).toBe(false);
      expect(can({ role: 'ASSISTANT' }, 'users.read')).toBe(false);

      expect(can({ role: 'DISPATCHER' }, 'users.manage')).toBe(false);
      expect(can({ role: 'FOREMAN' }, 'users.manage')).toBe(false);
      expect(can({ role: 'SAFETY_ENGINEER' }, 'users.manage')).toBe(false);
    });

    // Кто закрепляет людей за объектом — обязан видеть список людей.
    it('gives the roster to every role that can assign users to a site', () => {
      for (const role of ['ADMIN', 'DISPATCHER'] as const) {
        expect(can({ role }, 'sites.assign_users')).toBe(true);
        expect(can({ role }, 'users.read')).toBe(true);
      }
    });

    // Механик. Роль живёт сразу в двух системах: матрица готовности
    // (`readiness/domain/capability-defaults.ts`) говорит, что он ведёт
    // осмотры, наряды ТО, моточасы и дефекты, — а здесь у него не было ни
    // одного права, и центр готовности отвечал ему 403 по бригадам,
    // обслуживанию, шаблонам осмотра и карточке установки. Экран показывал
    // отказ как «осмотра ещё не было»: недоступность первоисточника
    // превращалась в утверждение о технике. Права ниже — не расширение, а
    // приведение второй системы к тому, что первая уже разрешила.
    it('gives MECHANIC the abilities its readiness capabilities already imply', () => {
      expect(can({ role: 'MECHANIC' }, 'maintenance.manage')).toBe(true);
      expect(can({ role: 'MECHANIC' }, 'inspection.perform')).toBe(true);
      expect(can({ role: 'MECHANIC' }, 'meter.record')).toBe(true);
      expect(can({ role: 'MECHANIC' }, 'crews.read')).toBe(true);
      expect(can({ role: 'MECHANIC' }, 'equipment.read')).toBe(true);
    });

    // Граница роли: механик обслуживает технику, а не распоряжается
    // предприятием. Всё, что заводит, удаляет и назначает, остаётся закрытым.
    it('keeps MECHANIC out of everything that manages the business', () => {
      for (const ability of [
        'equipment.manage', 'crews.manage', 'users.read', 'users.manage',
        'sites.manage', 'sites.assign_users', 'reports.export', 'system.read',
      ] as const) {
        expect(can({ role: 'MECHANIC' }, ability)).toBe(false);
      }
    });

    // Читать карточку установки и распоряжаться парком — разные права.
    // Раньше карточку закрывало system.read (диагностика системы), взятое как
    // синоним «админ или диспетчер»; механику она из-за этого не открывалась.
    it('separates reading an equipment card from managing the fleet', () => {
      for (const role of ['ADMIN', 'DISPATCHER', 'MECHANIC', 'SAFETY_ENGINEER'] as const) {
        expect(can({ role }, 'equipment.read')).toBe(true);
      }
      // Право на чтение карточки не даёт распоряжаться парком ни одной из них.
      expect(can({ role: 'MECHANIC' }, 'equipment.manage')).toBe(false);
      expect(can({ role: 'SAFETY_ENGINEER' }, 'equipment.manage')).toBe(false);
      expect(can({ role: 'DISPATCHER' }, 'equipment.manage')).toBe(false);
      expect(can({ role: 'OPERATOR' }, 'equipment.read')).toBe(false);
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
