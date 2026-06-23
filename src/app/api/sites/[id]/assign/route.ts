import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { assignUserToSite, unassignUserFromSite } from '@/modules/sites';
import { siteAssignSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.assign_users');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const { id } = await params;
    const body = await request.json();
    const validated = siteAssignSchema.safeParse(body);
    if (!validated.success) {
      return NextResponse.json({ error: 'Validation failed', details: validated.error.flatten() }, { status: 400 });
    }
    const assignment = await assignUserToSite(id, validated.data.userId, { tenantId, actorId: user!.id });
    await invalidateSites(tenantId);
    return NextResponse.json({ assignment });
  },
  { domain: 'sites' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.assign_users');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const { id } = await params;
    const userId = request.nextUrl.searchParams.get('userId');
    const result = await unassignUserFromSite(id, userId || '', { tenantId, actorId: user!.id });
    await invalidateSites(tenantId);
    return NextResponse.json(result);
  },
  { domain: 'sites' }
);
