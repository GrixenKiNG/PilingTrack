# W116 — Запросы к БД без фильтра tenantId

Инвентаризация (только чтение) обращений к Prisma в `src/services/**` и `src/modules/**`
(без `__tests__`, без замороженного `src/modules/operator-mobile/**`), у которых
модель по схеме имеет `tenantId`, но в аргументе запроса его нет.

## Итог

- Всего просмотрено обращений перечисленных методов: **480**. Из них «подозрительных»
  (модель с `tenantId`, в аргументе нет ни `tenantId`, ни обёртки) — **96**. После
  построчной проверки реальных утечек для непривилегированных ролей **не найдено**:
  почти все — либо FK к уже проверенной по тенанту записи, либо явная сверка
  `x.tenantId !== tenantId`, либо фон/воркер вне пользовательского запроса.
- По severity: **критично — 0, важно — 6, мелочь — 41** (итого 47 в таблице; остальные
  подозрительные разобраны как ложные срабатывания, см. «Методика»).
- Самое важное: `src/modules/reports/infrastructure/report.repository.ts:283`
  (`findById(reportId)`) и `:307` (`findByUserIdAndDate`) — методы репозитория отчёта
  ищут запись по бизнес-ключу `reportId`/`(userId,siteId,date)` **без параметра
  tenantId**. Изоляция держится только на проверке в вызывающем коде
  (`report-command.service.ts:158-164`), а у «наследных» отчётов с `tenantId = null`
  эта проверка пропускается (комментарий там же). Любой новый вызывающий, забывший
  сверку, получит чужой отчёт.
- Прочее «важное» — обход списков/записей без тенанта в фоне и асимметрия условий
  (см. таблицу). Мгновенной межтенантной утечки в текущем коде они не дают.
- RLS **намеренно не считается** защитой: расширение `applyTenantGuc` только доставляет
  `app.current_tenant`, политики в режиме аудита и ничего не запрещают
  (`src/core/security/tenant-rls.ts:88-114` — «механизм только доставляет переменную и
  ничего не запрещает»).

## Методика

Как искалось (воспроизводимо):

1. Из `prisma/schema.prisma` собран список моделей и признак наличия поля
   `tenantId` (построчный разбор `model X { ... }` + строка `tenantId String`).
   Модели **без** `tenantId` (по схеме): `Tenant, SitePilePlan, SiteDrillingPlan,
   PileField, Cluster, Picket, Crew, CrewAssistant, UserSiteAssignment, ReportVersion,
   ReportAudit, SiteDailySummary, FeedbackEvent, FeedbackEventRead` — по условию задачи
   такие вызовы пропущены.
2. По `src/services/**` и `src/modules/**` (исключая `__tests__`, `*.test.ts(x)`,
   `src/modules/operator-mobile/**`) скриптом-выборкой (Node, `fs`) найдены строки вида
   `<recv>.<model>.<method>(` для методов `findMany, findFirst, findUnique,
   findFirstOrThrow, findUniqueOrThrow, count, aggregate, groupBy, updateMany,
   deleteMany`. Из строки вырезан текст аргумента балансировкой скобок; проверено наличие
   подстрок `tenantId` / `tenantWhere` / `requireTenant`.
3. Каждый результат из списка «нет tenantId в аргументе» прочитан глазами в файле:
   искал (а) определение переменной `where`/`scope`, (б) явную сверку
   `record.tenantId !== tenantId`, (в) тенантную проверку переданного идентификатора
   выше по функции.
4. Тенантные обёртки: `tenantWhere` (`src/services/tenancy/tenant-enforcement-middleware.ts:68`)
   добавляет `tenantId` **только в multi-tenant режиме**; `requireTenantId`
   (`src/lib/tenant-scope.ts:21`) и локальные `tenantScope`/`scope` в коде собираются вручную.

Классы ложных срабатываний (сняты, т.к. тенант присутствует в переменной или явной сверке):
локальные `where`/`scope` с `tenantId` (readiness-репозитории, `report-query.service`,
`report-export.service`, `site-command`/`site-admin-command`, `telemetry-ingestion-service`,
`dictionary-service` list, `audit-history-service` `tenantScope`), и явные сверки
`if (!rec || rec.tenantId !== tenantId) throw` (`inspection-query.service.ts:52`,
`inspection-commands.ts:187,261,324`, `template-query.service.ts:30`,
`equipment-query.service.ts:423`, `meter-reading.ts:270`).

