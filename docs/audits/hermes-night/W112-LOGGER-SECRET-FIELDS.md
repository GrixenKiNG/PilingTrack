# W112 — Вызовы логгера, которые могут записать пароль или токен

Только чтение. Код не менялся. Значения секретов в отчёт не выписаны.

## Итог

- Всего проверено **303 вызова** `logger.<level>(...)` в `src/` (без `__tests__`). Целый объект (а не литерал с поимёнными полями) передаётся в **13 местах**.
- **Фильтрации секретных полей в общем логгере НЕТ.** `src/lib/logger.ts:54` кладёт всё через `...data`, затем `JSON.stringify` (строки 57, 64-67) — ни `redact`, ни `censor`, ни проверки `password`/`token`.
- В проекте **есть готовый маскировщик** `src/modules/readiness/domain/audit/mask.ts` (`SENSITIVE_KEYS`: `password, passphrase, pin, token, secret, apikey, cookie, authorization, email, phone…`), но он применяется **только** в пути readiness-аудита (`src/modules/readiness/infrastructure/audit/append-audit.ts:65-71`), не в общем логгере.
- **Подтверждённой утечки пароля или токена в лог не найдено.** Проверено: login-маршрут в metadata кладёт только `email` (`src/app/api/auth/login/route.ts:62,78,90`), пароль не логируется; `user-service` в аудит кладёт `select` без `password` (`src/services/users/user-service.ts:174,244,294`); Telegram в metadata кладёт `channelSnapshot` без `botToken` (`src/app/api/telegram/configs/route.ts:29-35`).
- **Реальная утечка — PII (email) и полные снимки сущностей:** `src/services/audit/audit-service.ts:955` логирует событие аудита целиком (`logger.info('audit', event)`), минуя маскировку. Email из событий входа и создания пользователя попадает в лог открытым текстом.
- **Sentry логами НЕ нагружен:** `enableLogs: false` и `sendDefaultPii: false` (`sentry.server.config.ts:17,20`; `src/workers/unified-worker/sentry.ts:34-35`). Логи идут в stdout → Loki; в Sentry уходят только ошибки через `captureRequestError`.
- Счёт по важности: **критично 0, важно 3, мелочь 4.** Плюс 6 «чистых» целообъектных вызовов, перечисленных для полноты.

Топ-5: (1) `audit-service.ts:955`; (2) отсутствие redact в `lib/logger.ts:54`; (3) email в аудит-событиях входа; (4) маскировщик существует, но не переиспользован логгером; (5) Telegram-fetch логирует ошибку из URL с `botToken` (только message/stack).

## Методика

Что искал и как (можно повторить):

