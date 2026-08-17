import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { encrypt, decrypt, isEncrypted } from '@/core/security/encryption';

function normalizeText(value: unknown, field: string) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new ServiceError(`${field} required`, 400);
  }
  return normalized;
}

function requireTenantId(tenantId: string) {
  if (!tenantId) {
    throw new ServiceError('tenantId is required', 400); // fail-closed (IDOR guard)
  }
  return tenantId;
}

/**
 * Хвост токена для опознания записи — и ничего больше.
 *
 * Токен бота даёт полный контроль над ботом: рассылку от его имени, чтение
 * истории, смену вебхука. Наружу он не выходит НИКОГДА. Интерфейс и так
 * показывал только последние символы (`••••1234`) — полный токен ехал в
 * браузер лишь затем, чтобы там же быть обрезанным, попутно оседая в памяти
 * вкладки, в devtools и в любом XSS.
 *
 * Отправитель уведомлений читает базу напрямую и расшифровывает сам
 * (core/notifications/telegram.ts), поэтому маскировка его не затрагивает.
 */
function tokenHint(plainToken: string): string {
  return plainToken.length > 4 ? plainToken.slice(-4) : '';
}

export type TelegramConfigView = Omit<
  Awaited<ReturnType<typeof db.telegramConfig.findMany>>[number],
  'botToken'
> & { botTokenHint: string; hasBotToken: boolean };

export async function listTelegramConfigs(tenantId: string): Promise<TelegramConfigView[]> {
  requireTenantId(tenantId);
  const configs = await db.telegramConfig.findMany({
    where: { tenantId },
    orderBy: { createdAt: 'desc' },
  });

  // Расшифровка нужна только чтобы взять хвост. Токен, зашифрованный другим
  // ENCRYPTION_KEY (прод-данные в локальной базе), не читается — тогда запись
  // считается «без токена», и страница настроек всё равно открывается, а
  // токен можно ввести заново.
  return configs.map((config) => {
    const { botToken: stored, ...rest } = config;
    let plain = stored;
    if (plain && isEncrypted(plain)) {
      try {
        plain = decrypt(plain);
      } catch {
        plain = '';
      }
    }
    return { ...rest, botTokenHint: tokenHint(plain), hasBotToken: Boolean(plain) };
  });
}

/** Запись без секрета — для ответов на создание и правку. */
function toView(config: { botToken: string } & Record<string, unknown>): TelegramConfigView {
  const { botToken, ...rest } = config;
  // Здесь в botToken лежит шифротекст: расшифровывать ради хвоста не нужно,
  // вызывающий только что сам прислал токен и знает его.
  return {
    ...(rest as Omit<TelegramConfigView, 'botTokenHint' | 'hasBotToken'>),
    botTokenHint: '',
    hasBotToken: Boolean(botToken),
  };
}

export async function createTelegramConfig(
  tenantId: string,
  input: {
    label: unknown;
    botToken: unknown;
    chatId: unknown;
    enabled?: unknown;
  }
) {
  requireTenantId(tenantId);
  const rawBotToken = normalizeText(input.botToken, 'botToken');
  const encryptedBotToken = encrypt(rawBotToken);

  const created = await db.telegramConfig.create({
    data: {
      tenantId,
      label: normalizeText(input.label, 'label'),
      botToken: encryptedBotToken,
      chatId: normalizeText(input.chatId, 'chatId'),
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    },
  });
  return toView(created);
}

export async function updateTelegramConfig(
  tenantId: string,
  id: string,
  input: {
    label?: unknown;
    botToken?: unknown;
    chatId?: unknown;
    enabled?: unknown;
  }
) {
  requireTenantId(tenantId);
  if (!id) {
    throw new ServiceError('id required', 400);
  }

  // Tenant ownership (IDOR guard): verify the config belongs to this tenant
  // before touching it — id alone is not enough.
  const existing = await db.telegramConfig.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) {
    throw new ServiceError('Config not found', 404);
  }

  const data: Record<string, unknown> = {};
  if (input.label !== undefined) data.label = normalizeText(input.label, 'label');
  if (input.botToken !== undefined) {
    data.botToken = encrypt(normalizeText(input.botToken, 'botToken'));
  }
  if (input.chatId !== undefined) data.chatId = normalizeText(input.chatId, 'chatId');
  if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);

  try {
    return toView(await db.telegramConfig.update({
      where: { id },
      data,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('Record to update not found')) {
      throw new ServiceError('Config not found', 404);
    }
    throw error;
  }
}

export async function deleteTelegramConfig(tenantId: string, id: string) {
  requireTenantId(tenantId);
  if (!id) {
    throw new ServiceError('id required', 400);
  }

  // Tenant ownership (IDOR guard) before an irreversible delete.
  const existing = await db.telegramConfig.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) {
    throw new ServiceError('Config not found', 404);
  }

  try {
    await db.telegramConfig.delete({ where: { id } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('Record to delete not found')) {
      throw new ServiceError('Config not found', 404);
    }
    throw error;
  }

  return { success: true };
}
