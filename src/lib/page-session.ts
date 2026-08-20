import { cookies } from 'next/headers';
import {
  SESSION_COOKIE_NAME,
  tokenTenantId,
  verifySessionToken,
} from '@/services/auth/session-service';
import { runWithTenantContext, setRequestTenantId } from '@/core/security/tenant-context';
import { db } from '@/lib/db';

/**
 * Проверка сессии для СЕРВЕРНЫХ РАСКЛАДОК страниц.
 *
 * Зачем отдельно от `requireAuth`. Тот работает внутри обёртки `withApi`,
 * которая открывает контекст организации. Раскладки страниц через обёртку не
 * проходят — они серверные компоненты, а не маршруты API. Без контекста
 * строгая политика RLS не отдаёт строку пользователя, раскладка решает
 * «сессии нет» и шлёт на /login, а страница входа видит сохранённую сессию и
 * шлёт обратно. Получается бесконечный круг переходов.
 *
 * Так и случилось на бою 19.08.2026 сразу после перевода политик в
 * fail-closed: весь раздел администратора мигал между /admin и /login, по три
 * перехода в секунду. Разбор — ADR-0046.
 *
 * Порядок тот же, что в `lib/auth.ts`: организация из токена попадает в
 * контекст ДО чтения строки пользователя, иначе замкнутый круг.
 */
export interface PageSessionUser {
  role: string;
  isActive: boolean;
  sessionVersion: number;
}

/**
 * Вернуть пользователя текущей сессии или `null`, если сессии нет, она
 * отозвана, учётная запись выключена или организация в токене разошлась со
 * строкой. Решение, куда перенаправлять, принимает вызывающая раскладка:
 * `redirect()` бросает служебное исключение, и держать его снаружи контекста
 * надёжнее.
 */
export async function readPageSessionUser(): Promise<PageSessionUser | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const payload = await verifySessionToken(token);
  if (!payload) return null;

  return runWithTenantContext(async () => {
    const claimedTenantId = tokenTenantId(payload);
    if (claimedTenantId !== undefined) {
      setRequestTenantId(claimedTenantId);
    }

    const user = await db.user.findUnique({
      where: { id: payload.sub },
      select: { role: true, isActive: true, sessionVersion: true, tenantId: true },
    });

    // Та же проверка, что и в requireAuth: подпись токена и список отзыва не
    // знают, что роль или признак активности могли измениться. Без неё
    // выключенный пользователь видел бы оболочку раздела до истечения токена,
    // хотя каждый запрос под ней уже отвечает отказом.
    if (!user || !user.isActive || (payload.sv ?? 0) !== user.sessionVersion) {
      return null;
    }

    // Токен утверждает одну организацию, строка говорит другую — пользователя
    // перевели, а токен остался старый.
    if (claimedTenantId !== undefined && user.tenantId !== claimedTenantId) {
      return null;
    }

    return { role: user.role, isActive: user.isActive, sessionVersion: user.sessionVersion };
  });
}
