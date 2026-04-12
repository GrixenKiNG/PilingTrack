import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { createJsonResponse, getRequestId } from '@/lib/request-context';
import { assertCan } from '@/services/auth/authorization-service';
import { getRuntimeDiagnostics } from '@/modules/system';
import { ServiceError } from '@/services/service-error';


export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const requestId = getRequestId(request);
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'users.manage');

    return createJsonResponse(
      {
        requestId,
        diagnostics: await getRuntimeDiagnostics(),
      },
      { status: 200 },
      requestId
    );
  } catch (caughtError) {
    if (caughtError instanceof ServiceError) {
      return createJsonResponse(
        { error: caughtError.message, requestId },
        { status: caughtError.status },
        requestId
      );
    }

    return createJsonResponse({ error: 'Internal error', requestId }, { status: 500 }, requestId);
  }
}
