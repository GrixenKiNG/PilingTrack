/**
 * GET/PUT /api/settings — per-tenant workspace settings + notification prefs.
 * GET: any authenticated user (read). PUT: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getSettings, saveSettings } from '@/modules/settings';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = requireTenantId(user!);
  return NextResponse.json(await getSettings(tenantId));
}, { domain: 'settings' });

export const PUT = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  if (user!.role !== 'ADMIN') return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = requireTenantId(user!);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const saved = await saveSettings(tenantId, body, user!.id);
  return NextResponse.json(saved);
}, { domain: 'settings' });
