# R85 — глобальный `db` внутри транзакции: потеря тенанта и ноль строк под RLS

## Итог

Проверена гипотеза: обёртка транзакции помечает область «`app.current_tenant` уже выставлен»
(`runWithGucApplied`, `src/core/security/tenant-rls.ts:42-49,141-151`), пометка — `AsyncLocalStorage`,
то есть накрывает **весь** код, вызванный из колбэка, включая запросы через **глобальный** `db`
(они уходят другим соединением, без `set_config`). Под строгими политиками такие чтения молча
видят ноль строк, записи падают (`42501`), а записи в таблицы без RLS (OutboxEvent) — утекают из транзакции.

Итог по severity: **критично — 2, важно — 4, мелочь — 4** (всего 10 позиций; 6 подтверждены чтением кода,
4 — латентные/сопутствующие).

* Всего в `src/**` найдено **34** колбэка `$transaction(async (tx) => …)` (функциональная форма) и **9** имён
  обёрток (`withReadiness*`, `runReadiness*`, `runInTransaction`, `withTenantContext`), с ~40 местами вызова.
* Прямых вызовов «сервисов на глобальном `db`» изнутри транзакции — **три**: две подтверждённые ошибки
  (Telegram-доставка уведомлений и PDF) и один ложный сигнал (репозитории принимают `tx`).
* **Топ-5 по вреду:**
  1. `src/services/reports/event-handlers.ts:617-624` (§1) — PDF отчёта не доходит в Telegram; ровно та
     ошибка, которую уже починили в ветке `fix/telegram-pdf-rls` (`e2e90e13`), но **не** в этой ветке.
  2. `src/services/notifications/durable-alert-delivery.ts:31-46` (§2) — не доходят **критические** алерты
     (происшествие с пострадавшим, опасный дефект): `isNotificationEnabled` читает настройки глобальным
     `db`, отправка не находит ни одного чата, событие уходит в DLQ.
  3. `src/core/security/tenant-rls.ts:189-190` (§3) — в помеченной области отключается и доставка тенанта
     для **сырого** SQL (аналитика), сейчас — латентно.
  4. `src/services/reports/outbox-publisher.ts:52-73` (§4) — запись в outbox глобальным клиентом внутри
     помеченной области не откатится вместе с транзакцией (латентно; сегодня все вызовы передают `tx`).
  5. `src/modules/settings/application/settings-service.ts:21-25,38-41` (§5) — `getSettings`/`readSettings`
     с клиентом по умолчанию `db`: одно место передачи `tx` забыть — и настройки молча станут значениями
     по умолчанию (латентно; сегодня все вызовы из транзакций передают `tx`).

## Методика

Всё — чтение, ни один файл в репозитории не изменён (кроме этого отчёта).

1. **Точка входа ошибки прочитана целиком**: `src/core/security/tenant-rls.ts` (198 строк) и
   `src/lib/db.ts:116-200` — прокси `db`, перехват `$transaction` → `wrapTransaction`, `$queryRaw*` →
   `wrapRawQuery`, расширение `applyTenantGuc`. Семантика пометки подтверждена тестом
   `src/core/security/__tests__/tenant-rls.test.ts:213-228` (`isGucApplied() === true` внутри колбэка,
   `false` сразу после).
2. **Инвентарь транзакций**: скрипт на node (в scratch, вне репозитория) нашёл все вхождения
   `$transaction(` в `src/**`, отобрал функциональную форму по `=>{`, вырезал тело колбэка сопоставлением
   скобок и вывел 34 тела (1011 строк) — все 34 прочитаны. Отдельно собраны 9 имён обёрток и все их
   места вызова (`grep`).
