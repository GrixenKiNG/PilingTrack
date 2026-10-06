import type { Prisma } from '@/generated/postgres-client/client';

export interface TelegramDeliveryProgress {
  deliveredChatIds: ReadonlySet<string>;
  confirm: (chatId: string) => Promise<void>;
}

/** Receipts live in the existing outbox JSON; no token or message content. */
export function createTelegramDeliveryProgress(
  payload: Prisma.JsonValue | undefined,
  persist: (payload: Prisma.InputJsonObject) => Promise<void>,
): TelegramDeliveryProgress {
  const body = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
  const stored = body.telegramDeliveredChatIds;
  const deliveredChatIds = new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
  return {
    deliveredChatIds,
    async confirm(chatId) {
      const confirmed = new Set([...deliveredChatIds, chatId]);
      await persist({ ...body, telegramDeliveredChatIds: [...confirmed] });
      deliveredChatIds.add(chatId);
    },
  };
}