## Находки

Severity: **важно** — есть список/запись без тенанта и опора на косвенную гарантию;
**мелочь** — запрос без `tenantId`, но идентификатор уже тенант-проверен или это
справочная/украшающая выборка.

| # | severity | path:line | модель | метод | проблема / сценарий | как защищено сейчас (почему не критично) | предлагаемое |
|---|---|---|---|---|---|---|---|
| 1 | важно | src/modules/reports/infrastructure/report.repository.ts:283 | Report | findUnique | `findById(reportId)` ищет по бизнес-ключу без параметра `tenantId` | вызывающий `report-command.service.ts:123` после загрузки сверяет владельца и тенант (147,158-164) | добавить tenantId в метод репозитория |
| 2 | важно | src/modules/reports/infrastructure/report.repository.ts:307 | Report | findFirst | `findByUserIdAndDate` — естественный ключ без тенанта | ключ ограничен `userId`, вызывающий валидирует пользователя/тенант | то же |
| 3 | важно | src/modules/reports/infrastructure/report.repository.ts:109 | Report | findUnique | чтение существующей записи по `reportId` на стороне записи, без тенанта | сверка тенанта в вызывающем; у «наследных» (`tenantId=null`) — пропускается | фильтр или явный отказ для `tenantId=null` |
| 4 | важно | src/modules/reports/infrastructure/report.repository.ts:134 | Report | updateMany | запись отчёта по `{id, version}` без `tenantId` | `existing` получен из :109; вызывающий сверил тенант | добавить `tenantId` в where записи |
| 5 | важно | src/services/reports/event-handlers.ts:216 | Report | findMany | список отчётов по `{siteId,date,status}` без тенанта (пересборка дневной сводки) | фоновая проекция, `siteId` из события; `siteId` глобально уникален | добавить `tenantId` события |
| 6 | важно | src/modules/equipment/application/queries/operational-state.ts:42 | MaintenanceRecord | findMany | ремонты выбираются по `equipmentId` без тенанта, хотя рядом `shift.findMany` (:34) тенант ставит | `equipmentIds` приходят из тенант-ограниченного списка (fleet-monitoring:120, site-query:106) | выровнять условие: добавить `tenantId` |
| 7 | мелочь | src/services/reports/event-handlers.ts:258 | Report | findUnique | резолв `siteId/date` по `reportId` (фолбэк воркера) | фон, `reportId` уникален | — |
| 8 | мелочь | src/services/reports/event-handlers.ts:553 | OutboxEvent | count | подсчёт в воркере по `aggregateId` без тенанта | фон | — |
| 9 | мелочь | src/services/reports/event-handlers.ts:660 | OutboxEvent | findUnique | `findUnique({id})` в воркере | фон, по первичному ключу | — |
| 10 | мелочь | src/services/reports/outbox-publisher.ts:94 | OutboxEvent | findMany | выборка событий всех тенантов без фильтра | глобальный воркер — так и задумано (комментарий :138-146) | — |
| 11 | мелочь | src/services/reports/outbox-publisher.ts:156 | OutboxEvent | updateMany | пометка «обработано» по `{id}` без тенанта | по первичному ключу, воркер | — |
| 12 | мелочь | src/services/reports/outbox-publisher.ts:175 | OutboxEvent | findUnique | перечитка payload по `id` | по первичному ключу | — |
| 13 | мелочь | src/services/reports/outbox-publisher.ts:315 | OutboxEvent | count | стат `published:false` без тенанта | воркер/диагностика | — |
| 14 | мелочь | src/services/reports/outbox-publisher.ts:316 | OutboxEvent | count | стат «провалов» без тенанта | воркер/диагностика | — |
| 15 | мелочь | src/services/reports/outbox-publisher.ts:322 | OutboxEvent | count | общий счётчик без where | воркер/диагностика | — |
| 16 | мелочь | src/services/audit/audit-service.ts:940 | User | findUnique | имя/роль актора по `actorId` без тенанта | украшение записи; при сбое — только id | — |
| 17 | мелочь | src/services/reports/report-history-service.ts:33 | Report | findUnique | отчёт по `reportId` без тенанта; тенант берётся из самой записи | маршрут `api/reports/[id]/history` требует `reports.read_all` (только ADMIN/DISPATCHER/FOREMAN/SAFETY) | если право дадут оператору — добавить сверку с сессией |
| 18 | мелочь | src/services/dictionaries/dictionary-service.ts:209 | PileWork | groupBy | подсчёт использования по `pileGradeId` без тенанта | `pileGradeId` собраны из `pileGrade.findMany({tenantId})` (:203) | — |
| 19 | мелочь | src/services/dictionaries/dictionary-service.ts:210 | LeaderDrilling | groupBy | то же по `typeId` | id тенанта (:204) | — |
| 20 | мелочь | src/services/dictionaries/dictionary-service.ts:211 | ReportDowntime | groupBy | то же по `reasonId` | id тенанта (:205) | — |
| 21 | мелочь | src/services/system/system-service.ts:33 | User | count | `count()` без where (проверка БД) | ветка SQLite недостижима (провайдер всегда postgres, :28) | — |
| 22 | мелочь | src/modules/equipment/application/commands/equipment-command.service.ts:18 | Equipment | findUnique | возврат только что созданной записи по `id` | id сгенерирован на сервере | — |
| 23 | мелочь | src/modules/equipment/application/commands/meter-reading.ts:85 | MeterReading | findFirst | «предыдущее показание» по `equipmentId` без тенанта | `equipmentId` проверен по тенанту в `addMeterReading` (:251) и в осмотре | — |
| 24 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:105 | Report | findMany | отчёты по `equipmentId` без тенанта | `equipment` загружен с `tenantId` (:69) | — |
| 25 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:112 | Report | findMany | то же (окно 30 дней) | там же | — |
| 26 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:118 | ReportAnalytics | findMany | по `reportId in [...]` без тенанта | `reportIds` из отчётов, ограниченных техникой тенанта | — |
| 27 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:398 | MaintenanceRecord | findUnique | наряд ТО по `id` без тенанта в where | явная сверка `record.tenantId !== tenantId` (:423) | — |
| 28 | мелочь | src/modules/equipment/application/queries/equipment-query.service.ts:451 | User | findMany | имена участников по `id in [...]` | id из проверенной записи (комментарий :436-438) | — |
| 29 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:142 | User | findUnique | машинист по `id` при создании бригады | `assertSameTenant` (:154) | — |
| 30 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:143 | Equipment | findUnique | установка по `id` | там же | — |
| 31 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:144 | Site | findUnique | объект по `id` | там же | — |
| 32 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:228 | User | findUnique | смена машиниста бригады | `assertSameTenant` (:250) | — |
| 33 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:229 | Equipment | findUnique | смена установки | там же | — |
| 34 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:230 | Site | findUnique | смена объекта | там же | — |
| 35 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:242 | Crew | findUnique | текущие тенанты трио | `requireTenantCrew` выше (:212); `crew` без `tenantId` — через site | — |
| 36 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:296 | Site | findUnique | тенант объекта для росписи помощников | `requireTenantCrew` выше; `assertSameTenant` (:301) | — |
| 37 | мелочь | src/modules/crews/application/commands/crew-command.service.ts:297 | Crew | findUnique | тенант объекта бригады | там же | — |
| 38 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:183 | ChecklistTemplate | findUnique | шаблон по `id` без тенанта | явная сверка `tpl.tenantId !== ctx.tenantId` (:187) | — |
| 39 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:294 | InspectionAnswer | deleteMany | ответы по `inspectionId` без тенанта | осмотр проверен по тенанту выше (:257-261) | — |
| 40 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:304 | Inspection | findUnique | осмотр по `id` | там же | — |
| 41 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:323 | Inspection | findUnique | осмотр по `id` | явная сверка (:324) | — |
| 42 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:410 | Inspection | findUnique | осмотр по `id` (повтор) | проверен ранее (:324) | — |
| 43 | мелочь | src/modules/inspections/application/commands/inspection-commands.ts:414 | Inspection | findUniqueOrThrow | осмотр по `id` после updateMany с `tenantId` (:401) | там же | — |
| 44 | мелочь | src/modules/inspections/application/queries/inspection-query.service.ts:48 | Inspection | findUnique | осмотр по `id` без тенанта в where | явная сверка `ins.tenantId !== tenantId` (:52) | — |
| 45 | мелочь | src/modules/inspections/application/queries/template-query.service.ts:26 | ChecklistTemplate | findUnique | шаблон по `id` | явная сверка (:30) | — |
| 46 | мелочь | src/modules/monitoring/application/queries/fleet-monitoring.service.ts:230 | ReportAnalytics | findMany | по `reportId in [...]` без тенанта | `reportIds` из отчётов техники тенанта (:195) | — |
| 47 | мелочь | src/modules/sites/application/commands/site-admin-command.service.ts:374 | PileWork | count | выработка в поддереве по `picket`-связям без тенанта | узел и сайт проверены (`requireTenantSite` :444, findFirst с `siteId`) | — |

