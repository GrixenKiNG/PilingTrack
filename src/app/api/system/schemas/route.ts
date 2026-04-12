/**
 * GET /api/system/schemas
 *
 * List all registered event schemas and their versions.
 * Admin only.
 *
 * Response:
 * {
 *   schemas: [
 *     { id: "report.created", version: 1, compatibility: "BACKWARD" },
 *     ...
 *   ]
 * }
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { schemaRegistry, registerAllEventSchemas } from '@/core/event-bus/schema-registry';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  try {
    assertCan(user!, 'system.read');

    // Ensure schemas are registered
    registerAllEventSchemas();

    const schemas = schemaRegistry.getAllSchemas();

    return NextResponse.json({ schemas });
  } catch (caughtError) {
    const message = caughtError instanceof Error ? caughtError.message : 'Internal error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
