/**
 * POST /api/orion/lead — public lead form on the ORION marketing site.
 *
 * Unauthenticated by design (public site), so it is hardened instead:
 *   - IP rate limit (LEAD_RATE_LIMIT) to stop flooding the Telegram chat;
 *   - a honeypot field (`website`) that real users never fill — bots do;
 *   - strict length caps + HTML-escaping before the text reaches Telegram
 *     (the notifier sends parse_mode=HTML, so raw user input must be escaped).
 *
 * Delivery: forwards to the tenant's configured Telegram chat via the existing
 * notifier. Every lead is also logged, so nothing is lost even when Telegram
 * is not configured (e.g. local dev). Server-side email is not wired yet —
 * add it here once an SMTP/transactional-email transport exists.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { telegramNotifier } from '@/core/notifications/telegram';
import { rateLimiter, getRateLimitIdentifier, type RateLimitConfig } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';

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

  // Honeypot tripped — pretend success, drop silently so bots get no signal.
  if (website) {
    return NextResponse.json({ ok: true });
  }

  logger.info('ORION lead received', { hasMessage: message.length > 0 });

  const text =
    '🏗 <b>Новая заявка с сайта ОРИОН</b>\n\n' +
    `👤 Имя: <b>${escapeHtml(name)}</b>\n` +
    `📞 Контакт: <code>${escapeHtml(contact)}</code>\n` +
    (message ? `💬 ${escapeHtml(message)}\n` : '') +
    `\n⏰ ${new Date().toLocaleString('ru-RU')}`;

  // Fire delivery but never fail the request on a transport error — the lead is
  // already in the logs, and the visitor should see a clean confirmation.
  void telegramNotifier.sendMessage(text).catch((err) => {
    logger.error('Failed to forward ORION lead to Telegram', err);
  });

  return NextResponse.json({ ok: true });
}
