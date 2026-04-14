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

    assertCan(user!, 'sites.manage');

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
        pilePlans: body.pilePlans,
        drillingPlans: body.drillingPlans,
      });

      await invalidateSites();

      return NextResponse.json({ site }, { status: 201 });
    });
  },
  { domain: 'sites' }
);
