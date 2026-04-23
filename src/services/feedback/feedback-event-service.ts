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
    select: {
      id: true,
      level: true,
      priority: true,
      scope: true,
      action: true,
      title: true,
      message: true,
      audience: true,
      actorId: true,
      actorName: true,
      actorRole: true,
      targetId: true,
      requestId: true,
      metadata: true,
      createdAt: true,
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
  const isPrivileged = isPrivilegedRole(user.role);
  const summary = {
    total: 0,
    unread: 0,
    error: 0,
    warn: 0,
    success: 0,
    critical: 0,
    ackPending: 0,
  };

  for (const event of mapped) {
    summary.total++;
    if (event.unread) summary.unread++;
    if (event.level === 'error') summary.error++;
    if (event.level === 'warn') summary.warn++;
    if (event.level === 'success') summary.success++;
    if (event.priority === 'CRITICAL') summary.critical++;
    if (
      isPrivileged &&
      (event.level === 'warn' || event.level === 'error') &&
      !event.acknowledgedAt
    ) {
      summary.ackPending++;
    }
  }

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
