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
import {
  provisionDeviceKey,
  revokeDeviceKey,
} from '@/services/telemetry/device-key-service';

export const runtime = 'nodejs';

async function getDbClient() {
  const { db } = await import('@/lib/db');
  return db;
}

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

// Resolves the caller's tenantId and confirms `equipmentId` belongs to it.
// Single source of truth is Equipment.tenantId, not DeviceKey.tenantId (some
// rows predate tenant scoping being enforced here and may be null). Returns
// the failure NextResponse directly (not wrapped) so callers can early-return
// it without TS narrowing ambiguity.
async function requireTenantEquipment(
  equipmentId: string,
  tenantId: string | null | undefined
): Promise<NextResponse | { tenantId: string; db: Awaited<ReturnType<typeof getDbClient>> }> {
  const resolvedTenantId = tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  if (!resolvedTenantId) {
    return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  }
  const db = await getDbClient();
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: resolvedTenantId },
    select: { id: true },
  });
  if (!equipment) {
    return NextResponse.json({ error: 'Equipment not found' }, { status: 404 });
  }
  return { tenantId: resolvedTenantId, db };
}

export const POST = withMutation(async (request: NextRequest, ctx: RouteCtx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
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

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

  const provisioned = await provisionDeviceKey({
    name: parsed.data.name,
    equipmentId,
    siteId: parsed.data.siteId ?? null,
    tenantId,
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    createdById: user!.id,
  });

  // Plaintext `key` returned exactly once.
  return NextResponse.json(provisioned, { status: 201 });
}, { domain: 'device-keys' });

export const GET = withApi(async (request: NextRequest, ctx: RouteCtx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  assertCan(user!, 'equipment.manage');

  const { id: equipmentId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const scope = await requireTenantEquipment(equipmentId, user!.tenantId);
  if (scope instanceof NextResponse) return scope;
  const { db } = scope;

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
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
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

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const scope = await requireTenantEquipment(equipmentId, user!.tenantId);
  if (scope instanceof NextResponse) return scope;
  const { db } = scope;

  // Confirm the key actually belongs to this equipment before revoking,
  // so the URL `equipmentId` (now tenant-verified above) bounds it too.
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
