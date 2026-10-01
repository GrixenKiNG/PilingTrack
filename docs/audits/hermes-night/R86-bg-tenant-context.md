# R86 — фоновые точки входа и контекст организации (RLS)

Аудит только на чтение. Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`.
Дата: 2026-10-01. Ни один файл кода не изменён; создан только этот отчёт.

## Итог

Проверено 20 фоновых/внесессионных точек входа, которые читают или пишут таблицы под строгим RLS.
Найдено 13 отклонений: **4 «важно»**, **9 «мелочь»**, критичных нет.

Топ-5 по риску «молча ничего не делает»:

1. **MQTT-приём телеметрии** читает `Equipment` без контекста организации (`mqtt-ingestion-service.ts:97`) — под строгой политикой это 0 строк, сообщение прибора отбрасывается; тенант как раз лежит в `Equipment`, поэтому контекст здесь взять неоткуда (яйцо и курица). Сейчас не проявляется: приём не запускается ни из `instrumentation.ts`, ни из воркеров — спит вместе с телеметрией.
2. **Писатели outbox без `tenantId`** (`equipment/site/crew.prisma.mapper.ts`) кладут строку с пустой организацией, а потребитель открывает контекст ровно этим значением (`outbox-publisher.ts:147`). Обработчик получит `tenant = null` → GUC не выставляется → строгий RLS отдаёт 0 строк. Сегодня маскируется тем, что на типы `Equipment*`/`Site*`/`Crew*` не подписано ни одного обработчика.
3. **Вебхук Alertmanager** спрашивает выключатель «Сбои сервера» без контекста (`alerts/webhook/route.ts:109`): `TenantSettings` под строгим RLS невидима → функция возвращает умолчание `true` → тумблер в настройках не работает даже на одном тенанте.
4. **Конфиг Telegram** на путях без ALS-контекста разрешается по `DEFAULT_TENANT_ID` (`telegram.ts:43`), а не по организации события. Вебхук и DLQ-алерт уедут в чаты тенанта развёртывания; до появления организации №2 внешне незаметно.
5. **DLQ-алерт** решение о подавлении принимает по организации события, а отправку ведёт в тенант по умолчанию (`dead-letter-queue.ts:95` против `telegram.ts:43`) — при второй организации сравнение идёт с чужими настройками.

Хорошая новость: после ADR-0046 обработчики outbox, планировщики readiness/pm/projection-rebuild и три фоновых «внесессионных» маршрута (public lead, telemetry ingest, DLQ admin) контекст открывают корректно — по строке на организацию. Их перечень с проверкой — в таблице ниже.

## Методика

Что и как искал (воспроизводимо):

1. Инвентарь точек входа: файлы `src/workers/**`, `src/services/reports/event-handlers.ts`, `src/core/outbox/**`, `src/services/notifications/**`, `src/core/notifications/**`, модульные планировщики (`find src -iname "*schedul*"`), маршруты без сессии и все `setInterval`/`setTimeout` в фоне.
2. Для каждой точки — четыре вопроса: откуда берётся тенант; открыт ли контекст (`runWithTenantContext` + `setRequestTenantId`, `withTenantContext`, `withApi`/`withMutation`); какие таблицы трогает; что будет без контекста.
3. Механика контекста прочитана по коду, а не по памяти: `core/security/tenant-context.ts` (ALS в `globalThis`, `setRequestTenantId` вне контекста — no-op), `core/security/tenant-rls.ts` (GUC доставляется `set_config(..., true)` только если `getRequestTenantId() !== null`; внутри транзакции — `wrapTransaction`), `lib/db.ts:121` (клиент под расширением), `core/api-wrapper.ts:69` (контекст открывает `withApi`, то есть и `withMutation`).
4. Строгость политик — только чтение миграций: `prisma/migrations/*rls*`, `20260516100000`, `20260819120000_rls_fail_closed_all`, `20260903000000_rls_remaining_tables`, `20260702000000_drop_stray_rls_tenant_outbox`. Плюс `docs/runbooks/012-rls-fail-closed.md`.
5. Поиск «фоновых читателей RLS-таблиц»: `grep -rn "db\."` по `src/core`, `src/services`, `src/workers`, `src/modules/**/application`; проверка каждого модуля, импортирующего `@/lib/db`.
6. Проверка списка маршрутов без обёртки: перебор всех `src/app/api/**/route.ts`, у которых нет `withApi`/`withMutation`; для подозрительных прочитан адаптер (`readiness/_shared/route-adapter.ts` → `withMutation` → контекст есть).
7. Состав подписчиков шины: `grep -n "on(" ` по `src/**` — обработчики есть только на типы отчётов и на `ReadinessSnapshotRequested`; для `Equipment*`/`Site*`/`Crew*` подписчиков нет.
8. Перечень прод-таймеров — `docs/runbooks/013-prod-timers.md` (на хосте, вне Docker: бэкапы и disk-guard → вебхук Alertmanager).

Что даёт «0 строк вместо ошибки»: `SELECT` под строгой политикой молча возвращает пусто; `UPDATE`/`DELETE` молча не трогают строки; `INSERT` — единственный случай, который падает громко («new row violates row-level security policy»). Поэтому ниже «молча ничего не делает» относится к чтениям и к `updateMany`/`deleteMany`.

### Карта точек входа (что проверено)

Столбцы: тенант | контекст | таблицы | поведение без контекста.

| # | Точка входа | Тенант | Контекст | Таблицы (RLS) | Без контекста |
|---|---|---|---|---|---|
| A | `workers/unified-worker/outbox.ts:49` → `services/reports/outbox-publisher.ts:147` (published) | `OutboxEvent.tenantId` (колонка) | ок: `runWithTenantContext`+`setRequestTenantId` на каждое событие | Report, ReportAnalytics, SiteDailySummary, SiteWeeklyTrend, TenantSettings, TelegramConfig, AuditLog | при `tenantId=null` контекст есть, но GUC не встаёт → 0 строк (находки 2,7) |
| B | `workers/unified-worker/projection.ts:16` + `modules/reports/.../projection-worker.ts:160` (projected) | тот же | ок (тот же потребитель) | те же + OutboxEvent(без RLS) | то же |
| C | `projection-worker.ts:179` (часовой пересчёт тренда) | `forEachTenant` (`lib/tenant-iteration.ts:22`) | ок | Site, SiteWeeklyTrend | — |
| D | `workers/embedded-workers.ts:142,245` (в процессе app) | как A/B | ок | как A/B | то же |
| E | `workers/outbox-worker.ts:32`, `workers/projection-worker.ts:23` (альтернативные точки запуска) | как A/B | ок | как A/B | то же |
| F | `workers/unified-worker/projection-rebuild-scheduler.ts:27` → `rebuildAll()` | внутри `rebuildAll` — `forEachTenant` (`rebuild.ts:32,92,178`) | ок, но косвенно | Report, SiteDailySummary, SiteWeeklyTrend, ReportAnalytics, Site | новый rebuilder без `forEachTenant` молча ничего не сделает (находка 11) |
| G | `workers/unified-worker/readiness-scheduler.ts:30` → `runReadinessScheduler` | `forEachTenant` | ок | Shift, WorkPermit, Report, Equipment, TenantSettings, OutboxEvent | — |
| H | `workers/unified-worker/pm-scheduler.ts:74` → `runPmScheduler` (+`notifyOverdue`) | `forEachTenant` | ок (планировщик ещё раз заводит свой) | MaintenancePlan, MaintenanceRecord, Equipment, MeterReading, TenantSettings, TelegramConfig | — |
| I | `workers/unified-worker/idempotency-cleanup-scheduler.ts:37` | не нужен | нет — по решению | IdempotencyKey (вне RLS осознанно) | — |
| J | `workers/register-readiness-projection.ts:29` → `project-event.ts:44` | `OutboxEvent.tenantId` | ок (свой `withReadinessWorkerTransaction`) | Shift, WorkPermit, Equipment, ReadinessScoreSnapshot, CurrentReadiness, TenantSettings, ReadinessBackfillProgress | бросает, если tenant пуст (`project-event.ts:41`) |
| K | `modules/readiness/.../backfill-service.ts:10` (скрипт, не рантайм) | параметр | ок | те же + AuditLog/TenantAuditChain | — |
| L | `services/telemetry/telemetry-buffer.ts:143` | `record.tenantId`, пачки по организациям | ок | TelemetryRecord | — |
| M | `services/telemetry/mqtt-ingestion-service.ts:97` (не запускается) | читает `Equipment.tenantId` | **нет** | Equipment, TelemetryRecord | 0 строк → «unknown equipmentId» → сообщение выброшено (находка 1) |
| N | `app/api/alerts/webhook/route.ts` (Alertmanager, токен) | `DEFAULT_TENANT_ID` (только для notifier) | **нет** (нет `withApi`) | TenantSettings, TelegramConfig | выключатель игнорируется; отправка идёт в тенант по умолчанию (находки 3,4,9) |
| O | `app/api/orion/lead/route.ts:92` (публичная форма) | `DEFAULT_TENANT_ID` | ок (`withTenantContext`) | OrionLead | insert корректный; уведомление — по `DEFAULT_TENANT_ID` через notifier (находка 4) |
| P | `app/api/telemetry/ingest/route.ts:305` (ключ устройства) | `DeviceKey.tenantId` | ок (`withApi`+`setRequestTenantId`) | TelemetryRecord, DeviceKey | бросает, если у ключа нет тенанта |
| Q | `app/api/health/deep`, `/health`, `/ready`, `/readiness`, `/liveness` | не нужен | нет | только `SELECT 1` (`health-checks.ts:42`) | — |
| R | `app/api/metrics/route.ts` (токен или админ) | не нужен | нет | OutboxEvent (вне RLS) + память | — |
| S | `app/api/admin/dlq/route.ts:16,66` | сессия | ок (`withApi`/`withMutation`) | DeadLetterQueue (вне RLS), OutboxEvent | читает DLQ без фильтра по организации (находка 10) |
| T | `core/outbox/dead-letter-queue.ts:46` (`moveToDlq`, внутри catch потребителя outbox) | `origin.tenantId` для решения | **нет** (catch вне `runWithTenantContext`) | DeadLetterQueue (вне RLS) | запись проходит; алерт уходит в тенант по умолчанию (находки 5,6) |
| U | `services/notifications/durable-alert-delivery.ts:21` | `event.tenantId` (обязателен) | ок (внутри A/B) | OutboxEvent, TenantSettings, TelegramConfig | бросает без `event.tenantId` |
| V | systemd-таймеры (`runbooks/013`, хоста): backup/pitr/disk-guard | — | — | pg_dump под владельцем; disk-guard → точка N | — |

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | минимальная правка |
|---|---|---|---|---|---|
| 1 | важно | `src/services/telemetry/mqtt-ingestion-service.ts:97-104` | Фоновый приём MQTT читает `Equipment` (строгий RLS с 13.08/19.08) без контекста организации | `Equipment` невидима → `equipment === null` → «MQTT: unknown equipmentId, dropping message». Организацию берут из самой `Equipment`, поэтому контекст здесь принципиально неоткуда взять. Спит, потому что `startMqttIngestion` не зовётся ни из `instrumentation.ts:60-77`, ни из воркеров | Провайдер сопоставления «прибор → организация» вне RLS (роль опознания, как `identity-role.ts`, либо таблица-реестр) и явный вход в контекст до чтения телеметрии |
| 2 | важно | `src/modules/equipment/infrastructure/equipment.prisma.mapper.ts:13-15`, `src/modules/sites/infrastructure/site.prisma.mapper.ts:42-49`, `src/modules/crews/infrastructure/crew.prisma.mapper.ts:34-41` (вызовы: `equipment.repository.ts:30`, `site.repository.ts:29`, `crew.repository.ts:47-54`) | `toOutboxData` не пишет `tenantId`; в outbox уходит строка с пустой организацией | Потребитель читает организацию из колонки: `outbox-publisher.ts:147-150` → `setRequestTenantId(null)` → GUC не встаёт (`tenant-rls.ts:117-121`) → любой тенантный запрос обработчика даёт 0 строк. Сегодня не видно только потому, что на `Equipment*`/`Site*`/`Crew*` нет подписчиков (`grep on(` — только типы отчётов и `ReadinessSnapshotRequested`) | Писать `tenantId` в `toOutboxData` из состояния агрегата; в потребителе считать событие без тенанта ошибкой (в DLQ), а не рядовым случаем |
| 3 | важно | `src/app/api/alerts/webhook/route.ts:109-116` | Выключатель «Сбои сервера (мониторинг)» спрашивают без контекста; у маршрута нет `withApi` | `isNotificationEnabled` → `getSettings` → `db.tenantSettings.findUnique` (`settings-service.ts:25`) без GUC → строгая политика отдаёт 0 строк → умолчание `true` (`settings.ts:81`). Админ снимает галку — тревоги идут. Комментарий `settings.ts:39` прямо обещает, что отправитель её соблюдает | Обернуть обработчик `withApi` (или открыть контекст вручную) и выставить `setRequestTenantId(DEFAULT_TENANT_ID)` до чтения настроек |
| 4 | важно | `src/core/notifications/telegram.ts:38-58` (вызовы: `alerts/webhook/route.ts:128`, `dead-letter-queue.ts:101`, `orion/lead/route.ts:128`) | Конфиг Telegram на путях без ALS-контекста разрешается по `DEFAULT_TENANT_ID`, а не по организации события/заявки | Получатель определяется тенантом развёртывания. При организации №2 системные тревоги уйдут в чаты первой, а заявка с сайта — в чаты того, кто записан «по умолчанию». Сегодня незаметно (тенант один) | Передавать `tenantId` в `sendAlert`/`sendMessage`/`sendDocument` параметром вместо вывода из окружения |
| 5 | мелочь | `src/core/outbox/dead-letter-queue.ts:94-105` + `telegram.ts:43` | Решение о подавлении — по `origin.tenantId`, отправка — по `DEFAULT_TENANT_ID` | Сравнение идёт с настройками одной организации, а сообщение уходит в другую. При №2 «Недоставленные события» будут глушить/слать не тому | Перед `sendMessage` открыть контекст с `origin.tenantId` (или передать тенант в notifier) |
| 6 | мелочь | `src/core/outbox/dead-letter-queue.ts:95` | `getRequestTenantId()` здесь структурно всегда `null` | `moveToDlq` зовётся из `catch` (`outbox-publisher.ts:169-191`), а `runWithTenantContext` закрывается раньше (`:147-150`); середина цепочки подстановки мертва — поведение целиком зависит от `origin.tenantId` | Убрать мёртвое звено или принять тенант параметром явно |
| 7 | мелочь | `src/services/reports/event-handlers.ts:64-82` | «Самолечение» — достать `siteId/userId/tenantId` из `Report`, если их нет в событии | При `tenantId = null` (см. находку 2) это же чтение `Report` идёт без GUC и возвращает 0 строк: восстановить организацию из отчёта нельзя — не хватает ровно того контекста, который пытаются получить | Считать отсутствие тенанта в событии концом пути (в DLQ/алерт), а не поводом дочитать «безымянно»; либо читать отчёт через роль опознания |
| 8 | мелочь | `src/services/audit/audit-service.ts:953-975` (`recordAuditEvent`) | Поле `tenantId` в события аудита не доходит до записи — `recordFeedbackEvent` его не принимает | Таблица `FeedbackEvent` намеренно вне RLS (`20260903000000_rls_remaining_tables:215-219`), поэтому лента аудита — «на весь стенд»: при №2 пользователи одной организации увидят следы другой | Решить и зафиксировать: либо лента сознательно общая, либо добавить `tenantId` в `FeedbackEvent` и фильтровать |
| 9 | мелочь | `src/app/api/alerts/webhook/route.ts:85` | Единственный маршрут с записью в БД без `withApi`/`withMutation` | Нет ни контекста (см. 3), ни ограничения частоты, ни единого места обработки ошибок — расхождение с AGENTS.md §3 | Обернуть в `withApi`/`withMutation` (CSRF вебхуку не нужен, ограничение частоты — да) |
| 10 | мелочь | `src/core/outbox/dead-letter-queue.ts:175-180` + `src/app/api/admin/dlq/route.ts:37-41` | `DeadLetterQueue` вне RLS и читается без фильтра по организации | Роль с правом `dlq.manage` увидит тела недоставленных событий всех организаций. По модели доверия ADMIN/DISPATCHER — платформенные, но право не привязано к платформенности | Если `dlq.manage` может получить не-платформенная роль — фильтровать по `tenantId` (колонка добавлена в `20260925180000_dlq_replay_identity`) |
| 11 | мелочь | `src/workers/unified-worker/projection-rebuild-scheduler.ts:27` | Планировщик зовёт `rebuildAll()` без своего контекста и полагается на `forEachTenant` внутри (`rebuild.ts:32,92,178`) | Работает; но новый rebuilder, добавленный в `rebuildAll` без `forEachTenant`, будет молча возвращать 0 строк (прецедент — стирание недельного тренда, `rebuild.ts:100-108,161-166`) | Комментарий-контракт в `rebuildAll` + проверка, что каждый `rebuild*ForTenant` обёрнут `forEachTenant`; тест на «каждая проекция видит >= 1 организацию» |
| 12 | мелочь | `src/workers/unified-worker/idempotency-cleanup-scheduler.ts:8-18,37` | Уборка ключей идёт без контекста и удаляет по всем организациям разом | Так задумано: `IdempotencyKey` вне RLS, ключ проверяется до контекста (`20260903000000:200-206`). Но у открытой находки Codex (`workers/unified-worker.ts:190-195`) уборка может снести активный ключ | Не менять тенантность; закрыть F-IDEMP (обновлять `expiresAt` у `processing`) до включения `IDEMPOTENCY_CLEANUP_ENABLED` |
| 13 | мелочь | `src/services/reports/domain-events.ts:86-94` | События `Equipment*`/`Site*`/`Crew*` уходят в outbox без обработчиков | Каждое сохранение техники/объекта/бригады пишет WARN «No handlers for domain event» и далее событие помечается обработанным — вместе с пустой организацией (находка 2) | Либо подписать обработчик (тогда обязателен tenantId), либо не писать эти события в outbox до появления потребителя |

Места, которые сейчас работают **только потому, что тенант один** (пометить перед организацией №2): находки 3, 4, 5, 8, 10 и подстановка `DEFAULT_TENANT_ID` в `core/security/tenant-enforcement.ts:73`, `lib/tenant.ts`, `lib/tenant-scope.ts:13`.

## Не проверено

- **Значения переменных окружения на бою** (`.env` читать запрещено правилами): есть ли в проде непустой `DEFAULT_TENANT_ID` и задан ли `MQTT_BROKER_URL`. От этого зависит, отдаёт ли вебхук Alertmanager 503 «не доставлено» (пустая строка не равна `null`, поэтому при незаданном значении подстановка в `webhook/route.ts:110` даст `''` и `getConfigs` вернёт пусто) — код прочитан, фактическое значение нет.
- **Реальные политики в боевой БД**: все выводы о строгости RLS сделаны только по миграциям в репозитории; `scripts/rls-state.sql` на бою не запускался.
- **Живое поведение**: приложение/БД не поднимались (по правилу задачи — только чтение кода и миграций). Ни один SQL не выполнялся, «0 строк» — вывод из текста политик, а не замер.
- **Кому выдано право `dlq.manage`** (находка 10): матрица прав не проверялась, поэтому severity занижен до «мелочь».
- **Запускается ли MQTT-приём где-то ещё** вне репозитория (внешний супервизор/скрипт): в репозитории вызовов нет, но это не доказывает отсутствие внешнего запуска.
- **`src/generated/**`** (сгенерированный Prisma-клиент) не анализировался, кроме факта отсутствия в нём логики.

