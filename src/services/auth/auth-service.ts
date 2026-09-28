import { hash as bcryptHash, compare as bcryptCompare } from 'bcryptjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { attachRequestIdHeader } from '@/lib/request-context';
import {
  attachSessionCookie,
  clearSessionCookie,
  createSessionToken,
  type SessionUser,
} from '@/services/auth/session-service';
import { rateLimiter, AUTH_RATE_LIMIT, LOGIN_IP_RATE_LIMIT, ACCOUNT_LOCKOUT_RATE_LIMIT } from '@/lib/rate-limiter';
import { logger } from '@/lib/logger';
import { withIdentityRole } from '@/core/security/identity-role';

const BCRYPT_ROUNDS = 12;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;
/**
 * bcrypt-хеш случайной строки, которой никто не знает. Сверка с ним занимает
 * столько же, сколько сверка с настоящим паролем: без неё ответ «нет такого
 * адреса» приходил мгновенно, и по секундомеру перебирались все e-mail.
 */
const TIMING_EQUALIZER_HASH = '$2b$12$NgCt4i.5lgeRdr5zSX6/aOm6xxgGEOFfKmpvQy9k9QU3fEiPFiKE2';

export async function hashPassword(value: string): Promise<string> {
  return bcryptHash(value, BCRYPT_ROUNDS);
}

export async function verifyPassword(value: string, hash: string): Promise<boolean> {
  return bcryptCompare(value, hash);
}

function hashLegacyPassword(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function isBcryptHash(hash: string) {
  return hash.startsWith('$2');
}

function isLegacySha256Hash(hash: string) {
  return SHA256_HEX_PATTERN.test(hash);
}

function safeHexEqual(aHex: string, bHex: string) {
  if (aHex.length !== bHex.length) return false;
  try {
    return timingSafeEqual(Buffer.from(aHex, 'hex'), Buffer.from(bHex, 'hex'));
  } catch {
    return false;
  }
}

async function verifyPasswordWithLegacySupport(value: string, storedHash: string) {
  if (isBcryptHash(storedHash)) {
    return { isValid: await verifyPassword(value, storedHash), needsUpgrade: false };
  }

  if (isLegacySha256Hash(storedHash)) {
    return {
      isValid: safeHexEqual(hashLegacyPassword(value), storedHash),
      needsUpgrade: true,
    };
  }

  // Unknown hash format — refuse authentication rather than falling through
  // to plaintext comparison (historical footgun — stored plaintext passwords
  // would otherwise authenticate successfully).
  return { isValid: false, needsUpgrade: false };
}

async function upgradeLegacyPasswordIfNeeded(userId: string, plainTextPassword: string, needsUpgrade: boolean) {
  if (!needsUpgrade) {
    return;
  }

  const hashed = await hashPassword(plainTextPassword);
  await withIdentityRole((client) =>
    client.user.update({ where: { id: userId }, data: { password: hashed } }),
  );
}

function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string | null;
  sessionVersion: number;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: user.tenantId,
    sessionVersion: user.sessionVersion,
  };
}

export async function authenticateUserByEmailPassword(
  email: string,
  password: string,
  // IP-derived identifier from getRateLimitIdentifier(). Optional so internal
  // callers (scripts/tests) keep working; they share one 'unknown' bucket.
  clientIdentifier: string = 'unknown',
) {
  // Dual buckets (audit A-2). Per-IP first: caps total attempts from one
  // address, closing the "rotate emails for unlimited tries" bypass.
  const ipLimit = await rateLimiter.check(`login-ip:${clientIdentifier}`, LOGIN_IP_RATE_LIMIT);
  if (!ipLimit.allowed) {
    return { user: null, rateLimited: true, retryAfter: ipLimit.retryAfter };
  }

  // Аккаунт целиком, со всех адресов (решение владельца 28.09.2026, вариант
  // «б»). Прежняя схема сознательно не блокировала аккаунт глобально — чтобы
  // чужой не мог запереть машиниста, — но тогда каждый новый IP давал ещё
  // 5 попыток на тот же аккаунт. Владелец выбрал блок на 15 минут. Ключ — по
  // почте, есть такой пользователь или нет: блок не выдаёт, существует ли
  // аккаунт. Пользователя не ищем, пока аккаунт закрыт.
  const lockoutKey = `login-acct:${email.toLowerCase()}`;
  const lockout = await rateLimiter.check(lockoutKey, ACCOUNT_LOCKOUT_RATE_LIMIT);
  if (!lockout.allowed) {
    return { user: null, rateLimited: true, retryAfter: lockout.retryAfter };
  }

  // Account bucket is scoped to email+IP, not bare email: a stranger firing
  // wrong passwords at a known email must not lock the real owner out from
  // their own address (lockout-DoS). Brute-forcing one account across many
  // IPs is still capped by the per-IP bucket above.
  const accountKey = `login:${email.toLowerCase()}:${clientIdentifier}`;
  const rateLimit = await rateLimiter.check(accountKey, AUTH_RATE_LIMIT);

  if (!rateLimit.allowed) {
    return { user: null, rateLimited: true, retryAfter: rateLimit.retryAfter };
  }

  // Опознание идёт под ролью, которой политики RLS не писаны: организация
  // ещё неизвестна — она лежит в той самой строке, которую мы ищем.
  const user = await withIdentityRole((client) =>
    client.user.findUnique({
      where: { email: email.toLowerCase() },
      select: {
        id: true,
        email: true,
        password: true,
        name: true,
        role: true,
        isActive: true,
        tenantId: true,
        sessionVersion: true,
      },
    }),
  );

  if (!user || !user.isActive) {
    await bcryptCompare(password, TIMING_EQUALIZER_HASH);
    return { user: null, rateLimited: false };
  }

  try {
    const verification = await verifyPasswordWithLegacySupport(password, user.password);
    const isValid = verification.isValid;
    if (!isValid) {
      return { user: null, rateLimited: false };
    }

    await upgradeLegacyPasswordIfNeeded(user.id, password, verification.needsUpgrade);
    await rateLimiter.reset(accountKey);
    await rateLimiter.reset(lockoutKey);
    return { user: toSessionUser(user), rateLimited: false };
  } catch (err) {
    logger.error('authenticateUserByEmailPassword failed', err);
    throw err;
  }
}

export async function createAuthenticatedResponse(user: SessionUser, requestId?: string) {
  const response = NextResponse.json({ user });
  attachSessionCookie(response, await createSessionToken(user));
  return requestId ? attachRequestIdHeader(response, requestId) : response;
}

export function createLogoutResponse(requestId?: string) {
  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  return requestId ? attachRequestIdHeader(response, requestId) : response;
}
