# AU64-S2 — Иерархия объекта: объект, поле, куст, пикет, сваи

Версия (git rev-parse HEAD рабочей папки): `0f2487b335dd027115b1e5a9daf67029573857a5`
Только чтение, код приложения не менялся.

## Итог

Иерархия `Site → PileField → Cluster → Picket → PileWork` описана в `prisma/schema.prisma`
(строки 1746–1852, 2172–2213). Каскады верхнего уровня — `Cascade`, а привязка выработки к
пикету — `ON DELETE SET NULL`, поэтому на уровне БД удаление узла молча отвязывает сваи, и
единственная защита от этого — прикладная (`assertNoSubtreeProduction`). Найдено 12 замечаний:
**критично 0, важно 5, мелочь 7**; отдельно отмечено 5 проверенных и корректных механизмов.

Пять важнейших:
1. **важно** — правка (переименование) узлов иерархии отсутствует вовсе: только создание и
   удаление (`route.ts` — лишь POST/DELETE). Исправить опечатку в названии пикета можно только
   удалив и создав заново, а удаление теряет привязку выработки.
2. **важно** — `Picket → PileWork`/`LeaderDrilling` = `ON DELETE SET NULL`
   (`schema.prisma:2199,2377`; миграция `20260419190903_init/migration.sql:1156,1165`). Любой путь
   удаления пикета в обход `deleteSiteHierarchyItem` молча теряет место работ.
3. **важно** — дубли строк плана по одной марке сваи не запрещены (`SitePilePlan` без
   уникальности), не схлопываются и проверяются построчно, из-за чего лимит плана становится
   «строжайшей строкой», а не суммой.
4. **важно** — снижение плана ниже уже забитого не блокируется: `updateSiteWithPlans` удаляет и
   заново вставляет строки плана без сверки с фактом, а KPI каппит прогресс на 100 %.
5. **важно** — RLS не покрывает `PileField`/`Cluster`/`Picket`/`PileWork`/`LeaderDrilling`/
   `SitePilePlan`/`SiteDrillingPlan`; изоляция этих таблиц держится только на прикладном слое
   (актуально «до объекта №2»).

## Методика

Что искал и чем (команды воспроизводимы из корня рабочей папки):

- `git rev-parse HEAD` → хэш версии; `git status --short` → изменён только `AGENTS.md` (не мой).
- Схема: прочитан `prisma/schema.prisma` целиком (2883 строки); выделены модели `Site`,
  `SitePilePlan`, `SiteDrillingPlan`, `PileField`, `Cluster`, `Picket`, `PileWork`,
  `LeaderDrilling`, `PileGrade`, `DrillingType`, `Report`.
- Фактические действия каскадов сверены **не только** по schema.prisma, но и по SQL миграции:
  `prisma/migrations/20260419190903_init/migration.sql` (FK `..._picketId_fkey ON DELETE SET NULL`).
- RLS: прочитаны `prisma/migrations/20260425000000_enable_rls_foundation/migration.sql` и
  `prisma/migrations/20260701020000_force_row_level_security/migration.sql` (список таблиц).
- Код: поиск `search_files` по `pileField|PileField|cluster|Cluster|picket|Picket` в `src/` и `e2e/`;
  прочитаны `src/modules/sites/**`, `src/app/api/sites/**`, `src/services/analytics/site-analytics-service.ts`,
  `src/services/dictionaries/dictionary-service.ts`, `src/modules/reports/**`,
  `src/modules/operator-mobile/application/commands/production.ts`,
  `src/components/piling/admin-sites/**`, `src/lib/validation-schemas.ts`.
- Тесты: найдены и прочитаны `site-hierarchy-guards.test.ts`, `site-admin-command.test.ts`,
  `site-plan-safety.test.ts`, `report-validation.test.ts`, `app/api/sites/[id]/hierarchy/__tests__/route.test.ts`,
  `components/piling/admin-sites/__tests__/admin-sites-hierarchy.test.tsx`.
- Проверок сборки/тестов (tsc, vitest, playwright) **не запускал** — задача read-only и требует
  только чтения кода; это отражено в «Не проверено».

