import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { documentTypeSchema } from './schema';
import { createUserDocumentType, listUserDocumentTypes, listUserDocumentTypesForAdmin } from '@/modules/users';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

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
    const tenantId = requireTenantId(user!);
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
    const tenantId = requireTenantId(user!);
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
