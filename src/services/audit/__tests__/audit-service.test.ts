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

/**
 * Канал Telegram решает, кто получит алерт о дефекте или простое. Токена бота
 * в metadata нет ни в каком виде (снимок собирает api/telegram/configs), в
 * ленте видно только название чата, его id и состояние оповещений.
 */
describe('recordAuditEvent — каналы оповещений Telegram', () => {
  it('называет канал и состояние оповещений при создании', async () => {
    await recordAuditEvent({
      action: 'telegram.config.created',
      scope: 'telegram',
      actorId: 'admin-a',
      metadata: { configId: 'cfg-1', label: 'Основной чат', chatId: '-100123', enabled: true },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Канал оповещений создан',
        message: 'Создан канал оповещений: «Основной чат» (чат -100123) — оповещения включены.',
      }),
    );
  });

  it('показывает выключенный канал, а не только его название', async () => {
    await recordAuditEvent({
      action: 'telegram.config.updated',
      scope: 'telegram',
      metadata: { label: 'Дежурный', chatId: '-100777', enabled: false },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Канал оповещений изменён',
        message: 'Изменён канал оповещений: «Дежурный» (чат -100777) — оповещения выключены.',
      }),
    );
  });

  it('отмечает замену токена, не показывая сам токен', async () => {
    await recordAuditEvent({
      action: 'telegram.config.updated',
      scope: 'telegram',
      metadata: { label: 'Основной чат', chatId: '-100123', enabled: true, tokenUpdated: true },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          'Изменён канал оповещений: «Основной чат» (чат -100123) — оповещения включены, токен бота заменён.',
      }),
    );
  });

  it('называет удалённый канал по чату, а не внутренним id', async () => {
    await recordAuditEvent({
      action: 'telegram.config.deleted',
      scope: 'telegram',
      metadata: { configId: 'cfg-7', label: 'Основной чат', chatId: '-100123', enabled: true },
    });

    // Точное совпадение текста и есть проверка: внутреннего id конфигурации в
    // ленте нет, а есть название чата и его id.
    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        priority: 'HIGH',
        title: 'Канал оповещений удалён',
        message: 'Удалён канал оповещений: «Основной чат» (чат -100123) — оповещения включены.',
      }),
    );
  });

  it('остаётся читаемым, когда metadata пустая', async () => {
    await recordAuditEvent({ action: 'telegram.config.created', scope: 'telegram' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Канал оповещений создан',
        message: 'Создан канал оповещений: Telegram — оповещения включены.',
      }),
    );
  });
});

/**
 * Решение мастера по свае перетирает прежнее: acceptance/acceptedById — те же
 * колонки, и повторное решение стирает первое (F-R34-16). В ленте важно видеть
 * и прежнее решение, и новое — иначе «отправил на добивку» выглядит как первое
 * решение, а кто и когда принял сваю до этого, не восстановить.
 */
describe('recordAuditEvent — решение мастера по свае', () => {
  it('показывает смену решения «принята → на добивку»', async () => {
    await recordAuditEvent({
      action: 'pile.passport.decided',
      scope: 'reports',
      actorId: 'foreman-1',
      metadata: {
        pileNumber: 'С-130',
        before: { acceptance: 'ACCEPTED', acceptedById: 'foreman-1' },
        after: { acceptance: 'NEEDS_REDRIVE', acceptedById: 'foreman-1' },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Решение по свае',
        message: 'Свая «С-130»: решение изменено — принята → на добивку.',
      }),
    );
  });

  it('называет сваю и решение, когда решают впервые', async () => {
    await recordAuditEvent({
      action: 'pile.passport.decided',
      scope: 'reports',
      metadata: {
        pileNumber: 'С-131',
        before: { acceptance: 'PENDING' },
        after: { acceptance: 'ACCEPTED' },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Решение по свае',
        message: 'Свая «С-131»: принята.',
      }),
    );
  });

  it('остаётся читаемым без номера сваи и снимков', async () => {
    await recordAuditEvent({ action: 'pile.passport.decided', scope: 'reports' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Решение по свае',
        message: 'Свая: решение мастера записано.',
        level: 'audit',
        priority: 'MEDIUM',
      }),
    );
  });
});