## Иерархия: операции, ограничения, поведение при дочерних

| Сущность | Операция | Ограничение | Что при наличии дочерних | file:line | Тест |
|---|---|---|---|---|---|
| Site | Создание | `name` обязателен, план опционален; `tenantId` обязателен (fail-closed) | план-строки создаются в той же транзакции (`createMany`) | `src/modules/sites/application/commands/site-admin-command.service.ts:80`; `src/app/api/sites/create/route.ts:14` | `site-admin-command.test.ts:160`, `site-plan-safety.test.ts:76` |
| Site | Правка | `sites.manage`; `updateSiteWithPlans` при явном массиве планов удаляет и заново вставляет строки; пустой массив = «очистить план» | каскадом не трогает детей; план перезаписывается целиком | `site-admin-command.service.ts:143,177-217`; `src/app/api/sites/[id]/route.ts:31,57` | `site-plan-safety.test.ts:33-46` |
| Site | Деактивация | запрещена при наличии черновиков-отчётов (409) | дерево и выработка не трогаются | `site-command.service.ts:92-111` | `site-command.service.ts` (косвенно) |
| Site | Удаление | 409 при `crews>0` **или** `reports>0`; иначе `db.site.delete` | каскад сносит план, поля/кусты/пикеты, назначения, отчёты | `site-admin-command.service.ts:254-268` | `site-admin-command.test.ts:222`, `site-hierarchy-guards.test.ts:210` |
| PileField | Создание | `type='field'`; родитель не нужен; владение объектом проверено | — | `site-admin-command.service.ts:409-413` | `site-hierarchy-guards.test.ts:77` |
| PileField | Правка | **отсутствует** | — | (нет ни PATCH-маршрута, ни команды) | — |
| PileField | Удаление | 409, если выработка в поддереве (сваи+бурение); блокировка поддерева `FOR UPDATE` под транзакцией | каскад `Cluster → Picket` | `site-admin-command.service.ts:445-460` | `site-admin-command.test.ts:292,301` |
| Cluster | Создание | родитель — поле **того же объекта** (иначе 404) | — | `site-admin-command.service.ts:415-423` | `site-hierarchy-guards.test.ts:85,95` |
| Cluster | Правка | **отсутствует** | — | — | — |
| Cluster | Удаление | 409 при выработке в пикетах куста; блокируются куст и его пикеты | каскад на `Picket` | `site-admin-command.service.ts:462-473` | `site-admin-command.test.ts:318` |
| Picket | Создание | родитель — куст **того же объекта** (иначе 404) | — | `site-admin-command.service.ts:425-433` | `site-hierarchy-guards.test.ts:104,114` |
| Picket | Правка | **отсутствует** | — | — | — |
| Picket | Удаление | 409 при выработке; блокировка пикета `FOR UPDATE` | FK `PileWork/LeaderDrilling.picketId = ON DELETE SET NULL` | `site-admin-command.service.ts:475-484` | `site-admin-command.test.ts:259-274` |
| PileWork | Создание/правка | `pileGradeId` обязателен; пикет — только с объекта отчёта; план-кап по марке (advisory-lock) | — | `src/modules/reports/application/commands/report-command.service.ts:81,95,322`; `operator-mobile/.../production.ts:337` | `report-validation.test.ts:233-265` |
| PileWork | Удаление | удаляется `reconcileReportEntries.removeIds`; свая с паспортом удалению/правке не подлежит (409) | отчёт удалён → каскад сносит сваи | `src/modules/reports/infrastructure/report.repository.ts:163-166`; `reconcile-report-entries.ts:40-46` | `reconcile-report-entries.test.ts` |
| SitePilePlan (план свай) | Создание/правка | строки пересоздаются транзакцией; `plannedPiles` на `Site` = сумма `count` | — | `site-admin-command.service.ts:47-74,103-123,191-217` | `site-plan-safety.test.ts:55-73` |
| SitePilePlan | Удаление | каскадом от `Site`; по марке — запрещено, пока `planCount>0` (409) | — | `schema.prisma:1783`; `dictionary-service.ts:404-419` | `dictionary-service.test.ts:78-96` |

