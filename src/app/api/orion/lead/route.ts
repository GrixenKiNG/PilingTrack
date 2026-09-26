/**
 * POST /api/orion/lead — public lead form on the ORION marketing site.
 *
 * Unauthenticated by design (public site), so it is hardened instead:
 *   - IP rate limit (LEAD_RATE_LIMIT) to stop flooding the Telegram chat;
 *   - a honeypot field (`website`) that real users never fill — bots do;
 *   - strict length caps + HTML-escaping before the text reaches Telegram
 *     (the notifier sends parse_mode=HTML, so raw user input must be escaped).
 *
 * СОХРАНЕНИЕ ИДЁТ ПЕРВЫМ. Раньше единственным экземпляром заявки было
 * сообщение в Telegram: отправка шла «в никуда» (`void`), ответ «принято»
 * уходил посетителю независимо от результата, а в журнал попадал лишь признак
 * «текст есть» — ни имени, ни контакта. Недоступный Telegram (у этого
 * провайдера он ходит через прокси) означал потерянного клиента, уверенного,
 * что его услышали. Теперь строка пишется в `OrionLead` до отправки, а исход
 * доставки записывается в ту же строку: `deliveredAt IS NULL` — это список
 * заявок, о которых компания могла не узнать.
 *
 * Ответ посетителю остаётся успешным даже при сбое Telegram: заявка сохранена,
 * и предлагать человеку отправить её заново — значит плодить дубли.
 * Серверная почта не подключена; появится транспорт — добавляется здесь.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { telegramNotifier } from '@/core/notifications/telegram';
import { withTenantContext } from '@/core/security/tenant-enforcement';
import { rateLimiter, getRateLimitIdentifier, type RateLimitConfig } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import type { PrismaClient } from '@/generated/postgres-client/client';

export const runtime = 'nodejs';

const LEAD_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 10 * 60 * 1000,      // 5 заявок за 10 минут с одного IP
  blockDurationMs: 30 * 60 * 1000,
};

const leadSchema = z.object({
  name: z.string().trim().min(1).max(100),
  contact: z.string().trim().min(1).max(120),
  message: z.string().trim().max(1500).optional().default(''),
  consent: z.literal(true),
  // Honeypot: hidden field; real users never fill it. Accept any value here so
  // a filled honeypot passes validation and is dropped silently below (a hard
  // schema reject would signal the bot that the field mattered).
  website: z.string().max(200).optional().default(''),
});

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function POST(request: NextRequest) {
  const limit = await rateLimiter.check(getRateLimitIdentifier(request), LEAD_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: 'Слишком много заявок. Попробуйте позже.' },
      { status: 429, headers: limit.retryAfter ? { 'Retry-After': String(limit.retryAfter) } : undefined },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Проверьте поля формы' }, { status: 400 });
  }

  const { name, contact, message, website } = parsed.data;
  const isSpam = Boolean(website);

  const tenantId = process.env.DEFAULT_TENANT_ID;
  if (!tenantId) {
    // Без тенанта строку не записать, а терять заявку молча нельзя: пишем всё
    // в журнал и признаёмся посетителю, что приняли ненадёжно.
    logger.error('ORION lead cannot be stored: DEFAULT_TENANT_ID is not set', { name, contact, message });
    return NextResponse.json({ error: 'Заявка не сохранена. Позвоните нам, пожалуйста.' }, { status: 500 });
  }

  // Сохраняем ДО отправки — включая заявки, на которых сработала ловушка.
  // Ловушка ошибается (менеджер паролей заполняет скрытое поле), и тихо терять
  // настоящего клиента дороже, чем хранить спам с пометкой.
  let leadId: string;
  try {
    leadId = await withTenantContext(tenantId, async (tx) => {
      const created = await (tx as PrismaClient).orionLead.create({
        data: { tenantId, name, contact, message, isSpam },
        select: { id: true },
      });
      return created.id;
    });
  } catch (error) {
    logger.error('ORION lead could not be stored', { error, name, contact, message });
    return NextResponse.json({ error: 'Заявка не сохранена. Позвоните нам, пожалуйста.' }, { status: 500 });
  }

  logger.info('ORION lead stored', { leadId, isSpam, hasMessage: message.length > 0 });

  // Боту подтверждаем успех и не тревожим чат: заявка уже лежит в базе с
  // пометкой, разбирать её будет человек, а не Telegram.
  if (isSpam) {
    return NextResponse.json({ ok: true });
  }

  const text =
    '🏗 <b>Новая заявка с сайта ОРИОН</b>\n\n' +
    `👤 Имя: <b>${escapeHtml(name)}</b>\n` +
    `📞 Контакт: <code>${escapeHtml(contact)}</code>\n` +
    (message ? `💬 ${escapeHtml(message)}\n` : '') +
    `\n⏰ ${new Date().toLocaleString('ru-RU')}`;

  // Ждём отправку, чтобы записать её исход. Ответ посетителю всё равно
  // успешный: заявка сохранена, и просить отправить заново — плодить дубли.
  //
  // ВНИМАНИЕ НА ВОЗВРАТ. `sendMessage` не бросает исключение, а возвращает
  // `false` — и когда Telegram ответил ошибкой, и когда бот вообще не настроен.
  // Полагаться на try/catch здесь нельзя: заявка помечалась бы доставленной,
  // хотя её никто не получил, а именно от этого таблица и заводилась.
  let deliveryError: string | null = null;
  try {
    const sent = await telegramNotifier.sendMessage(text);
    if (!sent) deliveryError = 'Telegram не принял сообщение или бот не настроен';
  } catch (error) {
    deliveryError = error instanceof Error ? error.message : String(error);
  }
  if (deliveryError) {
    logger.error('Failed to forward ORION lead to Telegram', { leadId, deliveryError });
  }

  // Пометка доставки не должна ронять запрос: заявка уже сохранена, и отказ
  // посетителю из-за неудачного UPDATE был бы враньём.
  try {
    await withTenantContext(tenantId, (tx) =>
      (tx as PrismaClient).orionLead.update({
        where: { id: leadId },
        data: deliveryError ? { deliveryError } : { deliveredAt: new Date() },
      }),
    );
  } catch (error) {
    logger.error('Failed to record ORION lead delivery status', { leadId, error });
  }

  return NextResponse.json({ ok: true });
}
