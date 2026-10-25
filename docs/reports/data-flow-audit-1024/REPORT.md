# Проверка движения данных, транзакций и отчётов PilingTrack

Дата: 24.10.2026. Текущий main ac04641c95bdc70c40ba13d0a7982ed996c7a689, дерево чистое. Ветка codex/data-flow-audit-1024. Исправления приложения не выполнялись.

## Результат и граница доказательств

Найдены две воспроизводимые ошибки алгоритма проекций (DF-01/02), два статических разрыва доставки/порядка (DF-03/04) и известные ограничения Telegram/телеметрии. «Утечка» здесь различается: потеря/искажение потока и разглашение чужих данных. Нового подтверждённого разглашения данных в этом проходе не установлено; это не заключение безопасности всех endpoint.

Синтаксическая инвентаризация исходников: 63 реальных вызова $transaction, 62 вызова обёрток/командного конвейера (включая реализацию обёрток), 35 прямых вызовов изменения Report/OutboxEvent. Это места вызова, не число транзакций за запрос и не полное доказательство всех runtime-ветвей. Реестр приложен: transaction-inventory.json, transaction-wrappers.json, report-writers.json. Колонки audit/outbox — текстовые признаки внутри callback, false не доказывает отсутствие аудита: он может быть в вызываемом helper. Raw SQL, алиасы и вложенные порты требуют source trace.

Подробно прослежены отчётные записи web/mobile/автозакрытие, repository+outbox, обработчики дневных/недельных/ReportAnalytics сводок, удаление, PDF/CSV/XLSX и карточка техники. Сопоставлены транзакционные границы остальных доменов и их роль в готовности/учёте. Полное ручное доказательство каждого callback и всех security-путей не заявляется. Изучение кода не доказывает наличие этих ситуаций в production.

## Карта: откуда и куда идут отчёты

| Источник/команда | Постоянный факт | Получатели и преобразования | Тест/пробел |
|---|---|---|---|
| /api/reports/upsert, admin-upsert/edit → upsertReport | Report + работы/простои + ReportVersion + обязательный аудит + outbox в tx | Списки/история, CSV/XLSX/PDF; ReportUpdated/Submitted → сводки | report-command-service, post-audit, repository/reconcile unit; disposable-report-race: web/web, сохранение корректировки; отдельный web/mobile HTTP race нужен |
| operator commands production/corrections | ensureReport, строки выработки, bumpReportVersion в внешней командной tx | Журнал забивки читает строки; сдача запускает сводки | production/corrections/shift-close unit; проверка реальной rollback всей команды нужна |
| submit из shift-close | submitted Report + снимки + outbox ReportSubmitted | Дневная/аналитическая проекция, задача Telegram PDF | shift-close.test: 23 passed в этом прогоне; полная HTTP→worker→PDF проверка не запускалась |
| readiness scheduler автозакрытие | submitted drafts + outbox autoClosed | Сводки и уведомление об автоматическом закрытии | scheduler tests существуют; межканальный конкурентный сценарий отдельно |
| /api/reports/delete | удаление + before в ReportDeleted outbox одной tx | immediate best-effort очистка ReportAnalytics/пересчёт дня; недельный consumer | DF-04: durable delete-событие не восстанавливает неуспешный дневной пересчёт |
| outbox published → emitDomainEvent | published независимо от projected, retry/DLQ | ReportAnalytics, SiteDailySummary, cache invalidation, доставка | outbox-publisher.dlq.test: 3 passed; разные флаги не гарантируют порядок между consumers |
| outbox projected → projection-worker | SiteWeeklyTrend из SiteDailySummary; readiness consumer | /api/admin/analytics/site-weekly-trend, тренды | weekly concurrency test: 1 passed; DF-03 касается порядка двух consumers, этого теста недостаточно |
| Report/дочерние строки → report-export.service | файл CSV или XLSX | пользователь скачивает; draft помечен, числовые и формульные ячейки обработаны | export-reports-csv.test и related export tests; этот прогон их не запускал |
| PileWork + PilePassport → pile-journal-list/totals/export | список/итоги/.xlsx журнала забивки | /api/pile-passports и export, решение по паспорту с audit tx | journal/паспорт tests существуют; сверка списка+итогов+экспорта на коррекциях/границе лимита нужна |
| PDF sync / BullMQ pdf-generation | артефакт в S3 либо локальном storage | status/download API, пользователь | renderer tests есть; разные файловые пространства worker/app и отказ storage отдельно |
| ReportSubmitted → ReportPdfDeliveryRequested | outbox с dedupeKey на событие | deliverReportPdf читает текущую редакцию, генерирует и шлёт Telegram | unit/интеграции доставки частично; PDF не является неизменным снимком исходного события |
| Топливо ЕО/manual + telemetry | FuelLog/MeterReading/TelemetryRecord | единый resolver liters/source/quality, журнал/аналитика | fuel-contract integration и unit; качество unknown не превращать в ноль |
| Осмотр→дефект→заявка ТО | completeInspectionWithOutcome + recordDefectInTx, snapshot request | готовность, наряд, мониторинг, export | ADR-0053 сохраняет tx; интеграционные tech-readiness-* есть, фактический PG прогон здесь не выполнен |
| users/docs/safety/sites/settings/layout | свои tx, обязательный либо явно best-effort аудит, версии/ограничения | допуск, справочники, UI, настройки отправки | инвентарь callback приложен; нельзя считать отсутствие outbox дефектом там, где отдельный потребитель не предусмотрен |