Ограничения уникальности (из schema.prisma):

| Таблица | Уникальность | file:line |
|---|---|---|
| Site | `@@unique([tenantId, id])` — **имя объекта не уникально** | `prisma/schema.prisma:1773` |
| PileField | нет уникальности, только `@@index([siteId])` | `prisma/schema.prisma:1822` |
| Cluster | нет уникальности, только `@@index([fieldId])` | `prisma/schema.prisma:1836` |
| Picket | нет уникальности, только `@@index([clusterId])` | `prisma/schema.prisma:1851` |
| SitePilePlan | **нет** `@@unique([siteId, pileGradeId])` | `prisma/schema.prisma:1780-1794` |
| PileWork | `@@unique([tenantId, clientCommandId])` | `prisma/schema.prisma:2206` |

Каскады `onDelete` (schema.prisma / SQL-миграция):

| Родитель → ребёнок | Действие | file:line |
|---|---|---|
| Site → PileField | Cascade | `schema.prisma:1815` |
| PileField → Cluster | Cascade | `schema.prisma:1829` |
| Cluster → Picket | Cascade | `schema.prisma:1843` |
| **Picket → PileWork** | **SetNull** | `schema.prisma:2199`; `migrations/20260419190903_init/migration.sql:1156` |
| **Picket → LeaderDrilling** | **SetNull** | `schema.prisma:2377`; `migrations/20260419190903_init/migration.sql:1165` |
| Report → PileWork / LeaderDrilling | Cascade | `schema.prisma:2198,2376` |
| PileGrade → PileWork | Restrict | `schema.prisma:2200` |
| PileGrade → SitePilePlan | Cascade | `schema.prisma:1785` |
| DrillingType → LeaderDrilling | Restrict | `schema.prisma:2378` |
| Site → SitePilePlan / SiteDrillingPlan / Report / UserSiteAssignment | Cascade | `schema.prisma:1783,1800,1964,1913` |
| Site → Crew | **Restrict** | `schema.prisma:1875` |

## Находки

