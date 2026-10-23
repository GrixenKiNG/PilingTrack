import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { type FeedbackEventLevel } from '@/lib/types';
// eslint-disable-next-line no-restricted-imports -- feedback остаётся в services/ до своего переноса (CLAUDE.md); поведение не меняется
import { recordFeedbackEvent, type CreateFeedbackEventInput } from '@/services/feedback/feedback-event-service';
import { recordAuditFeedbackFailure } from '@/core/observability/audit-feedback-metrics';
import { AUDIT_DESCRIPTIONS } from './audit-descriptions';

export interface AuditEvent {
  action: string;
  scope: string;
  actorId?: string | null;
  targetId?: string | null;
  tenantId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Экспортируется ради разового пересчёта старых строк ленты
 * (`scripts/backfill-audit-feed-text.ts`): тексты должны считаться той же
 * функцией, что пишет новые события, иначе история разойдётся с текущей лентой.
 */
export function describeAuditEvent(event: AuditEvent) {
  const description = AUDIT_DESCRIPTIONS[event.action];
  if (!description) {
    return {
      level: 'audit' as FeedbackEventLevel,
      title: event.action,
      message: `Событие аудита в контуре ${event.scope}.`,
    };
  }

  const meta = event.metadata ?? {};
  return {
    level: typeof description.level === 'function' ? description.level(meta) : description.level,
    title: typeof description.title === 'function' ? description.title(meta) : description.title,
    message: typeof description.message === 'function' ? description.message(meta) : description.message,
  };
}

/** Клиент, которым пишется след: обычный `db` или клиент открытой транзакции. */
export type AuditClient = Pick<typeof db, 'user' | 'feedbackEvent'>;

/**
 * Лента `/admin` рисует «Инициатора» только при заполненном `actorName`
 * (feedback-center.tsx), поэтому одного `id` для читаемого следа мало.
 * Имя и роль — украшение записи: сбой их чтения не повод терять событие,
 * поэтому здесь глушится только он, а не запись следа целиком.
 */
async function resolveActor(event: AuditEvent, client: AuditClient = db) {
  if (!event.actorId) return null;

  try {
    const user = await client.user.findUnique({
      where: { id: event.actorId },
      select: { name: true, role: true },
    });
    return user ? { id: event.actorId, name: user.name, role: user.role } : { id: event.actorId };
  } catch (error) {
    logger.warn('audit.actor_lookup_failed', {
      actorId: event.actorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { id: event.actorId };
  }
}

async function toFeedbackInput(event: AuditEvent, client: AuditClient): Promise<CreateFeedbackEventInput> {
  const description = describeAuditEvent(event);
  return {
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
    actor: await resolveActor(event, client),
    targetId: event.targetId || null,
    requestId: event.requestId || null,
    metadata: event.metadata || null,
  };
}

/**
 * След «по возможности»: сбой записи не роняет действие, но считается и логируется.
 * Для действий, без следа которых их нельзя считать выполненными (учётные записи
 * и права), — `recordAuditEventInTx`.
 */
export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  logger.info('audit', event as unknown as Record<string, unknown>);

  try {
    await recordFeedbackEvent(await toFeedbackInput(event, db));
  } catch (error) {
    // Запись следа не должна ронять основное действие — но и пропадать
    // бесследно тоже: без этой строки отказ ленты не оставлял ничего в логах.
    recordAuditFeedbackFailure();
    logger.warn('audit.feedback_write_failed', {
      action: event.action,
      scope: event.scope,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * След в той же транзакции, что и действие: сбой записи откатывает действие.
 * Ошибку не глушим — иначе транзакция зафиксировала бы действие без следа.
 */
export async function recordAuditEventInTx(tx: AuditClient, event: AuditEvent): Promise<void> {
  logger.info('audit', event as unknown as Record<string, unknown>);
  await recordFeedbackEvent(await toFeedbackInput(event, tx), tx);
}
