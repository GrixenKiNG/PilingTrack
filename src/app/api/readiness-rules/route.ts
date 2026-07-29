import { NextRequest, NextResponse } from 'next/server';
import { withApi, withMutation } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import {
  getReadinessRules,
  saveReadinessDraft,
} from '@/modules/readiness/application/readiness-rules-service';
import { assertRole } from '@/services/auth/authorization-service';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const tenantId = user.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  }
  return NextResponse.json(await getReadinessRules(tenantId));
}, { domain: 'readiness' });

export const PUT = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  assertRole(user, 'ADMIN');
  const tenantId = user.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  return NextResponse.json(await saveReadinessDraft(tenantId, body, {
    id: user.id,
    name: user.name,
    role: user.role,
  }));
}, { domain: 'readiness' });
