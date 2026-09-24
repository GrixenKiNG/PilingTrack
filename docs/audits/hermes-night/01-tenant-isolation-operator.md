# Прочитано: изоляция арендаторов для ролей OPERATOR / ASSISTANT через API-маршруты

## Итог

Проверено 142 обработчика `src/app/api/**/route.ts`; 40 маршрутов достижимы ролями OPERATOR
или ASSISTANT (по матрице прав `authorization-service.ts`, готовности `capability-defaults.ts`
и по маршрутам без ролевой проверки, где доступен любой аутентифицированный). **Подтверждённой
кросс-арендаторной утечки (чтение/запись данных арендатора B ролей A) не найдено.** Все
проверенные запросы, которые ложатся в базу, передают `tenantId` из сессии и фильтруют им через
строгое равенство в коде приложения (`where { tenantId }`), либо идут через транзакции контура
готовности с fail-closed RLS.

Находки по сути — не дыры, а хрупкость защиты и слои, где граница держится не только строгим
равенством. Главное: **RLS для подавляющего большинства таблиц в режиме аудита** (пропускает всё,
когда GUC не выставлен, и строки с `tenantId IS NULL`), поэтому реальная граница для ролей — это
строгое равенство в коде, а не политики БД; и **несколько мест, где строка грузится по ID из
запроса БЕЗ условия по арендатору**, и граница проверяется уже после загрузки (ownership-проверкой
или GUC-пер-операцией), а не фильтром в самом SQL. Пока прод одноарендаторный («orion») — это
защита уровня defense-in-depth.

По сегментам: 27 строк в таблицах (0 критично, 4 важно, 23 мелочь; последний блок — подтверждённая
безопасность, включены для протокола проверки). Топ-5:
1. RLS почти везде fail-open/аудит-режим — граница держится кодом, а не БД (важно).
2. `media-auth.ts:51` — `report.findFirst` по id/reportId без условия по арендатору; чужая запись,
   скрытая RLS, трактуется как «черновик» и загрузка к ней разрешается (важно).
3. `crew-query.service.ts:68` — бригада грузится по operatorId/assistantId без арендатора в SQL;
   арендатор проверяется вызывающим маршрутом через `ensureTenantAccess` пост-фактум (важно,
   паттерн хрупкий, повторён в meter/fuel).
4. `readiness/export` достижим OPERATOR (право `readiness.read`) и выгружает весь парк/разрешения/
   снапшоты арендатора CSV-ом — широкий поверх чтения «своего» арендатора (мелочь/контекст).
5. `media download-batch` грузит записи по `ids` без арендатора, фильтрует в памяти
   (`filterReadableMedia`) после загрузки (мелочь, но это слой, на который стоит опираться).

Результат соответствует заявленному в AGENTS.md: `OPERATOR`/`ASSISTANT` маршруты закрыты строгим
равенством; `ADMIN`/`DISPATCHER` кросс-арендаторный доступ — by design, не оценивался.

## Методика

Как воспроизвести (Windows + Git Bash, node — Python нет):

1. Список всех маршрутов:
   `find src/app/api -name 'route.ts'` → 142 файла.
2. Какие роли что могут — читаем две матрицы как источник истины:
   - `src/services/auth/authorization-service.ts` — прикладная матрица прав (OPERATOR:
     `inspection.perform`, `meter.record`, `media.upload`; ASSISTANT — ничего, отказ по умолчанию);
   - `src/modules/readiness/domain/capability-defaults.ts` — матрица готовности (OPERATOR:
     read, shift.manage, shift.authorize, handover.prepare/decide, inspection.manage, defect.report;
     ASSISTANT: только defect.report).
3. Классификация маршрутов по достижимости:
   - ролевые (явные `user.role === 'OPERATOR'/'ASSISTANT'`);
   - правовые (`assertCan(user, ability)`, `capabilities.has(...)`);
   - **без ролевой проверки** (нет `assertCan/assertRole/context.capabilities/role ===` в файле) —
     доступен любому аутентифицированному, включая OPERATOR/ASSISTANT. Отобрано командой:
     `grep -rL "assertCan\|assertRole\|assertAnyRole\|user.role\|context.capabilities" .../route.ts`.
