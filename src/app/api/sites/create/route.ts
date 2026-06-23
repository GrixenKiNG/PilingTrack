import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createSiteWithPlans } from '@/modules/sites';
import { createSiteSchema } from '@/lib/validation-schemas';
import { invalidateSites } from '@/lib/cached-queries';
import { withDbProtection } from '@/core/infrastructure/circuit-breakers';
import { withMutation } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'sites.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const body = await request.json();
    const validation = createSiteSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    return await withDbProtection(async () => {
      const site = await createSiteWithPlans({
        name: validation.data.name,
        pilePlans: validation.data.pilePlans,
        drillingPlans: validation.data.drillingPlans,
      }, { tenantId, actorId: user!.id });

      await invalidateSites(tenantId);

      return NextResponse.json({ site }, { status: 201 });
    });
  },
  { domain: 'sites' }
);
