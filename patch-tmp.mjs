import {readFileSync, writeFileSync} from 'node:fs';
const file = 'src/core/api-wrapper.ts';
let src = readFileSync(file, 'utf8');
const edit = (from, to) => {
  if (!src.includes(from)) throw new Error('якорь не найден:\n' + from.slice(0,90));
  src = src.replace(from, to);
};

edit(`export function getSessionCacheScope(request: NextRequest): string | undefined {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return undefined;

  return createHash('sha256').update(sessionToken).digest('hex').slice(0, 24);
}`,
`/**
 * Область кеша одного посетителя.
 *
 * ПОЧЕМУ В КЛЮЧ ВХОДИТ ИСПОЛНЯЕМАЯ РОЛЬ. Администратор переключается в режим
 * «действую как» тем же токеном, и без этого заголовка ответ, снятый в полных
 * правах, отдавался бы ему же в урезанной роли — экран показывал бы чужой
 * объём. Значению заголовка доверять не нужно: подставить чужую роль не даст
 * `requireAuth`, а здесь он лишь разделяет ячейки кеша.
 *
 * ПОЧЕМУ ЭТО ЖЕ МЕСТО СЧИТАЕТ КЛЮЧ ДЛЯ СБРОСА. Маршрут обратной связи гасит
 * запись того же посетителя (`invalidateFeedbackCache`). Считай он ключ сам —
 * первое расхождение оставило бы висеть ячейку, которую никто не может убрать.
 */
export function getSessionCacheScope(request: NextRequest): string | undefined {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) return undefined;

  const actingAs = request.headers.get('x-acting-as') ?? '';
  return createHash('sha256').update(\`\${sessionToken}:\${actingAs}\`).digest('hex').slice(0, 24);
}`);

edit(`      if (
        _opts?.cache &&
        request.method === 'GET' &&
        !request.nextUrl.searchParams.has('_ts')
      ) {
        const responseCache = getResponseCache(domain);
        const userScope = getSessionCacheScope(request);

        response = await responseCache.getOrFetch(`,
`      // Сессию проверяем ДО обращения к кешу.
      //
      // Проверки прав живут внутри обработчиков (\`requireAuth\`, \`assertCan\`), а
      // попадание в кеш обработчик не запускает вовсе. Отозванный или истёкший
      // токен продолжал получать снятый прежде ответ всё время жизни записи —
      // включая окно подачи устаревшего. Наличие строки токена сессией не
      // является, и хеш от неё это не проверяет.
      //
      // Невалидная сессия — идём мимо кеша: обработчик сам ответит отказом в
      // своей форме. Токена нет вовсе — поведение прежнее: обработчик всё равно
      // ответит 401, и кешировать его безопасно, ячейка общая для всех
      // неопознанных.
      const cacheable = Boolean(_opts?.cache)
        && request.method === 'GET'
        && !request.nextUrl.searchParams.has('_ts')
        && (readSessionToken(request) === null || (await requireAuth(request)).user !== null);

      if (cacheable) {
        const responseCache = getResponseCache(domain);
        const userScope = getSessionCacheScope(request);

        response = await responseCache.getOrFetch(`);

edit(`import { readSessionToken } from '@/services/auth/session-service';`,
`import { readSessionToken } from '@/services/auth/session-service';
import { requireAuth } from '@/lib/auth';`);

writeFileSync(file, src);
console.log('готово');