3. **Поиск «глобального `db`»**: собран список функций/методов, в теле которых есть `db.` при том, что файл
   импортирует `@/lib/db` (статически, динамически или через локальный `getDbClient`) — 219 имён.
   Затем: (а) пересечение имён, вызываемых из тел транзакций, с этим списком (ложный сигнал только
   `findById`/`save` — репозитории принимают клиент); (б) BFS по графу вызовов до 4 шагов от каждого тела
   транзакции; (в) отдельный проход по конкретным «сервисам-листьям» (`getSettings`, `isNotificationEnabled`,
   `recordAuditEvent`, `recordFeedbackEvent`, `telegramNotifier.*`, `invalidateReports`,
   `loadSingleReportPdfContext`, `getAccessMatrix`, `getReadinessRules`, `getPublishedAccessMatrix`,
   `readSettings`, `getDbClient`, `getResponseCache`, `requireAuth`) — для каждого места вызова вычислено,
   лежит ли оно внутри тела транзакции или внутри колбэка обёртки.
4. **Строгость RLS по таблицам** — только чтение миграций: `prisma/migrations/20260819120000_rls_fail_closed_all/migration.sql:50-61,82`
   (в списке 37 таблиц — `TelegramConfig`, `TenantSettings`, `User`, `Report`, `Site`, `AuditLog`…; условие
   `"tenantId" = current_setting('app.current_tenant', true)`), `20260819140000_rls_remaining_tenant_tables/migration.sql:30-51`
   (`ReadinessAccessMatrix`, `ReadinessBackfillProgress`, `TenantAuditChain`), `20260819120000…/migration.sql:30-35`
   (`OutboxEvent` и `IdempotencyKey` — без RLS намеренно). Состояние боя — `docs/runbooks/012-rls-fail-closed.md:180-181,306-318`
   (46 строгих политик; app/workers ходят ролью `pilingtrack_app` без `BYPASSRLS`, проверено 30.09.2026).
5. **Проверка «как код попадает в помеченную область»**: трассирован путь публикации outbox —
   `src/services/reports/outbox-publisher.ts:147-150` (`runWithTenantContext` + `setRequestTenantId` на каждое
   событие) → `src/workers/unified-worker/outbox.ts:50` и `src/workers/outbox-worker.ts:32` (`emitDomainEvent`)
   → `src/services/reports/domain-events.ts:71-81` (маршрутизация в оба проблемных обработчика). Без этого
   шага гипотезу нельзя было бы называть боевой: без контекста тенанта обёртка вообще не помечает область.
6. **Оценка уже исправленного**: `git merge-base --is-ancestor e2e90e13 HEAD` → `NOT ANCESTOR`;
   `git show --stat e2e90e13` — исправление живёт только в ветке `fix/telegram-pdf-rls`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | минимальная правка |
