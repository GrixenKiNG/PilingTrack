import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OUTBOX_STALE_MS } from '../health-tracker/thresholds';

const mocks = vi.hoisted(() => ({
  outboxStats: vi.fn(),
  findFirst: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: { outboxEvent: { findFirst: mocks.findFirst } },
}));

vi.mock('@/services/reports/outbox-publisher', () => ({
  getOutboxStats: mocks.outboxStats,
}));

const MINUTE = 60 * 1000;

function oldestEventAgo(ms: number) {
  mocks.outboxStats.mockResolvedValue({ unpublished: 3, failed: 0, total: 3 });
  mocks.findFirst.mockResolvedValue({ createdAt: new Date(Date.now() - ms) });
}

/*
  F2 стенда 16.10.2026: публикация outbox остановилась, а /api/health/deep
  оставался зелёным до часа — порог «застрял» был 60 минут, хотя событие
  обычно уходит за ~2 с. Порог — 5 минут.
*/
describe('checkOutbox: порог «застрял» (F2 стенда 16.10)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('порог — 5 минут', () => {
    expect(OUTBOX_STALE_MS).toBe(5 * MINUTE);
  });

  it('самое старое событие старше 5 минут и младше 60 → stalled', async () => {
    oldestEventAgo(10 * MINUTE);

    const { checkOutbox } = await import('../health-tracker/checkers/outbox');
    const result = await checkOutbox();

    expect(result.status).toBe('stalled');
    expect(result.pendingCount).toBe(3);
  });

  it('самое старое событие моложе 5 минут → ok', async () => {
    oldestEventAgo(4 * MINUTE);

    const { checkOutbox } = await import('../health-tracker/checkers/outbox');
    const result = await checkOutbox();

    expect(result.status).toBe('ok');
  });

  it('очередь пуста → ok, запрос самого старого не делается', async () => {
    mocks.outboxStats.mockResolvedValue({ unpublished: 0, failed: 0, total: 0 });

    const { checkOutbox } = await import('../health-tracker/checkers/outbox');
    const result = await checkOutbox();

    expect(result.status).toBe('ok');
    expect(mocks.findFirst).not.toHaveBeenCalled();
  });
});