| # | severity | status | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|---|
| 1 | важно | ПРОЙДЕНО (отсутствие подтверждено) | `src/app/api/sites/[id]/hierarchy/route.ts:49,99` | Узлы иерархии (поле/куст/пикет) можно только создать и удалить — **правки/переименования нет** ни в маршруте, ни в командах | Опечатка «ПК-12» вместо «ПК-21» исправляется лишь удалением пикета и созданием заново; удаление пикета отвязывает его выработку (SET NULL), т.е. исправление названия портит привязку свай | Добавить PATCH-маршрут + команду `updateSiteHierarchyItem` (переименование с проверкой владения объектом), не трогая удаление |
| 2 | важно | ПРОЙДЕНО | `prisma/schema.prisma:2199,2377`; `prisma/migrations/20260419190903_init/migration.sql:1156,1165` | Привязка выработки к пикету — `ON DELETE SET NULL`; на уровне БД удаление узла **не** блокируется, а молча отвязывает сваи | Защита есть только в `deleteSiteHierarchyItem`. Любой обход (прямой SQL, скрипт, будущая команда) тихо теряет место работ; след пишется только прикладным аудитом | Оставить SET NULL (осознанно), но добавить в БД защитный триггер/CHECK или документировать как единственный разрешённый путь удаления; дублировать проверку в любых новых путях |
| 3 | важно | ПРОЙДЕНО | `site-admin-command.service.ts:47-74`; `report-validation.service.ts:217-229`; `prisma/schema.prisma:1780-1794` | `SitePilePlan` не уникален по марке, дубли не схлопываются; сверка плана идёт построчно (`total > plan.count` для каждой строки) | Две строки «марка C60: 100» и «C60: 50» дают эффективный предел 50 (строжайшая строка), а не 150; поведение сверки зависит от того, как админ набрал строки — недетерминированный лимит | Дедуплицировать/суммировать строки плана перед проверкой (в `normalizeSitePlans` и `validateAgainstSitePlans`) либо запретить дубли марки в UI и БД |
| 4 | важно | ПРОЙДЕНО | `site-admin-command.service.ts:191-217`; `site-analytics-service.ts:191-196` | Замена/снижение плана не сверяется с уже забитым фактом; KPI каппит прогресс `Math.min(100, …)` | Админ ставит план ниже выполненного — расхождение не видно: прогресс ровно 100 %, «превышение» не сигнализируется; факт и план молча расходятся | При сохранении плана сравнивать с текущим фактом по маркам и предупреждать/требовать подтверждение (как у длины марки, `setPileGradeLength`) |
| 5 | важно | ПРОЙДЕНО | `prisma/migrations/20260701020000_force_row_level_security/migration.sql:17-25`; `prisma/migrations/20260425000000_enable_rls_foundation/migration.sql:48-63` | RLS включён только для `Site` (и верхних таблиц), но **не** для `PileField/Cluster/Picket/PileWork/LeaderDrilling/SitePilePlan/SiteDrillingPlan` | Изоляция этих таблиц держится исключительно на прикладном `requireTenantSite`/`validatePicketsBelongToSite`; raw-SQL или запрос без join к `Site` обойдёт арендатора. В однотенантной продакшене работает, но ломается «до объекта №2» | Добавить RLS с проверкой через родителя (`EXISTS Site WHERE tenantId = current_setting(...)`) либо, как минимум, зафиксировать риск в ADR |
| 6 | мелочь | ПРОЙДЕНО | `src/components/piling/admin-sites/hierarchy-tree.tsx:231,246`; `src/services/analytics/site-analytics-service.ts:101-106` | Карточка объекта считает метры плана как `count*metersPerUnit`, аналитика — с подстановкой `lengthMm/1000` при `metersPerUnit = 0` | Если у марки задана длина, а `metersPerUnit` пуст, «План свай» покажет 0 м, а KPI объекта — метраж по длине марки. Два числа об одном и том же расходятся | Привести расчёт карточки к тому же правилу (`NULLIF(metersPerUnit,0) ?? lengthMm/1000`) |
| 7 | мелочь | ПРОЙДЕНО | `site-admin-command.service.ts:257-266`; `prisma/schema.prisma:1303,1614,2039,2784` | `hardDeleteSite` проверяет только бригады и отчёты; `SafetyIncident.siteId`, `DeviceKey.siteId`, `TelemetryRecord.siteId`, `ReportPhoto.siteId` — без FK | Удаление «ошибочного» объекта оставляет висячие `siteId` в этих таблицах (нет каскада и нет проверки) | Либо включить эти проверки в guard, либо задокументировать как допустимые (нет FK = нет ссылочной целостности) |
| 8 | мелочь | ПРОЙДЕНО | `prisma/schema.prisma:1811-1852` | Имена `PileField/Cluster/Picket` не уникальны даже в пределах родителя | Два «Пикет 1» в одном кусте неотличимы в выпадающем списке; пикет — ключ привязки выработки, выбор неоднозначен | Добавить `@@unique([clusterId, name])` (и аналоги для поля/куста) или мягкое предупреждение о дубле |
| 9 | мелочь | ПРОЙДЕНО | `src/lib/validation-schemas.ts:69-70`; `create/route.ts:33-38`; `site-admin-command.service.ts:80-137` | `createSiteSchema` принимает `plannedPiles/plannedDrilling`, но `createSiteWithPlans` их игнорирует (считает из планов), а маршрут их не передаёт | Поля в схеме создания мертвы: клиент, приславший только `plannedPiles` без `pilePlans`, получит `plannedPiles = 0` без ошибки | Удалить неиспользуемые поля из `createSiteSchema` либо учесть их в команде |
| 10 | мелочь | ПРОЙДЕНО | `src/lib/validation-schemas.ts:425`; `site-admin-command.service.ts:410-432` | `siteHierarchyItemSchema.sortOrder` принимается, но нигде не используется (у моделей нет колонки) | Молчаливое игнорирование присланного `sortOrder` — ложное ожидание порядка | Убрать `sortOrder` из схемы либо реализовать сортировку |
| 11 | мелочь | ГИПОТЕЗА | `src/lib/validation-schemas.ts:118-122,468` | `siteHierarchySchema` (`fieldName/clusterName/picketNumber`) и тип `SiteHierarchyInput` не используются в коде | Легаси-схема вводит в заблуждение при чтении валидации объекта | Удалить неиспользуемую схему/тип (после проверки внешних ссылок) |
| 12 | мелочь | ПРОЙДЕНО | `site-admin-command.service.ts:360-361`; `report-validation.service.ts:129-148` | Комментарии честно фиксируют границу приложения: блокировка выработки — прикладная, а связь с объектом в мобильном пути дублируется вручную (`production.ts:309-318`) | Два независимых места проверки «пикет с объекта» (общий сервис + мобильная команда) могут разойтись при будущей правке — расхождение не поймается тестом | Оставить одну точку истины (вызывать `validatePicketsBelongToSite` из мобильного пути), если транзакционные ограничения позволяют |

