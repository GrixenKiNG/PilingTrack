/**
 * GET /api/sync/conflicts
 * POST /api/sync/conflicts
 *
 * Conflict management for Sync Engine v2.
 *
 * GET — Returns list of unresolved conflicts (admin only).
 *   Note: Currently conflicts are auto-resolved by the sync engine.
 *   This endpoint would list conflicts if you store them separately.
 *   For now, it returns conflicts from recent sync sessions via audit log.
 *
 * POST — Manually resolve a conflict.
 *   Body: { conflictId: string, strategy: 'server_wins' | 'client_wins' | 'custom', customData? }
 *   Admin only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { z } from 'zod';

export const runtime = 'nodejs';

async function getPostgresDb() {
  const { postgresDb } = await import('@/lib/db');
  return postgresDb;
}

// ============================================================
// GET /api/sync/conflicts
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const sessionUser = user!;

  // Admin only
  if (sessionUser.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

  const url = new URL(request.url);
  const tenantId = url.searchParams.get('tenantId') || undefined;
  const limit = parseInt(url.searchParams.get('limit') || '50', 10);
  const postgresDb = await getPostgresDb();

  // Query conflicts from audit log / feedback events
  // Conflicts are tracked as feedback events with action 'sync.conflict'
  const conflicts = await postgresDb.feedbackEvent.findMany({
    where: {
      action: 'sync.conflict',
      ...(tenantId ? { scope: tenantId } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(limit, 200),
  });

  return NextResponse.json({
    conflicts: conflicts.map((c: { id: string; scope: string; title: string; message: string; level: string; priority: string; actorId: string | null; actorName: string | null; metadata: unknown; createdAt: Date }) => ({
      id: c.id,
      entity: c.scope,
      title: c.title,
      message: c.message,
      level: c.level,
      priority: c.priority,
      actorId: c.actorId,
      actorName: c.actorName,
      metadata: c.metadata,
      createdAt: c.createdAt,
    })),
    total: conflicts.length,
  });
}, { domain: 'sync' });

// ============================================================
// POST /api/sync/conflicts/:id/resolve
// ============================================================

const resolveConflictSchema = z.object({
  conflictId: z.string().min(1),
  strategy: z.enum(['server_wins', 'client_wins', 'custom']),
  customData: z.record(z.string(), z.unknown()).optional(),
});

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const sessionUser = user!;

  if (sessionUser.role !== 'ADMIN') {
    return NextResponse.json(
      { error: 'Admin access required' },
      { status: 403 }
    );
  }

  const body = await request.json();
  const validated = resolveConflictSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json(
        { error: 'Validation error', details: validated.error.flatten() },
        { status: 400 }
      );
    }

    const { conflictId, strategy, customData } = validated.data;
    const postgresDb = await getPostgresDb();

    // Find the conflict in feedback events
    const conflict = await postgresDb.feedbackEvent.findUnique({
      where: { id: conflictId },
    });

    if (!conflict) {
      return NextResponse.json(
        { error: 'Conflict not found' },
        { status: 404 }
      );
    }

    if (conflict.action !== 'sync.conflict') {
      return NextResponse.json(
        { error: 'Not a sync conflict' },
        { status: 400 }
      );
    }

    // Apply resolution strategy
    const metadata = (conflict.metadata as Record<string, unknown> | null) ?? {};
    let resolvedData: Record<string, unknown> = {};

    switch (strategy) {
      case 'server_wins':
        resolvedData = (metadata.serverData as Record<string, unknown>) || {};
        break;

      case 'client_wins':
        resolvedData = (metadata.clientData as Record<string, unknown>) || {};
        break;

      case 'custom':
        resolvedData = customData || {};
        break;
    }

    // Update the entity with resolved data
    const entityType = metadata.entityType as string;
    const entityId = metadata.entityId as string;

    if (entityType === 'report' && entityId) {
      await postgresDb.report.update({
        where: { id: entityId },
        data: {
          ...(resolvedData as Record<string, unknown>),
          updatedAt: new Date(),
        },
      });
    }

    // Record resolution as a feedback event
    await postgresDb.feedbackEvent.create({
      data: {
        level: 'audit',
        scope: conflict.scope,
        action: 'sync.conflict_resolved',
        title: `Conflict resolved: ${strategy}`,
        message: `Manually resolved conflict ${conflictId} using strategy "${strategy}"`,
        audience: 'OPERATIONS',
        actorId: sessionUser.id,
        actorName: sessionUser.name,
        actorRole: sessionUser.role,
        targetId: conflictId,
        metadata: {
          strategy,
          originalConflictId: conflictId,
          ...(strategy === 'custom' ? { resolvedData: customData } : {}),
          entityType,
          entityId,
        } as any,
      },
    });

    // Mark original conflict as resolved (update metadata)
    await postgresDb.feedbackEvent.update({
      where: { id: conflictId },
      data: {
        metadata: {
          ...metadata,
          resolved: true,
          resolvedAt: new Date().toISOString(),
          resolvedBy: sessionUser.id,
          resolvedStrategy: strategy,
        } as any,
      },
    });

    return NextResponse.json({
      success: true,
      conflictId,
      strategy,
      resolvedAt: new Date().toISOString(),
    });
}, { domain: 'sync' });
