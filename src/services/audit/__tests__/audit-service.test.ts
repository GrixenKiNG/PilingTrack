/**
 * audit-service tests.
 *
 * The contract:
 *   - every recordAuditEvent call MUST emit a logger.info('audit', ...)
 *     (Pino structured event — what Loki/Grafana scrapes)
 *   - it ALSO writes a user-facing FeedbackEvent through
 *     recordFeedbackEvent, with severity mapped from the action
 *   - feedback-write failure MUST NOT propagate (audit is best-effort
 *     persistence; the main action that triggered it already happened)
 *   - when actorId is given, the actor's name/role are read from the user
 *     table so the /admin feed can show «Инициатор»; that lookup failing is
 *     NOT allowed to lose the event
 *
 * If the action→(title, level) map ever changes, this file is the
 * checklist. UI badges / Telegram alerts depend on these levels.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  recordFeedbackEvent: vi.fn().mockResolvedValue(undefined),
  loggerInfo: vi.fn(),
  loggerWarn: vi.fn(),
  userFindUnique: vi.fn(),
}));

vi.mock('@/services/feedback/feedback-event-service', () => ({
  recordFeedbackEvent: mocks.recordFeedbackEvent,
}));

vi.mock('@/lib/db', () => ({
  db: { user: { findUnique: mocks.userFindUnique } },
}));

vi.mock('@/lib/logger', () => ({
  logger: { info: mocks.loggerInfo, warn: mocks.loggerWarn, error: vi.fn(), debug: vi.fn() },
}));

import { recordAuditEvent } from '../audit-service';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.recordFeedbackEvent.mockResolvedValue(undefined);
  mocks.userFindUnique.mockResolvedValue(null);
});

describe('recordAuditEvent — logging', () => {
  it('always logs at info level under the "audit" message name', async () => {
    await recordAuditEvent({
      action: 'auth.login.succeeded',
      scope: 'auth',
      actorId: 'u-1',
    });

    expect(mocks.loggerInfo).toHaveBeenCalledWith(
      'audit',
      expect.objectContaining({ action: 'auth.login.succeeded', scope: 'auth' }),
    );
  });

  it('logs even when the feedback write fails', async () => {
    mocks.recordFeedbackEvent.mockRejectedValue(new Error('db down'));

    await recordAuditEvent({ action: 'report.created', scope: 'reports' });

    expect(mocks.loggerInfo).toHaveBeenCalledOnce();
  });
});

describe('recordAuditEvent — action → severity mapping', () => {
  it.each([
    // [action, expectedLevel, expectedPriority]
    ['auth.login.succeeded', 'success', 'LOW'],
    ['auth.login.failed', 'warn', 'HIGH'],
    ['auth.login.rate_limited', 'warn', 'HIGH'],
    ['auth.logout.succeeded', 'info', 'MEDIUM'],
    ['report.created', 'success', 'LOW'],
    ['report.updated', 'info', 'MEDIUM'],
  ] as const)('maps %s → level=%s priority=%s', async (action, level, priority) => {
    await recordAuditEvent({ action, scope: 'test' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ level, priority, action }),
    );
  });

  it('falls back to audit/MEDIUM for unknown actions and uses the action as the title', async () => {
    await recordAuditEvent({ action: 'site.archived', scope: 'sites' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'audit',
        priority: 'MEDIUM',
        title: 'site.archived',
        message: expect.stringContaining('sites'),
      }),
    );
  });
});

describe('recordAuditEvent — context propagation', () => {
  it('passes actorId, targetId, requestId, metadata into the feedback event', async () => {
    await recordAuditEvent({
      action: 'report.updated',
      scope: 'reports',
      actorId: 'op-1',
      targetId: 'report-7',
      requestId: 'req-abc',
      tenantId: 'orion',
      metadata: { fieldsChanged: ['status'] },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: 'op-1' },
        targetId: 'report-7',
        requestId: 'req-abc',
        metadata: { fieldsChanged: ['status'] },
        scope: 'reports',
        audience: 'OPERATIONS',
      }),
    );
  });

  it('sends actor=null when actorId is missing (anonymous events)', async () => {
    await recordAuditEvent({ action: 'auth.login.failed', scope: 'auth' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: null }),
    );
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
  });

  // Лента /admin рисует «Инициатора» только при заполненном actorName —
  // раньше им не был никто, и в строке события не было видно, кто это сделал.
  it('подставляет имя и роль актора из справочника пользователей', async () => {
    mocks.userFindUnique.mockResolvedValue({ name: 'Петров И.И.', role: 'OPERATOR' });

    await recordAuditEvent({ action: 'site.updated', scope: 'sites', actorId: 'op-1' });

    expect(mocks.userFindUnique).toHaveBeenCalledWith({
      where: { id: 'op-1' },
      select: { name: true, role: true },
    });
    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: 'op-1', name: 'Петров И.И.', role: 'OPERATOR' },
      }),
    );
  });

  // Имя — украшение записи: сбой этого чтения не повод терять само событие.
  it('пишет событие без имени, когда чтение пользователя упало', async () => {
    mocks.userFindUnique.mockRejectedValue(new Error('db down'));

    await recordAuditEvent({ action: 'site.updated', scope: 'sites', actorId: 'op-1' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { id: 'op-1' } }),
    );
  });

  it('пишет событие без имени, когда пользователь не найден', async () => {
    mocks.userFindUnique.mockResolvedValue(null);

    await recordAuditEvent({ action: 'site.updated', scope: 'sites', actorId: 'op-1' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ actor: { id: 'op-1' } }),
    );
  });

  it('replaces undefined metadata with null (predictable shape for downstream)', async () => {
    await recordAuditEvent({ action: 'report.created', scope: 'reports' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: null, targetId: null, requestId: null }),
    );
  });
});

describe('recordAuditEvent — failure isolation', () => {
  it('does not throw when recordFeedbackEvent rejects', async () => {
    mocks.recordFeedbackEvent.mockRejectedValue(new Error('feedback table missing'));

    await expect(
      recordAuditEvent({ action: 'report.created', scope: 'reports' }),
    ).resolves.toBeUndefined();
  });

  // Сбой записи следа раньше проглатывался пустым catch: в проде это значило,
  // что лента могла молча перестать наполняться, и в логах не было ни строчки.
  it('warns in the log when the feedback write fails', async () => {
    mocks.recordFeedbackEvent.mockRejectedValue(new Error('feedback table missing'));

    await recordAuditEvent({ action: 'report.created', scope: 'reports' });

    expect(mocks.loggerWarn).toHaveBeenCalledWith(
      'audit.feedback_write_failed',
      expect.objectContaining({
        action: 'report.created',
        scope: 'reports',
        error: 'feedback table missing',
      }),
    );
  });
});

/**
 * Ленту читает владелец. Эти действия раньше уезжали в default и показывали
 * машинный код вместо заголовка, а вместо текста — «Событие аудита в контуре X»,
 * хотя нужное название лежало рядом, в metadata.
 */
