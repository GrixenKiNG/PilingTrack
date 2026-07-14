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
      ['/report', 'shift-start'],
      ['/monitoring', 'monitoring'],
      ['/history', 'history'],
    ]);
    expect(ROLE_NAVIGATION.ASSISTANT).toEqual(ROLE_NAVIGATION.OPERATOR);
  });

  it('keeps administrator-only destinations out of dispatcher navigation', () => {
    const adminRoutes = ROLE_NAVIGATION.ADMIN.map((item) => item.href);
    const dispatcherRoutes = ROLE_NAVIGATION.DISPATCHER.map((item) => item.href);

    expect(adminRoutes).toEqual(expect.arrayContaining(['/admin/users', '/admin/telegram', '/admin/dlq']));
    expect(dispatcherRoutes).not.toEqual(expect.arrayContaining(['/admin/users', '/admin/telegram', '/admin/dlq']));
    expect(dispatcherRoutes).toContain('/admin/to');
  });
});

