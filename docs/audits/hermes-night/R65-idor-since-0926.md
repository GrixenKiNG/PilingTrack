# R65 — повторная проверка IDOR/арендатора на коде, изменённом с 26.09.2026

Отчёт только на чтение: ни один существующий файл не изменён, создан только этот файл.
Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`, базовый коммит `cb6b817c`.
Замороженные зоны (варианты экрана оператора, `src/app/orion/**`, `src/app/api/orion/**`) не
правились; `src/modules/operator-mobile/**` прочитан только поверхностным сканом (см. «Не проверено»).

## Итог

Проверено 101 изменённый не-тестовый файл из `src/app/api`, `src/modules`, `src/services` (плюс
`src/core/infrastructure/raw-queries.ts`, потому что он менялся в тот же период). В таблице ниже
**47 строк: 0 критично, 8 важно, 16 мелочь и 23 подтверждённых безопасных участка** —
последний блок включён для протокола проверки (что именно открывалось и чем закрыто).

Главное: **новые дефекты уровня «оператор читает чужую организацию» не найдены** — там, где с
26.09 добавлено чтение/запись по id, почти везде стоит строгое `tenantId` в самом запросе или
fail-closed отказ. Находки сосредоточены в другом слое — **в контуре следа/ленты у события вовсе нет
арендного измерения**, и это не одна опечатка, а отсутствующая колонка в схеме.

Топ-5:
1. **Контур следа не имеет арендатора.** `FeedbackEvent` (таблица ленты и аудита) вообще не имеет
   колонки `tenantId`, а `recordAuditEvent` не сохраняет переданный `event.tenantId` — он уходит
   только в лог (`audit-service.ts:888`, `feedback-event-service.ts`). Из-за этого
   `GET /api/audit?scope=…&targetId=…` отдаёт историю правок сущности **без фильтра по организации**
   (`audit-history-service.ts:101`), а лента показывает события `audience='ALL'` любому
   аутентифицированному пользователю любой организации (`feedback-event-service.ts:83-89`). Сегодня
   достижимо ролями с `system.read` (`ADMIN`/`DISPATCHER` — по решению владельца это норма), но
   STRUCTURAL: любая новая точка чтения истории утечёт между арендаторами (важно, «до арендатора №2»).
2. **`getCrewsWithDetailsRaw` — сырой запрос без единого арендного условия**, отдающий в том числе
   `operatorEmail` всех активных бригад системы (`src/core/infrastructure/raw-queries.ts:195-221`).
   Вызовов сейчас ноль, но
   функция экспортируется; соседнюю такую же (`bulkDeleteReportsRaw`) уже удаляли именно за это
   (`398d1d50`, F-R39-11) (важно: мина, не живой дефект).
3. **Запись бригад не сверяет арендатора действующего пользователя.** `createCrew` проверяет лишь
   внутреннюю согласованность трио «машинист+установка+объект» (`crew-command.service.ts:141-158`),
   а `updateCrew` позволяет перевести бригаду на объект/установку/машиниста другой организации
   (`crew-command.service.ts:242-254`). Право `crews.manage` только у `ADMIN`/`DISPATCHER`
   (важно, «до арендатора №2»).
4. **Легаси-отчёты с `Report.tenantId IS NULL` правятся из любой организации** — проверка арендатора
   включается только «когда она проставлена в самой записи» (`report-command.service.ts:158-165`).
   Решение осознанное и записано комментарием, но это живая открытая граница до тенанта №2.
5. **Слой «читаем по id без арендатора, проверяем пост-фактум» в новом коде не исчез, а размножился**:
   `SELECT … FOR UPDATE` до проверки арендатора (`equipment-command.service.ts:40`,
   `site-admin-command.service.ts:451-453`), `latestReading` без `tenantId`
   (`meter-reading.ts:85`), отчёты по `equipmentId` без арендатора (`equipment-query.service.ts:90`).
   Утечки сегодня нет (id приходит из уже проверенной записи), но каждая такая строка — будущая дыра
   при первом же переиспользовании функции.

Отдельно: **инвариант №13 из `pilingtrack-architecture-contract` устарел.** В
`resource-access-service.ts:70-83` больше НЕТ раннего `return` для `ADMIN`/`DISPATCHER` —
`ensureTenantAccess` сейчас строг для всех ролей и отказывает при чужом/пустом арендаторе. Об этом
же вводит в заблуждение комментарий в `crew-command.service.ts:48-54`, который ссылается на
несуществующий обход.

## Методика

Как воспроизвести (Windows + Git Bash; в этом окружении python нет — только node).

1. Список изменённого с 26.09 (в моей ветке):
   `git log --since=2026-09-26 --name-only --pretty=format: -- src/app/api src/modules src/services | sort -u`
   → 173 файла, из них 101 без `__tests__`/`.test.`. Плюс `git log --since=2026-09-26 --name-only -- src/core`
   → 14 файлов (из них к теме относится `raw-queries.ts`: в `398d1d50` из него удалили арендно-слепой
   `bulkDeleteReportsRaw`).
2. Массовые прогоны по отобранному списку (не по всему репозиторию):
   - `grep -nE "where: \{ *id[ ,}]" <файл>` по каждому изменённому файлу — все точки, где строка
     грузится по идентификатору без условия; каждую смотрел вручную на предмет проверки арендатора
     до/после загрузки;
   - `grep -rn "IS NULL OR" src --include=*.ts | grep -vi test`, `grep -rn "queryRawUnsafe" src`,
     `grep -rn "ensureTenantAccess(" src` — три инварианта из `pilingtrack-architecture-contract`;
   - `awk` по `prisma/schema.prisma`: наличие `tenantId` у моделей, которых касается новый код
     (`FeedbackEvent`, `FeedbackEventRead`, `Media`, `SiteDailySummary`, `MaintenancePlan`,
     `EquipmentDocument`, `FuelLog`, `MeterReading`, `MaintenanceRecord`, `WorkPermit`, `PilePassport`,
     `Equipment`, `User`).
3. По каждому маршруту с `[id]` и каждой команде — чтение файла целиком (не выборочно): маршруты
   `equipment/*`, `maintenance*/**`, `media/*`, `pile-passports/[id]/decide`, `sites/[id]`,
   `safety/equipment-permits/[id]`, `reports/{upsert,admin-upsert,delete,pdf,single-pdf,all}`,
   `readiness/*`, `users`, `telegram/configs`, `dictionary/manage`, `admin/*`, `feedback/events`,
   `telemetry/*`, `alerts/webhook` и командующие сервисы за ними.
4. Роли-держатели прав брались из `src/services/auth/authorization-service.ts:60-140`; решение
   владельца про `ADMIN`/`DISPATCHER` как платформенные роли — из `AGENTS.md` §3 и применялось как
   фильтр остроты (такие находки помечены «до арендатора №2»).
5. Рантайм-проверку с двумя арендаторами не делал (локальная база одноарендаторная, задача
   read-only) — все выводы статические, по коду.

## Находки

Порядок: сначала дефекты (важно → мелочь), затем подтверждённые безопасные участки.

| # | severity | path:line | что проверено | итог | сценарий / почему важно | что делать |
|---|---|---|---|---|---|---|
| 1 | важно | `src/services/audit/audit-service.ts:888-907`; `src/services/feedback/feedback-event-service.ts:43-55,112-131` | сохраняет ли след арендатора при записи | ДЕФЕКТ | `recordAuditEvent` принимает `event.tenantId` (тип, стр. 12), но ни разу его не использует: в `recordFeedbackEvent` уходит `audience:'OPERATIONS'`, `actor`, `targetId`, `metadata` — без арендатора; в самой `FeedbackEvent` колонки `tenantId` нет вовсе. Арендатор живёт только в строке лога. Любой след неотличим по организации | добавить `tenantId` в модель `FeedbackEvent` (миграция — зона владельца) и передавать его из `recordAuditEvent`; до этого — не строить на ленте арендных проверок |
| 2 | важно | `src/services/audit/audit-history-service.ts:90-105` | фильтр по организации в истории правок сущности | ДЕФЕКТ | `db.feedbackEvent.findMany({ where: { scope, targetId } })` — без арендатора; `requireTenantId(tenantId)` со стр. 100 сужает только карты имён (пользователи/объекты/техника). Зная (или подобрав) cuid чужой сущности, получаешь её историю правок с `before/after` из metadata. Роут `/api/audit` требует `system.read` = ADMIN/DISPATCHER (платформенные роли → сегодня «до арендатора №2»), но сама функция арендно-слепа | после п. 1 добавить в `where` арендатор; пока — не вызывать из маршрутов, доступных OPERATOR/ASSISTANT |
| 3 | важно | `src/services/feedback/feedback-event-service.ts:83-89,133-160` | видимость событий ленты чужому арендатору | ДЕФЕКТ | для непривилегированной роли условие `OR: [{ actorId: user.id }, { audience: 'ALL' }]`; событие с `audience:'ALL'` видно **любому** вошедшему, независимо от организации. Событие с `ALL` сейчас можно создать штатно: `POST /api/feedback/events` разрешает ADMIN/DISPATCHER выставить `audience` (`src/app/api/feedback/events/route.ts:154`) | либо запретить `audience:'ALL'` на запись, либо (правильнее) добавить арендатора в модель, как в п. 1 |
| 4 | важно | `src/modules/reports/infrastructure/report.repository.ts:109-112,282-290` | поиск отчёта по деловому номеру | ДЕФЕКТ (закрыт вызывающим) | `findUnique({ where: { reportId } })` и `findById(reportId)` — без арендатора, а `Report.reportId` уникален глобально. Сейчас защищает вызывающий: `report-command.service.ts:145-175` после загрузки сверяет владельца и арендатора и отвечает 403/409. Но репозиторий — публичный синглтон (`getReportRepository()`), и повторное использование `findById` из нового кода даст IDOR по глобальному номеру отчёта | добавить обязательный `tenantId` в сигнатуры `findById`/`findByUserIdAndDate` и в `where` |
| 5 | важно | `src/modules/reports/application/commands/report-command.service.ts:158-165` | арендатор у легаси-отчёта | ДЕФЕКТ | «Строгое равенство требуется, когда она проставлена в самой записи. У отчётов, заведённых до появления тенанта, там пусто» — при `existingState.tenantId == null` арендатор не сверяется, и отчёт правится из любой организации. Комментарий честно называет это осознанным (наследие), но граница открыта | закрыть после переноса данных (backfill `Report.tenantId`), затем убрать ветку; в отчёте владельцу — как «до арендатора №2» |
| 6 | важно | `src/core/infrastructure/raw-queries.ts:195-221` | арендный фильтр в `getCrewsWithDetailsRaw` | ДЕФЕКТ (мёртвый код) | Запрос `FROM "Crew" … LEFT JOIN "User"` с одним условием `isActive = true` (и опциональным `siteId`), отдаёт `u.email as "operatorEmail"`. Вызовов: `grep -rn getCrewsWithDetailsRaw src e2e` → только определение. Инвариант №1 скилла («в src нет fail-open арендных запросов») этот файл не проходит; соседний такой же запрос удалён в `398d1d50` | удалить функцию (владельцу решать), либо добавить `s.tenantId` в условие — но без вызовов проще удалить |
| 7 | важно | `src/modules/crews/application/commands/crew-command.service.ts:141-158,242-254` | арендатор при записи бригады | ДЕФЕКТ | `createCrew` не получает и не проверяет арендатора действующего пользователя — только `assertSameTenant` между машинистом/установкой/объектом; `updateCrew` берёт `requireTenantCrew` по прежнему объекту (стр. 212), а новое трио проверяет лишь между собой (стр. 250-254), поэтому бригада переезжает на объект+установку+машиниста чужой организации. Право `crews.manage` — только ADMIN/DISPATCHER | сверять итоговый `siteTenantId` с `command.tenantId` в обеих функциях (одна строка в `assertSameTenant`) |
| 8 | важно | `src/services/reports/event-handlers.ts:171-202`; `prisma/schema.prisma` (`model SiteDailySummary`) | арендный ключ проекции дневной сводки | ДЕФЕКТ (низкая острота) | `recomputeSiteDailySummary` читает/удаляет/пишет `SiteDailySummary` по `(siteId, date)` без арендатора, и у самой модели `tenantId` нет. Пересчёт внутри одного объекта безопасен (объект принадлежит одному арендатору), но проекция становится вторым арендно-слепым слоем рядом с лентой | при переносе на тенант №2 добавить `tenantId` в проекцию (как уже сделано у `ReportAnalytics`) |
| 9 | мелочь | `src/modules/crews/application/commands/crew-command.service.ts:48-54` | актуальность обоснования `requireTenantCrew` | ДЕФЕКТ (комментарий) | Комментарий утверждает: «`ensureTenantAccess` … that check unconditionally bypasses both roles», но в `resource-access-service.ts:70-83` никакого обхода ADMIN/DISPATCHER нет — сравнение строгое для всех ролей. Читающий код делает вывод о дыре, которой нет (и наоборот — не видит настоящей, п. 7) | обновить комментарий; в скилле `pilingtrack-architecture-contract` закрыть OPEN item 1 |
| 10 | мелочь | `src/modules/equipment/application/commands/meter-reading.ts:81-90` | правило «счётчик назад не идёт» | ДЕФЕКТ (fail-open чтение) | `latestReading`: `findFirst({ where: { equipmentId } })` — без `tenantId`. Вызывающие сейчас передают id из уже проверенной записи, но при первом же вызове с непроверенным id правило сравнивает новое показание с показанием чужой организации (и разрешит/запретит запись по чужим данным) | добавить `tenantId` в `latestReading` (сигнатура уже принимает ctx рядом) |
| 11 | мелочь | `src/modules/equipment/application/commands/equipment-command.service.ts:40` | блокировка строки установки до проверки арендатора | ДЕФЕКТ (мелкий) | `SELECT id FROM "Equipment" WHERE id = ${equipmentId} FOR UPDATE` — без арендатора и до `findUnique({id, tenantId})` (стр. 42). Транзакция откатится, но удерживаемый `FOR UPDATE` на чужой строке — бесплатный рычаг торможения чужой работы | перенести `tenantId` в условие блокировки (`WHERE id = … AND "tenantId" = …`) |
| 12 | мелочь | `src/modules/sites/application/commands/site-admin-command.service.ts:446-453` | блокировка поддерева узла схемы объекта | ДЕФЕКТ (мелкий) | Три `SELECT … FOR UPDATE` по `PileField`/`Cluster`/`Picket` идут до `requireTenantSite` (стр. 444 вызывается раньше, но `itemId` не связан с `siteId` до стр. 454) — на чужой `itemId` берётся блокировка чужого поддерева, затем 404 и откат | сверять `siteId` в тех же SELECT'ах |
| 13 | мелочь | `src/services/analytics/equipment-analytics-service.ts:75,131`; `src/services/analytics/site-analytics-service.ts:71,177` | форма `IS NULL OR` в арендных запросах | OK по существу / нарушение буквы инварианта | Условие относится к необязательному фильтру `siteId` («фильтр интерфейса, не граница арендатора»), арендный фильтр рядом строгий (`r."tenantId" = ${tenantId}`, стр. 74/118/130). Но дословное правило `CLAUDE.md` «никогда не писать `tenantId IS NULL OR …`» прогон `grep -rn "IS NULL OR" src` теперь **не проходит** | уточнить формулировку инварианта (запрет на `NULL` в арендном условии, а не на любую `IS NULL OR`), чтобы будущий аудит не читал это как регресс |
| 14 | мелочь | `src/services/analytics/site-analytics-service.ts:149-166` | «все время» подзапросы по отчётам | ДЕФЕКТ (производительность) | `p_all`/`d_all` агрегируют `Report` c `status='submitted'` **без `tenantId`** и присоединяются по `siteId`. Утечки нет (арендатор задаётся на `Site` стр. 176), но агрегат считается по строкам всех организаций | добавить `r."tenantId" = ${tenantId}` в подзапросы |
| 15 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:90-102` | отчёты установки в карточке | ДЕФЕКТ (мелкий) | `db.report.findMany({ where: { equipmentId } })` и `reportAnalytics.findMany({ where: { reportId: { in: [...] } } })` — без арендатора; оборудование проверено по арендатору выше (стр. 63-64), поэтому утечки нет, но слой опять арендно-слепой | добавить `tenantId` (переменная уже в области видимости) |
| 16 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:410-423` | имена участников наряда ТО | OK (обосновано) | `db.user.findMany({ where: { id: { in: ids } } })` без арендатора, но ids взяты из уже проверенной по арендатору записи; комментарий объясняет, что фильтр только терял бы имена при дрейфе `User.tenantId` | оставить; при тенанте №2 перепроверить |
| 17 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:69`; `src/services/users/user-service.ts:36-44,118-124` | какие поля людей уходят наружу | ДЕФЕКТ (низкая острота) | Карточка установки отдаёт `operator.email`; `GET /api/users` — `phone` и `email` всех работников организации. Пароль/пин-хеши не выбираются нигде (проверено). Право чтения `users.read` есть и у FOREMAN/SAFETY_ENGINEER, то есть телефоны коллег видят четыре роли, а не только админ | решить, нужен ли телефон в списке для этих ролей; свести к «свои данные + `users.manage`» |
| 18 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:275-278` | арендный фильтр в списке «мои отчёты» | ДЕФЕКТ (формально fail-open) | `if (… && sessionUser.tenantId) where.tenantId = …` — при отсутствии арендатора фильтр молча не ставится (в соседнем `listReportsForReview` для этого стоит бросок, стр. 135-138). Фактически выборка ограничена `userId`, поэтому утечки нет | заменить на `requireTenantId` для единообразия с соседней функцией |
| 19 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:327-339` | `getDashboardStats` — чтение проекции по id | ДЕФЕКТ (мёртвый код) | `siteDailySummary.findUnique({ where: { siteId_date } })` без арендатора; у модели нет арендатора (п. 8). Вызовов функции нет (`grep -rn getDashboardStats src e2e` → только экспорты), но она экспортируется из `@/modules/reports` | удалить или доиспользовать после появления арендного ключа у проекции |
| 20 | мелочь | `src/app/api/reports/upsert/route.ts:67,75` | передача арендатора в команду отчёта | ДЕФЕКТ (косметика с риском) | `requireTenantId(user)` бросает при отсутствии арендатора, после чего значение передаётся как `tenantId: tenantId || undefined` — ветка `|| undefined` недостижима, но читается как «арендатор может отсутствовать», то есть как fail-open | писать `tenantId` без `|| undefined` |
| 21 | мелочь | `src/app/api/alerts/webhook/route.ts:109-112` | арендатор у вебхука Alertmanager | OK (одноарендаторная предпосылка) | Тенант берётся из `DEFAULT_TENANT_ID ?? null`; при отсутствии переменной `isNotificationEnabled(null)` отправляет (fail-open по замыслу — «молчащее оповещение хуже лишнего») | при тенанте №2 — маршрутизация по явному тенанту, не по переменной окружения |
| 22 | мелочь | `src/modules/equipment/application/commands/maintenance-plan.ts:79-83,103`; `.../equipment-document.ts:61-65,77,92`; `.../fuel-log.ts:140-147`; `.../meter-reading.ts:266-275`; `src/services/users/user-documents.ts:287,319,330`; `src/services/users/user-document-types.ts:97-123,139-150` | check-then-act при правке/удалении по id | OK (узкое окно) | Везде сначала `findUnique({ where: { id } })` + сравнение `tenantId`/`equipmentId`, затем `update/delete({ where: { id } })` — арендатора в самом `WHERE` записи нет. `tenantId` строки неизменяем и берётся не из запроса, поэтому окно не эксплуатируется; при этом Prisma позволяет добавить его в `where` бесплатно | по возможности переносить арендатора в `WHERE` записи (шаблон уже применён в `safety/equipment-permits.ts:179-181`) |
| 23 | мелочь | `src/app/api/system/status/route.ts:30`; `src/app/api/health/route.ts`; `src/app/api/health/deep/route.ts` | доступ к системным данным | OK | `system.read` (ADMIN/DISPATCHER), тенантных данных не отдают (статусы сервисов, планировщики) | — |
| 24 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:366-397` | `getMaintenanceById` — наряд ТО по id | OK | `findUnique({ where: { id } })` без арендатора, затем `record.tenantId !== tenantId → 404`: fail-closed по значению, ответ не отдаётся | — |
| 25 | — | `src/app/api/equipment/[id]/route.ts:50-53,82-85,145-148` | карточка установки: чтение, правка, удаление по id | OK | `requireTenantId` до запросов, `getEquipmentByIdOrThrow(id, tenantId)`, снимки читаются `findFirst({ id, tenantId })`, `assertCan('equipment.manage')` на записи | — |
| 26 | — | `src/app/api/equipment/[id]/meter-readings/[readingId]/route.ts:29-40`, `fuel/[entryId]/route.ts:29-40`, `documents/[docId]/route.ts:76-87`, `[id]/maintenance/[recordId]/route.ts`, `[id]/maintenance/route.ts` | удаление вложенных записей оборудования | OK | Снимок `findFirst({ id, equipmentId, tenantId })`, команда получает `{ tenantId }`, сервисы сверяют `equipmentId + tenantId` до удаления | — |
| 27 | — | `src/app/api/maintenance-plans/[id]/route.ts:47,74-84`; `src/modules/equipment/application/commands/maintenance-plan.ts:79-83` | правка/удаление регламента ТО | OK | `requireTenantId`; снимок строго по `{ id, tenantId }`; сервис отказывает при чужом арендаторе | — |
| 28 | — | `src/app/api/maintenance/[id]/accept/route.ts:19-31` | приёмка наряда ТО | OK | `assertCan('maintenance.manage')` + `assertRole('ADMIN')` (через реальную роль, не через замещение), `acceptMaintenance` сверяет `tenantId` | — |
| 29 | — | `src/app/api/pile-passports/[id]/decide/route.ts:43-61`; `…/pile-passport.service.ts:401-427` | решение мастера по свае | OK | `findFirst({ id, tenantId })` для снимка, запись — `updateMany({ where: { id, tenantId } })`, `count === 0 → 404` (арендатор в самом UPDATE) | — |
| 30 | — | `src/app/api/sites/[id]/route.ts:22-25,39-41,116-121`; `sites/[id]/hierarchy/route.ts:30,43,57,119`; `site-admin-command.service.ts:33-38` | объект и его схема по id | OK | `requireTenantSite` во всех командах; `readHierarchyItemName` фильтрует через `site: { tenantId }`; `getSiteWithHierarchy` — `findFirst({ id, tenantId })` | — |
| 31 | — | `src/app/api/safety/equipment-permits/route.ts:38-47,83-89`; `[id]/route.ts:20-28`; `modules/safety/application/equipment-permits.ts:64,116,121-125,179-182` | матрица допусков к технике | OK | Чтение `{ tenantId, userId }`; работник сверяется `findFirst({ id: userId, tenantId })`; удаление — `deleteMany({ where: { id, tenantId } })` с 404 по нулю | — |
| 32 | — | `src/app/api/media/[id]/route.ts:13-34`; `[id]/confirm/route.ts:13-32` | файл по id | OK | `findUnique({ where: { id } })` с ЯВНО выбранным `tenantId` в `select` (комментарий объясняет, что без него вторая линия не срабатывает), затем `assertCanAccessMedia` | — |
| 33 | — | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:54-263` | наряды-допуски: все операции по id | OK | `get/updateContent/submit/markApproved/revoke` — везде `where: { tenantId, id, version … }`; блокировка подписи `lockForApproval` тоже с `tenantId` в `FOR UPDATE` (стр. 221-228) | — |
| 34 | — | `src/app/api/readiness/work-permits/route.ts:37-53`; `src/app/api/readiness/shifts/route.ts:28-37`; `src/app/api/readiness/audit/route.ts:28-33`; `_shared/request-context.ts:66-92` | контур готовности: маршруты | OK | Арендатор из сессии с отказом 403 при пустом; все запросы внутри `withReadinessRequestTransaction(context.tenantId, …)`; журнал — `readChain(tenantId)` | — |
| 35 | — | `src/modules/readiness/infrastructure/audit/audit-repository.ts:35-45,47-86,88-96` | цепочка аудита готовности | OK | `lockChain`/`advanceChain`/`readChain` — арендатор в каждом условии; неполные звенья цепочки дают ошибку, а не «целую» историю | — |
| 36 | — | `src/modules/readiness/application/{access-matrix-service,readiness-rules-service,scheduler,bootstrap-query,operator-shift-query}.ts` | контур готовности: чтения и команды | OK | Выборки строго `{ tenantId, … }`; блокировки черновиков — advisory-замок по `tenantId`; `operator-shift-query.ts:177-260` — все ветки с `tenantId` | — |
| 37 | — | `src/app/api/users/route.ts:26-33,96-117,130-151`; `src/services/users/user-service.ts:28,36-44,237-239,333-351` | работники: список, правка, удаление | OK | Арендатор из сессии (400 при пустом), `listUsers(tenantId, …)`, `updateUser/deleteUser(tenantId, …)` — `where: { id, tenantId }`; «последний администратор» под advisory-замком; пароли не выбираются | — |
| 38 | — | `src/app/api/telegram/configs/route.ts:48-49,101-113,153-170`; `src/services/users/user-documents*.ts`; `src/app/api/dictionary/manage/route.ts:66-78`; `src/services/dictionaries/dictionary-service.ts:264,274,308-392` | каналы Telegram, документы работника, справочники | OK | Арендатор из сессии; в аудит канала не попадает `botToken` (`channelSnapshot`, стр. 29-36); документы работника — `requireTenantUser`/`requireOwnDocument`/`requireAttachableMedia` с арендатором; справочники — `where: { id, tenantId }` на чтении, записи и удалении | — |
| 39 | — | `src/app/api/reports/delete/route.ts:73-90` | удаление отчёта по `reportId` | OK | `findFirst({ where: { reportId, tenantId } })` → 404, удаление внутри транзакции строго по найденному `report.id` | — |
| 40 | — | `src/modules/reports/application/commands/report-command.service.ts:114-175` | upsert отчёта по `reportId` с клиента | OK (кроме п. 5) | Владелец сверяется с **найденной** записью (не с присланным `userId`), арендатор — строгим равенством, дата и объект — иначе 409, окно правки 24 ч | — |
| 41 | — | `src/app/api/reports/pdf/route.ts:94-110,261-266`; `src/lib/pdf-data.ts:141-154`; `src/core/infrastructure/raw-queries.ts:70-75` | периодный PDF | OK | `tenantId: user?.tenantId || null` доходит до `getReportsByPeriodRaw`, а тот при пустом арендаторе бросает 403 (повтор R26-1 подтверждён) | — |
| 42 | — | `src/app/api/reports/single-pdf/route.ts:66-68,215-217` | PDF одного отчёта | OK | `ensureTenantAccess(user, context.report.tenantId, 'report')` + `assertCanAccessReportOwner` — арендатор и владелец | — |
| 43 | — | `src/app/api/admin/analytics/overview/route.ts:156-158`; `src/services/analytics/{site,equipment}-analytics-service.ts`; `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:109-156,194-199` | аналитика и снимок парка | OK | Арендатор строгим равенством во всех запросах (в т.ч. агрегат телеметрии, стр. 144-154); подзапросы аналитики объекта — см. п. 14 | — |
| 44 | — | `src/app/api/telemetry/ingest/route.ts:282-329` | приём телеметрии от устройства | OK | Арендатор только из ключа устройства, при отсутствии — бросок; `equipmentId`/`siteId` берутся из удостоверения устройства, не из тела (комментарий стр. 303-305) | — |
| 45 | — | `src/modules/inspections/application/commands/inspection-commands.ts:251-266,308-316,390-399`; `src/app/api/inspections/[id]/route.ts:36,64`; `src/app/api/inspections/[id]/complete/route.ts:27` | осмотры: ответы и завершение | OK | Загруженный осмотр сверяется по арендатору (404), для OPERATOR дополнительно `performedById === user.id`, переход — `updateMany({ id, tenantId, status })` | — |
| 46 | — | `src/modules/operator-mobile/application/commands/{shared,production,production-corrections,checklist,admission,incidents,shift-close}.ts` | выработка, смены, чек-листы, простои (замороженная зона, только чтение) | OK | Все ключи тенантные: `tenantId_clientCommandId`, `{ tenantId, shiftId }`, `{ tenantId, id }`, справочники — `requirePileGrade/requireDrillingType/requireDowntimeReason` с `tenantId`; `ensureReport` — upsert по `[tenantId, shiftId]`; буквальная проверка — `shared.ts:30-40,52-76,106-154`. См. «Не проверено» про глубину | — |
| 47 | — | `src/services/{reports/outbox-publisher.ts,reports/event-handlers.ts,notifications/durable-alert-delivery.ts}`, `src/modules/settings/application/settings-service.ts:25,88-92`, `src/services/weather/weather-client.ts:131-138` | фоновые обработчики и настройки | OK | Аутбокс: `setRequestTenantId(outboxEvent.tenantId ?? null)` и атомарный `updateMany`-claim; события при отсутствии арендатора **пропускаются с предупреждением** (не пишутся как `tenantId || null` — это F-R26-1, подтверждено на `event-handlers.ts:73-82`); настройки — `findUnique({ tenantId })` под advisory-замком; погода — `site.findFirst({ id, tenantId })` | — |

## Не проверено

- **Рантайм с двумя арендаторами не воспроизводился.** Локальная база одноарендаторная, задача
  read-only; все выводы — из чтения кода. Ни один дефект из таблицы не подтверждён запросом к базе.
- **`src/modules/operator-mobile/**` — замороженная зона (AGENTS.md §1).** Прочитан только скан
  `grep` по `findUnique/findFirst/updateMany/where` (результат — строка 46 таблицы); тела функций
  целиком не читал, поэтому «OK» там означает «арендный ключ присутствует в каждом найденном
  запросе», а не полный разбор логики.
- **ORION (`src/app/orion/**`, `src/app/api/orion/**`) — замороженная зона**, пропущен по правилу
  задачи. Исключение: `src/app/api/orion/lead/route.ts` открывал, чтобы понять контекст вебхуков; он
  неаутентифицируемый и пишет заявку под `DEFAULT_TENANT_ID` — в находки не выносил, так как зона
  заморожена.
- **`src/core/**` вне `raw-queries.ts`** не проверялся (эта область не входила в `git log` по
  `src/app/api src/modules src/services`; ограничился файлом, который менялся в тот же период).
- **`src/app/**` кроме `api/**`** (страницы, серверные компоненты, клиентский код) — не смотрел.
- **Файлы `__tests__` и `e2e/`** не аудировал: проверял, что тесты существуют (они в списке
  изменённых), но не сверял, покрывают ли они именно арендные ветки из таблицы.
- **RLS-политики БД** не сверял с миграциями; выводы об арендной границе — только про код приложения.
- **Схема и миграции не правились** (запрещено AGENTS.md §1); предложения в колонке «что делать»
  могут требовать миграции — это решение владельца.
- **Полнота списка изменённых файлов.** Брал `git log --since=2026-09-26` в своей ветке
  `hermes/q4-0926`; коммиты, попавшие в `main` через merge-коммиты без своих файлов, могли
  сдвинуть дату изменения файла. Файлы старше 26.09 не рассматривались даже при наличии правок
  в них внутри последних коммитов.
