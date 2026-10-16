// @vitest-environment node
import {describe, expect, it} from 'vitest';
import {authFailureResponse} from '../auth-failure';

/*
  ОТКАЗ ПРОВЕРКИ СЕССИИ: «ВОЙДИТЕ» ИЛИ «ПОДОЖДИТЕ» (аудит 16.10.2026, P2 D-20261016-002).

  Мобильные маршруты любой отказ requireAuth переписывали в 401 «Войдите в систему».
  Но requireAuth возвращает 500, когда сама проверка упала (база недоступна), а
  сессия при этом цела и после восстановления работает без входа. Человек шёл
  заново входить, хотя нужно было подождать. Настоящий отказ остаётся 401.
*/
const upstream = (status: number) => new Response('{}', {status});

describe('authFailureResponse', () => {
  it('нет сессии или она недействительна — 401 «Войдите в систему»', async () => {
    for (const error of [upstream(401), upstream(403), null, undefined]) {
      const response = authFailureResponse(error);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({error: 'Войдите в систему'});
    }
  });

  it.each([500, 502, 503])('сбой самой проверки (%i) — 503 без просьбы входить', async (status) => {
    const response = authFailureResponse(upstream(status));

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('15');
    const body = await response.json() as {error: string};
    expect(body.error).toMatch(/временно недоступен/i);
    expect(body.error).toMatch(/входить заново не нужно/i);
    expect(body.error).not.toMatch(/войдите/i);
  });
});
