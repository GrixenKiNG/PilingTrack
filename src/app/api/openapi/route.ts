/**
 * GET /api/openapi
 *
 * Serve OpenAPI specification.
 * Accessible at: GET /api/openapi
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { withApi } from '@/core/api-wrapper';
import { promises as fs } from 'fs';
import * as path from 'path';

export const runtime = 'nodejs';

const SPEC_PATH = path.join(process.cwd(), 'public', 'openapi.json');

let cachedSpec: string | null = null;

async function loadSpec(): Promise<string | null> {
  if (cachedSpec) return cachedSpec;
  try {
    cachedSpec = await fs.readFile(SPEC_PATH, 'utf8');
    return cachedSpec;
  } catch {
    return null;
  }
}

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'system.read');

  const content = await loadSpec();
  if (!content) {
    return NextResponse.json(
      { error: 'OpenAPI spec not generated. Run: npm run openapi:generate' },
      { status: 404 }
    );
  }

  return new NextResponse(content, {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}, { domain: 'openapi' });