Проверенные и корректные механизмы (без замечаний):

- **Защита от стирания плана при правке объекта** — в `updateSiteSchema` намеренно убран
  `.default([])`: пропущенное поле = «не трогать», явный пустой массив = «очистить»
  (`validation-schemas.ts:92-116`; `route.ts:57-58`). Есть регрессионный тест
  `site-plan-safety.test.ts:33-46`.
- **Сверка плана с фактом по маркам** — `validateAgainstSitePlans` вызывается внутри транзакции
  сохранения под `pg_advisory_xact_lock(hashtext('site-pile-plan:<siteId>'))`
  (`report-validation.service.ts:168-229`; вызов `report-command.service.ts:322`) — гонка двух
  одновременных отчётов закрыта. Тест `report-validation.test.ts:250-258`.
- **Пикет только с объекта отчёта** — `validatePicketsBelongToSite` (общая) + проверка в мобильной
  команде (`report-validation.service.ts:129-148`; `production.ts:309-318`) — сваи чужого объекта
  не попадут в журнал.
- **Антигонка при удалении узла** — блокировка поддерева `SELECT … FOR UPDATE` (поле → кусты →
  пикеты) до подсчёта выработки (`site-admin-command.service.ts:446-483`); тесты
  `site-admin-command.test.ts:276-330`.
- **Защита сваи с паспортом** — нельзя удалить/изменить сваю с паспортом через правку отчёта
  (`reconcile-report-entries.ts:40-46`).
- **Запрет удаления марки/справочника, использованного в плане** — `deleteDictionaryItem` при
  `planCount>0` возвращает 409 (`dictionary-service.ts:404-419`).

## Не проверено

1. **Выполнение проверок** (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`,
   `npx playwright test --list`, `npm run build`) и число пройденных/пропущенных тестов — не
   запускал: задача предписывает только чтение, а рабочая папка без `src/generated` требует
   `npm run db:generate`. Все ссылки на тесты — по факту просмотренного содержимого файлов, а не
   по прогону.
2. **Состояние боевой БД**: фактические FK/индексы/RLS в PostgreSQL сверены по SQL миграций в
   репозитории, а не по живой схеме. Если какой-то ручной патч на сервере расходится с миграцией —
   это не видно из кода.
3. **Значения `metersPerUnit` в реальных объектах** (находка 6): насколько часто встречается
   «lengthMm задан, metersPerUnit = 0» — по коду не определить, нужен запрос к БД.
4. **Возможность переноса выработки между пикетами**: сообщение об ошибке удаления узла
   предлагает «Сначала перенесите их», отдельной команды переноса я не нашёл; предполагаю, что
   перенос делается правкой отчёта (`PileWork.picketId` в форме), но UI-путь переноса намеренно
   не проверял (вне области задачи).
5. **Права на уровне UI для `sites.manage_hierarchy`** (ADMIN/DISPATCHER по `authorization-service.ts:75`)
   — матрица прочитана, но фактическое поведение кнопок для каждой роли не проверялось.
6. **Существующие отчёты** `docs/audits/**` (в т.ч. `AU46-S2-PLAN-VS-FACT.md`,
   `R146-SITE-HIERARCHY-UI.md`) намеренно не открывались ради независимости первого прохода;
   возможное пересечение с ними не проверялось.
