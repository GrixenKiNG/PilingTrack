/**
 * GET /api/openapi
 *
 * Serve OpenAPI specification.
 * Accessible at: GET /api/openapi
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import * as fs from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'system.read');
  const specPath = path.join(process.cwd(), 'public', 'openapi.json');

  if (!fs.existsSync(specPath)) {
    return NextResponse.json(
      { error: 'OpenAPI spec not generated. Run: npm run openapi:generate' },
      { status: 404 }
    );
  }

  const content = fs.readFileSync(specPath, 'utf8');
  return new NextResponse(content, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
