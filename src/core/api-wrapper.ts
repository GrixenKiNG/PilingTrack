import { NextRequest, NextResponse } from 'next/server';
import { ServiceError } from '@/services/service-error';

export interface ApiWrapperOptions {
  domain?: string;
  cache?: boolean;
  cacheTTL?: number;
}

/** Map Prisma error codes to HTTP status. Only well-known codes listed. */
const PRISMA_STATUS: Record<string, number> = {
  P2025: 404, // Record not found
  P2002: 409, // Unique constraint violation
};

function isPrismaKnownError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    typeof (err as any).code === 'string' &&
    (err as any).code.startsWith('P')
  );
}

/**
 * Minimal API wrapper — catches ServiceError and Prisma errors, maps to HTTP status.
 */
export function withApi(
  handler: (request: NextRequest) => Promise<NextResponse>,
  _opts?: ApiWrapperOptions
) {
  return async (request: NextRequest) => {
    try {
      return await handler(request);
    } catch (error: unknown) {
      if (error instanceof ServiceError) {
        return NextResponse.json(
          { error: error.message },
          { status: error.status }
        );
      }

      if (isPrismaKnownError(error)) {
        const status = PRISMA_STATUS[error.code];
        if (status) {
          return NextResponse.json(
            { error: error.code === 'P2025' ? 'Not found' : error.message },
            { status }
          );
        }
      }

      console.error(`[API ${_opts?.domain || 'unknown'}]`, error);
      return NextResponse.json(
        { error: 'Internal server error' },
        { status: 500 }
      );
    }
  };
}

export function withMutation(
  handler: (request: NextRequest) => Promise<NextResponse>,
  _opts?: ApiWrapperOptions
) {
  return withApi(handler, _opts);
}