Под «все отчёты» в карте перечислены выявленные кодовые семейства, не каждый визуальный вариант экрана. Экспорт готовности, журнал ТО и инструктажей имеют отдельные endpoints /api/readiness/export, /api/to/journal и /api/briefings/journal; их полная побайтовая сверка с UI не выполнена. Одинаковое поле в разных файлах не означает одинаковый фильтр: draft/submitted, период/часовой пояс, correction и лимиты нужно включать в контракт сверки.

## Находки

### DF-01 — P1: дневной итог может вернуться к старым данным

Источник: src/modules/reports/application/event-handlers.ts:212–244. recomputeSiteDailySummary сначала читает Report, затем отдельно deleteMany/upsert SiteDailySummary. Общего tx/lock на site+date нет. Вызов старого пересчёта может прочитать 5 свай, новый — 9; новый пишет 9, старый позднее пишет 5. Основные строки сохранены, но потребители дневной/недельной сводки видят заниженный факт.

Воспроизведение: reproduce.cjs выполняет настоящую функцию после TS-transpile, DB mock управляет порядком. Итог: 9→5. Exit 0 означает, что harness подтвердил ошибочное поведение; это не успешная проверка корректности. Реальный PG/два HTTP-процесса не проверены.

Нужный тест: в existing daily-summary.test.ts два конкурирующих пересчёта; ожидается финальный актуальный итог. Затем PG integration с барьером между чтением и записью, включая вариант старый delete после нового upsert. Исправление: согласованный lock на site+date ДО чтения и запись через тот же tx; учесть rebuild и delete, а не чинить только один entrypoint.

### DF-02 — P2: повтор старого события откатывает числа ReportAnalytics

Источник: event-handlers.ts:59–155. handleReportForAnalytics читает текущий status из Report, но числа берёт из event.data. Upsert не сравнивает aggregate version/lastEventAt. После события 9 свай более старое 5 записывает totalPiles=5 и передвигает lastEventAt назад. Возможен retry ранее упавшего события после более свежего либо повтор обработки.

Воспроизведено настоящим зарегистрированным обработчиком с DB mock: 12:00/9 → 11:00/5. Последняя сохранённая проекция 5. В карточке техники source-first уменьшает влияние, но при полностью пустых строках используется fallback к ReportAnalytics (equipment-query.service.ts:124–148). Поэтому очистка всех работ может временно показывать прежние числа. Не все экраны читают эту проекцию.

Нужный тест: existing daily-summary.test.ts — новая редакция затем старая, повтор одного события, полное удаление работ. Решение: пересчёт из текущего источника с защитой порядка записи либо атомарный version gate; timestamp без строгой версии не всегда достаточен. Проверить потребителей прежде изменения контракта.

### DF-03 — P2, статический риск: неделя считается раньше обновления дня

Источник: outbox-publisher.ts:100–174, projection-worker.ts:118–142, projection-handlers.ts:91–100. Published и projected работают независимо. Недельный consumer читает SiteDailySummary, даже если published consumer ещё не пересчитал день этого же события. Затем оба флага true, но день свежий, неделя старая. Lock недельного тренда защищает два недельных пересчёта, а не порядок «день→неделя».

По коду есть исправляющие механизмы: часовой пересчёт только текущей недели, full rebuild после старта и раз в сутки в unified worker. Они снижают длительность рассогласования при работающих задачах, но не являются подтверждением своевременной доставки. Для прошлой недели часовой пересчёт не помогает. Runtime воспроизведение не проводилось.

Нужный integration test: приостановить published, выполнить projected, затем published, проверить прошлую неделю. Нужна причинная связь day-updated→week-update либо пересчёт недели из source; выбранный вариант проверить с DF-01 и rebuild.

### DF-04 — P1, статический разрыв: неуспешный пересчёт после удаления не восстанавливается этим событием

Источник: src/app/api/reports/delete/route.ts:73–170; registerAnalyticsEventHandler в event-handlers.ts:29–51. Report удаляется и ReportDeleted сохраняется атомарно. Но удаление ReportAnalytics и recomputeSiteDailySummary идут ПОСЛЕ commit в best-effort try/catch. ReportDeleted подписан на cache invalidation, не на durable daily cleanup. Если процесс упадёт сразу после commit или БД откажет на этой стадии, исходный отчёт уже удалён, день может содержать прежний вклад; weekly consumer способен прочесть этот вклад и завершиться.