/**
 * Удаление показания моточасов меняет наработку и сроки ТО, а строки показания
 * после этого уже нет (F-R34-13). В ленте должно быть видно, у какой установки
 * и какую цифру стёрли — без внутренних id.
 */
describe('recordAuditEvent — удаление показания моточасов', () => {
  it('называет установку и снятое значение', async () => {
    await recordAuditEvent({
      action: 'meter.reading.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: { name: 'ЭО-5111', before: { engineHours: 1234, recordedById: 'operator-1' } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        priority: 'HIGH',
        title: 'Показание моточасов удалено',
        message: 'Удалено показание моточасов 1234 м/ч: «ЭО-5111».',
      }),
    );
  });

  it('остаётся читаемым без названия установки и снимка', async () => {
    await recordAuditEvent({ action: 'meter.reading.deleted', scope: 'equipment' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Показание моточасов удалено',
        message: 'Удалено показание моточасов.',
      }),
    );
  });
});

/**
 * Удаления записи топлива, регламента ТО и документа установки не оставляли
 * следа (F-R39-3). Самих строк после удаления нет, а по ним считают расход,
 * сроки ТО и допуск машины к работе — в ленте должно быть видно, у какой
 * установки что убрали, без внутренних id.
 */
describe('recordAuditEvent — удаления по технике', () => {
  it('называет литраж, дату и установку у удалённой записи о топливе', async () => {
    await recordAuditEvent({
      action: 'equipment.fuel.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: {
        name: 'ЭО-5111',
        before: { litersAdded: 120, recordedAt: new Date('2026-09-26T08:00:00.000Z') },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        priority: 'HIGH',
        title: 'Запись о топливе удалена',
        message: 'Удалена запись о топливе 120 л от 26.09.2026: «ЭО-5111».',
      }),
    );
  });

  it('остаётся читаемым без снимка записи о топливе', async () => {
    await recordAuditEvent({ action: 'equipment.fuel.deleted', scope: 'equipment' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Удалена запись о топливе.' }),
    );
  });

  it('называет регламент ТО и его интервал', async () => {
    await recordAuditEvent({
      action: 'maintenance.plan.deleted',
      scope: 'equipment',
      metadata: { name: 'ЭО-5111', before: { title: 'ТО-2', intervalHours: 250 } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        title: 'Регламент ТО удалён',
        message: 'Удалён регламент «ТО-2», каждые 250 м/ч: «ЭО-5111».',
      }),
    );
  });

  it('показывает календарный интервал, когда регламент не по моточасам', async () => {
    await recordAuditEvent({
      action: 'maintenance.plan.deleted',
      scope: 'equipment',
      metadata: { name: 'ЭО-5111', before: { title: 'Сезонное ТО', intervalDays: 180 } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Удалён регламент «Сезонное ТО», каждые 180 дн.: «ЭО-5111».',
      }),
    );
  });

  it('называет документ установки и его срок действия', async () => {
    await recordAuditEvent({
      action: 'equipment.document.deleted',
      scope: 'equipment',
      metadata: {
        name: 'ЭО-5111',
        before: { type: 'INSURANCE', title: 'Полис ОСАГО', expiresAt: new Date('2027-01-01T00:00:00.000Z') },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        title: 'Документ установки удалён',
        message: 'Удалён документ «Полис ОСАГО» (срок до 01.01.2027): «ЭО-5111».',
      }),
    );
  });

  it('остаётся читаемым, когда документа и срока в metadata нет', async () => {
    await recordAuditEvent({ action: 'equipment.document.deleted', scope: 'equipment' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Удалён документ установки.' }),
    );
  });
});

/**
 * Заведение, правка, вывод из эксплуатации и удаление установки не оставляли
 * следа (F-R34-14). Выведенная установка перестаёт допускаться к работе, а
 * удаление уничтожает карточку — в ленте должно быть видно, что и с какой
 * установкой сделали, без внутренних id. Правка перечисляет только изменившиеся
 * поля: снимок даёт api/equipment.
 */
describe('recordAuditEvent — карточка установки', () => {
  it('называет заведённую установку', async () => {
    await recordAuditEvent({
      action: 'equipment.created',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: { name: 'ЭО-5111', after: { name: 'ЭО-5111', model: 'ЭО-5111А', qty: 2, isActive: true } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Установка заведена',
        message: 'Заведена установка: «ЭО-5111».',
      }),
    );
  });

  it('перечисляет изменившиеся поля правки по-русски', async () => {
    await recordAuditEvent({
      action: 'equipment.updated',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: {
        name: 'ЭО-5111',
        before: { name: 'ЭО-5110', qty: 1 },
        after: { name: 'ЭО-5111', qty: 2 },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Установка изменена',
        message: 'Установка «ЭО-5111»: изменено — название, количество.',
      }),
    );
  });

  it('остаётся читаемым, когда правка ничего не изменила', async () => {
    await recordAuditEvent({
      action: 'equipment.updated',
      scope: 'equipment',
      metadata: { name: 'ЭО-5111', before: {}, after: {} },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Установка «ЭО-5111»: изменения сохранены.' }),
    );
  });

  it('сообщает о выводе установки из эксплуатации', async () => {
    await recordAuditEvent({
      action: 'equipment.retired',
      scope: 'equipment',
      metadata: { name: 'ЭО-5111', before: { isActive: true }, after: { isActive: false } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'audit',
        title: 'Установка выведена из эксплуатации',
        message: 'Установка выведена из эксплуатации: «ЭО-5111».',
      }),
    );
  });

  it('называет удалённую установку и её модель', async () => {
    await recordAuditEvent({
      action: 'equipment.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: { name: 'ЭО-5111', before: { model: 'ЭО-5111А', kind: 'PILE_DRIVER', isActive: false } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        priority: 'HIGH',
        title: 'Установка удалена',
        message: 'Удалена установка (ЭО-5111А): «ЭО-5111».',
      }),
    );
  });
});

/**
 * Схема объекта (поле/куст/пикет) не оставляла следа при создании и удалении
 * (F-R34-15), хотя пикет — ключ привязки выработки (PileWork.picketId) и его
 * удаление ломает связи задним числом. В ленте должно быть видно, какой именно
 * узел завели или убрали; род слова берётся из типа, внутренних id нет.
 */
describe('recordAuditEvent — схема объекта (поле/куст/пикет)', () => {
  it('называет добавленный пикет', async () => {
    await recordAuditEvent({
      action: 'site.hierarchy.created',
      scope: 'sites',
      actorId: 'admin-1',
      targetId: 'site-1',
      metadata: { type: 'picket', name: 'П-12', itemId: 'picket-1' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'audit',
        priority: 'MEDIUM',
        title: 'Элемент схемы объекта добавлен',
        message: 'Добавлен пикет «П-12».',
      }),
    );
  });

  it('называет удалённый куст', async () => {
    await recordAuditEvent({
      action: 'site.hierarchy.deleted',
      scope: 'sites',
      actorId: 'admin-1',
      targetId: 'site-1',
      metadata: { type: 'cluster', name: 'К-3', itemId: 'cluster-1' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Элемент схемы объекта удалён',
        message: 'Удалён куст «К-3».',
      }),
    );
  });

  // «Добавлен куст», но «Добавлено поле»: у поля другой род, и общая фраза
  // читалась бы как «Добавлен поле».
  it('согласует род слова с типом узла', async () => {
    await recordAuditEvent({
      action: 'site.hierarchy.created',
      scope: 'sites',
      metadata: { type: 'field', name: 'Поле-1' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Добавлено поле «Поле-1».' }),
    );
  });

  it('остаётся читаемым без типа и названия узла', async () => {
    await recordAuditEvent({ action: 'site.hierarchy.deleted', scope: 'sites' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Элемент схемы объекта удалён',
        message: 'Удалён элемент схемы объекта.',
      }),
    );
  });
});

/**
 * Допуск работника к технике: строка матрицы перезаписывается и удаляется
 * целиком, поэтому лента — единственное место, где видно, кто и когда его
 * выдал или снял. Вид техники и состояние — перечисления схемы, а ленту читает
 * владелец, а не программист (F-R34-25).
 */
describe('recordAuditEvent — допуск к технике', () => {
  it('переводит вид техники и состояние допуска на русский', async () => {
    await recordAuditEvent({
      action: 'user.equipment_permit.saved',
      scope: 'users',
      actorId: 'admin-1',
      targetId: 'user-1',
      metadata: { permitId: 'permit-1', equipmentKind: 'PILE_DRIVER', status: 'DENIED' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Допуск к технике выдан или изменён',
        message: 'Допуск работника к технике: Сваебойная установка, не допущен.',
      }),
    );
  });

  it('показывает состояние «ограничен», а не только «допущен/не допущен»', async () => {
    await recordAuditEvent({
      action: 'user.equipment_permit.saved',
      scope: 'users',
      metadata: { equipmentKind: 'DRILLING_RIG', status: 'LIMITED' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Допуск работника к технике: Буровая установка, ограничен.',
      }),
    );
  });

  // Новый вид техники или состояние в схеме не должны превращаться в «—»:
  // сырой код лучше, чем потеря информации.
  it('оставляет сырой код для неизвестного значения перечисления', async () => {
    await recordAuditEvent({
      action: 'user.equipment_permit.saved',
      scope: 'users',
      metadata: { equipmentKind: 'CRANE', status: 'SUSPENDED' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Допуск работника к технике: CRANE, SUSPENDED.',
      }),
    );
  });

  it('остаётся читаемым без вида техники и состояния', async () => {
    await recordAuditEvent({ action: 'user.equipment_permit.saved', scope: 'users' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Допуск к технике выдан или изменён',
        message: 'Допуск работника к технике: —, —.',
      }),
    );
  });
});

/**
 * Черновик сменного отчёта закрывает планировщик, когда производственные сутки
 * истекли, — оператор отчёт не сдавал (F-R34-18). Запись от его имени была
 * неправдой: у такой сдачи актора нет («система»), а имя владельца отчёта
 * приходит из обработчика события (metadata.operatorName) и уходит в текст.
 */
describe('recordAuditEvent — автосдача отчёта планировщиком', () => {
  it('пишет запись без актора и называет оператора в тексте', async () => {
    await recordAuditEvent({
      action: 'ReportSubmitted',
      scope: 'reports',
      actorId: null,
      targetId: 'RM-abcd1234-2026-09-26',
      tenantId: 'orion',
      metadata: {
        eventType: 'ReportSubmitted',
        data: { autoClosed: true },
        operatorName: 'Петров И.И.',
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: null,
        level: 'audit',
        title: 'Отчёт сдан автоматически при закрытии смены',
        message: 'Смена закрыта автоматически: отчёт оператора Петров И.И. сдан системой.',
      }),
    );
  });

  it('остаётся читаемым, когда имя оператора не нашлось', async () => {
    await recordAuditEvent({
      action: 'ReportSubmitted',
      scope: 'reports',
      actorId: null,
      metadata: { data: { autoClosed: true }, operatorName: null },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Отчёт сдан автоматически при закрытии смены',
        message: 'Смена закрыта автоматически: отчёт сдан системой.',
      }),
    );
  });

  it('обычную сдачу оператором оставляет как была', async () => {
    await recordAuditEvent({
      action: 'ReportSubmitted',
      scope: 'reports',
      actorId: 'op-1',
      metadata: { eventType: 'ReportSubmitted', data: {} },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { id: 'op-1' },
        title: 'Отчёт сдан',
        message: 'Отчёт передан на проверку.',
      }),
    );
  });
});

