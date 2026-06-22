import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { assertCan } from '@/services/auth/authorization-service';
import { getRuntimeDiagnostics } from '@/modules/system';
import { withApi } from '@/core/api-wrapper';


export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const requestId = getRequestId(request);
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'users.manage');

    return createJsonResponse(
      {
        requestId,
        diagnostics: await getRuntimeDiagnostics(),
      },
      { status: 200 },
      requestId
    );
  },
  { domain: 'system' }
);
