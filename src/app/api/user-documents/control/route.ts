import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { listDocumentsNeedingAttention } from '@/modules/users';
import { withApi } from '@/core/api-wrapper';
import { ServiceError } from '@/lib/service-error';

export const runtime = 'nodejs';

/**
 * Контроль документов: что просрочено и что истекает — по всем работникам
 * тенанта. Рабочая выборка диспетчера и инженера ОТ перед сменой.
 * Право проверяет сервис (users.documents.read_all).
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = actor.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });

    try {
      const documents = await listDocumentsNeedingAttention({
        tenantId,
        actor: { id: actor.id, role: actor.role },
      });
      return NextResponse.json({
        documents,
        expired: documents.filter((row) => row.expiry.status === 'expired').length,
        expiring: documents.filter((row) => row.expiry.status === 'expiring').length,
      });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'users.documents' }
);
