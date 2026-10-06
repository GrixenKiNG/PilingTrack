/**
 * GET/PUT /api/settings — per-tenant workspace settings + notification prefs.
 * GET: any authenticated user (read). PUT: ADMIN only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { requireAuth } from '@/lib/auth';
import { resolveEffectiveRole } from '@/lib/types';
import { withApi, withMutation } from '@/core/api-wrapper';
import { getSettings, saveSettings, type WorkspaceSettings } from '@/modules/settings';
import { recordAuditEvent } from '@/services/audit/audit-service';

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
  if (resolveEffectiveRole(user!.role, user!.actingAs) !== 'ADMIN') return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const tenantId = requireTenantId(user!);
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный JSON' }, { status: 400 });
  }
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
  const actorId = user!.id;
  // Снимок «до» берём здесь, а не в saveSettings: служба настроек ничего не
  // знает о журнале, а след без прежнего значения не отвечает на вопрос «что
  // именно меняли».
  const before = await getSettings(tenantId);
  const saved = await saveSettings(tenantId, body, actorId);
  // Смена часового пояса двигает границы производственных суток и периоды
  // отчётов, выключатель уведомления меняет объём оповещений — но сохранение
  // «как было» следа не оставляет: лента должна показывать изменения, а не
  // каждое открытие экрана настроек.
  if (hasSettingsChanges(before, saved)) {
    await recordAuditEvent({
      action: 'settings.updated',
      scope: 'settings',
      actorId,
      tenantId,
      metadata: { before, after: saved },
    });
  }
  return NextResponse.json(saved);
}, { domain: 'settings' });

/** Значимые поля настроек: сохранение без изменений следа не оставляет. */
function hasSettingsChanges(before: WorkspaceSettings, after: WorkspaceSettings): boolean {
  return (
    before.companyName !== after.companyName ||
    before.inn !== after.inn ||
    before.timezone !== after.timezone ||
    before.dateFormat !== after.dateFormat ||
    before.units !== after.units ||
    before.currency !== after.currency ||
    notificationsChanged(before.notifications, after.notifications)
  );
}

/** Сравниваем по объединению ключей: набор переключателей может отличаться. */
function notificationsChanged(before: Record<string, boolean>, after: Record<string, boolean>): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (before[key] !== after[key]) return true;
  }
  return false;
}
