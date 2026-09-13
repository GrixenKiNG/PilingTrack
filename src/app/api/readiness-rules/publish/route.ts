import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { withMutation } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { publishReadinessRules } from '@/modules/readiness/application/readiness-rules-service';
import { assertRole } from '@/services/auth/authorization-service';

export const runtime = 'nodejs';

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  assertRole(user, 'ADMIN');
  const tenantId = requireTenantId(user);
  return NextResponse.json(await publishReadinessRules(tenantId, {
    id: user.id,
    name: user.name,
    role: user.role,
  }));
}, { domain: 'readiness' });
