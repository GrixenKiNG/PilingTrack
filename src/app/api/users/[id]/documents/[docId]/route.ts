import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { updateUserDocument, deleteUserDocument } from '@/modules/users';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const updateSchema = z.object({
  typeId: z.string().trim().min(1).optional(),
  number: z.string().trim().max(100).optional(),
  issuedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  expiresAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  notes: z.string().max(2000).optional(),
  mediaId: z.string().optional().nullable(),
});

function actorContext(user: { id: string; role: string; tenantId?: string | null }) {
  const tenantId = user.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return null;
  return { tenantId, actor: { id: user.id, role: user.role } };
}

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const ctx = actorContext(user!);
    if (!ctx) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const { id, docId } = await params;
    const parsed = updateSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    try {
      const document = await updateUserDocument(id, docId, parsed.data, ctx);
      return NextResponse.json({ document });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const ctx = actorContext(user!);
    if (!ctx) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const { id, docId } = await params;
    try {
      await deleteUserDocument(id, docId, ctx);
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
