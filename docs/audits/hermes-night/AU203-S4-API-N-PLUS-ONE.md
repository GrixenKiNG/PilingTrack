# AU203-S4-API-N-PLUS-ONE: запросы N+1 в API (только чтение кода)

**HEAD на момент аудита:** `14a943bb89edc30474da7281c7b3994053088a52`
(ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`)
**Область:** `src/app/api/**` (141 route.ts) и `src/modules/**`.
Код приложения не изменялся. Замеров на живых данных нет — только чтение кода.

## Итог

- Найдено 30 находок: **критично — 0, важно — 18, мелочь — 12.**
- Категория A (запрос к БД внутри цикла, настоящий N+1): 18 шт. Категория B
  (`findMany` без `take` — в т.ч. `include` — «на вырост»): 12 шт.
- Критичных нет: N+1 здесь бьют по времени ответа и по нагрузке на БД при
  росте данных, а не целостности. Ни одна находка не открывает доступ к чужим
  данным (tenancy в этих путях не затронута).
- Топ-5 по последствиям:
  1. `src/modules/reports/infrastructure/report.repository.ts:167` — запись
     строк отчёта (сваи/бурение/простои) по одной в цикле внутри транзакции.
  2. `src/modules/reports/application/projections/rebuild.ts:199` — админский
     пересбор отчётов: `upsert` на каждый отчёт (`/api/admin/projections/rebuild`).
  3. `src/modules/readiness/application/scheduler.ts:262` (и 139/177/219) —
     ночной планировщик: запрос на каждую единицу техники / каждую смену.
  4. `src/modules/reports/application/queries/report-export.service.ts:135` —
     выгрузка отчётов одним `findMany` без `take` с вложенными `include`.
  5. `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` —
     `readChain` читает всю цепочку аудита без лимита (растёт бесконечно).

## Методика

Что и как искалось (воспроизводимо):

1. Перепись маршрутов: `find src/app/api -name route.ts | wc -l` → 141;
   `rg -n '\.findMany\(' src/app/api | wc -l` → 22; в `src/modules` → 110.
2. **Цикл с запросом к БД.** Написан сканер на node
   (`scan2.cjs`): для каждого `for (`/`while (` находил тело по балансу скобок
   и отмечал строки с `await` внутри тела. Прогон по `src/app/api` + `src/modules`
   (без `__tests__`, `*.test.ts`) дал 22 адреса; вручную отсеяны ретраи и
   не-БД-await. Команда: `node <scratch>/scan2.cjs`.
3. **`findMany` без `take`.** Сканер `scan3.cjs` захватывал аргументы каждого
   `findMany(...)` по балансу скобок и помечал те, где нет `take:`; размечал
   `[include]`/`[select]`/`[full]`. Команда: `node <scratch>/scan3.cjs`.
   Результат: 101 адрес без `take` (в т.ч. легитимные словари/константы).
4. Просмотр `include`-ветки и «горячих» маршрутов списков: `reports/all`,
   `reports/recent`, `reports/period`, `equipment`, `admin/analytics/overview`,
   `admin/incidents`, `admin/dlq`, `media/download-batch`, `readiness/current`,
   `readiness/export`, `readiness/history`.
5. Числа (`git rev-parse HEAD`, счётчики) — только из команд, зафиксированы выше.

Что **проверено как НЕ N+1** (хорошие образцы, менять не нужно): батчинг через
`in:` вместо цикла — `src/app/api/admin/incidents/route.ts:52` (три запроса
`in:` вместо запроса на строку), `src/app/api/admin/dlq/route.ts:35` (в
комментарии прямо описано, как этого избежали), `report-query.service.ts:118`
(одна выборка media на страницу вместо запроса на отчёт — в комментарии
названо «~200 requests per screen»),
`src/modules/monitoring/application/queries/fleet-monitoring.service.ts:170`,
`src/modules/safety/application/clearance-overview-query.ts:150`,
`src/modules/operator-mobile/application/assistant-query.ts:55`;
курсорная пагинация — `src/app/api/equipment/route.ts:21` и
`equipment-query.service.ts:513`; лимит на страницу —
`src/app/api/readiness/history/route.ts:27` и
`src/app/api/admin/incidents/route.ts:26`.

Формат строки таблицы: `маршрут | файл:строка (полный путь) | паттерн | риск`.

## Находки

### A. Запросы к БД внутри цикла (настоящий N+1)

| # | severity | маршрут | файл:строка | паттерн | риск при росте данных / сценарий | правка |
|---|----------|---------|-------------|---------|----------------------------------|--------|
| 1 | важно | (модуль reports, вызов из сдачи/правки отчёта) | `src/modules/reports/infrastructure/report.repository.ts:167` | цикл по `plan.rows`: `update`/`create` на каждую строку свай/бурения/простоев внутри транзакции | два запроса на каждую строку отчёта; при 200+ строк на отчёт и потоке сдач — сотни round-trip в одной транзакции, растёт линейно по числу строк | заменить на `createMany`/`updateMany` или батч по 50–100 |
| 2 | важно | `POST /api/admin/projections/rebuild` | `src/modules/reports/application/projections/rebuild.ts:199` | цикл по `reports`: `db.reportAnalytics.upsert` на отчёт | число отчётов × 1 запрос; на пересборке всего поля — тысячи upsert-ов; ручная операция может уйти в таймаут | `createMany({skipDuplicates})` + апдейты батчем, либо `$transaction`/`COPY` |
| 3 | важно | планировщик готовности (крон) | `src/modules/readiness/application/scheduler.ts:262` | цикл по всему активному парку: `requestReadinessSnapshot` на единицу | 1 запрос на каждую единицу техники; при 300 машинах — 300 запросов за ночной прогон; линейный рост с парком | сформировать один `createMany` outbox-событий |
| 4 | важно | планировщик готовности (крон) | `src/modules/readiness/application/scheduler.ts:219` | цикл по черновикам отчётов: `outboxEvent.create` на отчёт | N отчётов × 1 вставка; за ночь по всем сменам | `createMany` одним запросом |
| 5 | важно | планировщик готовности (крон) | `src/modules/readiness/application/scheduler.ts:177` | цикл по авто-закрытым сменам: `recordChainedReadinessAudit` на смену | 1 вставка аудита на смену; накопление за сутки | `createMany` |
| 6 | важно | планировщик готовности (крон) | `src/modules/readiness/application/scheduler.ts:139` | цикл по истёкшим нарядам-допускам: аудит-запись на наряд | 1 запрос на нарад; рост с числом допусков | `createMany` |
| 7 | важно | публикация правил готовности | `src/modules/readiness/application/readiness-rules-service.ts:200` | цикл по парку: `requestReadinessSnapshot` на единицу | 1 запрос на машину при каждой публикации правил; линейный рост | `createMany` outbox |
| 8 | важно | планировщик ТО (крон) | `src/modules/equipment/application/commands/pm-scheduler.ts:82` | цикл по `plans`: на каждый просроченный план — своя `$transaction` с 3+ запросами | число просроченных планов × (транзакция); при большом парке — длинная последовательная серия транзакций | вынести проверку «открытых нарядов» в один `findMany` (`in:`) до цикла |
| 9 | важно | (воркер проекций) | `src/modules/reports/application/projections/projection-worker.ts:188` | `setInterval` → для каждого tenant → цикл по `sites`: `projectWeeklyTrend(site)` (несколько запросов) | 1 «мини-операция» на объект каждый час; при десятках объектов и организаций — нагрузка каждый час | считать тренд по всем объектам одним агрегатом, либо `Promise.all` с ограничением |
| 10 | важно | `POST /api/operator/mobile/command` (чек-лист) | `src/modules/operator-mobile/application/commands/checklist.ts:203` | цикл по дефектам: `findFirst` + `create` на каждый | 2 запроса на каждый дефект-пункт чек-листа; на длинном чек-листе — десятки round-trip (замок уже взят, дедуп уже прочитан) | прочитать открытые дефекты одним `findMany` (`in: sourceKey`) до цикла и `createMany` |
| 11 | важно | `POST /api/alerts/webhook` | `src/app/api/alerts/webhook/route.ts:125` | цикл по `alerts` (тело запроса, не ограничено): `outboxEvent.upsert` на каждый firing-алерт | число алертов приходит извне и не ограничено; лимит `MAX_FORWARDED=100` (стр.60) ограничивает только доставку, но upsert выполняется для каждого firing-алерта | ограничить длину `alerts` сверху и/или батчить upsert |
| 12 | важно | (модуль readiness, бэкфилл) | `src/modules/readiness/application/backfill/backfill-service.ts:34` | цикл по батчу техники (200): `evaluateAuthoritativeReadiness` + `createDeduplicatedSnapshot` + `advanceCurrentReadiness` на единицу | не N+1 «в чистом виде» (батч ограничен `READINESS_BACKFILL_BATCH_SIZE=200`, стр.8), но на каждую единицу — 3+ запроса; миграционный прогон по всему парку | оставить (разовая миграция), но зафиксировать как известную стоимость |
| 13 | мелочь | `POST /api/operator/mobile/command` | `src/modules/operator-mobile/application/commands/checklist.ts:195` | цикл: `$executeRaw` advisory-lock на каждый `sourceKey` | 1 запрос на каждый ключ дедупликации дефекта; размер = числу дефектных пунктов | объединить блокировки (один ключ компонента) |
| 14 | мелочь | `POST /api/inspections/[id]/complete` | `src/modules/inspections/application/commands/inspection-commands.ts:471` | цикл по `toCreate`: `equipmentDefect.create` + `outboxEvent.createMany` на дефект | 2 запроса на каждый новый дефект осмотра | `createMany` дефектов + один `createMany` событий |
| 15 | мелочь | `POST /api/inspections/[id]/complete` | `src/modules/inspections/application/commands/inspection-commands.ts:399` | цикл: advisory-lock на каждый `sourceKey` | 1 запрос на ключ дефекта | см. #13 |
| 16 | мелочь | (валидация отчёта) | `src/modules/reports/application/commands/report-validation.service.ts:188` | цикл по сваям: `pileGrade.findUnique` при отсутствии марки в плане | только путь ошибки (далее `throw`), потому редкий; но по одной выборке на «не ту» сваю | взять имена марок из уже загруженных `plans` |
| 17 | мелочь | (закрытие наряда ТО) | `src/modules/equipment/application/commands/maintenance-regulation.ts:97` | цикл по `plans`: `maintenancePlan.update` на подходящий план | 1 запрос на план того же типа; число планов на машину мало | собрать `updateMany` |
| 18 | мелочь | (сохранение техники) | `src/modules/equipment/application/commands/equipment-command.service.ts:41` | цикл по `agg.getPendingEvents()`: `outboxEvent.create` на событие | 1 вставка на доменное событие (обычно 1–2) | `createMany` |

### B. `findMany` без `take` (в т.ч. `include`) — «на вырост»

| # | severity | маршрут | файл:строка | паттерн | риск при росте данных / сценарий | правка |
|---|----------|---------|-------------|---------|----------------------------------|--------|
| 19 | важно | `GET /api/reports/export` (CSV/XLSX) | `src/modules/reports/application/queries/report-export.service.ts:135` | `findMany` без `take`, вложенные `include` (`piles`, `drillings`, `downtimes`, user/equipment/crew/site) | выгрузка за весь период тянет все отчёты со всеми строками в память; линейный рост без потолка | лимит на выгрузку или потоковая пагинация |
| 20 | важно | `GET /api/readiness/export`, `GET /api/readiness/audit` | `src/modules/readiness/infrastructure/audit/audit-repository.ts:87` | `readChain`: `auditLog.findMany` без `take`, вся цепочка | журнал аудита растёт вечно; каждое чтение цепочки — весь журнал организации; на «зрелой» базе — мегабайты в память | `take`/курсор для выгрузки, отдельный запрос «голова + последние N» для проверки |
| 21 | важно | `GET /api/admin/analytics/overview` | `src/app/api/admin/analytics/overview/route.ts:52` (`loadPeriod`) | `report.findMany` без `take` со вложенными `piles/drillings/downtimes` × 2 (текущий и прошлый период) | за длинный период — все отчёты со строками в память, дважды; дашборд «за год» деградирует линейно | агрегация на стороне БД (`groupBy`) или лимит периода |
| 22 | важно | `GET /api/readiness/export` | `src/app/api/readiness/export/route.ts:102` | `readinessScoreSnapshot.findMany` без `take`, `[full]` | снимки готовности копятся ежедневно по всему парку; выгрузка без фильтров — все снимки за всё время | `take`/курсор |
| 23 | важно | `GET /api/readiness/export` | `src/app/api/readiness/export/route.ts:43` | `equipment.findMany` без `take`, `[full]` | выгрузка парка целиком; умеренный рост, но `[full]` тянет все колонки | `select` нужных полей |
| 24 | важно | `GET /api/readiness/export` | `src/app/api/readiness/export/route.ts:59` | `workPermit.findMany` с `include: approvals` без `take` | наряд × согласования; выгрузка без лимита | `take`/курсор |
| 25 | мелочь | `GET /api/readiness/current` | `src/app/api/readiness/current/route.ts:21`, `:25` | два `findMany` `[full]` без `take` (`currentReadiness`, `readinessScoreSnapshot`) | по одному «текущему» снимку на активную машину; сам эндпоинт батчит (3 запроса, не N+1), но без потолка | добавить `take`/представление только активных |
| 26 | мелочь | (валидация отчёта) | `src/modules/reports/application/commands/report-validation.service.ts:177` | `sitePilePlan.findMany` с `include: pileGrade` без `take` | планов на объект обычно десятки; но включает полную марку | `select` нужных полей |
| 27 | мелочь | `GET /api/equipment` (косвенно) | `src/modules/equipment/application/queries/equipment-query.service.ts:15` (`getAccessibleEquipment`) | `equipment.findMany` `[full]` без `take` | сам по себе список парка; вызовы этого хелпера в других путях не пагинированы | ограничить `select` |
| 28 | мелочь | (карточка/списки техники) | `src/modules/equipment/application/queries/equipment-query.service.ts:48` | `equipment.findMany` с `include: crews` без `take` | включение бригад на всю технику; растёт с историей бригад | `take` на `crews` |
| 29 | мелочь | `GET /api/checklist-templates` | `src/modules/inspections/application/queries/template-query.service.ts:10` | `checklistTemplate.findMany` с `include: sections` без `take` | словарь шаблонов, обычно малый; включение секций | норм для словаря, следить за ростом |
| 30 | мелочь | (реконсиляция отчёта) | `src/modules/reports/infrastructure/report.repository.ts:158` | `findMany` с `include: passport` без `take` | ограничено числом строк отчёта; связано с #1 | см. #1 |

## Не проверено

- **Реальные плановые числа и время ответа.** Замеров на живых данных
  (`EXPLAIN ANALYZE`, нагрузочный прогон) не делалось: локальная БД/прод
  недоступны, профилировщик не запускался. Все оценки роста — из чтения кода,
  статус — ГИПОТЕЗА, не ПРОЙДЕНО.
- **Фактические объёмы** (сколько сейчас строк в `Report`, `PileWork`,
  `AuditLog`, `ReadinessScoreSnapshot`, сколько единиц техники в парке) — не
  смотрел: подключение к БД запрещено правилами (AGENTS.md §1).
- **Полнота сканера циклов.** `scan2.cjs` ищет `for`/`while` с `await` в теле
  по балансу `{}`. Не покрыты: циклы без фигурных скобок в одну строку,
  рекурсия, N+1 через `.map()` с вспомогательной функцией, делающей запрос
  внутри (такие в коде не найдены, но формально гарантии нет). Значит, что
  список категории A может быть неполон — но найденное воспроизводимо.
- **Фоновые воркеры и крон** (`pm-scheduler`, `scheduler`, `projection-worker`,
  `backfill`) — читал код вызова, но не проверял, с какой периодичностью и на
  каком парке они реально крутятся в проде.
- **Маршруты `src/app/api/orion/**` и операторские варианты экранов** — по
  правилам задачи пропущены (замороженные области).
- Влияние на **RLS/tenancy** в затронутых путях не пересматривал (вне темы
  N+1); найденные места tenancy не ослабляют.
