/**
 * J2 (W28-CODEX-J-TESTPLAN): событие без подписчиков не должно считаться
 * доставленным.
 *
 * `emitDomainEvent` при пустом реестре обработчиков пишет warn и `return`-ит —
 * промис разрешается, как будто событие обработано. Outbox-publisher
 * (dispatch-then-claim) в этом случае всё равно клеймит строку `published=true`,
 * поэтому событие, попавшее в окно до регистрации обработчиков (race на старте
 * воркера, N-4), навсегда теряется без ретрая и DLQ.
 *
 * Целевое поведение: пустой реестр — ошибка, пробрасываемая наружу. Тест красный
 * до правки Codex (см. комментарий с it.fails).
 *
 * ВАЖНО: не импортировать `@/services/reports/event-handlers` — иначе реестр
 * заполнится и тест перестанет проверять «нет подписчиков».
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { emitDomainEvent, getHandlerCount } from '../domain-events';
import { REPORT_DOMAIN_EVENT_TYPES } from '@/modules/reports/domain';

describe('шина доменных событий: нет подписчиков (J2)', () => {
  it.fails('J2: ждёт правки Codex; после правки заменить на it(...) — пустой реестр не доставка', async () => {
    // Реестр обработчиков — модуль-синглтон; в этом файле event-handlers не
    // импортируется, поэтому подписчиков быть не должно.
    expect(getHandlerCount(REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED)).toBe(0);

    await expect(
      emitDomainEvent({
        id: 'evt-j2-1',
        type: REPORT_DOMAIN_EVENT_TYPES.REPORT_SUBMITTED,
        aggregateId: 'RM-j2-1',
        aggregateType: 'Report',
        occurredAt: new Date().toISOString(),
        data: {},
      }),
    ).rejects.toThrow(/No handlers/);
  });
});
