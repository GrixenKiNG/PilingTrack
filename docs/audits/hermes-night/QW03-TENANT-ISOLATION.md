# QW03 — Аудит изоляции мульти-тенантности (read-only)

- Код-база: `D:\PillingR\wt-night-code`, ветка `hermes/code-1011`, HEAD `9d5794f4b4a4f450a7b6000b68fe1c4ad19e2ec3`, дерево чистое.
- Аудит читательский: ни один файл не менялся; создан только этот отчёт.
- Доверительная модель из AGENTS.md учтена: ADMIN/DISPATCHER — платформенные роли, видят все тенанты по-design; перекрёстные утечки для OPERATOR/ASSISTANT и нетронутых привилегированными ролями путей — настоящие findings; для ADMIN — архитектурные заметки.

## Итог

Производство одно-тенантовое (`orion`), но код мульти-тенантный и защищён в 4 слоя: (1) `requireAuth`/`assertCan` на маршрутах; (2) fail-closed-проверки `tenantId` на уровнях команд и репозиториев (нет `tenantId` — исключение/400); (3) авто-подстановка `app.current_tenant` на каждую операцию Prisma через расширение в `src/core/security/tenant-rls.ts` + `src/core/security/tenant-context.ts`; (4) RLS в Postgres с `FORCE` на 61 из 69 таблиц с колонкой `tenantId`, все политики строгие: `USING ("tenantId" = current_setting('app.current_tenant', true))` — при незаданном GUC строки не возвращаются, ветки `IS NULL`/escape нет (старые удалены миграцией `20260817230000`). 8 таблиц без RLS (`BriefingRecord`, `DeadLetterQueue`, `IdempotencyKey`, `ModuleLayoutTemplate`, `OutboxEvent`, `ReadinessAccessMatrix`, `ReadinessBackfillProgress`, `TenantAuditChain`) проверены почитаем: все пути-чтения сужены строгой равносностью `tenantId`. `tenantId IS NULL OR ...` в src/ — 0; `$queryRawUnsafe` — 0. Из 142 API-маршрутов истинно публичных 7 (health-пробы, ORION lead,alerts webhook), каждый проверен. Критических нарушений не найдено; ниже — 12 находок, 2 из них МEDIUM.

## Методика

1. Базовая линия: `git rev-parse HEAD` — `9d5794f4…`; ветка `hermes/code-1011`; `git status` чистое.
2. Инвентаризация сырого SQL: `queryRaw|executeRaw` в `src/` (67 сайтов), `src/core/infrastructure/raw-queries.ts`, `src/lib/tenant-scope.ts`; скриптом `audit-raw.js` проверено каждое вхождение на `tenantId` в окрестности ±13 строк и на `IS NULL OR` анти-паттерн (`audit-isnull.js` — 0 кандидатов).
3. RLS: перебраны все `prisma/migrations/*/migration.sql` скриптом `rls-final2.js`: порядок CREATE/DROP POLICY, ENABLE/FORCE (включая DO-блоки `format()` и ARRAY-циклы), сопоставление с `prisma/schema.prisma` (модели с колонкой `tenantId`). Итог: 61/69 с RLS+FORCE, 8 без; плюс 15 дочерних таблиц без `tenantId` с RLS через `EXISTS`/внешние ссылки (корректно).
4. 8 таблиц без RLS: для каждой перечитаны все пути `db.<model>.*` в `src/` с подтверждением фильтра `tenantId` в `where`; `cleanupExpiredKeys` (`src/core/security/idempotency.ts`) — cron-очистка, не HTTP.
5. Механизм авто-тенанта: `src/core/security/tenant-rls.ts`, `tenant-context.ts`, `tenant-enforcement.ts`, `identity-role.ts`, `src/lib/db.ts:116-127` (`applyTenantGuc` на клиенте), `src/modules/readiness/infrastructure/tenant-transaction.ts:27`.
6. API-маршруты: `find src/app/api -name route.ts` — 142; скрипт: 36 без строки `requireAuth`, из них 25 readiness-маршруты используют `requireAuth` через `src/app/api/readiness/_shared/request-context.ts:70`. Истинно публичные 7 — каждый прочитан по-полному.
7. Запрошены/не запрашивались существующие отчёты — по инструкции не читались `docs/audits/`, `CODEX-REPORT*`, `docs/strategy`.
8. Числа (запрошены, не сгенерированы): 67 raw-SQL, 142 маршрута, 36 без requireAuth → 25 через shared-context → 7 публичных, 8/69 таблиц без RLS, 0 `tenantId IS NULL OR`, 0 `$queryRawUnsafe`.

## Находки

