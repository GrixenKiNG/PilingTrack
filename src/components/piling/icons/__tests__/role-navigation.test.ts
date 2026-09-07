import { describe, expect, it } from 'vitest';
import { ASSISTANT_HOME_ROUTE, OPERATOR_HOME_ROUTE } from '@/lib/routes';
import { ROLE_NAVIGATION } from '../role-navigation';

const emojiPattern = /[\p{Extended_Pictographic}]/u;

describe('ROLE_NAVIGATION', () => {
  it('defines an icon for every route without emoji labels', () => {
    for (const items of Object.values(ROLE_NAVIGATION)) {
      for (const item of items) {
        expect(item.icon).toBeTruthy();
        expect(item.label).not.toMatch(emojiPattern);
      }
    }
  });

  it('covers the operator workflow routes', () => {
    expect(ROLE_NAVIGATION.OPERATOR.map(({ href, icon }) => [href, icon])).toEqual([
      [OPERATOR_HOME_ROUTE, 'home'],
      ['/history', 'history'],
    ]);
    // У помощника своё место, а не урезанное место машиниста: рабочее место
    // машиниста отвечает ему отказом, и пункт меню, ведущий в отказ, — это
    // тупик. Его экран — собственный допуск.
    expect(ROLE_NAVIGATION.ASSISTANT.map(({ href }) => href))
      .toEqual([ASSISTANT_HOME_ROUTE, '/history']);
    expect(ROLE_NAVIGATION.ASSISTANT.map(({ href }) => href)).not.toContain(OPERATOR_HOME_ROUTE);
  });

  /**
   * Обходных путей мимо шага смены быть не должно.
   *
   * Экран смены закрывает недоступные шаги замком, но замок держит, только
   * пока те же места не открыты из панели снизу. Отчёт, начатый до пуска,
   * заводился без `shiftId` и к смене уже не привязывался — смену нельзя было
   * сдать. Тест сторожит именно это, а не длину списка.
   */
  it('keeps the operator out of routes that bypass the shift step', () => {
    const routes = ROLE_NAVIGATION.OPERATOR.map((item) => item.href);
    for (const bypass of ['/report', '/admin/to', '/monitoring']) {
      expect(routes).not.toContain(bypass);
    }
  });

  it('keeps administrator-only destinations out of dispatcher navigation', () => {
    const adminRoutes = ROLE_NAVIGATION.ADMIN.map((item) => item.href);
    const dispatcherRoutes = ROLE_NAVIGATION.DISPATCHER.map((item) => item.href);

    expect(adminRoutes).toContain('/admin/users');
    expect(adminRoutes).toContain('/admin/dictionaries');
    expect(dispatcherRoutes).not.toContain('/admin/users');
    expect(dispatcherRoutes).not.toContain('/admin/dictionaries');
    expect(dispatcherRoutes).toContain('/admin/to');
  });

  /**
   * Право без дороги — это тот же тупик, что дорога без права.
   *
   * `incidents.read` разрешён администратору, диспетчеру, мастеру и инженеру
   * ОТ, но в меню «Происшествия» стояли только у первых двух. Инженер ОТ —
   * один из трёх, кому разрешено закрывать происшествие разбором, — попадал
   * на экран только по прямому адресу.
   */
  it('gives every role that may read incidents a way to reach them', () => {
    for (const role of ['ADMIN', 'DISPATCHER', 'FOREMAN', 'SAFETY_ENGINEER'] as const) {
      expect(ROLE_NAVIGATION[role].map((item) => item.href)).toContain('/admin/incidents');
    }
    for (const role of ['OPERATOR', 'ASSISTANT', 'MECHANIC'] as const) {
      expect(ROLE_NAVIGATION[role].map((item) => item.href)).not.toContain('/admin/incidents');
    }
  });

  it('gives mechanics only the readiness destination', () => {
    expect(ROLE_NAVIGATION.MECHANIC.map((item) => item.href)).toEqual(['/admin/to']);
  });

  it('folds Telegram and DLQ into Settings (out of top-level navigation)', () => {
    for (const items of Object.values(ROLE_NAVIGATION)) {
      const routes = items.map((item) => item.href);
      expect(routes).not.toContain('/admin/telegram');
      expect(routes).not.toContain('/admin/dlq');
    }
  });

  it('places Settings at the very end for admin and dispatcher', () => {
    for (const role of ['ADMIN', 'DISPATCHER'] as const) {
      const items = ROLE_NAVIGATION[role];
      expect(items[items.length - 1].href).toBe('/admin/settings');
    }
  });
});