4. Для каждого достижимого маршрута прослежен путь до Prisma-запросов (маршрут → модуль →
   репозиторий) и оценено: строгое равенство в коде / только RLS / не проверено.
5. Проверка режима RLS по миграциям:
   `grep -rl "current_tenant\|set_config\|create policy" prisma/migrations`.
6. Поиск IDOR-паттерна — загрузка строки по ID из запроса без арендатора:
   `grep -rn "findUnique({ where: { id:\|findFirst({ where: { id:" <достижимые модули> | grep -v tenantId`.

Ключевые файлы механизма доставки арендатора:
- `src/core/security/tenant-rls.ts` — GUC `app.current_tenant` ставится пер-операцию
  `$transaction([set_config, query])`, если маршрут прошёл `requireAuth`;
- `src/core/security/tenant-context.ts` — AsyncLocalStorage на запрос, `tenantId` кладёт `requireAuth`;
- `src/modules/readiness/infrastructure/tenant-transaction.ts` — fail-closed транзакции готовности.

## Находки

### Архитектурные (важно/контекст)

| # | sever | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|-------|-----------|----------|------------------------|----------------------|
| 1 | важно | prisma/migrations/20260425000000_enable_rls_foundation/migration.sql:31 | Политика RLS для Report/Site/User — аудит-режим: `current_setting IS NULL OR '' OR "tenantId" IS NULL OR "tenantId" = value`. Первые три ветки пропускают всё и строки с пустым арендатором. Большинство таблиц осталось в этом режиме (fail-open). | Любой маршрут, который забудет условие `where tenantId` (или строка с `tenantId IS NULL`), не будет отсечён БД. Сегодня границу держит код. | После ревизии всех путей перевести политики в fail-closed (убрать fail-open ветки), как уже сделано в `20260813030000_readiness_rls_fail_closed/migration.sql`. |
| 2 | важно | src/core/media/media-auth.ts:51 | `db.report.findFirst({ where: { OR: [{id: entityId},{reportId: entityId}] } })` — загрузка отчёта по ID из запроса БЕЗ условия по `tenantId`. | OPERATOR арендатора A, прислав `entityId` валидного отчёта арендатора B: если RLS (аудит-режим + GUC=A) скрывает эту строку, `report` равен null и ветка `if (!report) return;` разрешает загрузку файла как для «черновика». Отчёт B не читается (данных нет), но файл пишется в арендатор A с чужим `entityId`. | Проверять арендатора в запросе или, для «черновик-окна», отклонять upload, если id имеет вид реального отчёта другого арендатора. |
| 3 | важно | src/modules/crews/application/queries/crew-query.service.ts:68 | `db.crew.findFirst({ where: { OR: [{operatorId},{assistants:{some:{userId}}}] } })` — БЕЗ условия по арендатору (у Crew нет tenantId, он у site). Проверку делает вызывающий маршрут (`ensureTenantAccess`) уже после загрузки. | Граница держится пост-проверкой. Повторён в `meter-readings` и `fuel` (`assertOperatorOwnsEquipment`): там crew загружается без арендатора, и только сравнение `crew.equipmentId` решает судьбу. Если `crew.site` когда-нибудь будет null/чужим — `tenantId` станет null и проверка может пройти мимо. | Загружать бригаду с вложенным `site: { tenantId }` и фильтровать равенством до использования. |
| 4 | важно | src/core/security/tenant-rls.ts:82 | GUC доставляется сквозь Prisma-прокси `db` (`applyTenantGuc`) и обёртки `wrapRawQuery/wrapTransaction`. Любой код, создающий клиент Prisma напрямую или сырой запрос вне `db.$queryRaw`-прокси, останется без GUC → политики аудита пропустят всё + строки с `tenantId IS NULL`. | Пока все маршруты ходят через `@/lib/db` — ок. Но любой новый прямой клиент/работник повторит «3 экземпляра, тенант не доехал» из комментария tenant-context.ts:41. | Не создавать Prisma-клиент мимо `@/lib/db`; для работников/планировщика явно заводить контекст арендатора. |

### Точечные (мелочь)

