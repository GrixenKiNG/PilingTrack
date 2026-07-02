import { logger } from '@/lib/logger';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';

export interface AuditEvent {
  action: string;
  scope: string;
  actorId?: string | null;
  targetId?: string | null;
  tenantId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

function describeAuditEvent(event: AuditEvent) {
  switch (event.action) {
    case 'auth.login.succeeded':
      return {
        level: 'success' as const,
        title: 'Успешный вход',
        message: 'Пользователь успешно вошёл в систему.',
      };
    case 'auth.login.failed':
      return {
        level: 'warn' as const,
        title: 'Ошибка входа',
        message: 'Попытка входа завершилась ошибкой авторизации.',
      };
    case 'auth.login.rate_limited':
      return {
        level: 'warn' as const,
        title: 'Слишком много попыток входа',
        message: 'Сработало ограничение по частоте попыток входа.',
      };
    case 'auth.logout': // the logout route records this shorter action name
    case 'auth.logout.succeeded':
      return {
        level: 'info' as const,
        title: 'Выход выполнен',
        message: 'Сессия пользователя была завершена.',
      };
    case 'site.completed':
      return {
        level: 'info' as const,
        title: 'Объект отмечен выполненным',
        message: 'Работы на объекте отмечены как завершённые.',
      };
    case 'site.completion_cleared':
      return {
        level: 'info' as const,
        title: 'Отметка выполнения снята',
        message: 'Объект возвращён в работу.',
      };
    case 'report.created':
      return {
        level: 'success' as const,
        title: 'Отчёт создан',
        message: 'Новый производственный отчёт сохранён в системе.',
      };
    case 'report.updated':
      return {
        level: 'info' as const,
        title: 'Отчёт обновлён',
        message: 'Отчёт был изменён и повторно сохранён.',
      };
    default:
      return {
        level: 'audit' as const,
        title: event.action,
        message: `Событие аудита в контуре ${event.scope}.`,
      };
  }
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  logger.info('audit', event as unknown as Record<string, unknown>);

  try {
    const description = describeAuditEvent(event);
    await recordFeedbackEvent({
      level: description.level,
      priority:
        description.level === 'warn'
          ? 'HIGH'
          : description.level === 'success'
            ? 'LOW'
            : 'MEDIUM',
      scope: event.scope,
      action: event.action,
      title: description.title,
      message: description.message,
      audience: 'OPERATIONS',
      actor: event.actorId ? { id: event.actorId } : null,
      targetId: event.targetId || null,
      requestId: event.requestId || null,
      metadata: event.metadata || null,
    });
  } catch {
    // Feedback persistence must not break the main action path.
  }
}
