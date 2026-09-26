import { z } from 'zod';
import { requireTenantId } from '@/lib/tenant';
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import {
  createTelegramConfig,
  deleteTelegramConfig,
  listTelegramConfigs,
  updateTelegramConfig,
} from '@/services/telegram/telegram-config-service';
import { telegramConfigSchema } from '@/lib/validation-schemas';
import { withApi, withMutation, readJsonBody } from '@/core/api-wrapper';
import { getResponseCache } from '@/core/cache';
import { db } from '@/lib/db';
import { recordAuditEvent } from '@/services/audit/audit-service';

const telegramConfigIdSchema = telegramConfigSchema.partial().extend({ id: z.string().min(1) });
const deleteIdSchema = z.object({ id: z.string().min(1, 'Invalid ID') });

/**
 * Снимок канала для журнала аудита.
 *
 * Канал решает, кто получит сообщение о дефекте или простое, поэтому в ленте
 * должно быть видно, какой чат заводили и правят. Собираем поля поимённо, а не
 * берём строку из базы целиком: `botToken` (даже в шифрованном виде) и его
 * хвост в след не попадают — токен бота даёт полный контроль над ботом.
 */
function channelSnapshot(config: { id: string; label: string; chatId: string; enabled: boolean }) {
  return {
    configId: config.id,
    label: config.label,
    chatId: config.chatId,
    enabled: config.enabled,
  };
}

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'telegram.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const configs = await listTelegramConfigs(tenantId);
    return NextResponse.json({ configs });
  },
  { domain: 'telegram', cache: true, cacheTTL: 60_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'telegram.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await readJsonBody(request);

    const validation = telegramConfigSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const config = await createTelegramConfig(tenantId, validation.data);
    getResponseCache('telegram').invalidateAll();
    // Кто получает оповещения о дефектах и простоях, решает этот канал —
    // без записи в ленте переезд алертов на другой чат неотличим от «никто не
    // менял». Токен в metadata не кладём никогда (channelSnapshot).
    await recordAuditEvent({
      action: 'telegram.config.created',
      scope: 'telegram',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: config.id,
      tenantId,
      metadata: channelSnapshot(config),
    });
    return NextResponse.json({ config }, { status: 201 });
  },
  { domain: 'telegram' }
);

export const PUT = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'telegram.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await readJsonBody(request);

    const validation = telegramConfigIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const { id, ...data } = validation.data;
    const config = await updateTelegramConfig(tenantId, id, data);
    getResponseCache('telegram').invalidateAll();
    // Признак замены токена нужен в ленте («секрет меняли»), а сам токен —
    // нет: он даёт полный контроль над ботом.
    await recordAuditEvent({
      action: 'telegram.config.updated',
      scope: 'telegram',
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      actorId: user!.id,
      targetId: config.id,
      tenantId,
      metadata: { ...channelSnapshot(config), tokenUpdated: data.botToken !== undefined },
    });
    return NextResponse.json({ config });
  },
  { domain: 'telegram' }
);

export const DELETE = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'telegram.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await readJsonBody(request);

    const validation = deleteIdSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    // Снимок читаем ДО удаления — после него сказать, что именно исчезло, будет
    // уже нечем. Токен в выборку не берём: секрет не должен попадать даже в
    // память следа.
    const before = await db.telegramConfig.findFirst({
      where: { id: validation.data.id, tenantId },
      select: { id: true, label: true, chatId: true, enabled: true },
    });

    const result = await deleteTelegramConfig(tenantId, validation.data.id);
    getResponseCache('telegram').invalidateAll();
    // Удалённый канал — это чат, в который больше не придёт алерт о дефекте или
    // простое; без записи восстановить по базе решение нечем.
    if (before) {
      await recordAuditEvent({
        action: 'telegram.config.deleted',
        scope: 'telegram',
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
        actorId: user!.id,
        targetId: before.id,
        tenantId,
        metadata: channelSnapshot(before),
      });
    }
    return NextResponse.json(result);
  },
  { domain: 'telegram' }
);