|---|---|---|---|---|---|
| 1 | критично | `src/services/reports/event-handlers.ts:617-624` (вызов `:621`) → `src/core/notifications/telegram.ts:262-267` → `:38-58` → `:60-67` | Внутри `db.$transaction(async (tx) => …)` вызывается `telegramNotifier.sendDocument`; `sendDocument` → `sendAlert`-путь `getConfigs()` → `getDbClient()` (глобальный `db`) → `db.telegramConfig.findMany` (строгая RLS). Пометка `runWithGucApplied` уже стоит (`tenant-rls.ts:148`), расширение тенанта не прикладывает (`resolveGucTenantId():58` → `null`) | Ровно боевой дефект с 25.09.2026: `getConfigs` отдаёт `[]` → `logger.warn('Telegram not configured — skipping document')` → `sent === false` → `throw` (`:622`) → outbox повторяет, затем DLQ; в чат приходит только сообщение об ошибке. Ни один PDF отчёта не доставляется. Воспроизводимо и локально, и на бою (условие — непустой контекст тенанта, который публикатор ставит всегда) | Прочитать настройки бота **до** транзакции (как `loadSingleReportPdfContext` строкой выше, `:565`) и передать их в отправку; либо выполнить `getConfigs` вне пометки отдельным примитивом (`runOutsideGucScope` из `e2e90e13`) — до реализации выбрать одно |
| 2 | критично | `src/services/notifications/durable-alert-delivery.ts:31-46` (строки `:40`, `:42`) | Внутри `db.$transaction(async tx => …)`: `isNotificationEnabled(tenantId, key)` (глобальный `db` → `TenantSettings`, `modules/settings/application/settings-service.ts:66,21-25`) и `telegramNotifier.sendAlert` → `getConfigs` (глобальный `db` → `TelegramConfig`) | Критические уведомления (пострадавший, «прекратить работы», опасный дефект — `core/notifications/durable-alert.ts:18-30`) не доставляются: `sendAlert` возвращает `false` → `throw` (`:43`) → DLQ. Дополнительный эффект: `isNotificationEnabled` при пустом чтении возвращает **умолчания** (`settings-service.ts:67`, `domain/settings.ts:65-83`), то есть решение «глушить/не глушить» принимается не по настройкам владельца, а по константам; ошибка тихая (ноль строк — не исключение) | То же: перенести чтение признака и настроек бота за пределы транзакции (или вне пометки), а внутри транзакции оставить только `tx.outboxEvent.update` |
| 3 | важно | `src/core/security/tenant-rls.ts:184-198` (ранний выход `:189-190`) | `wrapRawQuery` при уже выставленной пометке возвращает исходный вызов без `set_config` — то есть в помеченной области **сырой** SQL уходит без тенанта | Латентно: аналитика по объектам и технике собирается одним большим SQL (комментарий `:170-183`; там же замер 19.08.2026 — «Объекты» отдавали пустой список). Сегодня ни один колбэк транзакции не делает глобальный `$queryRaw` (проверено), но любой будущий вызов сырого SQL из транзакции даст молчаливые нули | Покрыть сырой SQL тем же исключением, что и `getConfigs` (`runOutsideGucScope`), а не полагаться на «сейчас не вызывается» |
| 4 | важно | `src/services/reports/outbox-publisher.ts:52-73` (вызовы: `src/app/api/reports/delete/route.ts:46-66`, `:73-139`) | `saveToOutbox(tx: any, …)` берёт клиента параметром; если его позвать с глобальным `db` из помеченной области, запись в `OutboxEvent` уйдёт **вне** транзакции | `OutboxEvent` — одна из двух таблиц без RLS (`20260819120000…/migration.sql:30-35`), строгая политика не остановит: ни ошибки, ни отката, событие останется даже при падении транзакции (или наоборот — запись видна читателю до коммита). Сегодня все вызовы передают `tx` (проверено: `reports/delete:73-139`), то есть это мина, а не живой дефект | Типизировать параметр как `Prisma.TransactionClient` (не `any`) — тогда глобальный `db` перестанет компилироваться |
| 5 | важно | `src/modules/settings/application/settings-service.ts:21-25, 38-41, 57-71`; `src/modules/readiness/application/access-matrix-service.ts:54-59, 83-90`; `src/modules/readiness/application/readiness-rules-service.ts:69-75`; `src/services/reports/audit-service.ts:29-38` | У «читающих» функций клиент — необязательный параметр со значением по умолчанию `db`. Передача `tx` — соглашение, компилятор его не проверяет | Класс ошибки №1/№2 возникает ровно так: одна забытая передача `tx` (или вызов из новой функции внутри транзакции) — и чтение уходит глобальным клиентом в помеченную область. Живой дефект сегодня только в №1/№2, но поверхность уязвимости — 4 функции в 3 модулях | Сделать клиент обязательным там, где есть транзакционный путь (или запретить значение по умолчанию `db` для чтений, попадающих в RLS-таблицы) |
| 6 | важно | `src/app/api/readiness/handovers/[id]/accept/route.ts:12-19` (`:15` — `withReadinessTenantTransaction` внутри колбэка `withReadinessSerializableTransaction`) | Вложенная транзакция: внутри уже открытой транзакции снова вызывается `db.$transaction` (через обёртку). Prisma не поддерживает вложенность — открывается **вторая** транзакция на другом соединении | Вызов стоит в `resolveConflictDetails`, который исполняется уже после провала внешней попытки (`tenant-transaction.ts:99-115`), поэтому пометки из него нет и тенант выставляется заново — сейчас это не даёт нулей. Но вторая транзакция не видит незакоммиченного состояния первой и может встать в ожидание на её блокировках: если диагностическую ветку однажды вызовут **внутри** колбэка (а не в `catch`), получится и зависание, и работа без тенанта | Диагностику читать в той же транзакции (`HandoverRepository(tx)`) — тогда второй транзакции не нужно вовсе |
| 7 | мелочь | `src/services/feedback/feedback-event-service.ts:112-131` (`:113`) | `recordFeedbackEvent` пишет `db.feedbackEvent.create` глобальным клиентом; внутри помеченной области это **запись** — строгая политика даст `42501`, а не ноль строк | Сегодня все вызовы вне транзакций (проверено автоматически: `app/api/reports/delete/route.ts:185` — после `});`, `app/api/reports/pdf/route.ts:150,164,306` и т. д.), но лента — как раз то место, куда «след» добавляют позже всего. Цена ошибки — падение уже успешной операции после коммита | Разрешить писать ленту только вне транзакции (в коде — комментарий-предупреждение), либо передавать клиент |
| 8 | мелочь | `src/services/audit/audit-service.ts:935-943` (`resolveActor`), `:953-975` (`recordAuditEvent`) | Аудит читает пользователя и пишет ленту глобальным `db`; внутри помеченной области чтение автора следа даст `null`, запись — ошибку | Все вызовы проверены: внутри тел транзакций их нет (`site-admin-command.service.ts:128` — сразу после `});` на `:126`; `report-command.service.ts:334` — «post-commit» вне транзакции `:329`). Остаётся риск для будущих вызовов «изнутри» | То же: держать запись аудита строго после коммита (инвариант уже описан в комментариях) и не вызывать из колбэков |
| 9 | мелочь | `src/core/notifications/telegram.ts:38-58` | `getConfigs` открывает собственный контекст тенанта (`runWithTenantContext` + `setRequestTenantId`), но **не может** снять уже стоящую пометку: `runWithGucApplied` побеждает | Именно это делает №1 и №2 неочевидными: код выглядит защищённым («мы же сами ставим тенант») и всё равно уходит без него. Комментарий в файле обещает защиту, которой в транзакции нет | Явно отметить в коде, что изнутри транзакции этот путь не работает, и/или сделать `getConfigs` независимым от пометки |
| 10 | мелочь | `src/core/security/tenant-enforcement.ts:243-253` (`setPostgresTenantContext`) | `db.$executeRaw\`SET app.current_tenant = …\`` — сессионная установка через глобальный клиент; в комментарии рядом (`:264`) сказано, что так делать нельзя, и сама функция помечена как ненадёжная | Живых вызывающих в `src/**` нет (только экспорт `core/security/index.ts:17` и тесты) — то есть это мёртвый, но опасный образец: под pgbouncer в транзакционном пулинге `SET` не доживает до запроса, а при копировании даёт ложное чувство защищённости | Пометить как `@deprecated` с указанием замены (`withTenantContext`/обёртки работы) |

