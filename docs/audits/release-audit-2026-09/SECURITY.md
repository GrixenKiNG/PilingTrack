# SECURITY — результаты AppSec-проверки (OWASP-ориентированно)

**Ревизия:** `feat/safety-module` @ `054ee768` · **Дата:** 21.09.2026 · **Перепроверка авторизации:** 22.09.2026
**Метод:** статический анализ кода, чтение конфигов, анализ истории git, `npm audit`, точечные HTTP-пробы локального инстанса. Атак на прод/сторонние системы не проводилось.

## 1. Аутентификация и сессии
- Реализация логина/PIN, refresh-токенов и сессий присутствует (`src/services/auth/*`, `src/core/auth.ts`, `refresh-tokens.ts`, `session-service.ts`).
- Cookie-флаги и параметры сессии — требуют отдельного подтверждения (файлы собраны в evidence, но полный разбор не завершён из-за сбоя исполнителя). **Статус: требует проверки.**
- Rate limiting на login подтверждён E2E-тестом «rate limiting works on login» (`e2e/app.spec.ts`) — прошёл.
- Известный исторический риск: per-user/per-route rate limit и PIN-lockout (аудит 02.07.2026, High). Требует перепроверки.

## 2. Авторизация и изоляция
- Серверные гарды присутствуют: `assertCan(user, '<permission>')`, `requireAuth`, `requireTenantId`, `withApi`/`withMutation`.
- IDOR-гард по tenant в `reports/delete`: перед удалением выполняется `findFirst({reportId, tenantId})` (fail-closed).
- **F-01 (ЗАКРЫТО 22.09.2026):** владелец сверяется по найденной записи в командном сервисе (`report-command.service.ts:136`), вторая линия — по организации (`:143`). Покрыто `report-command-service.test.ts:409` + 2 теста на организацию; мутационная проверка пройдена.
- **F-02 (ЗАКРЫТО 22.09.2026):** ключ кэша содержит `sha256(sessionToken:actingAs)` (`api-wrapper.ts:44`), сессия проверяется до кэша (`:88`), смена роли/блокировка поднимают `sessionVersion` и отвергают старый JWT. Покрыто `api-wrapper.test.ts:162,184`.
- Подмена `reportId` и «действую как» разобраны и закрыты тестами (см. F-01/F-02). Сквозной прогон по ролям (аноним/оператор/чужой объект/заблокированный) вживую не выполнялся. **Статус: частично, остаток — в E2E.**

## 3. Секреты
- ✅ `.env`, `.env.docker`, `.env.sentry-build-plugin` — в `.gitignore` (строки 11, 17, 125). В git отслеживаются только `.env.*.example`.
- ✅ История по `.env*` пуста (`git log --all -- .env*` — нет результатов).
- ⚠️ В README документированы дефолтные учётки (`admin@piling.ru`/`admin123` и др.) — **должны быть сменены в production** (README это отмечает).
- Секреты в отчёте не публикуются (только тип/файл/маска).

## 4. Веб-безопасность и заголовки
- ✅ `deploy/Caddyfile.prod` (источник истины) выставляет: HSTS (preload), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`; срезает `Server`/`X-Powered-By`.
- ✅ CSP задаётся в `next.config.ts` (напр. `frame-ancestors 'self'`).
- ⚠️ **F-06:** `X-Frame-Options` задан и в Caddy (DENY), и в `next.config.ts` (SAMEORIGIN) — потенциальный конфликт/дубль.
- ✅ **Исправлено:** `Permissions-Policy` теперь `geolocation=(self)` (погода по координатам телефона); камера закрыта намеренно, фото — через `<input capture>`.

## 5. Загрузка файлов / обработка медиа
- `src/core/media/*` содержит проверки magic-bytes (`content-magic-bytes` тесты проходят) и построение ключей (`build-media-key`).
- Обработка изображений — `sharp@0.35.4`. Полная проверка MIME/размера/расширения по всем точкам загрузки не завершена. **Статус: требует проверки.**

## 6. Зависимости / supply chain
- `npm audit` (21.09.2026): **7 уязвимостей — 0 critical, 4 high, 3 moderate.**
  - Было (15.09): 13 (1 critical next-RCE, 8 high, 4 moderate). Критичная next-уязвимость закрыта (установлен `next@16.3.5`).
  - Остаточные high — в dev/build-цепочке (browserslist, vitest/@vitest/mocker, js-yaml).
- Установленные версии: `next@16.3.5`, `sharp@0.35.4`, `prisma@7.10.0`, `vitest@4.1.5`, `js-yaml@4.3.2`, `browserslist@4.28.9`, `fast-uri@3.1.7`, `mysql2@3.15.3`.
- Рекомендация: `npm audit --omit=dev` как CI-гейт; `postinstall` = `npm run db:generate` (без сетевых скриптов) — безопасно.

## 7. CI/CD
- Workflows: `.github/workflows/ci.yml` (unit+typecheck+lint, миграции на PostgreSQL, E2E Playwright chromium), `deploy.yml`.
- Actions пинованы тегами (`actions/checkout@v4`, `actions/setup-node@v4`, `actions/cache@v4`). Рекомендация — пиновать по SHA и ограничить `permissions:` (требует проверки содержимого обеих workflow целиком).

---

## Сводка по безопасности
| Область | Статус |
|---|---|
| Секреты в git | ✅ чисто |
| Заголовки безопасности (prod Caddy) | ✅ заданы (конфликт XFO — см. F-06) |
| Геолокация/Permissions-Policy | ✅ исправлено |
| Критичные уязвимости зависимостей | ✅ 0 critical |
| Серверная авторизация | ✅ F-01/F-02 закрыты и покрыты тестами (22.09.2026); сквозной прогон по ролям — за E2E |
| Rate limiting / brute-force | ⚠️ базово подтверждено E2E, полный аудит не завершён |
| Загрузка файлов | ⚠️ требуется проверка |
| Наблюдаемость (deep-health) | ⚠️ 503 на проде — ложная тревога, причина найдена и исправлена локально (F-03) |
