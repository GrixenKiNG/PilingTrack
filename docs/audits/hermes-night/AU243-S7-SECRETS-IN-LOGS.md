# AU243-S7-SECRETS-IN-LOGS — Секреты в журналах

Версия: `cc49c1298f7c89353eaacf6edd6b5b9b279bfb51` (`git rev-parse HEAD`), ветка `hermes/q4-0926`.
Все пути — от корня репозитория `D:\PillingR\wt-night`.
Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` НЕ читались (запрет задачи) — выводы получены только из кода приложения.

## Итог

- Всего находок: **8**. По важности: **критично — 0, важно — 3, мелочь — 5**.
- Пароли, токены бота, ключи устройств и сессионные cookie в журналы **не пишутся осознанно**: телеграм-токен отсечён в аудите (`metadata` собирается поимённо), ключ устройства отдаётся один раз в ответе и не логируется, пароль в аудит-метаданные не попадает (select без `password`). Это ПРОЙДЕНО.
- Но защиты-сетки нет: логгер (`logger.ts`) и аудит (`audit-service.ts:1000`) пишут объекты как есть, без редакции и белого списка полей — любой будущий вызов, положивший секрет в `metadata` или в текст исключения, немедленно утечёт в stdout/Loki.
- Топ-3: (1) `audit-service.ts:1000` печатает весь объект события вместе со всеми `metadata`; (2) `mqtt-ingestion-service.ts:158` печатает `MQTT_BROKER_URL` целиком — если в URL встроены логин/пароль брокера, пароль попадает в лог; (3) у логгера нет слоя редакции, а `logger.error` всегда добавляет `error.message`/`error.stack`.
- Отдельно: Sentry DSN захардкожен литералом в `sentry.server.config.ts:8` и `sentry.edge.config.ts:9`, тогда как воркер берёт его из `process.env.SENTRY_DSN`.

## Методика

Поиск только чтением (`rg` через `search_files`, `read_file`), команды не печатают значения секретов — числа/факты.

1. Прочитан `src/lib/logger.ts` целиком — сигнатура и поведение логгера (JSON.stringify, что добавляется в `error`).
2. `rg -n "logger\.(info|warn|error|debug)\(" src/` — 258 вызовов; просмотрены опасные (те, что логируют объекты/исключения), не сами sec-файлы.
3. `rg -n "Sentry\.(captureException|captureMessage|setUser|setContext|addBreadcrumb|captureRequestError)" src/` — точки отправки в Sentry; прочитаны конфиги `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/workers/unified-worker/sentry.ts`, `src/instrumentation.ts`.
4. Прочитаны: `src/core/api-wrapper.ts`, `src/core/error-boundary/api-error-boundary.ts`, `src/core/observability/error-tracker.ts`.
5. Аудит: `src/services/audit/audit-service.ts` целиком; `rg -n "recordAuditEvent" src/` и разбор всех `metadata:` по местам вызова.
6. Секреты: `rg -n "password|botToken|apiKey|deviceKey|secret|webhookSecret|privateKey" src/`; прочитаны `services/users/user-service.ts`, `services/telegram/telegram-config-service.ts`, `core/notifications/telegram.ts`, `services/telemetry/device-key-service.ts`, `services/telemetry/mqtt-ingestion-service.ts`, `core/security/encryption.ts`, `app/api/auth/login/route.ts`, `app/api/auth/...`, `app/api/telemetry/ingest/route.ts`, `app/api/metrics/route.ts`, `app/api/alerts/webhook/route.ts`, `app/api/telegram/configs/route.ts`.
7. Cookie/заголовки: `rg -n "headers\.get\('(authorization|cookie)'\)|cookies\.get" src/`; прочитан `src/lib/csrf-protection.ts`, `services/auth/session-service.ts`, `src/lib/auth.ts` (catch), `src/proxy.ts`.
8. Фильтр Sentry по умолчанию (для оценки риска заголовков): `node_modules/@sentry/core/build/cjs/utils/data-collection/filtering-snippets.js:1-52`.
9. `rg` по `scripts/` на логирование env — секретов в логах скриптов не найдено.

## Находки

| # | severity | место (path:line) | что попадает | риск / сценарий | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/services/audit/audit-service.ts:1000` | Весь объект события аудита, включая все `metadata`, печатается в stdout/Loki: `logger.info('audit', event as unknown as Record<string, unknown>)`. Редакции полей нет. | Сегодняшние вызовы секретов не кладут (см. ниже ПРОЙДЕНО), но защиты нет: одно новое `recordAuditEvent({..., metadata: { botToken } })` — и токен в логах. Приведение `as unknown as Record` обходит проверку типов. | Перед логированием прогонять `metadata` через редактор секретных ключей (auth/token/secret/password/cookie/key) либо логировать только `action/scope/targetId/requestId`, без `metadata`. |
| 2 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:158` | `logger.info('MQTT: connected to broker', { brokerUrl: config.brokerUrl })`, где `brokerUrl = process.env.MQTT_BROKER_URL` (`:50`, без разбора). | При подключении железа часто пишут `mqtt://user:pass@host:1883`. Тогда пароль брокера окажется в логе при каждом реконнекте. Тот же URL уходит в `mqtt.connect` (`:148`); ошибки клиента логируются как `logger.error(..., error)` (`:174`), где драйвер может нести URL. | Логировать только host/port (распарсенный `URL`), не строку с userinfo; либо не логировать URL вовсе. |
| 3 | важно (гипотеза) | `src/lib/logger.ts:45-58` и `:95-104` | Логгер не имеет слоя редакции: `JSON.stringify(entry)` пишет объект как есть; `logger.error` всегда добавляет `error.message` (`:98`) и `error.stack` (`:99`). | Вместе с `src/core/api-wrapper.ts:128` (`logger.error('API handler failed', error, { domain })`) и `Sentry.captureException(error)` (`:129`) в логи/Sentry уходит любой текст исключения. Если драйвер/сборщик URL положит в сообщение строку подключения или токен — редакции, которая это остановит, нет. Не воспроизведено на живом исключении. | Добавить `beforeSend`-скруббер в `sentry.*.config.ts` и функцию маскирования в `logger` (`redact(data)`), фильтрующую ключи по снипетам. |
| 4 | мелочь | `sentry.server.config.ts:8`, `sentry.edge.config.ts:9` | DSN Sentry — захардкоженный литерал в коммите, а не из env. | Конфиг воркера берёт DSN из `process.env.SENTRY_DSN` (`src/workers/unified-worker/sentry.ts:24,31`) — расхождение. DSN — писательский ключ приёма (не полный секрет), но в репозитории ему не место; смены DSN потребуют правки кода. `beforeSend`-скруббера нет. | Читать DSN из `process.env.SENTRY_DSN` в обоих конфигах приложения, как в воркере. |
| 5 | мелочь | `src/core/api-wrapper.ts:122` | `logger.warn('API handler hit a Prisma constraint', { domain, code: error.code, message: error.message })` — сырой текст ошибки Prisma. | Ошибки Prisma называют колонки и иногда значение-нарушитель (напр. уникальное поле). Если таким полем когда-нибудь окажется чувствительное значение — попадёт в лог. | Логировать только `code` и `domain`; текст Prisma — не в общий журнал. |
| 6 | мелочь | `src/app/api/auth/login/route.ts:62,78,90` | В аудит-`metadata` кладётся email пользователя (и роль) при входе/отказе/лимите; затем печатается `audit-service.ts:1000`. | Персональные данные (email) в stdout/Loki. Не учётные данные, но ПДн; в коде уже заявлен контекст 152-ФЗ (`sentry.server.config.ts:16`). | Признать осознанным решением или маскировать email в строке лога (аудит-лента в БД пусть хранит как есть). |
| 7 | мелочь | `src/app/api/settings/route.ts:53` | `metadata: { before, after: saved }` — полный `WorkspaceSettings`, включая `inn` (`src/modules/settings/domain/settings.ts:21`), печатается `audit-service.ts:1000`. | ИНН организации — ПДн/реквизит в журнале. Не секрет. | Логировать только список изменённых полей (функция `hasSettingsChanges` уже есть), а не оба снимка целиком. |
| 8 | мелочь | `src/core/notifications/telegram.ts:243,248,278,282` | Логируется сырой ответ Telegram API (`new Error(error)`, `JSON.stringify(result)`) и текст отказа. | Токен бота в теле ответа не встречается, но тело может эхо-повторять текст рассылки и `chat_id` (получатель). | Логировать только `status`/`error_code` и человеческую подпись (`describeTelegramError`), без сырого тела. |

