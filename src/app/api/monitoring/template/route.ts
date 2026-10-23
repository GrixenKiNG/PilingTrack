/**
 * GET/PUT /api/monitoring/template
 *
 * Server-persisted equipment tile template for the /monitoring dashboard.
 * GET returns the tenant's saved template, or the default if none is saved.
 * PUT is ADMIN-only and requires the revision returned by GET (If-Match).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getLayoutSnapshot, saveLayoutSnapshot, LayoutConflictError, MONITORING_EQUIPMENT_TILE_SURFACE_ID } from '@/modules/layout';
import { resolveEffectiveRole } from '@/lib/types';
import { logger } from '@/lib/logger';

export const runtime = 'nodejs';

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = requireTenantId(user!);
  const snapshot = await getLayoutSnapshot(tenantId, MONITORING_EQUIPMENT_TILE_SURFACE_ID);
  return NextResponse.json(snapshot.template, { headers: { ETag: snapshot.revision } });
}, { domain: 'monitoring' });

export const PUT = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  if (resolveEffectiveRole(user!.role, user!.actingAs) !== 'ADMIN') return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = requireTenantId(user!);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const saved = await saveLayoutSnapshot(tenantId, MONITORING_EQUIPMENT_TILE_SURFACE_ID, body, user!.id, undefined, request.headers.get('If-Match'));
    return NextResponse.json(saved.template, { headers: { ETag: saved.revision } });
  } catch (err) {
    if (err instanceof LayoutConflictError) return NextResponse.json({ error: err.message }, { status: 409 });
    // `TypeError` — шаблон не прошёл проверку. Всё остальное — сбой базы или
    // кэша: админу не нужно «править верные данные», нужно повторить позже.
    if (err instanceof TypeError) return NextResponse.json({ error: 'Некорректные данные' }, { status: 400 });
    logger.error('Monitoring template save failed', err, { domain: 'monitoring' });
    return NextResponse.json(
      { error: 'Сервис временно недоступен. Повторите через минуту.' },
      { status: 503, headers: { 'Retry-After': '15' } },
    );
  }
}, { domain: 'monitoring' });
