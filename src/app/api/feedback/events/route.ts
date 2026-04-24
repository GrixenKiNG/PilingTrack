import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import {
  listFeedbackEventsForUser,
  markAllFeedbackEventsRead,
  markFeedbackEventState,
  recordFeedbackEvent,
} from '@/services/feedback/feedback-event-service';
import type { FeedbackEventAudience, FeedbackEventLevel, FeedbackEventPriority } from '@/lib/types';
import { z } from 'zod';
import { getSessionCacheScope, withApi, withMutation } from '@/core/api-wrapper';
import { getResponseCache } from '@/core/cache';

const ALLOWED_LEVELS: FeedbackEventLevel[] = ['info', 'success', 'warn', 'error', 'audit'];
const ALLOWED_PRIORITIES: FeedbackEventPriority[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
const ALLOWED_AUDIENCES: FeedbackEventAudience[] = ['ALL', 'OPERATIONS', 'USER'];

const feedbackOperationSchema = z.object({
  operation: z.enum(['read_all', 'read', 'acknowledge']),
  eventId: z.string().optional(),
});

const feedbackCreateSchema = z.object({
  operation: z.undefined().optional(),
  level: z.enum(ALLOWED_LEVELS).optional().default('info'),
  priority: z.enum(ALLOWED_PRIORITIES).optional().default('MEDIUM'),
  audience: z.enum(ALLOWED_AUDIENCES).optional().default('USER'),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(2000),
  scope: z.string().max(100).optional().default('ui'),
  action: z.string().max(200).optional().default('client.feedback'),
  targetId: z.string().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
});


export const runtime = 'nodejs';

function invalidateFeedbackCache(request: NextRequest, scope: 'all' | 'user') {
  const cache = getResponseCache('feedback');

  if (scope === 'all') {
    cache.invalidate('GET:/api/feedback/events');
    return;
  }

  const userScope = getSessionCacheScope(request);
  if (!userScope) {
    cache.invalidate('GET:/api/feedback/events');
    return;
  }

  cache.invalidate('GET:/api/feedback/events', { userId: userScope });
}

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const sessionUser = user;
    const requestId = getRequestId(request);
    const limitParam = Number(request.nextUrl.searchParams.get('limit') || '25');
    const limit = Number.isFinite(limitParam) ? Math.max(1, Math.min(100, limitParam)) : 25;

    if (!sessionUser) {
      return createJsonResponse({ error: 'Unauthorized', requestId }, { status: 401 }, requestId);
    }

    const result = await listFeedbackEventsForUser(sessionUser, limit);
    return createJsonResponse({ requestId, ...result }, { status: 200 }, requestId);
  },
  { domain: 'feedback', cache: true, cacheTTL: 10_000 }
);

export const POST = withMutation(async (request: NextRequest) => {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  // user is guaranteed after error check above
  const sessionUser = user;
  if (!sessionUser) {
    return createJsonResponse({ error: 'Unauthorized', requestId }, { status: 401 }, requestId);
  }

  try {
    const body = await request.json();
    const operation = body.operation;

    if (operation === 'read_all') {
      const result = await markAllFeedbackEventsRead(sessionUser);
      invalidateFeedbackCache(request, 'user');
      return createJsonResponse({ requestId, ...result }, { status: 200 }, requestId);
    }

    if (operation === 'read' || operation === 'acknowledge') {
      const validated = feedbackOperationSchema.safeParse(body);
      if (!validated.success) {
        return createJsonResponse(
          { error: 'Validation error', details: validated.error.flatten(), requestId },
          { status: 400 },
          requestId
        );
      }
      const eventId = validated.data.eventId || '';
      if (!eventId) {
        return createJsonResponse(
          { error: 'eventId is required', requestId },
          { status: 400 },
          requestId
        );
      }

      if (operation === 'acknowledge' && user?.role !== 'ADMIN' && user?.role !== 'DISPATCHER') {
        return createJsonResponse(
          { error: 'Only privileged roles can acknowledge events', requestId },
          { status: 403 },
          requestId
        );
      }

      const event = await markFeedbackEventState(sessionUser, eventId, operation);
      if (!event) {
        return createJsonResponse(
          { error: 'Event not found', requestId },
          { status: 404 },
          requestId
        );
      }

      invalidateFeedbackCache(request, 'user');
      return createJsonResponse({ requestId, event }, { status: 200 }, requestId);
    }

    // Creating a new feedback event
    const validated = feedbackCreateSchema.safeParse(body);
    if (!validated.success) {
      return createJsonResponse(
        { error: 'Validation error', details: validated.error.flatten(), requestId },
        { status: 400 },
        requestId
      );
    }

    const event = await recordFeedbackEvent({
      level: validated.data.level,
      priority: validated.data.priority,
      scope: validated.data.scope,
      action: validated.data.action,
      title: validated.data.title,
      message: validated.data.message,
      audience: sessionUser.role === 'ADMIN' || sessionUser.role === 'DISPATCHER' ? validated.data.audience : 'USER',
      actor: { id: sessionUser.id, name: sessionUser.name, role: sessionUser.role },
      requestId,
      targetId: validated.data.targetId || null,
      metadata: validated.data.metadata || null,
    });

    invalidateFeedbackCache(request, 'all');

    return createJsonResponse(
      {
        requestId,
        event: {
          id: event.id,
          level: event.level,
          priority: event.priority,
          scope: event.scope,
          action: event.action,
          title: event.title,
          message: event.message,
          audience: event.audience,
          actorId: event.actorId,
          actorName: event.actorName,
          actorRole: event.actorRole,
          targetId: event.targetId,
          requestId: event.requestId,
          metadata: event.metadata,
          readAt: null,
          acknowledgedAt: null,
          unread: true,
          source: 'server',
          createdAt: event.createdAt.toISOString(),
        },
      },
      { status: 201 },
      requestId
    );
  } catch {
    return createJsonResponse({ error: 'Internal error', requestId }, { status: 500 }, requestId);
  }
}, { domain: 'feedback' });

export const PATCH = POST;