### ПРОЙДЕНО (проверено, утечки нет)

- **Токен бота Telegram** нигде не пишется в логи и аудит: `src/services/telegram/telegram-config-service.ts:26-28,61-69` отдаёт только `botTokenHint`/`hasBotToken`; снимок для аудита собран поимённо без токена — `src/app/api/telegram/configs/route.ts:29-36,86,124,155`; тесты прямо утверждают `expect(JSON.stringify(audited)).not.toContain('botToken')` (`src/app/api/telegram/configs/__tests__/route.test.ts:94,141,173`). Токен нужен только для исходящего запроса (`src/core/notifications/telegram.ts:227,265,397`).
- **Ключ устройства**: плейнтекст не логируется, возвращается ровно один раз в ответе (`src/app/api/equipment/[id]/device-keys/route.ts:94-95`); сервис `src/services/telemetry/device-key-service.ts` вообще не логирует ключ (`hashDeviceKey`, `authenticateDeviceByKey` — без `logger`). Маршрут `src/app/api/telemetry/ingest/route.ts:63,102` читает `x-device-key` и не пишет его в лог.
- **Пароль**: `authenticateUserByEmailPassword` (`src/services/auth/auth-service.ts:70-143`) нигде не логирует значение пароля; `createUser`/`updateUser` кладут в аудит-`metadata` только `select`-поля без `password` (`src/services/users/user-service.ts:174,244,294`). При исключении логируется только сам объект ошибки (`auth-service.ts:140`), не пароль.
- **Cookie/токен сессии**: `readSessionToken` (`src/services/auth/session-service.ts:265-277`) и хеширование под кэш/лимиты (`src/core/api-wrapper.ts:49,210`) не печатают сырой токен; `setSessionCookie` пишет cookie в ответ, а не в лог (`session-service.ts:279-291`).
- **Sentry PII-политика**: `sendDefaultPii: false` и `enableLogs: false` в `sentry.server.config.ts:17,19`, `sentry.edge.config.ts:12,13` и `src/workers/unified-worker/sentry.ts:34,35`; `Sentry.setUser` не вызывается нигде в `src/`.
- **CSRF/вебхук/метрики**: `withCsrf` возвращает только текстовые сообщения об ошибке валидации заголовков (`src/lib/csrf-protection.ts:75-124`), значение `Authorization` не логируется; `app/api/alerts/webhook/route.ts:79-86` и `app/api/metrics/route.ts:39-45` сравнивают токен константным временем и не пишут его в лог.
- **Шифрование**: `src/core/security/encryption.ts` не логирует ни ключи, ни плейнтекст (единственный `logger.warn` — про отсутствие ключа, `:99-101`).
- **Фильтр заголовков Sentry по умолчанию** покрывает `auth/token/secret/session/password/key/jwt/bearer/csrf/cookie` (`node_modules/@sentry/core/build/cjs/utils/data-collection/filtering-snippets.js:1-52`) — поэтому `authorization`/`cookie` в событиях `captureRequestError` маскируются. Остаётся зазор для нестандартных заголовков без этих сниппетов (напр. `x-device-key`, `x-acting-as`).

## Не проверено

- **Живые логи stdout/Loki** — не читались (вне репозитория / нет доступа); все выводы по коду, а не по фактическим записям журнала.
- **Реальное поведение Sentry при исключении** (`captureRequestError` в `node_modules`): прочитан только список чувствительных ключей, приложение не запускалось для наблюдения события — поэтому №3 оставлен как ГИПОТЕЗА.
- **Наличие внешнего скруббера** на сборщике логов (Loki/Promtail) — вне репозитория, не проверялось.
- **Фактическое содержимое `MQTT_BROKER_URL`** на боевом стенде — env не читался (запрет AGENTS.md §1); находка №2 сформулирована как зависимая от конфигурации.
- **Значение DSN** в `sentry.*.config.ts` не печаталось; вывод о «захардкожено» основан на том, что строка задана литералом, а не через `process.env`.
- **Тесты и сборка не запускались** — задача только на чтение кода, аудит «по коду»; §6 AGENTS.md здесь не применялся.