/**
 * Пересборка проекций меняет цифры витрин и аналитики по одному запросу, и без
 * строки в ленте на вопрос «почему у меня другие числа, чем вчера» ответить
 * нечем (F-R34-23). В тексте — названия витрин по-русски, а не коды схемы
 * (`site-daily`, `report-analytics`), и число записанных строк.
 */
describe('recordAuditEvent — пересборка проекций', () => {
  it('называет витрины по-русски и число записанных строк', async () => {
    await recordAuditEvent({
      action: 'projections.rebuilt',
      scope: 'projections',
      actorId: 'admin-1',
      metadata: { names: ['report-analytics', 'site-daily', 'site-weekly'], rowsWritten: 14 },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'audit',
        priority: 'MEDIUM',
        title: 'Проекции пересобраны',
        message:
          'Пересобраны проекции: Аналитика отчётов, Сводка по объектам за день, Недельный тренд по объектам — записано строк: 14.',
      }),
    );
  });

  it('называет одну витрину без числа строк, когда пересобирали не всё', async () => {
    await recordAuditEvent({
      action: 'projections.rebuilt',
      scope: 'projections',
      metadata: { names: ['site-daily'] },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Пересобраны проекции: Сводка по объектам за день.' }),
    );
  });

  // Новый код витрины в схеме не должен превращаться в пустую строку: сырое
  // имя лучше, чем потеря информации.
  it('оставляет сырое имя для неизвестной витрины', async () => {
    await recordAuditEvent({
      action: 'projections.rebuilt',
      scope: 'projections',
      metadata: { names: ['operator-performance'], rowsWritten: 0 },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Пересобраны проекции: operator-performance — записано строк: 0.',
      }),
    );
  });

  it('остаётся читаемым, когда metadata пустая', async () => {
    await recordAuditEvent({ action: 'projections.rebuilt', scope: 'projections' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Проекции пересобраны',
        message: 'Проекции пересобраны.',
      }),
    );
  });
});

