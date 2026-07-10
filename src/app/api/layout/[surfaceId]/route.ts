/**
 * GET/PUT /api/layout/[surfaceId]
 *
 * Server-persisted layout template for a registered editable surface
 * (shared module layout editor). GET returns the tenant's saved template or
 * the surface default. PUT is ADMIN-only and validates + upserts. Unknown
 * (unregistered) surfaces are 404 — the registry is the allow-list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getLayout, saveLayout, UnknownSurfaceError } from '@/modules/layout';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ surfaceId: string }> };

export const GET = withApi(async (request: NextRequest, ctx: Ctx) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  const { surfaceId } = await ctx.params;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  try {
    return NextResponse.json(await getLayout(tenantId, surfaceId));
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
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const saved = await saveLayout(tenantId, surfaceId, body, user!.id);
    return NextResponse.json(saved);
  } catch (err) {
    if (err instanceof UnknownSurfaceError) return NextResponse.json({ error: 'Unknown surface' }, { status: 404 });
    if (err instanceof TypeError) return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
    throw err;
  }
}, { domain: 'layout' });