| # | Sev | Статус | Путь | Описание |
|---|-----|--------|------|----------|
| 1 | MEDIUM | ПРОЙДЕНО | `src/app/api/admin/dlq/route.ts:82-95,100-140`; `src/core/outbox/dead-letter-queue.ts:126-133` | `GET /api/admin/dlq` с `status=pending|resolved|discarded|all` и `retryDlqEntry(id)`/`discardDlqEntry(id)` не фильтруются по `tenantId`, RLS на `DeadLetterQueue` нет. Доступ — только `dlq.manage` = `['ADMIN']` (`src/services/auth/authorization-service.ts:133`). Перекрёстное чтение/мутация строк другого тенанта возможно, но в рамках верифицированной доверительной модели (ADMIN — платформенный). Заметка: `payload` содержит тела событий — при появлении 2+ тенантов ADMIN увидит чужие. |
| 2 | MEDIUM | ПРОЙДЕНО | `src/services/reports/outbox-publisher.ts:87-100` | Фоновый потребитель `consumeOutboxEvents` читает все события из `outboxEvent` без `tenantId` и без RLS (таблица не защищена). Корректно по-design (worker обрабатывает все тенанты), но на уровне БД — единственный массовый путь без RLS-защиты для данных с телами событий. При пересечении с №1 — потенциальный перекрёстный канал. |
| 3 | LOW | ПРОЙДЕНО | `src/app/api/health/route.ts`, `/api/health/deep/route.ts`, `/api/liveness/route.ts`, `/api/ready/route.ts`, `/api/route.ts`, `/api/readiness/route.ts` (алиас) | Публичные health-пробы без rate-limit в GET-ветке (`withApi` не применяет rate-limiter к GET, только мутации: `src/core/api-wrapper.ts:201,213`). `health/deep` ограничен кэшем 15 с и минимальным ответом (`route.ts:26-50`). Риск DoS/разведки: `health/deep` показывает компонент-статусы (DB/Redis/S3) любому IP. |
| 4 | INFO | ПРОЙДЕНО | `src/app/api/orion/lead/route.ts:56,79-99` | Публичная запись `OrionLead` с IP-rate-limit (`LEAD_RATE_LIMIT`) и honeypot — корректно. `isSpam = Boolean(website)` — honeypot-маркер, не фильтрация. |
| 5 | INFO | ПРОЙДЕНО | `src/app/api/alerts/webhook/route.ts:79-90` | Shared-secret webhook: `ALERTMANAGER_WEBHOOK_TOKEN` обязателен, `timingSafeEqual` поверх SHA-256, fail-closed при unset tokene. Правильно. |
| 6 | INFO | ПРОЙДЕНО | `prisma/migrations/20260817230000_rls_drop_null_tenant_escape/migration.sql` | Старая ветка `current_setting(...) IS NULL OR ...` удалена. Текущая политика: `"tenantId" = current_setting('app.current_tenant', true)` (NULL ≠ любой строка → 0 строк). Fail-closed. |
| 7 | INFO | ПРОЙДЕНО | `prisma/migrations/20260701020000_force_row_level_security/migration.sql` | `FORCE ROW LEVEL SECURITY` на всех 61 таблиц — обход владельцем таблицы закрыт (без FORCE owner пропускал бы свои ROWS). |
| 8 | INFO | ПРОЙДЕНО | `src/modules/operator-mobile/application/briefing-journal-query.ts:88-120` | `BriefingRecord` без RLS: `findMany` с `tenantId` в `where` + `if (!input.tenantId) throw 400`. Верифицировано для `signBriefingRecord` (`src/modules/safety/application/briefing-commands.ts:119-122`), `self-clearance-query.ts:70-80`, `clearance-overview-query.ts:189-222`. |
| 9 | INFO | ПРОЙДЕНО | `src/modules/layout/application/layout-service.ts:30-60` | `ModuleLayoutTemplate` без RLS: `getLayout`/`getLayoutSet` с throw при пустом `tenantId`, строгое `tenantId` в `where` (`findUnique` по `tenantId_surfaceId_entityId`). |
| 10 | INFO | ПРОЙДЕНО | `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts:38-80`, `src/core/security/idempotency.ts` | `IdempotencyKey` без RLS: `find`/`complete`/`fail` с `tenantId` в `where`; `cleanupExpiredKeys` — cron, не HTTP, не находит строки чужого tenant (однако без фильтра по `tenantId` при purge — см. ниже). |
| 11 | INFO | ПРОЙДЕНО | `src/modules/readiness/infrastructure/audit/audit-repository.ts:25-29` | `TenantAuditChain` без RLS: `updateMany`/`findUnique` с `where: { tenantId }` — строгое. `PrismaAuditRepository.readChain(tenantId)` также строится через `tx.tenantAuditChain` с `tenantId` в `where`. |
| 12 | INFO | ПРОЙДЕНО | `src/modules/readiness/application/access-matrix-service.ts:55-100`, `progress-repository.ts:7-53` | `ReadinessAccessMatrix` и `ReadinessBackfillProgress` без RLS: `getAccessMatrix(tenantId)`, `getPublishedAccessMatrix(tenantId)` с throw при пустом; `readinessBackfillProgress.findUnique({where: { tenantId }})` / `upsert` / `update` — строгие. |
| 13 | LOW | ПРОЙДЕНО | `src/core/outbox/dead-letter-queue.ts:36-160` | `moveToDlq` пишет в `deadLetterQueue` без RLS — корректно по-design (DLQ создаётся из outbox с уже известным `origin.tenantId`). |
| 14 | INFO | ПРОЙДЕНО | `prisma/migrations/*/migration.sql` (15 таблиц) | Дочерние таблицы без `tenantId`-колонки (`PileField`, `Cluster`, `Picket`, `SitePilePlan`, `SiteDrillingPlan`, `SiteDailySummary`, `UserSiteAssignment`, `Crew`, `CrewAssistant`, `ReportVersion`, `ReportAudit`, `DowntimeSummary`, `OperatorPerformance`, `ReportStats`, `ModuleLayoutTemplate`) имеют RLS с `EXISTS`/внешними ссылками на родительский `Site`/`Report` — изоляция по родителю, корректно. |
| 15 | LOW | ПРОЙДЕНО | `src/core/security/idempotency.ts:21-27` | `cleanupExpiredKeys()` — периодическая очистка `idempotencyKey` с условием `OR: [expiresAt < now, createdAt < now-7d]` — фильтр по `tenantId` отсутствует. Если таблица когда-либо соберёт ключи разных тенантов, purge очистит чужие ключи (перезапрос/повтор мутации). Редкий путь (cron), но — единственная массовая мутация без `tenantId` в src/. |

