# AU157-S4-LARGE-LIST-PERFORMANCE — Большие списки: пагинация и поиск

Версия кода: `git rev-parse HEAD` = **8fce160386a27de36a38c9826bb239a1bab91d3f**
(ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`).
Аудит только на чтение: ни один файл приложения не изменён; создан только этот отчёт.

## Итог

1. Найдено **26** пунктов: **1 критично**, **11 важно**, **14 мелочь**.
2. **Критично одно:** журнал аудита технической готовности читает **всю** цепочку аудита тенанта на каждый запрос и пересчитывает SHA-256 по каждому событию — `src/app/api/readiness/audit/route.ts:32`, `src/modules/readiness/infrastructure/audit/audit-repository.ts:86`, `src/modules/readiness/infrastructure/audit/verify-chain.ts:45`. На 1000+ событий это единственный список, чья стоимость запроса растёт линейно и никогда не падает.
3. **Списки с курсором есть, но клиент их не использует:** дефекты и наряды (work permits) поддерживают курсор на сервере, а экраны просят `?limit=200` без курсора — `src/components/piling/to/readiness/api/client.ts:191` и `:176`. Сверх 200 записей экран их не покажет вообще.
4. **Смены — курсора нет ни на сервере, ни на клиенте:** лимит 200 и всё — `src/app/api/readiness/shifts/route.ts:24`, `src/modules/readiness/infrastructure/shifts/shift-repository.ts:81`. Аналогично осмотры: жёсткий `take: 200` без итога (`src/modules/inspections/application/queries/inspection-query.service.ts:21`).
5. **Оборудование обрезается до 50 строк в трёх экранах** (склад/бригады/фильтр отчётов): клиенты зовут `/api/equipment` без `limit` и без добора курсора — `use-equipment-list.ts:29`, `use-crews-data.ts:83`, `use-reports-data.ts:121`.
6. **Сотрудники: экран вычитывает ВСЕ страницы в цикле и ищет по ним на клиенте** — `src/components/piling/admin-users/use-users-list.ts:69`, поиск `src/components/piling/admin-users/user-list-model.ts:82`.
7. **Поиск почти везде клиентский** — по уже загруженной странице. Серверный поиск есть только в журнале забивки (`pileNumber`), и он честно уходит в SQL.

## Методика

Что и как искалось (воспроизводимо):

1. `rg -n "take:|skip:|LIMIT |OFFSET " src/` — файлы с ограничениями выборки (53 файла); далее точечное чтение каждого.
2. Инвентаризация маршрутов: `ls` по `src/app/api/**/route.ts` (141 маршрут), затем чтение всех маршрутов-списков: `reports/all|my|recent|period`, `users`, `equipment`, `sites/all`, `crews/all`, `inspections`, `readiness/{defects,shifts,work-permits,audit,history,current,export}`, `admin/{incidents,dlq,analytics/*}`, `maintenance`, `pile-passports`, `user-documents/control`, `briefings/journal`, `feedback/events`, `audit`.
3. Для каждого списка — спуск до фактического Prisma-вызова (`findMany`): `rg -n "findMany|count" src/app src/modules src/services src/core`.
4. Проверка клиента: `rg -n "normalizeSearch" src/` (59 попаданий — где поиск на клиенте), `rg -n "/api/(readiness/...|users|equipment|...)" src/` (какие лимиты реально запрашивает UI), `rg -n "nextCursor" src/components` (кто доводит пагинацию до конца).
5. Проверка валидации лимитов: чтение `src/lib/pagination.ts`, `src/lib/pagination-cursor.ts` и тестов `src/lib/__tests__/pagination.test.ts`.
6. Поведение Prisma при отрицательном `take` сверял с уже принятым решением в самом репозитории (`src/app/api/admin/dlq/route.ts:61-63` — комментарий «отрицательное — выборку с конца») — признак того, что команда этот эффект знает и в новых маршрутах закрывает; без запуска БД из-за запрета подключаться к базе это помечено как ГИПОТЕЗА.
7. Справочники внешних API (Prisma `take`) пробовал уточнить через context7 (`/prisma/web`) — ответ про отрицательный `take` не найдён, поэтому помечено ГИПОТЕЗА, а не факт.

## Таблица: списки — лимит / пагинация / поиск

| Список | Файл:строка (ограничение) | Лимит на сервере | Пагинация | Поиск | Что при 1000+ записей |
|---|---|---|---|---|---|
| Отчёты (журнал) `/api/reports/all` | `src/app/api/reports/all/route.ts:24` | 1..100 (по умолч. 25) | курсор + `hasMore` + `total` + итоги | клиентский по загруженной странице | ПРОЙДЕНО: листается; поиск видит только загруженное (есть подсказка на экране) |
| Мои отчёты `/api/reports/my` | `src/app/api/reports/my/route.ts:19` | 50 (макс. 100) | курсор | — | ГИПОТЕЗА: без тай-брейкера по `id` возможны пропуск/дубль между страницами |
| Дашборд: последние отчёты | `src/modules/reports/application/queries/report-query.service.ts:231` | 8 | не нужна | — | ПРОЙДЕНО |
| Отчёты за период `/api/reports/period` | `src/core/infrastructure/raw-queries.ts:22,79,101` | 2000, сверх — 422 с текстом | нет (весь срез) | — | ПРОЙДЕНО: явный отказ вместо тихого среза |
| Дефекты `/api/readiness/defects` | `src/modules/readiness/application/defects/schemas.ts:44` | 1..200 (по умолч. 50) | курсор есть | фильтры (status/severity/equipment) серверные | ВАЖНО: экран просит 200 без курсора (`api/client.ts:191`) |
| Наряды (work permits) `/api/readiness/work-permits` | `src/app/api/readiness/work-permits/route.ts:33` | 1..200 (по умолч. 50) | курсор есть | фильтры серверные | ВАЖНО: экран просит 200 без курсора (`api/client.ts:176`) |
| Смены `/api/readiness/shifts` | `src/app/api/readiness/shifts/route.ts:26` | 1..200 (по умолч. 50) | **нет курсора** | фильтры серверные | ВАЖНО: 200 — потолок навсегда |
| Аудит готовности `/api/readiness/audit` | `src/app/api/readiness/audit/route.ts:26` | 1..500 (по умолч. 200) | нет (срез `slice(-limit)`) | фильтр в JS после полной выборки | КРИТИЧНО: сначала читается вся цепочка |
| История готовности `/api/readiness/history` | `src/app/api/readiness/history/route.ts:24` | 1..500 (по умолч. 200) | нет курсора | фильтры серверные | ВАЖНО: старые снимки недостижимы |
| Аудит сущности `/api/audit` | `src/app/api/audit/route.ts:25-27` | 200 (по умолч. 20) | нет | — | ПРОЙДЕНО (лимит закрыт) |
| Сотрудники `/api/users` | `src/app/api/users/route.ts:31` | 50 (макс. 100) | курсор | только фильтр `role` на сервере; поиск на клиенте | ВАЖНО: экран вычитывает все страницы циклом |
| Техника `/api/equipment` | `src/app/api/equipment/route.ts:20` | 50 (макс. 100) | курсор | фильтры серверные | ВАЖНО: 3 экрана не идут за курсором → видны 50 |
| Осмотры `/api/inspections` | `src/app/api/inspections/route.ts:47` | `take: 200`, параметра нет | нет | — | ВАЖНО: тихая обрезка без `total` |
| Наряды ТО `/api/maintenance` | `src/modules/equipment/application/queries/equipment-query.service.ts:493` | 500 (в коде константа) | параметров страницы нет | фильтры серверные | ВАЖНО: тихая обрезка на 500 |
| Происшествия `/api/admin/incidents` | `src/app/api/admin/incidents/route.ts:24,42` | 100 | нет | `scope=open/all` | ВАЖНО: в режиме «все» видно первые 100 |
| Журнал инструктажей `/api/briefings/journal` | `src/modules/operator-mobile/application/briefing-journal-query.ts:27,127` | 1000 + флаг `truncated` | нет | фильтры серверные | ПРОЙДЕНО по замыслу (срез помечен) |
| Журнал забивки `/api/pile-passports` | `src/modules/reports/application/queries/pile-journal-types.ts:175` | 500 (выгрузка 20000) | нет | `pileNumber` — **поиск в SQL** | ПРОЙДЕНО |
| Контроль документов `/api/user-documents/control` | `src/services/users/user-documents.ts:126-140` | нет `take` | нет | — | МЕЛОЧЬ: объём ограничен фильтром «истекает» |
| Объекты `/api/sites/all`, бригады `/api/crews/all` | `src/app/api/sites/all/route.ts:20`, `src/app/api/crews/all/route.ts:25-28` | нет | нет | — | МЕЛОЧЬ: бригады читаются все и фильтруются по тенанту в памяти |
| DLQ `/api/admin/dlq` | `src/app/api/admin/dlq/route.ts:62-63` | 1..500 (по умолч. 100) | нет | `status` | ПРОЙДЕНО |
| События `/api/feedback/events` | `src/app/api/feedback/events/route.ts:64-65` | 1..100 | нет | — | ПРОЙДЕНО |

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/infrastructure/audit/audit-repository.ts:86-90` + `src/app/api/readiness/audit/route.ts:32` + `src/modules/readiness/infrastructure/audit/verify-chain.ts:45` | `readChain()` читает **все** строки `AuditLog` тенанта без `take`, затем `verifyAuditEvents` считает SHA-256 по каждому событию на каждый HTTP-запрос | Стоимость запроса `GET /api/readiness/audit` = O(вся история). На 10 000 событий — десятки тысяч байтов JSON и 10 000 дайджестов в JS на каждое открытие экрана; на 100 000 — таймаут и память. Кэша у маршрута нет (`withApi(..., {domain:'readiness-audit'})` без `cache`) | Читать хвост цепочки (последние N по `sequence desc`) для показа, а полную проверку цепи вынести в отдельную команду; кэшировать результат проверки по `headHash` |
| 2 | важно | `src/components/piling/to/readiness/api/client.ts:191`, `src/app/api/readiness/defects/route.ts:47-48` | Дефекты: серверный курсор есть, клиент запрашивает `limit=200` и курсор не передаёт | Сверх 200 дефектов старые не отображаются никогда; кнопки «ещё» нет | Пробрасывать `nextCursor` из ответа и подгружать страницы |
| 3 | важно | `src/components/piling/to/readiness/api/client.ts:176`, `src/app/api/readiness/work-permits/route.ts:51` | Наряды: сервер поддерживает `cursor`, клиент берёт первые 200 | История нарядов старше 200 записей недоступна на экране | То же: догрузка по курсору |
| 4 | важно | `src/app/api/readiness/shifts/route.ts:24`, `src/modules/readiness/infrastructure/shifts/shift-repository.ts:80-84` | Смены: параметр `cursor` не входит в `allowed`, в репозитории ни `cursor`, ни `skip` | Больше 200 смен за период посмотреть нельзя даже вручную — сужение фильтром единственный путь | Добавить курсор (`productionDate, id`) по образцу дефектов |
| 5 | важно | `src/modules/inspections/application/queries/inspection-query.service.ts:21`, `src/app/api/inspections/route.ts:47` | Жёсткий `take: 200`, в маршруте нет ни `limit`, ни `cursor`, в ответе нет `total` | Оператор/офис видят 200 последних осмотров и не знают, что список обрезан (нет ни счётчика, ни признака) | Вернуть `total` и добавить курсор; как минимум — флаг усечения |
| 6 | важно | `src/app/api/maintenance/route.ts:26`, `src/modules/equipment/application/queries/equipment-query.service.ts:13,493` | Наряды ТО: `take: 500` без параметров страницы и без `total`; в коде это признано («revisit with cursor pagination») | За годы работы 500 нарядов набираются; старые исчезают без предупреждения | Курсор + `total` или явный признак среза |
| 7 | важно | `src/app/api/admin/incidents/route.ts:24,42` | Происшествия: `PAGE_SIZE = 100`, страницы нет, `total` нет | `?scope=all` показывает первые 100 происшествий как полный список — инженер ОТ не увидит остальное | `cursor` + `total` |
| 8 | важно | `src/components/piling/admin-equipment/use-equipment-list.ts:29` | Экран «Техника» зовёт `/api/equipment` без `limit` → сервер отдаёт 50 (`src/app/api/equipment/route.ts:20`), курсор не запрашивается | Парк больше 50 единиц: часть машин не видна ни в карточках, ни в фильтрах, ни в поиске | Догрузка по `nextCursor` (или `limit=100` + пагинация) |
| 9 | важно | `src/components/piling/admin-crews/use-crews-data.ts:82-83` | Экран «Бригады» грузит `/api/users` и `/api/equipment` без курсора → по 50 записей каждого | Бригаду на 51-й машине/операторе нельзя ни завести, ни увидеть | Тот же добор страниц |
| 10 | важно | `src/components/piling/admin-reports/use-reports-data.ts:120` | Фильтр «Оператор» в журнале отчётов — `/api/users?role=OPERATOR` без курсора → максимум 50 операторов | В фирме больше 50 машинистов: часть людей не попадает в фильтр, отчёты по ним «не находятся» | Пагинация фильтра или отдельный справочный эндпоинт без страниц |
| 11 | важно | `src/components/piling/admin-users/use-users-list.ts:62-75` | Список сотрудников вычитывает **все** страницы последовательным `while (cursor)`, потом фильтрует и ищет на клиенте (`user-list-model.ts:82-96`) | 1000 пользователей = 20 последовательных запросов, каждый с `_count`, `crews`, `crewAssistantOf`, `reports` (`src/services/users/user-service.ts:36-83`); экран ждёт всю цепочку | Оставить серверную страницу + серверный поиск (`?q=`) |
| 12 | важно | `src/app/api/reports/my/route.ts:19-24`, `src/modules/reports/application/queries/report-query.service.ts:300-304` | В списке «мои отчёты» `orderBy: { date: 'desc' }` без тай-брейкера по `id`, а курсор — по `id` | Тот же дефект, что уже чинили в журнале отчётов (`report-query.service.ts:162-166`, F-R140-PAGING): при нескольких отчётах на одну дату страница может показать строку дважды или пропустить | Добавить `{ id: 'desc' }` в `orderBy` |
| 13 | важно | `src/lib/pagination-cursor.ts:46` | Лимит не ограничен снизу и не проверяется на NaN: `Math.min(parseInt(limitParam || default), maxLimit)` | ГИПОТЕЗА: `?limit=-5` даёт `take: -5`, что Prisma трактует как «выборку с конца» (так это описано в комментарии `src/app/api/admin/dlq/route.ts:61-63`), а `?limit=abc` — `take: NaN`. Ни один тест этого не покрывает (`src/lib/__tests__/pagination.test.ts`) | `Number.isInteger` + `Math.max(1, …)` по образцу DLQ-маршрута |
| 14 | важно | `src/services/audit/audit-history-service.ts:109-113` | История сущности (панель «История») грузит **всех** пользователей, объекты и технику тенанта ради карт имён, на каждое открытие панели | На 1000+ сотрудников/объектов каждое раскрытие истории тянет три полные таблицы | Отдельный запрос по нужным id (набор известен после чтения событий) |
| 15 | мелочь | `src/services/users/user-service.ts:14-21` | `listAssignableUsers` — без `take`, все активные пользователи тенанта | Вызывается там, где нужен справочник; при росте штата растёт ответ | Курсор или серверный поиск |
| 16 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:236-255` | Поиск/фильтр/сортировка отчётов — по загруженной странице (100 строк) | Пользователь ищет фамилию, которой нет в первых 100, и видит пусто | Уже есть подсказка `admin-reports.tsx:511-515`; полезен серверный `q` |
| 17 | мелочь | `src/components/piling/to/readiness/screens/permits-screen.tsx:130-131`, `src/components/piling/to/readiness/screens/reports-screen.tsx:237-244`, `src/components/piling/to/readiness/screens/documents-screen.tsx:74-77` | Поиск на экранах ТО — клиентский (`normalizeSearch` по загруженному массиву) | Совпадает с пунктами 2-3: ищется по 200 строкам и результат выдаётся за полный | Серверный поиск по образцу `pileNumber` |
| 18 | мелочь | `src/app/api/admin/analytics/site-weekly-trend/route.ts:28` | `take: weeks * (siteId ? 1 : 10)` — эвристика «не больше 10 объектов» | При 11+ объектах (`?siteId=all`) последние недели молча обрезаны | `take` по числу объектов или по неделям без множителя 10 |
| 19 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:110-115` | История отчётов в карточке техники: `take: 1000` без пагинации | Машина с 1000+ отчётов — таймлайн обрывается без признака | `total` + «показать ещё» |
| 20 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:15-18,46-52,224-230,372-392` | `getAccessibleEquipment`, `listEquipmentWithCrewCounts`, `listMaintenance`, `listMaintenancePlans` — без `take` | Рост парка/истории ТО увеличивает каждый ответ без предела | Явные пределы или пагинация |
| 21 | мелочь | `src/app/api/sites/all/route.ts:20`, `src/app/api/crews/all/route.ts:25-28` | Справочники «все объекты»/«все бригады»: полные выборки; бригады читаются по всем тенантам и фильтруются в памяти | Изоляция соблюдена (`crews.filter(crew => crew.site?.tenantId === tenantId)`), но объём растёт с числом тенантов | Фильтр по тенанту в SQL (`getCachedCrewsAll` принимает тенант) |
| 22 | мелочь | `src/modules/readiness/application/defects/queries.ts:63` | Сводка дефектов считается по странице (`summarizeDefects(page)`), а не по всей выборке | Плитки «открыто дефектов» показывают число по 50 строкам — цифра выглядит как общая | Считать по `total`/агрегатом (в комментарии признано осознанным — уточнить с владельцем) |
| 23 | мелочь | `src/app/api/readiness/current/route.ts:21-32` | `currentReadiness` и снимки читаются без `take` | Объём = размер парка; на большом парке ответ экрана растёт линейно | Кэш/срез по закреплённым установкам |
| 24 | мелочь | `src/app/api/readiness/export/route.ts:59-72,102-114` | Выгрузки `permits`/`reports` читают все строки без предела, `audit` — всю цепочку | Выгрузка на 1000+ строк держит соединение и строит CSV в памяти | Потоковая отдача + предел с явным сообщением |
| 25 | мелочь | `src/services/users/user-documents.ts:91-95` | `listUserDocuments` без `take` | Объём ограничен одним работником, риск низкий | Не требуется |
| 26 | мелочь | `src/app/api/reports/all/route.ts:23-24` | `Number(...)` без `Number.isFinite`-проверки на входе (проверка есть — `Number.isFinite(limitParam)`), но `Math.max(limitParam, 1)` на `NaN` даёт `NaN` | `?limit=abc`: `Number('abc')=NaN`, `Math.min(Math.max(NaN,1),100)=NaN` → `take: NaN` | Добавить `Number.isInteger`-проверку (ГИПОТЕЗА о поведении Prisma, см. #13) |

## Приложение: остальные места с выборками без предела (только path:line)

- `src/app/api/admin/analytics/overview/route.ts:52` — период ограничен `MAX_PERIOD_DAYS` (проверка на `:173`), ПРОЙДЕНО.
- `src/app/api/equipment/[id]/device-keys/route.ts:110` — ключи одной установки, риск низкий.
- `src/app/api/media/download-batch/route.ts:56` — пакетная выгрузка по списку id, риск низкий.
- `src/services/users/user-documents.ts:166,172` — по одному работнику.
- `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:159` — `take: limit + 1` (корректно).
- `src/modules/readiness/infrastructure/defects/defect-repository.ts:97` — то же, корректно.

## Не проверено

1. **Поведение Prisma при отрицательном/NaN `take`** — не проверено фактически: нет запущенной БД (правила запрещают подключаться к базе, `prisma`-команды работы со схемой запрещены). Основание считать, что отрицательный `take` даёт выборку с конца, — комментарий в самом репозитории (`src/app/api/admin/dlq/route.ts:61`). Статус: ГИПОТЕЗА.
2. **Реальные объёмы данных в проде** (число отчётов, событий аудита, сотрудников) — не проверено: нет доступа к продовой базе. Все оценки «1000+» взяты из условия задачи, а не из замеров.
3. **Время ответа каждого списка** (`EXPLAIN ANALYZE`, замеры) — не проверено: скрипт `scripts/explain-analyze.ts` требует БД. Индексы соответствующих таблиц не разбирал.
4. **Кэш ответов** (`src/core/cache`) — не проверял предельный размер и вытеснение; известно только, что `readiness/audit` идёт без кэша (`src/app/api/readiness/audit/route.ts:54`).
5. **Виртуализация списков в UI** (сколько строк реально в DOM при «Загрузить ещё») — не проверено: не открывал браузер и не запускал e2e.
6. **Экраны, лежащие в замороженных зонах** (`src/app/operator/**`, ORION) — по правилам задачи не разбирал; там могут быть свои лимиты и свои дефекты пагинации.
7. **Проверки `tsc`/`lint`/`test`/`build` не запускались** — задача только на чтение и не меняет код, поэтому набор из §6 AGENTS.md к ней неприменим.
