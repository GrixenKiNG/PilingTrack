/**
 * POST /api/equipment/[id]/device-keys — provision a new device key
 * GET  /api/equipment/[id]/device-keys — list keys for this equipment (no plaintext)
 * DELETE body { keyId } — revoke
 *
 * The plaintext key is returned exactly once on POST and never persisted.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi, withMutation } from '@/core/api-wrapper';
import { db } from '@/lib/db';
import {
  provisionDeviceKey,
  revokeDeviceKey,
} from '@/services/telemetry/device-key-service';

export const runtime = 'nodejs';

const provisionSchema = z.object({
  name: z.string().min(1).max(120),
  siteId: z.string().min(1).optional(),
});

const revokeSchema = z.object({
  keyId: z.string().min(1),
});

interface RouteCtx {
  params: Promise<{ id: string }>;
}

export const POST = withMutation(async (request: NextRequest, ctx: RouteCtx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'equipment.manage');

  const { id: equipmentId } = await ctx.params;

  const body = await request.json();
  const parsed = provisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const provisioned = await provisionDeviceKey({
    name: parsed.data.name,
    equipmentId,
    siteId: parsed.data.siteId ?? null,
    tenantId: user!.tenantId,
    createdById: user!.id,
  });

  // Plaintext `key` returned exactly once.
  return NextResponse.json(provisioned, { status: 201 });
}, { domain: 'device-keys' });

export const GET = withApi(async (request: NextRequest, ctx: RouteCtx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'equipment.manage');

  const { id: equipmentId } = await ctx.params;

  const keys = await db.deviceKey.findMany({
    where: { equipmentId },
    select: {
      id: true,
      name: true,
      siteId: true,
      tenantId: true,
      revoked: true,
      createdAt: true,
      lastUsedAt: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return NextResponse.json({ keys });
}, { domain: 'device-keys' });

export const DELETE = withMutation(async (request: NextRequest, ctx: RouteCtx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'equipment.manage');

  const { id: equipmentId } = await ctx.params;

  const body = await request.json();
  const parsed = revokeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  // Confirm the key actually belongs to this equipment before revoking,
  // so the URL `equipmentId` acts as a tenant-scoping check.
  const key = await db.deviceKey.findUnique({
    where: { id: parsed.data.keyId },
    select: { equipmentId: true },
  });
  if (!key || key.equipmentId !== equipmentId) {
    return NextResponse.json({ error: 'Key not found' }, { status: 404 });
  }

  await revokeDeviceKey(parsed.data.keyId);
  return NextResponse.json({ revoked: true });
}, { domain: 'device-keys' });
