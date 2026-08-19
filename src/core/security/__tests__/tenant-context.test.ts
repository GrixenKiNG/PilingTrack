import { describe, it, expect } from 'vitest';
import {
  runWithTenantContext,
  setRequestTenantId,
  getRequestTenantId,
  hasTenantContext,
} from '../tenant-context';

describe('контекст тенанта запроса', () => {
  it('вне контекста не падает и сообщает, что тенанта нет', () => {
    expect(hasTenantContext()).toBe(false);
    expect(getRequestTenantId()).toBeNull();
    // Воркеры и тесты зовут requireAuth вне обёртки маршрута — падать не за что.
    expect(() => setRequestTenantId('orion')).not.toThrow();
  });

  it('открытый контекст начинается пустым, а не с чужого тенанта', () => {
    runWithTenantContext(() => {
      expect(hasTenantContext()).toBe(true);
      expect(getRequestTenantId()).toBeNull();
    });
  });

  it('отдаёт тенанта, записанного аутентификацией', () => {
    runWithTenantContext(() => {
      setRequestTenantId('orion');
      expect(getRequestTenantId()).toBe('orion');
    });
  });

  it('не пропускает тенанта наружу после запроса', () => {
    runWithTenantContext(() => setRequestTenantId('orion'));
    expect(getRequestTenantId()).toBeNull();
  });

  /**
   * Главное свойство: соседние запросы не видят тенанта друг друга. Именно
   * ради этого взят AsyncLocalStorage, а не модульная переменная — под
   * нагрузкой обработчики чередуются на каждом await, и общая переменная
   * отдала бы данные одного тенанта другому.
   */
  it('держит тенантов раздельно у запросов, идущих вперемешку', async () => {
    const seen: string[] = [];

    const request = (tenantId: string, delayMs: number) =>
      runWithTenantContext(async () => {
        setRequestTenantId(tenantId);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        seen.push(`${tenantId}:${getRequestTenantId()}`);
      });

    // Второй запрос стартует позже, но завершается раньше первого.
    await Promise.all([request('orion', 20), request('stranger', 1)]);

    expect(seen.sort()).toEqual(['orion:orion', 'stranger:stranger']);
  });

  it('переприсвоение другого тенанта внутри запроса — ошибка, а не тихая подмена', () => {
    runWithTenantContext(() => {
      setRequestTenantId('orion');
      expect(() => setRequestTenantId('stranger')).toThrow(/reassigned/);
      expect(getRequestTenantId()).toBe('orion');
    });
  });

  it('повторная запись того же тенанта безобидна', () => {
    runWithTenantContext(() => {
      setRequestTenantId('orion');
      expect(() => setRequestTenantId('orion')).not.toThrow();
    });
  });

  it('неаутентифицированный запрос оставляет контекст пустым', () => {
    runWithTenantContext(() => {
      setRequestTenantId(null);
      expect(getRequestTenantId()).toBeNull();
    });
  });
});

describe('хранилище одно на процесс', () => {
  /**
   * Next.js собирает маршруты, instrumentation и фоновые задачи разными
   * сборками, и каждая получает свой экземпляр модуля. Если хранилище держать
   * в переменной модуля, обёртка маршрута положит тенанта в одно, а
   * расширение Prisma прочитает из другого — и никогда ничего не найдёт.
   * Замерено на стенде 19.08.2026: три экземпляра, тенант до базы не доходил.
   *
   * Проверяем не «две сборки» (в тестах их не создать), а сам приём: экземпляр
   * лежит в globalThis, а не заводится модулем заново.
   */
  it('лежит в globalThis, а не в переменной модуля', () => {
    const stored = (globalThis as { tenantContextStorage?: unknown }).tenantContextStorage;
    expect(stored).toBeDefined();
  });

  it('запись через модуль видна через экземпляр из globalThis', () => {
    const storage = (globalThis as {
      tenantContextStorage?: { getStore(): { tenantId: string | null } | undefined };
    }).tenantContextStorage;

    runWithTenantContext(() => {
      setRequestTenantId('orion');
      // Вторая сборка добралась бы до тенанта именно так — через общий
      // экземпляр. Если он окажется другим, здесь будет undefined.
      expect(storage?.getStore()?.tenantId).toBe('orion');
    });
  });
});