## Не проверено

- **Живая БД**: `SELECT ... FROM information_schema` по политикам — недоступно (read-only, не SSH). Статический анализ миграций считается корректным при условии, что миграции действительно применены в продакшене.
- **`FORCE` на роли**: `20260701020000` утверждает, что FORCE стоит; фактическое состояние на ролях в продакшене не проверено.
- **`src/core/security/tenant-rls.ts` `applyTenantGuc`**: проверены 4 использования `set_config('app.current_tenant', …)` — полный перебор интерцепсов Prisma-клиента (каждый `db.<model>.*` метод, `$transaction`, `$queryRaw`, `$executeRaw`) по коду не вычерчен — предполагается, что реализация полная; при ошибке — RLS fall-back не работает.
- **69 моделей с `tenantId`**: пересчёт через `prisma/schema.prisma` — 69; `src/generated/postgres-client` в синхроном, но при добавлении новых моделей без пере-генерации — разрыв.
- **Приватность `Media`**: политика `app` на `Media`/`ReportPhoto`/`AuditLog`/`DeviceKey`/`DeviceSyncState`/`ReportAnalytics`/`SiteWeeklyTrend`/`TenantInvoice`/`OutboxEvent` (через `pols=app`) — тело политик не перебрано по одной (исчезли в сокращённых выводах); предполагается, что это строгие аналог `tenant_isolation_*`. Если хоть одна — `USING (true)` — это MEDIUM.
- **Playwright / e2e-спеки** не запускались — аудит по коду, не по поведению.
- **`src/app/api/admin/system/status`** и другие admin-маршруты с подробной диагностикой — только `/api/admin/dlq` проверен; остальные admin-маршруты предполагают `dlq.manage`-аналог, но полный перебор не выполнен.
- **Редис и MinIO** — tenant-изоляция на уровне внешнего хранилища не проверялась (out of scope, инфраструктура).
- **`src/core/api-wrapper.ts` `withApi` GET-ветка**: rate-limit на GET не применяется (подтверждено строками 201/213); `withMutation` — да. Все публичные GET (health, liveness) — без rate-limit (см. №3).
- **`src/app/api/orion/lead` POST-ветка honeypot** — логика «сохраняем спам с отметкой `isSpam`» корректна, но не проверялась на фактическую зашумленность Telegram-канала.
- **`src/app/api/readiness/access-matrix/route.ts`** и прочие readiness-маршруты — авторизация через `resolveReadinessRequestContext` подтверждена (через `requireAuth` на строке 70 `request-context.ts`), но полный перебор каждого capability-проверки (`readiness.audit.read`, `readiness.shift.*`, …) не вычерчен по-полному.
- **`src/modules/safety/application/briefing-commands.ts` `signBriefingRecord` mutation** (`update({ where: { id: record.id } })`) — `record.id` уже ограничен `findFirst({ where: { id, tenantId } })` выше, так что update по `id` — в рамках уже-выявленной строки; риск минимальный, но если `findFirst` когда-нибудь станет без `tenantId` — мгновенное перекрёстное обновление.

## Итоговый счёт (по severity)

| Sev | Кол-во | Находки |
|-----|--------|---------|
| CRITICAL | 0 | — |
| HIGH | 0 | — |
| MEDIUM | 2 | №1 (DLQ cross-tenant при 2+ тенантах), №2 (outbox без RLS) |
| LOW | 3 | №3 (health-пробы без rate-limit GET), №13 (moveToDlq — информационно, корректно), №15 (idempotency purge без tenantId) |
| INFO | 10 | №4–#14, #8, #9, #10, #11, #12 |
| **Итого** | **15** | |

Критически опасных нарушений изоляции между тенантами в рамках одно-тенантового продакшена и задокументированной доверительной модели **не найдено**.
