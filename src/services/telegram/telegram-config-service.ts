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

export async function listTelegramConfigs() {
  const configs = await db.telegramConfig.findMany({
    orderBy: { createdAt: 'desc' },
  });

  // Decrypt botToken for each config. A token encrypted under a different
  // ENCRYPTION_KEY (e.g. prod data loaded into a local DB) can't be decrypted
  // here — degrade to an empty token instead of failing the whole list, so the
  // settings page still loads and the token can be re-entered.
  return configs.map((config) => {
    let botToken = config.botToken;
    if (botToken && isEncrypted(botToken)) {
      try {
        botToken = decrypt(botToken);
      } catch {
        botToken = '';
      }
    }
    return { ...config, botToken };
  });
}

export async function createTelegramConfig(input: {
  label: unknown;
  botToken: unknown;
  chatId: unknown;
  enabled?: unknown;
}) {
  const rawBotToken = normalizeText(input.botToken, 'botToken');
  const encryptedBotToken = encrypt(rawBotToken);

  return db.telegramConfig.create({
    data: {
      label: normalizeText(input.label, 'label'),
      botToken: encryptedBotToken,
      chatId: normalizeText(input.chatId, 'chatId'),
      enabled: input.enabled === undefined ? true : Boolean(input.enabled),
    },
  });
}

export async function updateTelegramConfig(
  id: string,
  input: {
    label?: unknown;
    botToken?: unknown;
    chatId?: unknown;
    enabled?: unknown;
  }
) {
  if (!id) {
    throw new ServiceError('id required', 400);
  }

  const data: Record<string, unknown> = {};
  if (input.label !== undefined) data.label = normalizeText(input.label, 'label');
  if (input.botToken !== undefined) {
    data.botToken = encrypt(normalizeText(input.botToken, 'botToken'));
  }
  if (input.chatId !== undefined) data.chatId = normalizeText(input.chatId, 'chatId');
  if (input.enabled !== undefined) data.enabled = Boolean(input.enabled);

  try {
    return await db.telegramConfig.update({
      where: { id },
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    if (message.includes('Record to update not found')) {
      throw new ServiceError('Config not found', 404);
    }
    throw error;
  }
}

export async function deleteTelegramConfig(id: string) {
  if (!id) {
    throw new ServiceError('id required', 400);
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