/**
 * Заведение, правка/закрытие/отмена и приёмка наряда ТО не оставляли следа
 * (F-R34-12). Правку стоимости, трудозатрат и моточасов после закрытия в другом
 * месте не увидеть: строка хранит только последнее значение, а принятый наряд
 * закрыт на изменение. Вид и состояние — перечисления схемы, а ленту читает
 * владелец, поэтому в тексте человеческие подписи и название наряда, не id.
 */
describe('recordAuditEvent — наряды ТО', () => {
  it('называет заведённый наряд и его вид', async () => {
    await recordAuditEvent({
      action: 'maintenance.created',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      metadata: { name: 'Замена РВД', after: { type: 'REPAIR', status: 'PLANNED' } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'audit',
        priority: 'MEDIUM',
        title: 'Наряд ТО заведён',
        message: 'Создан наряд ТО «Замена РВД» (ремонт).',
      }),
    );
  });

  it('остаётся читаемым без названия и вида наряда', async () => {
    await recordAuditEvent({ action: 'maintenance.created', scope: 'equipment' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Наряд ТО заведён', message: 'Создан наряд ТО.' }),
    );
  });

  it('показывает переход статуса и изменённые поля по-русски', async () => {
    await recordAuditEvent({
      action: 'maintenance.updated',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: {
        name: 'Замена РВД',
        before: { status: 'IN_PROGRESS', cost: 100, laborHours: 2 },
        after: { status: 'DONE', cost: 150, laborHours: 3 },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Наряд ТО изменён',
        message: 'Наряд ТО «Замена РВД»: изменено — статус: в работе → выполнено, стоимость, трудозатраты.',
      }),
    );
  });

  it('показывает отмену с причиной, а не только «изменено»', async () => {
    await recordAuditEvent({
      action: 'maintenance.updated',
      scope: 'equipment',
      metadata: {
        name: 'Замена РВД',
        before: { status: 'PLANNED', cancelReason: null },
        after: { status: 'CANCELLED', cancelReason: 'узел заменён целиком' },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Наряд ТО «Замена РВД»: изменено — статус: запланировано → отменено, причина отмены.',
      }),
    );
  });

  it('остаётся читаемым, когда правка ничего не изменила', async () => {
    await recordAuditEvent({
      action: 'maintenance.updated',
      scope: 'equipment',
      metadata: { name: 'Замена РВД', before: {}, after: {} },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Наряд ТО «Замена РВД»: изменения сохранены.' }),
    );
  });

  it('сообщает о приёмке наряда администратором', async () => {
    await recordAuditEvent({
      action: 'maintenance.accepted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      metadata: { name: 'Замена РВД' },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Наряд ТО принят',
        message: 'Наряд ТО «Замена РВД» принят администратором.',
      }),
    );
  });

  it('оставляет сырой код для неизвестного вида или состояния', async () => {
    await recordAuditEvent({
      action: 'maintenance.created',
      scope: 'equipment',
      metadata: { name: 'Осмотр', after: { type: 'WARRANTY' } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Создан наряд ТО «Осмотр» (WARRANTY).' }),
    );
  });
});

/**
 * Запись показания моточасов и удаление наряда ТО не оставляли следа
 * (F-R72-FEED-METER-MAINT): добавленное показание двигает наработку и сроки ТО,
 * а удалённый наряд (в том числе открытый ремонт) держит блокер готовности.
 * В ленте должно быть видно, по какой установке вписали цифру и какой наряд
 * убрали — человеческими словами, без внутренних id.
 */
describe('recordAuditEvent — ввод показания моточасов и удаление наряда ТО', () => {
  it('называет внесённое показание и установку', async () => {
    await recordAuditEvent({
      action: 'meter.reading.added',
      scope: 'equipment',
      actorId: 'admin-1',
      metadata: { name: 'ЭО-5111', after: { engineHours: 1234 } },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'info',
        priority: 'MEDIUM',
        title: 'Показание моточасов внесено',
        message: 'Внесено показание моточасов 1234 м/ч — «ЭО-5111».',
      }),
    );
  });

  it('остаётся читаемым без названия установки и значения', async () => {
    await recordAuditEvent({ action: 'meter.reading.added', scope: 'equipment' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Показание моточасов внесено',
        message: 'Внесено показание моточасов.',
      }),
    );
  });

  it('называет удалённый наряд, его вид, состояние, плановую дату и установку', async () => {
    await recordAuditEvent({
      action: 'maintenance.record.deleted',
      scope: 'equipment',
      actorId: 'admin-1',
      targetId: 'rec-1',
      metadata: {
        name: 'Замена РВД',
        before: {
          type: 'REPAIR',
          status: 'IN_PROGRESS',
          scheduledAt: new Date('2026-10-01T00:00:00.000Z'),
          equipmentName: 'ЭО-5111',
        },
      },
    });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'warn',
        priority: 'HIGH',
        title: 'Наряд ТО удалён',
        message: 'Удалён наряд ТО «Замена РВД» (ремонт, в работе, плановая дата 01.10.2026): установка «ЭО-5111».',
      }),
    );
  });

  it('остаётся читаемым без снимка удалённого наряда', async () => {
    await recordAuditEvent({ action: 'maintenance.record.deleted', scope: 'equipment' });

    expect(mocks.recordFeedbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Наряд ТО удалён', message: 'Удалён наряд ТО.' }),
    );
  });
});
