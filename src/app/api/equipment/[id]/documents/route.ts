import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createEquipmentDocument } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

const documentTypeEnum = z.enum([
  'PASSPORT', 'OTS', 'INSURANCE', 'INSPECTION',
  'CERTIFICATE', 'MAINTENANCE_LOG', 'OTHER',
]);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z.object({
  type: documentTypeEnum,
  title: z.string().trim().min(1).max(200),
  issuedAt:  z.preprocess(emptyToUndef, z.coerce.date()).optional(),
  expiresAt: z.preprocess(emptyToUndef, z.coerce.date()).optional(),
  notes: z.string().max(2000).optional(),
  mediaId: z.string().optional().nullable(),
});

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');

    const { id } = await params;
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: 'Validation failed',
          details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })),
        },
        { status: 400 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const doc = await createEquipmentDocument(id, parsed.data, { tenantId });
    return NextResponse.json({ document: doc }, { status: 201 });
  },
  { domain: 'equipment.documents' }
);