Дополнительно (те же классы, ниже 60-й строки — кратко, path:line):

- Запись без `tenantId`/условно-тенантные: `report-command.service.ts:185,194,337`
  (по `reportId`/`shiftId`, вызывающий сверил тенант), `site-admin-command.service.ts:180,219`
  (`site.update`/`findUnique` после `requireTenantSite`), `site-admin-command.service.ts:259,375`
  (`report.count`/`leaderDrilling.count` по проверенному `siteId`), `site-command.service.ts:103`
  (`report.count` по проверенному `siteId`).
- Списки с условным тенантом (для ADMIN/DISPATCHER он не ставится — это дизайн): 
  `report-query.service.ts:64,95,96,97,98,101,152,157,177,245,288`, `getDashboardStats:333`.
- `site-command.service.ts:25,67` — возврат объекта/только что сохранённой записи по `id`.
- `report-validation.service.ts:191` (`pileGrade.findUnique` — только имя в тексте ошибки),
  `:210` (`pileWork.groupBy` по `report.siteId`), `report.repository.ts:158,165`
  (динамические `group.model` по `existing.id`).

## Сводка по модулям

| модуль | важно | мелочь | основной характер |
|---|---|---|---|
| src/modules/reports | 4 (report.repository), 1 (report-query условный) | ~6 | репозиторий без параметра tenantId; списки с условным тенантом |
| src/services/reports | 1 (event-handlers list) | ~8 | фон/воркер: outbox, проекции, история отчёта |
| src/services/audit | 0 | 1 | украшающий резолв имени актора |
| src/services/dictionaries | 0 | 3 | FK к тенантным id справочника |
| src/services/system | 0 | 1 | health-check |
| src/modules/equipment | 1 (operational-state) | 5 | FK к тенантной технике; явные сверки |
| src/modules/crews | 0 | 9 | `findUnique` по id, закрыто `assertSameTenant` |
| src/modules/inspections | 0 | 7 | `findUnique` по id + явная сверка тенанта |
| src/modules/monitoring | 0 | 1 | FK к тенантным reportId |
| src/modules/sites | 0 | 4 | после `requireTenantSite`/по проверенному siteId |
| src/modules/readiness | 0 | 0 | все `where` собраны с `tenantId` (лог. совпадение) |
| src/modules/operator-mobile | — | — | замороженная зона, по правилам задачи пропущена |

