import {describe, expect, it} from 'vitest';
import {operatorRouteOwnsNavigation} from '../operator-layout-policy';

describe('политика нижней навигации оператора', () => {
  it.each(['/operator/v2', '/operator/v2/history', '/operator/v3', '/operator/v3/offline'])(
    'скрывает общую панель на маршруте со своей навигацией: %s',
    (pathname) => expect(operatorRouteOwnsNavigation(pathname)).toBe(true),
  );

  it.each(['/operator', '/operator/history', '/admin', '/history'])(
    'сохраняет общую панель на остальных маршрутах: %s',
    (pathname) => expect(operatorRouteOwnsNavigation(pathname)).toBe(false),
  );
});