### Проверено и чисто (чтобы не возвращаться)

Все 34 тела колбэков прочитаны; передача `tx` вниз соблюдена в: `modules/equipment/application/commands/{equipment-maintenance,meter-reading,pm-scheduler,maintenance-regulation}.ts`
(`equipment-maintenance.ts:264,293,319,321`; `meter-reading.ts:118-131,178-239`; `maintenance-regulation.ts:76-117`),
`modules/inspections/application/commands/inspection-commands.ts:447,555`,
`modules/sites/application/commands/site-admin-command.service.ts:456` (`assertNoSubtreeProduction`),
`modules/readiness/application/{access-matrix-service,readiness-rules-service}.ts` (`getAccessMatrix(tx)` `:171,208`;
`getReadinessRules(tx)` `:108,227`; `recordChainedReadinessAudit(tx)` через `record-audit.ts:20-25`),
`modules/readiness/application/scheduler.ts:123-279` и `projection/project-event.ts:44-72` (только `tx`),
`modules/reports/application/commands/report-command.service.ts:116-329` (`repo.findById(…, tx)`, `repo.save(…, tx)`,
`writeReportAuditRow(auditRecord, saveTx)` — `services/reports/audit-service.ts:29-38`),
`services/users/user-service.ts:236-299` (`applyUpdate(tx)` + аудит после `:301`),
`modules/crews/infrastructure/crew.repository.ts:32-155` и оба хука `crew-command.service.ts:173,305` (только `tx`).

