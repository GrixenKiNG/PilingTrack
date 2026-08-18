import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { createUserDocumentType, listUserDocumentTypes, listUserDocumentTypesForAdmin } from '@/modules/users';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

export const documentTypeSchema = z.object({
  name: z.string().trim().min(1).max(200),
  requiresExpiry: z.boolean().optional(),
  defaultValidMonths: z.number().int().min(1).max(600).nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).optional(),
  isActive: z.boolean().optional(),
  notes: z.string().max(2000).optional(),
});

/**
 * Справочник видов документов работника — нужен формам заведения.
 * Отдельного права не требует: это перечень названий, а не персональные
 * данные, и он нужен любому, кто заводит хотя бы свои документы.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    // ?scope=all — экран управления справочником: отдаёт и отключённые виды
    // со счётчиком использования. Право проверяет сервис (users.manage).
    if (new URL(request.url).searchParams.get('scope') === 'all') {
      try {
        return NextResponse.json({
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
          types: await listUserDocumentTypesForAdmin({ tenantId, actor: user! }),
        });
      } catch (err) {
        if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
        throw err;
      }
    }
    return NextResponse.json({ types: await listUserDocumentTypes(tenantId) });
  },
  { domain: 'users.documents' }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    const parsed = documentTypeSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((issue) => ({ field: issue.path.join('.'), message: issue.message })) }, { status: 400 });
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      const type = await createUserDocumentType(parsed.data, { tenantId, actor: user! });
      return NextResponse.json({ type }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