| # | sever | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|-------|-----------|----------|------------------------|----------------------|
| 5 | мелочь | src/app/api/media/download-batch/route.ts:56 | `db.media.findMany({ where: { id: { in: ids } } })` без арендатора; фильтр в памяти (`filterReadableMedia`) после загрузки. | Чужие/недоступные записи отсекаются в памяти — но выборка происходит по всем арендаторам (`tenant_id IS NULL` строки пройдут collect). Память-фильтр — единственный барьер. | Добавить `tenantId` при наличии в `where`, оставив `filterReadableMedia` как второй слой. |
| 6 | мелочь | src/app/api/media/[id]/download/route.ts:20 | `db.media.findUnique({ where: { id } })` без арендатора; проверка `assertCanAccessMedia` после. | Тот же паттерн записи-по-ID. `-` | Сузить `where` арендатором (или двухэтапно после нахождения). |
| 7 | мелочь | src/core/media/media-auth.ts:194 | `assertCanAccessMedia`: для не-equipment любому отдаётся доступ, если `media.userId === actor.id` — без проверки арендатора стрелки (неявно: у пользователя один арендатор). | Пока userId глобально уникален и пользователь в одном арендаторе — безопасно. Но это правило «мой файл = мой» мимо арендатора; при разделении userId между арендаторами станет дырой. | Добавить `actor.tenantId && media.tenantId && ... ===` в эту ветку. |
| 8 | мелочь | src/modules/operator-mobile/application/mobile-shift-query.ts:320 | `db.sitePilePlan.findMany({ where: { siteId } })` — загрузка по siteId без явного арендатора (siteId взят из бригады текущего пользователя). | Сайт получен из своей бригады оператора; риск косвенный. | Добавить фильтр по арендатору (у SitePilePlan есть tenantId). |
| 9 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:183 | `db.checklistTemplate.findUnique({ where: { id: input.templateId } })` без арендатора; проверка `tpl.tenantId !== ctx.tenantId` после загрузки (404). | Оператор может подать `templateId` чужого арендатора → получит 404, но шаблон прочитан из БД. | Добавить `tenantId` в `where`. |
| 10 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:45 | `db.crew.findFirst({ where: { operatorId, equipmentId, isActive: true } })` без арендатора в `assertOperatorInspectionScope`. | Загружается бригада; затем `db.equipment.findUnique({where:{id,tenantId}})` всё же фильтрует. | Добавить `equipment: { tenantId }`. |
| 11 | мелочь | src/modules/safety/application/briefing-commands.ts:140 | `db.briefingRecord.update({ where: { id: record.id } })` без арендатора — запись перед этим загружена с арендатором, но сам update не несёт условие. | Race-безопасно по факту (запись своя), но по правилу AGENTS.md update должен быть с `tenantId`. Сейчас защита — только факт предварительной загрузки. | Добавить `tenantId` в `where` update. |
| 12 | мелочь | src/app/api/readiness/export/route.ts:28 | Доступен OPERATOR (право `readiness.read`) и отдаёт CSV всего парка/разрешений/снапшотов/аудита СВОЕГО арендатора. | Не кросс-арендаторно, но широкий поверх чтения для роли-исполнителя; `dataset=audit` закрыт (`readiness.audit.export` у OPERATOR нет). | Сознательно, можно сузить `fleet/permits/reports` для оператора до своей установки. |
| 13 | мелочь | src/app/api/readiness/bootstrap/route.ts:42 | Bootstrap OPERATOR-доступен и отдаёт списки equipment/sites/actors арендатора (для разворота имён). | Только свой арендатор (`withReadinessRequestTransaction` + `tenantId`), не утечка. | — |
| 14 | мелочь | src/app/api/operator/shift/route.ts:22 | Факты смены по `getOperatorShiftFacts(tenantId, user.id)` — арендатор из сессии, `operatorId` из сессии. | Безопасно; `operatorId` нельзя подменить. | — |
| 15 | мелочь | src/app/api/safety/equipment-permits/route.ts:46 | GET: `userId` из query; `mayRead = userId === actor.id || can(users.documents.read_all)`. OPERATOR может читать допуски только свои; чужие — 403. | Безопасно. | — |
| 16 | мелочь | src/app/api/reports/edit/route.ts:18 / report-query.service.ts:58 | `WHERE TENANT` добавляется только не-привилегированному (`role !== ADMIN && !== DISPATCHER`). Для OPERATOR/ASSISTANT арендатор подставляется. | Безопасно для этих ролей (ADMIN/DISPATCHER — by design кросс). | — |
| 17 | мелочь | src/app/api/crews/my/route.ts:18 | `getCrewForOperator` + `ensureTenantAccess` пост-фактум. | См. #3. | См. #3. |
| 18 | мелочь | src/app/api/telemetry/ingest/route.ts:290 | `tenantId` берётся из ключа устройства и ставится `setRequestTenantId`; `equipmentId/siteId` — из identity, не тела. | Безопасно; контроллер одной организации не может писать чужому. | — |
| 19 | мелочь | src/app/api/user-document-types/route.ts:36 | GET справочника — по `tenantId`; OPERATOR может список. Не персональные данные. | Безопасно. | — |
| 20 | мелочь | src/modules/operator-mobile/application/commands/production-corrections.ts:68,84,161 | Поправки выработки фильтруются `scope = {tenantId, shiftId, id}` и `where {tenantId, correctsId}` — строгое равенство на запись и на агрегаты. | Безопасно. | — |

