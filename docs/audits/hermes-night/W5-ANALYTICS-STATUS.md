# W5-ANALYTICS-STATUS: ReportAnalytics.status не равен Report.status

READ-ONLY. Существующие файлы не менялись; создан только этот документ.
Рабочая копия: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`, HEAD `bb4c4d09`. `git status` — чисто на момент чтения.
Источник находки: `D:/PillingR/qa/runs/FULL-20261006-1211/{report.md,tasks.md}` (пункт 12 таблицы / `D-20261004-002`), база обхода — `pilingtrack_test` (report.md:4).

## Итог

- Находок 6: **критично — 0, важно — 4, мелочь — 2**. Дефект подтверждён по коду и по данным, но не критичен: расходится 1 строка из 268, потери данных нет.
- Расхождение воспроизведено в локальной БД (`pilingtrack_test`): `Report=submitted / ReportAnalytics=draft` ровно у одной записи — `RM-3190cede-2026-09-28` (Report.submittedAt `2026-10-01T06:24:00.240Z`, analytics.status `draft`, analytics.createdAt `2026-10-01T06:24:01.906Z`).
- Топ-5:
  1. **важно** — `ReportAnalytics.status` меняется ТОЛЬКО обработчиками `ReportCreated`/`ReportSubmitted`; на `ReportUpdated` обработчик не подписан (только сброс кэша) — сдача через круг событий, где `ReportSubmitted` не дошёл, оставляет `draft` навсегда (`src/services/reports/event-handlers.ts:29-47,86-112`).
  2. **важно** — при неразрешённых `siteId/userId/tenantId` обработчик делает `return`, не бросая исключение, а outbox всё равно помечает событие `published=true` → нет ни ретрая, ни DLQ, дрейф молчит (`event-handlers.ts:79-84` против `outbox-publisher.ts:147-168`).
  3. **важно** — событие может попасть в «пустоту» при гонке регистрации обработчиков: события до `registerAllEventHandlers()` теряются (лог warn), но всё равно помечаются `published` (`src/workers/unified-worker/outbox.ts:26-40`, `domain-events.ts:86-95`).
  4. **важно** — отчёты смены заводятся через `ensureReport` вообще без события outbox, поэтому их проекция статуса целиком зависит от позднего `ReportSubmitted` (`src/modules/operator-mobile/application/commands/shared.ts:388-412`).
  5. **мелочь** — предохранительная перестройка (`projection-rebuild-scheduler.ts:27-53`) должна была вылечить строку (пишет `status` из `Report`), но на 06.10 строка всё ещё `draft` — прогон в этой среде не подтверждён.

**Вердикт: дефект** (рассинхрон проекции; `ReportAnalytics.status` по замыслу зеркалит `Report.status` — это прямо делают и обработчик на сдаче, и полная перестройка). Не «так задумано» и не «ошибка теста»: расхождение независимо воспроизведено SQL-запросом, а не только в UI обхода.

## Методика

Python нет, использованы `read_file`/`search_files`/`terminal`/`git` и локальный Postgres через `pg` из `node_modules`.

1. Прочитан `AGENTS.md` (модель доверия, заморозка вариантов оператора/ORION, «выглядит мёртвым, но живёт»). Замороженные экраны не читались.
2. Загружены скиллы `pilingtrack-architecture-contract` (outbox→projections→read-models) и `pilingtrack-proof-and-analysis-toolkit` (рецепт «projection-completeness», вердикт CONFIRMED/REFUTED/DOWNGRADED).
3. Прослежен путь статуса: поиск `reportAnalytics.(upsert|create|update|deleteMany)` по `src/` — ровно 3 точки записи. Прочитаны целиком: `src/services/reports/event-handlers.ts`, `src/services/reports/outbox-publisher.ts`, `src/modules/reports/application/projections/projection-worker.ts`, `.../projections/rebuild.ts`, `src/workers/unified-worker/outbox.ts`, `src/modules/reports/infrastructure/report.repository.ts`, `src/modules/reports/application/commands/report-command.service.ts`, `src/modules/reports/domain/report.aggregate.ts`, `src/modules/operator-mobile/application/commands/shared.ts` (фрагм.), `src/modules/operator-mobile/application/commands/shift-close.ts` (фрагм.), `src/modules/readiness/application/scheduler.ts` (фрагм.), `src/services/reports/domain-events.ts`, `src/app/api/admin/projections/rebuild/route.ts`, `scripts/backfill-report-analytics.sql`.
4. Сверено с текущим `origin/main` (ветка отстаёт на 63 коммита): `git show origin/main:src/services/reports/event-handlers.ts` и `.../rebuild.ts` — логика идентична рабочей копии; `git show 56893709:.../event-handlers.ts` (сборка обхода) — тоже идентична.
5. SQL выполнен только на чтение. **Важно для воспроизведения:** в БД включён `FORCE RLS` с политикой `"tenantId" = current_setting('app.current_tenant', true)`, поэтому запрос без `set_config('app.current_tenant','orion',false)` возвращает 0 строк (первый прогон дал ложные нули — это ловушка метода, а не «пустая база»). `OutboxEvent` под RLS не находится — его строки видны и без контекста.
6. §6-команды (`tsc/lint/test/build`) **не запускались**: правок кода/тестов нет, единственная запись — этот `.md`; сборка/тесты к исследованию статуса ничего не добавляют.

Перезапуск проверки расхождений:
```sql
SET app.current_tenant = 'orion';   -- иначе RLS вернёт 0
SELECT count(*) FROM "Report" r JOIN "ReportAnalytics" a ON a."reportId"=r."reportId" WHERE r.status<>a.status;
-- ожидаемо 0; сейчас 1
```

## Находки

| # | важность | путь:строка | проблема | сценарий / почему важно | что предложить |
|---|----------|-------------|-----------|--------------------------|----------------|
| 1 | важно | `src/services/reports/event-handlers.ts:29-47,86-112` | `ReportAnalytics.status` выставляется только по `ReportCreated` (→`draft`) и `ReportSubmitted` (→`submitted`); `ReportUpdated` подписан на сброс кэша (`:44-46`), но НЕ на проекцию. В `update`-ветке статус вообще не трогается для прочих событий (`:100`). | Любой путь, где `ReportSubmitted` не дошёл до обработчика (тихий пропуск, потеря события, сдача без события), фиксирует `draft` и ничем не исправляется. Ровно наблюдаемый случай: `Report=submitted`, `ReportAnalytics=draft`. | Брать `status` из строки `Report` (единственный источник истины), а не из типа события; либо добавить `on(REPORT_UPDATED, handleReportForAnalytics)`. |
| 2 | важно | `src/services/reports/event-handlers.ts:79-84` против `src/services/reports/outbox-publisher.ts:147-168` | При неразрешённых `siteId/userId/tenantId` обработчик пишет `logger.warn` и `return` — БЕЗ исключения. Outbox помечает строку `published=true` (dispatch-then-claim) независимо от результата. | Событие считается обработанным: `attempts=0`, `lastError=null`, DLQ пуст — но проекция не записана. Дрейф витрин молчит и не само-лечится. Это единственный кодовый путь, объясняющий наблюдаемое `published/projected=true, attempts=0` при `status=draft`. | Бросать ошибку в этой ветке (тогда outbox уйдёт в ретрай/DLQ), а не `return`. |
| 3 | важно | `src/workers/unified-worker/outbox.ts:26-40`; `src/services/reports/domain-events.ts:86-95` | Комментарий прямо документирует гонку: события, отправленные до `registerAllEventHandlers()`, уходят «в пустоту» (шина логирует `warn`, обработчиков нет), но outbox-цикл всё равно проставляет `published`. | После рестарта воркера первые (в т.ч. ровно один «наш») `ReportSubmitted` могут не дойти до аналитики без ретрая — согласуется с изолированным характером расхождения (1 из 268). | Регистрировать обработчики синхронно до старта цикла (уже частично сделано) и не помечать `published`, если шина не нашла обработчиков. |
| 4 | важно | `src/modules/operator-mobile/application/commands/shared.ts:388-412` (`ensureReport`) | Отчёт смены заводится через `tx.report.upsert` и НЕ пишет ни одного события outbox (в отличие от `report.repository.ts:46-72` — `mapEventsToOutboxData`). | У таких отчётов (создаются на экране смены) строки `ReportAnalytics` появляются только из перестройки или из позднего `ReportSubmitted` при закрытии смены; событийного «создания» проекция вообще не видит, и статус держится исключительно на обработчике сдачи. Отсюда — класс дефекта. | Либо писать событие создания отчёта в той же транзакции, либо в обработчике сдачи всегда сверяться со `Report.status`. |
| 5 | мелочь | конкретная запись: `OutboxEvent cmup5f61j001hqcw5eclck2tv`; `RM-3190cede-2026-09-28` | Строка расхождения: `Report.status=submitted`, `submittedAt=2026-10-01T06:24:00.240Z`; `ReportAnalytics.status=draft`, `createdAt=2026-10-01T06:24:01.906Z`, `lastEventAt=2026-09-28T20:11:33.897Z` (=`Report.createdAt`). Событие `ReportSubmitted` (payload `{siteId,userId,tenantId,autoClosed:true,totalPiles:21,…}`) — `published=true, projected=true, attempts=0, lastError=null, publishedAt=2026-10-01T06:24:01.951Z`. | Смена открыта 28.09, отчёт заведён на экране смены (без события), автозакрыта планировщиком 01.10; событие сдачи обработано «успешно», но статус проекции остался `draft`. `lastEventAt` = времени создания отчёта, т.е. строка отражает состояние «черновик», а не сдачу. | Вылечивается перестройкой: `POST /api/admin/projections/rebuild?name=report-analytics` (пишет `status` из `Report`, `rebuild.ts:187-230`). Причину «почему именно эта строка» доказать по коду не удалось — см. «Не проверено». |
| 6 | мелочь | `src/workers/unified-worker/projection-rebuild-scheduler.ts:27-53`; `rebuild.ts:217,222` | Ежедневная предохранительная перестройка (`rebuildAll`, в т.ч. `rebuildReportAnalytics`) ставит `status` прямо из `Report.status` и должна была вылечить строку. На 06.10 (5 суток после 01.10) строка всё ещё `draft`. | Значит, само-лечение не сработало в этой среде: либо планировщик не запущен, либо интервал/тайминг иные — тревожный сигнал для мониторинга проекций. | Проверить, что `startProjectionRebuildScheduler()` реально стартует в воркере, и добавить метрику/алерт «число расхождений r.status≠a.status». |

Отдельно (не дефект задачи, зафиксировано попутно): в БД на 268 `Report` приходится 272 `ReportAnalytics` — 1 отчёт (черновик `RM-95cd98f5-2026-10-04`, без `submittedAt`) не имеет строки проекции вовсе, и 5 «осиротевших» строк аналитики без отчёта (легаси-дрейф ключа, чинился в `899cecf`). Непубликованных/непроецированных `ReportSubmitted` — 0; в DLQ — только Telegram-доставки.

## Не проверено

- **Точная причина конкретной строки.** Значение `ReportAnalytics.lastEventAt` этой записи в точности равно `Report.createdAt` (не `updatedAt` и не времени события). Ни один из трёх писателей проекции (`event-handlers.ts:86-112`, `rebuild.ts:210-226`, `scripts/backfill-report-analytics.sql`) не пишет в `lastEventAt` время создания отчёта, а события outbox с таким `occurredAt` (28.09 20:11:33) в таблице нет. Как строка получила именно это значение — доказать не удалось; выводы №1–№4 опираются на код, а не на реконструкцию этой строки.
- **Рантайм.** Сервер не поднимался, логи воркера не читались; «тихий пропуск» (находка №2) и гонка регистрации (№3) подтверждены чтением кода, но не наблюдением.
- **Планировщик перестройки** (находка №6): запускается ли `startProjectionRebuildScheduler()` в этой среде и когда был последний прогон — не проверено (таблиц/ключей heartbeat для него не нашёл).
- **§6-команды** (`tsc`, `lint`, `test`, `playwright --list`, `build`) не запускались: правок кода нет, документ — единственная запись.
- **Историчность кода**: работа шла на обнаруженном диске, но данные накапливались месяцами разными сборками; сверены только `origin/main` и `56893709` (сборка обхода) — совпадают с копией. Промежуточные сборки, которыми могли писаться строки в сентябре–октябре, не сверялись.
