# N17-42 — Запасной tenantId из переменной окружения (`DEFAULT_TENANT_ID`)

Аудит версии `git rev-parse HEAD` = `e9a3a2d7eb6f4ab1d13f169a9b8fe215dfef166d`, ветка `hermes/code-1011`.
Только чтение: код приложения не менялся.

## Итог

- В `src` ровно **58** упоминаний `DEFAULT_TENANT_ID` (проверено node-скриптом по `src/**/*.{ts,tsx,js,mjs,cjs}`). Из них чтение переменной в боевом коде — **6 строк в 5 файлах**; остальные 52 — тесты (42) и комментарии.
- Серьёзность: **критично — 0, важно — 7, мелочь — 9** (итого 16 находок). Не завышаю: прод однотенантный (`orion`), ни один путь не отдаёт чужой тенант в HTTP-ответ, поэтому «критично» нет.
- Главное: правило «нет tenantId — отказ» соблюдено в маршрутах с сессией (`src/lib/tenant.ts`, `src/lib/tenant-scope.ts`, `src/modules/reports/.../report-query.service.ts:221`), но **не соблюдено в 5 фоновых/безсессионных точках**.
- Топ-5: 
  1. `src/core/notifications/telegram.ts:49` — все фоновые отправители без контекста уходят на организацию по умолчанию;
  2. `src/app/api/alerts/webhook/route.ts:124` — вебхук без входа пишет outbox и шлёт именно под `DEFAULT_TENANT_ID`; без переменной — вечный 503;
  3. `src/app/api/orion/lead/route.ts:79` — публичная форма без входа пишет заявку под `DEFAULT_TENANT_ID`;
  4. `src/core/outbox/dead-letter-queue.ts:99` — алерт DLQ для строк без тенанта уходит в организацию по умолчанию;
  5. `src/services/tenancy/tenant-context-service.ts:31` — в мульти-режиме запрос без заголовка получает default, а не отказ.
- `scripts/validate-env.ts:105` объявляет переменную необязательной — приложение стартует без неё и все фолбэки молча деградируют.

## Методика

Что искал и где (воспроизводимо):

