/**
 * moveToDlq — сбой записи в DLQ не должен теряться (находка Codex XP45).
 *
 * Раньше moveToDlq при сбое записи только логировал ошибку и возвращал успех,
 * а издатель сразу помечал строку outbox обработанной: событие не попадало в
 * DLQ и больше не повторялось, то есть пропадало без следа. Теперь ошибка
 * пробрасывается, и издатель оставляет строку необработанной для повтора.
 */
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    deadLetterQueue: { create: mocks.create },
  },
}));

vi.mock('@/lib/logger', () => ({
  logger: {
    error: mocks.error,
    warn: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock('@/core/security/tenant-context', () => ({
  getRequestTenantId: vi.fn(),
}));

beforeEach(() => {
  vi.resetAllMocks();
});

it('пробрасывает исходную ошибку записи в DLQ', async () => {
  const { moveToDlq } = await import('../dead-letter-queue');
  const failure = new Error('DLQ insert rejected');
  mocks.create.mockRejectedValueOnce(failure);

  await expect(
    moveToDlq(
      'outbox-1',
      'ReportCreated',
      'report-1',
      { reportId: 'report-1' },
      new Error('handler failed'),
      5,
      {
        tenantId: 'tenant-1',
        aggregateType: 'Report',
        consumer: 'published',
      },
    ),
  ).rejects.toBe(failure);

  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.error).toHaveBeenCalledWith(
    'DLQ: failed to move event to DLQ',
    failure,
  );
});