describe('recordAuditEvent — человеческий текст вместо машинного кода', () => {
  it('подставляет название вида документа работника (случай с боя 22.09.2026)', async () => {
    await recordAuditEvent({
      action: 'user.document_type.created',
      scope: 'users',
      metadata: { name: 'Удостоверение машиниста копровой установки' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Заведён вид документа работника',
        message: 'Добавлен вид документа: «Удостоверение машиниста копровой установки».',
      }),
    );
  });

  it('достаёт название из снимка before/after, а не только из metadata.name', async () => {
    await recordAuditEvent({
      action: 'dictionary.renamed',
      scope: 'dictionaries',
      metadata: { type: 'pileGrade', before: { name: 'С120.35-9' }, after: { name: 'С120.35-10' } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Справочник «Сваи»: запись «С120.35-9» переименована в «С120.35-10».',
      }),
    );
  });

  it('остаётся читаемым, когда metadata пустая', async () => {
    await recordAuditEvent({ action: 'site.created', scope: 'sites' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Объект создан', message: 'Создан объект.' }),
    );
  });

  // Приоритет в ленте зависит от level — описания добавлялись как текстовая
  // правка и не должны были поднять эти события выше, чем они были.
  it('не меняет приоритет у событий, которым срочность не назначалась', async () => {
    for (const action of ['site.created', 'crew.deleted', 'user.created', 'dictionary.deleted']) {
      mocks.recordFeedbackEvent.mockClear();
      await recordAuditEvent({ action, scope: 'test' });

      expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
        expect.objectContaining({ level: 'audit', priority: 'MEDIUM' }),
      );
    }
  });
});

/**
 * Настройки меняют границы производственных суток (часовой пояс) и объём
 * оповещений (переключатели) — в ленте должно быть видно, что именно меняли.
 */
describe('recordAuditEvent — изменения настроек', () => {
  it('перечисляет изменённые поля по-русски', async () => {
    await recordAuditEvent({
      action: 'settings.updated',
      scope: 'settings',
      actorId: 'admin-a',
      tenantId: 'orion',
      metadata: {
        before: { companyName: 'Ромашка', timezone: 'Europe/Moscow' },
        after: { companyName: 'Ромашка', timezone: 'Asia/Krasnoyarsk' },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Настройки изменены',
        message: 'Изменены настройки: часовой пояс.',
      }),
    );
  });

  it('показывает направление переключателей уведомлений', async () => {
    await recordAuditEvent({
      action: 'settings.updated',
      scope: 'settings',
      metadata: {
        before: { notifications: { downtime30: true, newReports: false } },
        after: { notifications: { downtime30: false, newReports: true } },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Изменены настройки: уведомления (включено: 1, выключено: 1).',
      }),
    );
  });

  it('остаётся читаемым без снимков before/after', async () => {
    await recordAuditEvent({ action: 'settings.updated', scope: 'settings' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Настройки изменены',
        message: 'Настройки организации сохранены.',
        level: 'audit',
        priority: 'MEDIUM',
      }),
    );
  });
});
