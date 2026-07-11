/**
 * GET/PUT/DELETE /api/layout/[surfaceId]
 *
 * Server-persisted layout templates for a registered editable surface
 * (shared module layout editor). A surface has one base layout plus optional
 * per-entity overrides, addressed by ?entityId=<id> ('' / omitted = base).
 *
 * - GET                     → base layout (resolved)
 * - GET ?entityId=x         → tile layout for x (override -> base -> default)
 * - GET ?scope=set          → { base, overrides } for the whole surface
 * - PUT ?entityId=x         → save layout at that scope (ADMIN)
 * - DELETE ?entityId=x      → remove layout at that scope (ADMIN)
 *
 * Unknown (unregistered) surfaces are 404 — the registry is the allow-list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getLayout, getLayoutSet, saveLayout, deleteLayout, BASE_ENTITY, UnknownSurfaceError } from '@/modules/layout';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ surfaceId: string }> };

function tenantOf(user: { tenantId?: string | null }): string | null {
  return user.tenantId ?? process.env.DEFAULT_TENANT_ID ?? null;
}

export const GET = withApi(async (request: NextRequest, ctx: Ctx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  const { surfaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = tenantOf(user!);
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  const { searchParams } = new URL(request.url);
  try {
    if (searchParams.get('scope') === 'set') {
      return NextResponse.json(await getLayoutSet(tenantId, surfaceId));
    }
    const entityId = searchParams.get('entityId') ?? BASE_ENTITY;
    return NextResponse.json(await getLayout(tenantId, surfaceId, entityId));
  } catch (err) {
    if (err instanceof UnknownSurfaceError) return NextResponse.json({ error: 'Unknown surface' }, { status: 404 });
    throw err;
  }
}, { domain: 'layout' });

export const PUT = withMutation(async (request: NextRequest, ctx: Ctx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { surfaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = tenantOf(user!);
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  const entityId = new URL(request.url).searchParams.get('entityId') ?? BASE_ENTITY;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const saved = await saveLayout(tenantId, surfaceId, body, user!.id, entityId);
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof UnknownSurfaceError) return NextResponse.json({ error: 'Unknown surface' }, { status: 404 });
    if (err instanceof TypeError) return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    throw err;
  }
}, { domain: 'layout' });

export const DELETE = withMutation(async (request: NextRequest, ctx: Ctx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const { surfaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = tenantOf(user!);
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  const entityId = new URL(request.url).searchParams.get('entityId') ?? BASE_ENTITY;
  try {
    await deleteLayout(tenantId, surfaceId, entityId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof UnknownSurfaceError) return NextResponse.json({ error: 'Unknown surface' }, { status: 404 });
    throw err;
  }
}, { domain: 'layout' });