### Достижимость OPERATOR/ASSISTANT (что проверено, подтверждённая безопасность)

| # | sever | path:line | проблема | сценарий | предлагаемая правка |
|---|-------|-----------|----------|----------|----------------------|
| 21 | — | src/modules/operator-mobile/application/mobile-shift-query.ts:154–183 | State оператора: user/profile/document/pPECheck/crew/dictionaries — `where { tenantId }` строго везде. | Арендатор из сессии; чужой недоступен. | — |
| 22 | — | src/modules/operator-mobile/application/assistant-query.ts:54–103 | State помощника: tenantId строго; defects с `where {tenantId, equipmentId in(...)}`. | Безопасно. | — |
| 23 | — | src/modules/operator-mobile/application/commands/* | Все команды (происшествие, приёмка, чек-лист, допуск, поправки) — `withReadinessTenantTransaction(input.tenantId)` + `where tenantId`. | Безопасно. | — |
| 24 | — | src/modules/readiness/infrastructure/{shifts,defects}/*repository.ts | Все get/list/update — `where {tenantId, id}`; таблицы Shift/Handover/WorkPermit/CurrentReadiness — fail-closed RLS (`20260813030000`). | Двойная защита. | — |
| 25 | — | src/app/api/readiness/current|defects|history|shifts|handovers|work-permits | Все — `withReadinessRequestTransaction(w/ tenantId)`, права через `capabilities`. | Безопасно. | — |
| 26 | — | src/app/api/inspections/route.ts, [id]/route.ts, [id]/complete | `assertCan('inspection.perform')` + `getInspection/saveAnswers/complete` с проверкой `tenantId` и `performedById` для OPERATOR. | Безопасно, IDOR закрыт (404 для чужого). | — |
| 27 | — | src/app/api/equipment/[id]/meter-readings, [id]/fuel | `assertCan('meter.record')` + `{tenantId}` в запросах. | Безопасно. | — |

## Не проверено

- Реальная конфигурация Postgres/pgbouncer/S3 из `.env` (запрещено AGENTS.md) — не подтверждал, доставляется ли GUC на живом проде и не обходится ли транзакционный пулинг. Опирался на код (`tenant-rls.ts`).
- Тесты/энд-ту-энд не гонял: задача read-only, БД живую не трогал. Проверка — статическая по коду.
- Строки с `tenantId IS NULL` в живой базе не проверял (нет доступа к БД). Если такие есть, политики аудита прокачивают их всем арендаторам.
- Маршруты, недостижимые OPERATOR/ASSISTANT, глубоко не разбирал (maintenance.manage/crews.read/piles.manage/incidents.* у них отсутствуют — подтверждено по матрицам прав).
- Playwright/build/lint/unit — не запускал (нет изменений кода, задача read-only; правила §6 требуют команд при изменении кода).