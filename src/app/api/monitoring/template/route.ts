/**
 * GET/PUT /api/monitoring/template
 *
 * Server-persisted equipment tile template for the /monitoring dashboard.
 * GET returns the tenant's saved template, or the default if none is saved.
 * PUT is ADMIN-only and validates + upserts the template.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getTemplate, saveTemplate } from '@/modules/monitoring';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  return NextResponse.json(await getTemplate(tenantId));
}, { domain: 'monitoring' });

export const PUT = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    const saved = await saveTemplate(tenantId, body, user!.id);
    return NextResponse.json(saved);
  } catch {
    return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  }
}, { domain: 'monitoring' });