1. `git rev-parse HEAD` — версия выше.
2. `rg`/grep-инструмент `DEFAULT_TENANT_ID` по `src` (58 совпадений) и node-скрипт подсчёта по `src/**/*.{ts,tsx,js,mjs,cjs}` — тот же результат 58, разбивка по файлам (app-код читает переменную только в 5 файлах).
3. Открывал целиком/диапазонами: `src/services/tenancy/tenant-context-service.ts`, `src/lib/tenant.ts`, `src/lib/tenant-scope.ts`, `src/app/api/alerts/webhook/route.ts`, `src/app/api/orion/lead/route.ts`, `src/core/notifications/telegram.ts` (1–120, 120–259, 340–419), `src/core/outbox/dead-letter-queue.ts` (1–197), `src/modules/settings/application/settings-service.ts` (1–99), `src/lib/pdf-data.ts` (40–109), `src/modules/reports/application/queries/report-query.service.ts` (210–239), `src/core/security/tenant-enforcement.ts`, `src/core/security/tenant-context.ts`, `src/app/api/auth/login/route.ts`, `src/app/api/auth/logout/route.ts`, `src/modules/system/application/queries/system-service.ts`, `src/services/notifications/durable-alert-delivery.ts`, `src/workers/unified-worker/pm-scheduler.ts` (1–80), `src/lib/tenant-iteration.ts`, `src/services/reports/outbox-publisher.ts` (130–209), `src/services/reports/event-handlers.ts` (370–443), `prisma/seed.ts` (90–119), `scripts/validate-env.ts` (20–39), `scripts/seed-user-document-types.ts` (96–113), `scripts/seed-checklist-blocks.ts` (934–953), `scripts/verify-readiness.ts` (18–31), `scripts/republish-readiness-rules.ts` (24–39), `scripts/app-role-smoke.ts` (24–35), `scripts/dev/smoke-fleet-monitoring.ts` (28–41).
4. Искал потребителей `resolveTenantContext`, `getRequestTenantId`/`setRequestTenantId`/`runWithTenantContext`, `getConfigs(`/`sendAlert(`/`sendMessage(`/`sendDocument(` — чтобы отделить пути с открытым контекстом от путей без него.
5. `.env*` не читал (запрещено правилами), значение переменной на бою не проверял.

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Как исправить |
|---|---|---|---|---|---|
| 1 | важно | `src/core/notifications/telegram.ts:49` | `getConfigs`: `expectedTenantId ?? getRequestTenantId() ?? process.env.DEFAULT_TENANT_ID` — запасной тенант у общего отправителя | Все фоновые вызовы `sendAlert/sendMessage/sendDocument` без контекста (`sendMessage` из orion-lead, алерт DLQ для строк без тенанта) уходят в чаты организации по умолчанию. При второй организации — чужие чаты; при незаданной переменной — `return []` и уведомление молча теряется | Требовать явный `tenantId` у фоновых отправителей; при отсутствии — возвращать `[]`/ошибку, а не default |
| 2 | важно | `src/app/api/alerts/webhook/route.ts:124` | `tenantId = process.env.DEFAULT_TENANT_ID` в маршруте без сессии (только shared-secret) | Переменной нет → в цикле `if (!tenantId) continue` после `firing++` → `forwarded < firing` всегда → вечный 503, Alertmanager зацикливает ретраи. Переменная чужая → outbox-строки пишутся под чужим тенантом, чатов нет → `deliverQueuedAlert` бросает → DLQ | Явная конфигурация тенанта алертов; без неё — понятный отказ без ложного «Telegram упал» |
| 3 | важно | `src/app/api/alerts/webhook/route.ts:113` | `isNotificationEnabled(process.env.DEFAULT_TENANT_ID ?? null, 'systemAlerts')` | Переменной нет → `null` → `isNotificationEnabled` возвращает `true` (fail-open, `settings-service.ts:62-64`) → выключатель владельца не соблюдается. Переменная чужая → читаются настройки чужой организации | Передавать явный тенант; при отсутствии — не считать «включено» по умолчанию |
| 4 | важно | `src/core/outbox/dead-letter-queue.ts:99` | `origin.tenantId ?? getRequestTenantId() ?? process.env.DEFAULT_TENANT_ID` | Для outbox-строк без `tenantId` (легаси) алерт DLQ уходит в организацию по умолчанию — возможен чужой чат. Колонка `tenantId` в DLQ уже есть (`:71`, `retryDlqEntry` пишет `entry.tenantId`) | Требовать `origin.tenantId`; без него — не отправлять, а писать в лог |
| 5 | важно | `src/app/api/orion/lead/route.ts:79` | Публичный маршрут без сессии: `const tenantId = process.env.DEFAULT_TENANT_ID` (замороженная зона ORION — только отчёт) | Переменной нет → 500 посетителю и в лог пишутся `name, contact, message` (ПДн, `:83`). Переменная чужая → заявка пишется под чужой организацией и Telegram-сообщение уходит в её чаты | Вынести тенант заявок в явную конфигурацию; не логировать контакт |
| 6 | важно | `src/services/tenancy/tenant-context-service.ts:21,31-36` | `resolveTenantContext`: в мульти-режиме запрос без `x-tenant-id` получает `defaultTenantId`, а не отказ | При `MULTI_TENANT_MODE=multi` вход без заголовка обслуживается как организация по умолчанию — данные клиента №1 вместо отказа | В мульти-режиме при отсутствии заголовка возвращать `null`/падать (fail closed) |
| 7 | важно | `scripts/validate-env.ts:105` | `DEFAULT_TENANT_ID: { required: false }` | Приложение стартует без переменной, и все 6 фолбэков молча деградируют (Telegram выключен, алерты 503) — без предупреждения на старте | Считать обязательной при `MULTI_TENANT_MODE=multi` или при настроенных Telegram/алертах |
| 8 | мелочь | `src/app/api/auth/login/route.ts:31,60,76`; `src/app/api/auth/logout/route.ts:14,30`; `src/modules/system/application/queries/system-service.ts:24,58` | Потребители `resolveTenantContext` берут запасной тенант для аудита (`tenantId`) и витрины готовности | Неудачный вход пользователя организации №2 запишется в аудит под организацией по умолчанию; в витрине `/ready` видно default | Брать тенант аудита из самого пользователя, а не из контекста |
| 9 | мелочь | `src/modules/settings/application/settings-service.ts:62-64` | `isNotificationEnabled(null)` возвращает `true` («молчащее оповещение хуже лишнего») | Именно сюда попадает вебхук при незаданной переменной (#3): «включено» вместо отказа | Оставить по замыслу, но в вебхуке передавать явный тенант |
| 10 | мелочь | `prisma/seed.ts:101` | `process.env.DEFAULT_TENANT_ID ?? 'orion'` (литерал) | Сид на машине без переменной пишет в литерал `orion`; защищён `assertNotProduction()` (`:98`), товар — пограничный | Требовать переменную, убрать литерал |
| 11 | мелочь | `scripts/seed-checklist-blocks.ts:941` | `SEED_TENANT_ID \|\| DEFAULT_TENANT_ID \|\| 'orion'` — третий фолбэк на литерал | Молчаливая запись шаблонов ЕО/ТО в `orion` при незаданных переменных; рядом гасятся чужие шаблоны (`:949-952`) | Падать без явного тенанта |
| 12 | мелочь | `scripts/seed-user-document-types.ts:102-103` | Требует `DEFAULT_TENANT_ID`, иначе падает (fail closed — корректно) | Для клиента №2 нужно помнить про env, иначе скрипт не заведёт типы документов | Принимать `--tenant=<id>` аргументом |
| 13 | мелочь | `scripts/verify-readiness.ts:22`; `scripts/app-role-smoke.ts:27`; `scripts/republish-readiness-rules.ts:30` | `DEFAULT_TENANT_ID \|\| 'orion'` (и `SMOKE_TENANT_ID` у первого) | Локальные проверки молча идут по литералу `orion`; на другой организации результат недостоверен | Требовать явный аргумент |
| 14 | мелочь | `scripts/dev/smoke-fleet-monitoring.ts:33` | `process.env.DEFAULT_TENANT_ID \|\| 'default'` | Литерал `'default'` расходится с фактическим `orion`; снимок парка пустой без объяснения | Требовать переменную |
| 15 | мелочь | `src/app/api/orion/lead/route.ts:83,100` | В лог пишутся `name`, `contact`, `message` заявки | При незаданной переменной (#5) или сбое записи телефон/почта клиента попадают в логи в открытом виде (ПДн). `contact` не матчится фильтром маскирования логгера | Не логировать `contact`/`name` (достаточно `leadId`) или маскировать. Замороженная зона ORION — только отчёт |
| 16 | мелочь | `src/lib/tenant.ts:7`, `src/lib/tenant-scope.ts:13`, `src/lib/pdf-data.ts:52`, `src/modules/reports/application/queries/report-query.service.ts:221` | Комментарии прямо описывают, что `DEFAULT_TENANT_ID` **не** подставляется; код этому соответствует (`requireTenantId` бросает, `listRecentReportsForDashboard` бросает при пустом тенанте) | Подтверждение: в маршрутах с сессией правило fail-closed соблюдено — не дефект, а положительная проверка | — |

### Таблица «место | контекст | запасной вариант | если переменной нет | если переменная чужая | риск»

| Место | Контекст | Запасной вариант | Если переменной нет | Если переменная чужая | Риск |
|---|---|---|---|---|---|
| `src/services/tenancy/tenant-context-service.ts:21` | login/logout/`/ready` (сессия есть или вход) | `process.env.DEFAULT_TENANT_ID \|\| null`; в мульти-режиме — при отсутствии заголовка | `null`, `source='none'` | аудит/витрина показывают чужой тенант | важно (мульти-режим не отказывает) |
| `src/core/notifications/telegram.ts:49` | фоновые отправители без контекста | `expectedTenantId ?? getRequestTenantId() ?? DEFAULT_TENANT_ID` | `return []` → уведомление молча теряется | сообщение уходит в чаты чужой организации | важно |
| `src/core/outbox/dead-letter-queue.ts:99` | алерт DLQ (фон) | `origin.tenantId ?? getRequestTenantId() ?? DEFAULT_TENANT_ID` | `undefined` → Telegram не находит чатов | алерт DLQ в чужой чат | важно |
| `src/app/api/alerts/webhook/route.ts:113` | маршрут без входа (shared-secret) | `DEFAULT_TENANT_ID ?? null` в `isNotificationEnabled` | `null` → `true` (fail-open) | читаются настройки чужой организации | важно |
| `src/app/api/alerts/webhook/route.ts:124` | маршрут без входа | `DEFAULT_TENANT_ID` для outbox-записи и доставки | `undefined` → 503, доставки нет | запись под чужим тенантом + нет чатов → DLQ | важно |
| `src/app/api/orion/lead/route.ts:79` | публичная форма без входа (ORION, frozen) | `DEFAULT_TENANT_ID` | 500 + ПДн в лог | заявка и Telegram в чужой организации | важно |
| `prisma/seed.ts:101` | сид (не прод, `assertNotProduction`) | `DEFAULT_TENANT_ID ?? 'orion'` | литерал `'orion'` | — | мелочь |
| `scripts/*` (`seed-checklist-blocks.ts:941`, `verify-readiness.ts:22`, `app-role-smoke.ts:27`, `republish-readiness-rules.ts:30`, `dev/smoke-fleet-monitoring.ts:33`) | локальные скрипты | `DEFAULT_TENANT_ID \|\| 'orion'`/`'default'` | литерал | работа не по той организации | мелочь |

## Не проверено

- **Фактическое значение `DEFAULT_TENANT_ID` на бою** — `.env*` читать запрещено (AGENTS.md §1). Поэтому «если переменная чужая» — ГИПОТЕЗА по коду; проверка на живой установке: `docker exec pilingtrack-app printenv DEFAULT_TENANT_ID` против `SELECT id FROM "Tenant"`.
- **`docker-compose*.yml` / `setup.sh:74` / `docker-setup.sh:44`** — переменная подаётся, но значения (`default` у setup) сверял только по grep-вывод, файлы не открывал; рассинхрон `default` vs `orion` — ГИПОТЕЗА.
- **`MULTI_TENANT_MODE` в окружении** — какой режим активен, не проверено; от этого зависит проявление находки #6.
- **Тесты** (42 совпадения в `__tests__`/`tests/`) — не аудировал: вне области задачи (чтение переменной только в тестовой обвязке).
- **Замороженная зона ORION** (`src/app/api/orion/**`) — читал только `lead/route.ts`, правок не предлагаю; остальные файлы зоны (в т.ч. `sendMessage`-путь) не открывал.
- **Полный путь outbox → Telegram** (какие исторические строки имеют `tenantId = null`) — не измерял по БД; вывод о fallback для легаси-строк основан на чтении `outbox-publisher.ts:147-148` и `dead-letter-queue.ts:71,99`.
- Команды §6 AGENTS.md (tsc/lint/test/build) не запускал: задача — только чтение, код не менялся.
