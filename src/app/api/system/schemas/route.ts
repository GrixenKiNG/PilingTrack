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
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'system.read');

    // Ensure schemas are registered
    registerAllEventSchemas();

    const schemas = schemaRegistry.getAllSchemas();

    return NextResponse.json({ schemas });
  },
  { domain: 'system' }
);