Это не утверждение об исчезновении всей истории: before есть в outbox, работает плановый rebuild. Но гарантии «успешное удаление доведёт день до состояния источника через retry события» нет. Runtime crash/PG reproducer не запускался.

Нужный тест: crash/error после commit, затем обычный replay ReportDeleted, без ручного rebuild; ожидается удаление вклада, analytics и корректная неделя. Пересчёт по siteId/date из delete envelope нужен в retryable handler; before/audit не терять. Отдельно не менять принятую владельцем политику best-effort аудита без задания.

## Известные ограничения, которые не выдаются за новые дефекты

- Telegram alert и PDF держат DB transaction до 60с при сетевой отправке. Потеря ACK после фактической отправки может дать дубль; Redis dedupe не гарантирует exactly-once. Это уже исследовалось задачей B. Нужно расширять tests/integration/notifications, отдельно покрыть PDF и receipts по адресатам; повторный RED такой задачи не является новой находкой.
- PDF читает актуальную редакцию при доставке. Старые pending события coalesce; это не потеря исходных строк ReportVersion и не автоматически баг. Нужен утверждённый контракт, какой документ требуется получателю.
- Telemetry buffered ACK — RAM/best effort, SIGKILL теряет неподтверждённый БД буфер; device ingest после createMany имеет другую гарантию. Process/PG harness существует в src/services/telemetry/__tests__/run-reliability-disposable.sh. Его зелёный duplicate-case характеризует отсутствие дедупликации, не защиту. Здесь не запускался.
- Отсутствие подписчика у некоторых item-events намеренно; чтение идёт из источника или другим consumer. Не считать каждый warn «No handlers» потерей.
- acceptMaintenance best-effort audit — принятое исключение. ADMIN/DISPATCHER platform-wide — принятое поведение, не новая tenant-утечка.

## Тесты и приоритет

Реально запущен node node_modules/vitest/vitest.mjs run с пятью файлами: daily-summary.test.ts (33), outbox-publisher.dlq.test.ts (3), projection-handlers.concurrency.test.ts (1), operator production.test.ts (27), shift-close.test.ts (23). Cwd D:/PillingR/my-project, SHA ac04641c; тесты читают этот код, DB mock, артефакты вывода в этом worktree. Exit 0: 5 файлов, 87 passed, 0 skipped, 0 failed. Vite предупредил о будущем configLoader native; на текущий результат не повлияло.

Зелёные 87 не доказывают межпроцессную доставку. Новые проверки DF-01–04 нужны: они защищают существенные связи и способны поймать реальную регрессию. Предпочтительно расширять имеющиеся файлы, не создавать отдельный suite на каждую функцию. Проверки простых реэкспортов или повторяющие реализацию не нужны.

Приоритет: (1) DF-01 и retryable delete DF-04; (2) причинный порядок день→неделя; (3) monotonic ReportAnalytics; (4) реальный web/mobile save+close+correction→journal→CSV/XLSX/PDF contract, fault matrix Telegram и telemetry ACK. Для cross-channel теста нужен один synthetic набор и сверка чисел/единиц/версии на всех получателях, а не просто HTTP 200. Отдельно проверить ночь/часовой пояс, submitted/draft, отрицательные corrections, пустой источник и pagination/export limits.

## Проверки и ограничения

reproduce.cjs: node docs/reports/data-flow-audit-1024/reproduce.cjs D:/PillingR/my-project — exit 0, оба ожидаемых дефекта воспроизведены на mock. Harness находится в документах, не добавлен в штатный unit suite. Два первых запуска временного harness не выполнились из-за ESM interop TypeScript; исправлена загрузка через createRequire. Финальная команда воспроизводится из сохранённого файла.

GitNexus: старый индекс на той же программной основе показал behind на Markdown-коммите, поэтому построен свежий индекс этого worktree. Анализ завершился exit 0. Общие flows ограничены бюджетом, property-call связи могут быть ложными; source trace имеет приоритет. Query/context использованы для дневной/недельной цепи. До прикладных правок нужен отдельный impact; здесь функции не редактировались.

Полные tsc, lint, test:unit, playwright --list, build по AGENTS §6 не запускались: код приложения не изменён, выполнен targeted audit. Их exit/counters не заявляются. PG integration, browser E2E, production, физические устройства и реальный Telegram не проверялись. Новых dependencies, схемы, auth/RLS, operator/ORION, .env и production действий нет. Исправления не коммитились вместе с аудитом.

Изменены только отчёт, три реестра и воспроизводящий harness. Push/merge/deploy не выполнялись. Проверки документа и хеш локального коммита сообщены в финальном ответе; полный лог targeted tests в ignored output/data-flow-audit/targeted-tests.log.

Проверки артефактов: node --check reproduce.cjs exit 0; node scripts/check-text-integrity.js exit 0; git diff --cached --check exit 0; GitNexus detect_changes exit 0, risk low, 5 files, 31 символ harness, без partial/truncated. Индексация и targeted tests завершены, main status чист.
