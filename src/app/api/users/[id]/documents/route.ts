import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { listUserDocuments, createUserDocument } from '@/modules/users';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z.object({
  typeId: z.string().trim().min(1),
  number: z.string().trim().max(100).optional(),
  issuedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  expiresAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  notes: z.string().max(2000).optional(),
  mediaId: z.string().optional().nullable(),
});

/**
 * Права проверяет сервис: работник ведёт свои документы сам, чужие —
 * администратор, читает чужие ещё диспетчер и инженер ОТ. Проверка «свой или
 * чужой» требует знать и действующего пользователя, и работника из адреса,
 * поэтому она живёт в одном месте (services/users/user-documents.ts), а не
 * разъезжается по маршрутам через assertCan.
 */
function actorContext(user: { id: string; role: string; tenantId?: string | null }) {
  const tenantId = user.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return null;
  return { tenantId, actor: { id: user.id, role: user.role } };
}

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const ctx = actorContext(user!);
    if (!ctx) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const { id } = await params;
    try {
      const documents = await listUserDocuments(id, ctx);
      return NextResponse.json({ documents });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const ctx = actorContext(user!);
    if (!ctx) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const { id } = await params;
    const parsed = createSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    try {
      const document = await createUserDocument(id, parsed.data, ctx);
      return NextResponse.json({ document }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
