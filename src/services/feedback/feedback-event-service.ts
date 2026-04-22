import type { Prisma } from '@/generated/postgres-client/client';
import { db } from '@/lib/db';
import type {
  FeedbackEventAudience,
  FeedbackEventDTO,
  FeedbackEventLevel,
  FeedbackEventPriority,
} from '@/lib/types';
import { isPrivilegedRole } from '@/services/auth/authorization-service';

interface FeedbackActor {
  id: string;
  name?: string | null;
  role?: string | null;
}

interface FeedbackUser {
  id: string;
  role: string;
}

interface FeedbackEventWithReads {
  id: string;
  level: string;
  priority: string;
  scope: string;
  action: string;
  title: string;
  message: string;
  audience: string;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: unknown;
  createdAt: Date;
  reads: {
    readAt: Date | null;
    acknowledgedAt: Date | null;
  }[];
}

export interface CreateFeedbackEventInput {
  level: FeedbackEventLevel;
  priority?: FeedbackEventPriority;
  scope: string;
  action: string;
  title: string;
  message: string;
  audience?: FeedbackEventAudience;
  actor?: FeedbackActor | null;
  targetId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown> | null;
}

function mapEvent(event: FeedbackEventWithReads): FeedbackEventDTO {
  const state = event.reads[0];

  return {
    id: event.id,
    level: event.level as FeedbackEventLevel,
    priority: event.priority as FeedbackEventPriority,
    scope: event.scope,
    action: event.action,
    title: event.title,
    message: event.message,
    audience: event.audience as FeedbackEventAudience,
    actorId: event.actorId,
    actorName: event.actorName,
    actorRole: event.actorRole,
    targetId: event.targetId,
    requestId: event.requestId,
    metadata: (event.metadata as Record<string, unknown> | null) || null,
    readAt: state?.readAt?.toISOString() || null,
    acknowledgedAt: state?.acknowledgedAt?.toISOString() || null,
    unread: !state?.readAt,
    source: 'server',
    createdAt: event.createdAt.toISOString(),
  };
}

function getAccessWhere(user: FeedbackUser) {
  return isPrivilegedRole(user.role)
    ? {}
    : {
        OR: [{ actorId: user.id }, { audience: 'ALL' }],
      };
}

export async function recordFeedbackEvent(input: CreateFeedbackEventInput) {
  return db.feedbackEvent.create({
    data: {
      level: input.level,
      priority: input.priority || 'MEDIUM',
      scope: input.scope,
      action: input.action,
      title: input.title,
      message: input.message,
      audience: input.audience || 'OPERATIONS',
      actorId: input.actor?.id || null,
      actorName: input.actor?.name || null,
      actorRole: input.actor?.role || null,
      targetId: input.targetId || null,
      requestId: input.requestId || null,
      metadata: (input.metadata as any) || undefined,
    },
  });
}

export async function listFeedbackEventsForUser(user: FeedbackUser, limit = 25) {
  const events = await db.feedbackEvent.findMany({
    where: getAccessWhere(user),
    include: {
      reads: {
        where: { userId: user.id },
        select: { readAt: true, acknowledgedAt: true },
        take: 1,
      },
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });

  const mapped = events.map(mapEvent);
  const summary = {
    total: mapped.length,
    unread: mapped.filter((event) => event.unread).length,
    error: mapped.filter((event) => event.level === 'error').length,
    warn: mapped.filter((event) => event.level === 'warn').length,
    success: mapped.filter((event) => event.level === 'success').length,
    critical: mapped.filter((event) => event.priority === 'CRITICAL').length,
    ackPending: mapped.filter(
      (event) =>
        (event.level === 'warn' || event.level === 'error') &&
        isPrivilegedRole(user.role) &&
        !event.acknowledgedAt
    ).length,
  };

  return { events: mapped, summary };
}

export async function markFeedbackEventState(
  user: FeedbackUser,
  eventId: string,
  action: 'read' | 'acknowledge'
) {
  const event = await db.feedbackEvent.findFirst({
    where: {
      id: eventId,
      ...getAccessWhere(user),
    },
  });

  if (!event) {
    return null;
  }

  const now = new Date();
  const data =
    action === 'acknowledge'
      ? {
          readAt: now,
          acknowledgedAt: now,
        }
      : {
          readAt: now,
        };

  await db.feedbackEventRead.upsert({
    where: {
      eventId_userId: {
        eventId,
        userId: user.id,
      },
    },
    create: {
      eventId,
      userId: user.id,
      ...data,
    },
    update: data,
  });

  const updated = await db.feedbackEvent.findUnique({
    where: { id: eventId },
    include: {
      reads: {
        where: { userId: user.id },
        select: { readAt: true, acknowledgedAt: true },
        take: 1,
      },
    },
  });

  return updated ? mapEvent(updated) : null;
}

export async function markAllFeedbackEventsRead(user: FeedbackUser, limit = 100) {
  const events = await db.feedbackEvent.findMany({
    where: getAccessWhere(user),
    select: { id: true },
    take: limit,
    orderBy: { createdAt: 'desc' },
  });

  const now = new Date();

  await Promise.all(
    events.map((event) =>
      db.feedbackEventRead.upsert({
        where: {
          eventId_userId: {
            eventId: event.id,
            userId: user.id,
          },
        },
        create: {
          eventId: event.id,
          userId: user.id,
          readAt: now,
        },
        update: {
          readAt: now,
        },
      })
    )
  );

  return listFeedbackEventsForUser(user, 25);
}
