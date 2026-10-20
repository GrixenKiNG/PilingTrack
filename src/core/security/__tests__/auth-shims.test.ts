import { describe, expect, it } from 'vitest';
import * as authorization from '../authorization';
import * as resourceAccess from '../resource-access';
import * as password from '../password';
import * as authorizationShim from '@/services/auth/authorization-service';
import * as resourceAccessShim from '@/services/auth/resource-access-service';

// Реализация прав живёт в core; старые пути services/auth — только реэкспорт.
// Если их тела разойдутся, маршруты и модули начнут отвечать по-разному.
describe('реэкспорты services/auth совпадают с core/security', () => {
  it('authorization-service отдаёт те же функции', () => {
    for (const name of Object.keys(authorization) as (keyof typeof authorization)[]) {
      expect(authorizationShim[name]).toBe(authorization[name]);
    }
  });

  it('resource-access-service отдаёт те же функции', () => {
    for (const name of Object.keys(resourceAccess) as (keyof typeof resourceAccess)[]) {
      expect(resourceAccessShim[name]).toBe(resourceAccess[name]);
    }
  });

  it('хеш пароля проверяется той же функцией, что создаёт его', async () => {
    const hash = await password.hashPassword('s3cret-пароль');
    expect(hash.startsWith('$2')).toBe(true);
    expect(await password.verifyPassword('s3cret-пароль', hash)).toBe(true);
    expect(await password.verifyPassword('другой', hash)).toBe(false);
  });
});