Замороженная зона (по AGENTS.md — не правим): `src/modules/operator-mobile/**` — колбэки
`withReadinessTenantTransaction` (`admission.ts:223,259,329`, `checklist.ts:80`, `equipment.ts:33`,
`incidents.ts:57`, `production.ts:98`, `production-corrections.ts:72`, `shift-close.ts:17,50,236`)
проверены на вызовы уведомлений/настроек/аудита — не найдено; сами команды передают `tx`
(`shared.ts:30,52,146,161,302`). Отдельная обязанность: `src/app/api/orion/lead/route.ts:92` — транзакция
через `withTenantContext`, внутри только `tx` (и `runWithTenantContext` выставляется самой обёрткой).

## Не проверено

1. **Боевая база и прод не проверялись** — доступа нет (запрет AGENTS.md). Утверждение «политики строгие, роль
   приложения без `BYPASSRLS`» взято из документов (`docs/runbooks/012-rls-fail-closed.md:180-181,306-318`) и
   текста коммита `e2e90e13`; сам вывод «ноль строк» на живой базе я не воспроизводил.
2. **Ничего не запускалось**: ни тесты, ни `tsc`, ни сборка — задача только на чтение, файлы не менялись;
   версии/настройки окружения не сверялись.
3. **Полнота графа вызовов — эвристика.** Три скрипта в scratch (`guc-scan2`, `direct-hits`, `bfs-final`)
   построены на регулярном разборе скобок; они пропустили известный путь
   `event-handlers.ts:621 → sendDocument → getConfigs → loadConfigsForTenant` (нашёлся только вручную).
   Значит, возможны и другие пропущенные пути той же глубины — особенно через объектные литералы,
   `Promise.all`-массивы вызовов и реестры обработчиков.
4. **Глубина больше 4 шагов и вызовы через строковые имена** (событийные шины, реестры вида
   `handlers.get(type)`, динамические `import()` по имени модуля) — не покрыты: если сервис достаётся
   «по имени», статический поиск его не свяжет с транзакцией.
5. **Каталоги вне `src/`** (`scripts/**`, `e2e/**`, `load-tests/**`, `chaos/**`) не просматривались: там те же
   обёртки могут вызываться иначе; задача ограничивала область `src/**`.
6. **Порядок зависимостей `SET LOCAL ROLE` и `set_config`** в `withIdentityRole` (`identity-role.ts:61-67`):
   роль опознания обходит RLS, поэтому практического вреда не ожидается, но поведение GUC при смене роли
   внутри той же транзакции на живой базе я не проверял.
7. **Проект `fix/telegram-pdf-rls`** прочитан только по `git show --stat`/сообщению коммита: реализация
   `runOutsideGucScope` и её тест в этой ветке (после слияния) не проверялись на достаточность.
8. **Что именно кладёт `DEFAULT_TENANT_ID`** в контекст тенанта в воркерах (влияет на то, помечается ли
   область в не-HTTP-путях, отличных от публикатора outbox) — не прослеживал до конца.