Итого: 6 «важно», 41 «мелочь».

## Не проверено

- **Замороженная зона** `src/modules/operator-mobile/**` (и варианты экрана оператора)
  не проверялась по правилам задачи; в ней 20+ вызовов из общего списка «подозрительных».
- **Вызовы старше 60 строк** в сводке (`report-query`, `site-*`, `report-validation`)
  разобраны по коду, но не перечитывались построчно до конца — если там окажется
  `where` без тенанта, найдётся отдельно.
- **Line-precision сканера.** Скрипт ловит только шаблон `<recv>.<model>.<method>(`
  на одной строке; обращения через иные псевдонимы, декораторы или многострочный
  `await db\n  .report.findMany` могли не попасть. Число «480» — нижняя оценка.
- **Динамический `group.model`** (`report.repository.ts:158,165`) — модель
  подставляется в рантайме; проверено, что `where` ограничен `existing.id`
  (проверенная строка), но тип модели скриптом не распознан.
- **Оценка достижимости маршрутов** (кто именно может вызвать `getReportHistory`,
  `report.repository.findById` и т.п.) сделана по коду, без запуска приложения.
- **RLS**: считалось, что политики не фильтруют; если решение владельца изменит статус
  RLS на fail-closed — перечень станет короче, но без запуска БД это «не проверено».
