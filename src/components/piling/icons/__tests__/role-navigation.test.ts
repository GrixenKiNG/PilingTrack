import { describe, expect, it } from 'vitest';
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
      ['/operator', 'home'],
      ['/history', 'history'],
    ]);
    expect(ROLE_NAVIGATION.ASSISTANT).toEqual(ROLE_NAVIGATION.OPERATOR);
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
