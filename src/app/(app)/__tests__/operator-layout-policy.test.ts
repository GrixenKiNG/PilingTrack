import {describe, expect, it} from 'vitest';
import {operatorRouteOwnsNavigation} from '../operator-layout-policy';

describe('политика нижней навигации оператора', () => {
  it.each(['/operator', '/operator/v2', '/operator/v2/history'])(
    'скрывает общую панель на маршруте со своей навигацией: %s',
    (pathname) => expect(operatorRouteOwnsNavigation(pathname)).toBe(true),
  );

  it.each(['/operator/history', '/operator/v3', '/admin', '/history'])(
    'сохраняет общую панель на остальных маршрутах: %s',
    (pathname) => expect(operatorRouteOwnsNavigation(pathname)).toBe(false),
  );
});