1. `search_files` по `src/` c `pattern: logger\.(info|warn|error|debug)\(`, `file_glob: !**/__tests__/**` → 303 совпадения. Полный список вызовов разобран вручную.
2. Прочитан целиком `src/lib/logger.ts` (146 строк) — сигнатуры `debug/info/warn/error/time`, `formatEntry`, `log`, `withRequestLogging`.
3. Поиск маскировки: `redact|censor|sanitiz|maskSecret|\*\*\*` и `maskAuditPayload|maskOptionalAuditPayload` по `src/` → единственный маскировщик `src/modules/readiness/domain/audit/mask.ts`, применяется в `append-audit.ts:65-71`.
4. Отбор целообъектных вызовов: `search_files` по `\.\.\.(user|session|params|input|validated|body|req|data|payload|credential)` и `logger\.[a-z]+\([^\n]*\b(body|request|req|session|params|input|validated|payload|token|cookie|headers?)\b`; затем ручная сверка с полным списком.
5. Трассировка `recordAuditEvent` — 33 файла-вызывателя; проверены `user-service.ts` (какие поля в `select`), `login/route.ts` (что в metadata), `telegram/configs/route.ts` (`channelSnapshot`).
6. Проверка, куда реально уходят логи: `sentry.server.config.ts`, `sentry.edge.config.ts`, `src/workers/unified-worker/sentry.ts`, `next.config.ts` (withSentryConfig).
7. `search_files` `logger\.(info|warn|error|debug)\([^)]*process\.env\.` → 1 совпадение (bucket-name, не секрет).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предложенный фикс |
|---|----------|-----------|----------|--------------------------|-------------------|
| 1 | важно | src/services/audit/audit-service.ts:955 | `logger.info('audit', event as unknown as Record<string, unknown>)` — логируется весь `AuditEvent`, включая `metadata` с полными снимками `before`/`after` сущностей (тип `metadata?: Record<string, unknown>`, строка 15) | Любой аудит-событие с PII/секретом в metadata попадёт в stdout/Loki без фильтра. Сейчас там точно есть `email` (события входа, создание пользователя) и снимки словарей/объектов. Если в будущем в metadata попадёт токен — утечёт автоматически. Маскировки на этом пути нет (она только в readiness-пути). | Маскировать перед логом: `logger.info('audit', maskAuditPayload(event) as ...)`, переиспользовав `src/modules/readiness/domain/audit/mask.ts` (вынести в общий `src/lib`). |
| 2 | важно | src/lib/logger.ts:54 (и 57, 64-67) | Общий логгер не фильтрует поля: `entry = { timestamp, level, message, ...data }` и `JSON.stringify(entry)`. Нет `redact`/`censor`/`password` (проверено чтением файла). | Это корневая причина всех остальных находок: любой вызывающий, передавший объект целиком, немедленно пишет секрет в лог. Фильтрация отсутствует на уровне единственной точки записи. | Добавить в `formatEntry`/`log` рекурсивную маскировку по списку ключей (`password, token, secret, key, cookie, authorization,…`), как в `mask.ts`. |
| 3 | важно | src/app/api/auth/login/route.ts:62, 78, 90 | `metadata: { email: ... }` (rate_limited / failed / succeeded) уходит в `recordAuditEvent` → `logger.info('audit', event)` (находка №1) | Email — персональные данные (в `mask.ts:10` email/phone прямо в `SENSITIVE_KEYS`). При неудачном входе логируется **введённый пользователем** (непроверенный) email — открытый текст в Loki. Без маскировки. | Маскировать email в логе (или целиком маскировать на уровне логгера, см. №2). Значение — не менять. |
| 4 | важно | src/modules/readiness/domain/audit/mask.ts:7-11 vs src/lib/logger.ts | Готовый маскировщик с корректным `SENSITIVE_KEYS` (password/token/secret/apikey/cookie/authorization/email/phone) существует, но не переиспользован общим логгером — только readiness-аудитом (`append-audit.ts:65-71`) | Разрыв: два аудит-пути обрабатывают PII/секреты по-разному. Legacy-путь (`@/services/audit`) пишет всё, readiness-путь маскирует. Ожидание «аудиты безопасны» ложно для legacy-пути. | Переиспользовать `maskAuditPayload` в логгере или в legacy `recordAuditEvent`. |
| 5 | мелочь | src/core/notifications/telegram.ts:250, 284 | `logger.error('Failed to send Telegram message'/'document', error)` — `error` из `fetch` к URL `.../bot${config.botToken}/...` (строки 227, 265). Логируется `error.message`/`error.stack` (`logger.ts:97-99`) | `undici`/`fetch` иногда кладёт URL в `cause`, но логгер пишет только `message`+`stack`. `message` обычно «fetch failed» без URL. Токен в лог попасть может, но не подтверждено. | Не логировать `error` целиком в этом пути; либо санитизировать URL. Разобраться: содержит ли `error.message` URL в вашей версии Node. |
| 6 | мелочь | src/core/media/media-service.ts:300 | `logger.warn('Thumbnail generation failed…', { mediaId, error })` — в объект кладётся **весь** `error`, а не `error.message` | `JSON.stringify(Error)` даёт `{}` (нет enumerable-полей), поэтому утечки текста нет, но поведение непредсказуемо и создаёт ловушку при рефакторинге. | Класть `error: (error as Error).message`, как это сделано в соседних строках. |
| 7 | мелочь | src/workers/unified-worker/env-int.ts:34-40 | `logger.warn('Invalid integer env value…', { name, value: raw, … })` — логируется **сырое** значение env-переменной | Все текущие вызовы — числовые настройки (интервалы/порты), не секреты. Но паттерн «логировать сырое env-значение» опасен при переиспользовании хелпера. | Логировать только `name` и факт «некорректное число». |

### Целообъектные вызовы, признанные безопасными (для полноты, не находки)

| # | path:line | что передаётся | может ли содержать password/token/secret |
|---|-----------|----------------|------------------------------------------|
| — | src/workers/outbox-worker.ts:68,70 | `payload = {...stats, isLeader}` (счётчики) | нет |
| — | src/workers/unified-worker/outbox.ts:99,101 | `stats` (unpublished/failed/total) | нет |
| — | src/workers/embedded-workers.ts:181,186,191 | `stats` (те же счётчики) | нет |
| — | src/services/telemetry/telemetry-buffer.ts:208 | `getStats()` → `{buffered, flushed, dropped}` (строка 167) | нет |
| — | src/core/observability/health-tracker/tracker.ts:88 | `snapshot` — статусы компонентов (database/redis/outbox/workers) | нет |
| — | src/core/error-boundary/bulkhead.ts:268 | производный объект со счётчиками (active/queued/rejected/avgMs) | нет |
| — | src/core/cache/response-cache.ts:369 | производный объект entries/inFlight/hitRate | нет |
| — | src/lib/logger.ts:143 | `rest = { requestId, userId }` | нет (только идентификатор) |
| — | src/instrumentation.ts:19-28 | явные `LOG_*`/`NODE_ENV` флаги, не значения секретов | нет |

## Не проверено

- **ORION (замороженная зона, по правилам не аудировал).** При этом `src/app/api/orion/lead/route.ts:83,100` логирует `name`, `contact`, `message` — потенциальные PII (contact = телефон/почта). Не включаю в находки, потому что зона заморожена (AGENTS.md, §1). Стоит проверить отдельно.
- Содержит ли `error.message` URL с `botToken` при сетевом сбое fetch к Telegram — сетевой сбой не воспроизводил («не знаю»).
- Фактическое содержимое `metadata` в проде — оценка только по коду вызывающих, прод-логи не смотрел (доступа нет).
- Тесты (`__tests__`) и e2e-вызовы `logger.` не разбирались — вне задачи.
- Сторонние библиотеки (Prisma/Sentry/Next), которые могли бы логировать сами, — не проверял.
