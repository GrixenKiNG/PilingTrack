# PilingTrack: структура, качество модулей и развитие

Дата: 23.10.2026. Worktree: `D:/PillingR/wt-module-fixes-1022`, ветка `codex/app-completion-1022`, HEAD на старте обзора `551e9f4c9797e2ed97a64016af12baf20dd4189c`. Часть рабочей копии меняется основным агентом; это обзор прочитанного среза, а не подписанный release manifest.

## Независимый структурный обзор: вывод и предел уверенности

Это предметно насыщенный модульный монолит с сильным транзакционным ядром. Ценность проекта — связка «допуск человека и установки → смена → выработка/паспорт → отчёт → доказательства и уведомления». Папка modules сама по себе не делает контексты независимыми: несколько модулей координируют одни таблицы и взаимно импортируются.

Осмотрены публичные entrypoints всех 17 модулей, ключевые domain/application/infrastructure реализации каждого, фасад telemetry и его фактическая реализация в services, DB/API/worker/outbox/leader/storage, четыре workflow. Это выборочное чтение ключевых путей каждого модуля, не построчный аудит всех файлов и маршрутов. `__tests__` не использованы для выставления баллов. В этой фазе **не запускались** npm, сборка, тесты, БД, browser или production. Числа предыдущего QA не выдаются за результаты структурного обзора. Основной агент сообщил build/lint exit 0; независимо здесь это не повторялось.

Пять исправлений R1–R5 не считаются открытыми дефектами. Замечания ниже — ограничения архитектуры/доказательств или кандидаты для отдельного воспроизведения; это не новый список подтверждённых багов. Production, credentials и `.env*` не читались. Разрешённый артефакт — только этот файл.

GitNexus ранее выполнен с явным `--repo D:/PillingR/wt-module-fixes-1022`; индекс сообщил `behind: 5`. Read-only обзор его не перестраивал. Для текущих связей использованы прямые импорты и исходники; нулевые процессы старого индекса не трактуются как отсутствие влияния.

## Стек и эксплуатационная форма

По прочитанному [package.json](D:/PillingR/wt-module-fixes-1022/package.json:1): Next.js `^16.4.1`, React `^19.2.5`, TypeScript `^6`, Tailwind 4, Radix UI, Zustand, Zod 4; Prisma 7.8 + adapter-pg, pg; BullMQ 6 + ioredis 6; AWS S3 SDK, PDFKit, Sharp, Sentry. Это диапазоны manifest, **не подтверждённые версии установленного runtime**; package и lock менялись основным агентом во время QA.

[db.ts](D:/PillingR/wt-module-fixes-1022/src/lib/db.ts:1) поддерживает PostgreSQL, ленивый Prisma client, transaction-local tenant context и default ReadCommitted. База не «универсальная SQLite/Postgres»: SQLite-ветка в system — остаточная совместимость. HTTP — Next route handlers и [api-wrapper.ts](D:/PillingR/wt-module-fixes-1022/src/core/api-wrapper.ts:62), домен в modules, инфраструктура в core/lib, сохранённые shared/legacy реализации в services. [next.config.ts](D:/PillingR/wt-module-fixes-1022/next.config.ts:5) задаёт standalone и строгие ошибки типов; production build явно webpack. Это не повод менять bundler без проверки CSP.

По [docker-compose.yml](D:/PillingR/wt-module-fixes-1022/docker-compose.yml:237) заданы PgBouncer, PostgreSQL 18, отдельные Redis state/cache и MinIO; app/workers разделены. [Dockerfile](D:/PillingR/wt-module-fixes-1022/Dockerfile:75) и [Dockerfile.workers](D:/PillingR/wt-module-fixes-1022/Dockerfile.workers:59) используют runner stages, непривилегированного пользователя и healthcheck. Внешний reverse proxy/фактические версии/ресурсы production здесь не проверялись.

[unified-worker.ts](D:/PillingR/wt-module-fixes-1022/src/workers/unified-worker.ts:1) запускает outbox/projection/PDF и планировщики в отдельном процессе; [leader-election.ts](D:/PillingR/wt-module-fixes-1022/src/core/infrastructure/leader-election.ts:29) использует owner-token Redis lease. Outbox — at least once, а не exactly once: [outbox-publisher.ts](D:/PillingR/wt-module-fixes-1022/src/modules/reports/application/outbox-publisher.ts:95) прямо требует идемпотентности обработчиков. PDF — BullMQ, файлы — [s3-service.ts](D:/PillingR/wt-module-fixes-1022/src/core/storage/s3-service.ts:54).

## Оценки 17 модулей

Шкала — субъективная инженерная оценка по пяти наблюдаемым критериям 0–2: **Д** — ясность доменных правил; **Т** — целостность, версии и повторы; **Г** — границы/связность; **Н** — наблюдаемость и поведение отказа; **П** — подтверждённость полного пути. Формат после балла: Д/Т/Г/Н/П. По П здесь максимум 1: код и предусмотренные проверки видны, live путь в этой фазе не выполнялся. 10/10 требует результата эксплуатации и приёмки, а не дополнительных слоёв. Уверенность всех баллов — средняя по устройству кода, низкая по production; разумная погрешность ±1 балл, у telemetry ±2. Сравнивать разницу в один балл как точное измерение нельзя.

| Модуль | Назначение | Сильная сторона | Ограничение и следующий шаг | Балл /10 | Проверенные исходники |
|---|---|---|---|---|---|
| analytics | План/факт объектов, парк, простой и выработка. | SQL агрегирует дочерние виды работ отдельно, исключая декартово умножение; период отделён от накопительного прогресса. | Крупные SQL-запросы: стоимость общих/all-time подзапросов зависит от объёма истории. EXPLAIN и бюджет времени не измерены. | 7 (2/1/2/1/1) | [site-analytics-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/analytics/application/queries/site-analytics-service.ts:58); [equipment-analytics-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/analytics/application/queries/equipment-analytics-service.ts:56) |
| audit | Читаемый след действий и история сущностей. | Единый каталог описаний, ограниченная история и счётчик потерь записи. | recordAuditEvent пишет в FeedbackEvent после действия и гасит сбой: это best effort, не транзакционный доказательный журнал. У reports/readiness иные механизмы. | 6 (1/1/1/2/1) | [audit-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/audit/audit-service.ts:66); [audit-history-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/audit/audit-history-service.ts:90) |
| crews | Состав бригады, закрепление машиниста, помощников, объекта и установки. | Агрегат, условная запись по loaded updatedAt, outbox и roster в одной транзакции; расформирование мягкое. | Проверка одной активной бригады на установку выполняется предварительным чтением. Нужна отдельная гарантия/демонстрация параллельного назначения; это кандидат, а не воспроизведённый дефект. | 7 (2/1/1/2/1) | [crew-command.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/crews/application/commands/crew-command.service.ts:39); [crew.repository.ts](D:/PillingR/wt-module-fixes-1022/src/modules/crews/infrastructure/crew.repository.ts:30) |
| equipment | Карточка и паспорт техники, документы, ТО, регламенты, моточасы, топливо. | ТО связано с регламентом; журнал показаний и готовность обновляются общими командами. Карточка имеет путь с блокировкой и expectedUpdatedAt. | Агрегат описывает лишь базовую карточку; инварианты обслуживания/метаданных находятся в отдельных командах. Два пути updateEquipment имеют разные гарантии версии. | 7 (2/1/1/2/1) | [equipment-command.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/equipment/application/commands/equipment-command.service.ts:21); [maintenance-regulation.ts](D:/PillingR/wt-module-fixes-1022/src/modules/equipment/application/commands/maintenance-regulation.ts:76); [equipment.repository.ts](D:/PillingR/wt-module-fixes-1022/src/modules/equipment/infrastructure/equipment.repository.ts:11) |
| inspections | ЕО/ТО, шаблоны обхода, ответы, фото, дефекты и завершение обслуживания. | Снимок композиции блоков, чистые правила полноты/оценки; завершение условное по версии, side effects в транзакции. | Команда завершения координирует много сущностей и соседних модулей; изменение требует матрицы сценариев фото/дефект/ТО/показание/повтор. | 8 (2/2/1/2/1) | [block-composition.ts](D:/PillingR/wt-module-fixes-1022/src/modules/inspections/domain/block-composition.ts:1); [inspection-logic.ts](D:/PillingR/wt-module-fixes-1022/src/modules/inspections/domain/inspection-logic.ts:49); [inspection-commands.ts](D:/PillingR/wt-module-fixes-1022/src/modules/inspections/application/commands/inspection-commands.ts:352) |
| layout | Сохраняемые раскладки карточек и страниц по организации. | Allow-list поверхностей, валидатор с пределами, цепочка override → base → default; клиентский вход отдельно. | Публичный PersistedTemplate сохраняет только version: тип поверхности затем восстанавливается приведениями (monitoring). Редактор требует проверки сохранения/изображений/адаптивности браузером. | 8 (2/1/2/2/1) | [layout-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/layout/application/layout-service.ts:31); [layout-template.ts](D:/PillingR/wt-module-fixes-1022/src/modules/layout/domain/layout-template.ts:126); [template-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/monitoring/application/template-service.ts:12) |
| monitoring | Сводный парк: выработка, наличие отчёта, рабочее/ремонтное состояние, карточки. | Явно отделяет presence отчёта от состояния техники; единый resolver operational state. | Расчёт фиксирует MSK; агрегирует в Node отчёты за 7 дней и все фото выбранного парка. Допущение о небольшом парке указано в коде, нагрузочная граница не доказана. | 7 (2/1/2/1/1) | [fleet-monitoring.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/monitoring/application/queries/fleet-monitoring.service.ts:29); [fleet-monitoring.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/monitoring/application/queries/fleet-monitoring.service.ts:106) |
| notifications | Надёжная доставка алертов из outbox в Telegram. | Блокировки события и dedupe key, отметки прогресса по чатам, настройка тенанта; ошибки возвращаются в retry/DLQ. | Сетевой send выполняется при открытой транзакции до 60 секунд. При неоднозначном ответе Telegram дубль остаётся возможен и честно описан. | 7 (2/1/1/2/1) | [durable-alert-delivery.ts](D:/PillingR/wt-module-fixes-1022/src/modules/notifications/application/durable-alert-delivery.ts:35); [telegram-delivery-progress.ts](D:/PillingR/wt-module-fixes-1022/src/core/notifications/telegram-delivery-progress.ts:1) |
| operator-mobile | Рабочая смена машиниста/помощника: допуск, осмотры, выработка, инцидент, закрытие. | Чистые фазы отделены от разрешения работать; смена блокируется перед командами, общий путь submitShiftReport, клиентский контракт отделён от БД. | Зависит от readiness/reports/safety/system и напрямую координирует общие таблицы. Полнота offline/replay и работа на настоящем телефоне этим обзором не доказаны; область frozen. | 8 (2/2/1/2/1) | [shift-phases.ts](D:/PillingR/wt-module-fixes-1022/src/modules/operator-mobile/domain/shift-phases.ts:1); [shared.ts](D:/PillingR/wt-module-fixes-1022/src/modules/operator-mobile/application/commands/shared.ts:65); [shift-close.ts](D:/PillingR/wt-module-fixes-1022/src/modules/operator-mobile/application/commands/shift-close.ts:124) |
| readiness | Техническая готовность, допуск к пуску, смены, дефекты и наряды. | Чистый evaluator с captured clock/evidence; version/ETag, hash+idempotency key, chained audit, snapshot/current projection, Serializable retry. | Большой координационный контур и цикл импортов с inspections/equipment. Снимок считает факты при обработке события, а clock — от события: семантику исторического воспроизведения нужно фиксировать отдельно. | 8 (2/2/1/2/1) | [evaluator.ts](D:/PillingR/wt-module-fixes-1022/src/modules/readiness/domain/evaluation/evaluator.ts:35); [execute-command.ts](D:/PillingR/wt-module-fixes-1022/src/modules/readiness/application/command-pipeline/execute-command.ts:56); [project-event.ts](D:/PillingR/wt-module-fixes-1022/src/modules/readiness/application/projection/project-event.ts:26) |
| reports | Сменная выработка, паспорт сваи, история, журнал и выгрузки. | Агрегат + единый repository, version claim, identity reconciliation, транзакционные audit/outbox/version; итог журнала до пагинации. | Мобильный и веб-контуры пишут одну предметную область разными командами. Гарантии их совместимости нужно держать явным контрактом; SQL/проекции/экспорт увеличивают число читателей. | 8 (2/2/1/2/1) | [report-command.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/reports/application/commands/report-command.service.ts:79); [report.repository.ts](D:/PillingR/wt-module-fixes-1022/src/modules/reports/infrastructure/report.repository.ts:112); [reconcile-report-entries.ts](D:/PillingR/wt-module-fixes-1022/src/modules/reports/infrastructure/reconcile-report-entries.ts:12); [pile-journal-totals.ts](D:/PillingR/wt-module-fixes-1022/src/modules/reports/application/queries/pile-journal-totals.ts:37) |
| safety | Охрана труда: ознакомление с редакциями, повторные инструктажи, подписи и матрица допусков. | Один чистый расчёт различает новую редакцию и просрочку повторения; сводка и личный вид используют подтверждённую историю. | Матрица допуска к виду техники пока сознательно справочная, не участвует в пуске. Каталог инструкций живёт в коде; утверждение содержания/редакций — внешняя ответственность. | 7 (2/1/2/1/1) | [briefing-requirements.ts](D:/PillingR/wt-module-fixes-1022/src/modules/safety/domain/briefing-requirements.ts:92); [self-clearance-query.ts](D:/PillingR/wt-module-fixes-1022/src/modules/safety/application/self-clearance-query.ts:63); [equipment-permits.ts](D:/PillingR/wt-module-fixes-1022/src/modules/safety/application/equipment-permits.ts:1) |
| settings | Настройки организации, часовой пояс и уведомления. | Advisory lock на read-modify-write; sanitizer, IANA timezone, перечень реализованных уведомлений. | При сбое чтения признака доставки возвращает true: выбран приоритет отправки, но изменение поведения нужно наблюдать. Сам факт сохранения units/currency не доказывает преобразование всех экранов. | 8 (2/2/2/1/1) | [settings-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/settings/application/settings-service.ts:58); [settings-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/settings/application/settings-service.ts:87); [settings.ts](D:/PillingR/wt-module-fixes-1022/src/modules/settings/domain/settings.ts:120) |
| sites | Объект, планы, иерархия полей/кустов/пикетов, назначения и жизненный цикл. | Версионный repository и outbox; планы сохраняются транзакционно; архивирование защищает незавершённые отчёты. | Параллельно существуют aggregate-команды и admin-команды с прямым Prisma. Общие правила и аудиторский контракт должны проверяться на обоих входах. | 7 (2/1/1/2/1) | [site-command.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/sites/application/commands/site-command.service.ts:35); [site-admin-command.service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/sites/application/commands/site-admin-command.service.ts:79); [site.repository.ts](D:/PillingR/wt-module-fixes-1022/src/modules/sites/infrastructure/site.repository.ts:22) |
| system | Диагностика runtime и технических зависимостей. | Небольшой фасад, отделён от домена; диагностические ответы показывают конфигурацию и состояние rate limiter. | Локальный getReadinessStatus проверяет БД и наличие session config; не доказывает доставку, очереди и storage. Полный health-tracker живёт в core, поэтому этот модуль нельзя считать всей наблюдаемостью. | 6 (1/1/2/1/1) | [system-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/system/application/queries/system-service.ts:21); [system-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/system/application/queries/system-service.ts:57); [health-tracker/index.ts](D:/PillingR/wt-module-fixes-1022/src/core/observability/health-tracker/index.ts:1) |
| telemetry | Приём и чтение будущей телеметрии оборудования. | Тонкий сохранённый фасад; buffer batches по tenant, circuit breaker, счётчики dropped; ключи устройств отделены. | Приём возвращает buffered ID до фиксации; буфер RAM и sampling допускают потери. Лимит/настройка sampling локальны процессу. Не доказана точность, доставка и восстановление от реального прибора. | 5 (1/1/1/1/1) | [index.ts](D:/PillingR/wt-module-fixes-1022/src/modules/telemetry/index.ts:1); [telemetry-ingestion-service.ts](D:/PillingR/wt-module-fixes-1022/src/services/telemetry/telemetry-ingestion-service.ts:179); [telemetry-buffer.ts](D:/PillingR/wt-module-fixes-1022/src/services/telemetry/telemetry-buffer.ts:55) |
| users | Работники, назначения, документы, типы документов и личный допуск. | Безопасные DTO, ограниченные выборки, общий чистый evaluator допуска принимает tx reader для пуска смены. | Жизненный цикл работника, документы и вычисление допуска разделены файлами, но связаны с audit/security/media; изменения требуют согласованности UI и серверного допуска. | 7 (2/1/2/1/1) | [user-service.ts](D:/PillingR/wt-module-fixes-1022/src/modules/users/user-service.ts:23); [user-documents.ts](D:/PillingR/wt-module-fixes-1022/src/modules/users/user-documents.ts:62); [operator-clearance.ts](D:/PillingR/wt-module-fixes-1022/src/modules/users/operator-clearance.ts:103) |

## Связи и циклы

Ниже — смысловой поток, не развёртывание в отдельные сервисы:

```mermaid
flowchart LR
  users --> safety
  users --> readiness
  equipment --> inspections
  inspections --> readiness
  readiness --> mobile[operator-mobile]
  mobile --> reports
  reports --> analytics
  reports --> monitoring
  equipment --> monitoring
  reports --> outbox[Outbox + workers]
  outbox --> notifications
  outbox --> projections[Read models / PDF]
  settings --> notifications
  layout --> monitoring
```

Направление стрелок на рисунке — поток данных/использования в продукте; реальные импорты местами направлены иначе. По просмотренным статическим import/export имеется связная группа:

- `readiness/application/shifts/commands.ts:11` импортирует runtime `diffInspectionStates` из `@/modules/inspections`.
- `inspections/index.ts:4` реэкспортирует команды; `inspection-commands.ts:6–7` импортирует `equipment` и `readiness/server`.
- `equipment/index.ts:10` реэкспортирует обслуживание; `equipment-maintenance.ts:10–11` импортирует `readiness/server`.
- `readiness/server.ts:61` реэкспортирует команды смен, замыкая путь.

Следовательно, **цикл импортов подтверждён**, но ошибка инициализации/падение приложения из этого не следует. Поведение runtime цикла здесь не воспроизводилось. Узкий client/server entry уже есть и полезен; ближайший путь уменьшения связности — давать потребителям чистого правила узкий публичный client/domain контракт, не тянуть через barrel весь command graph. Это предложение для отдельной задачи с impact analysis, не разрешение на массовое переустройство.

Другая сильная зависимость — общий state: mobile/reports пишут Report и его строки, inspections/equipment/readiness — обслуживание и готовность. Поэтому публичные TypeScript entrypoints и layer-check не заменяют контракт владельца записи, версии, неизменности и журнала. Разделение агрегатов не означает раздельные транзакции там, где бизнес требует одного коммита.

Скан всех production `@/modules/...` ссылок (без тестов) также обнаружил `operator-mobile → safety/system/reports/readiness`, `safety/readiness → users`, `monitoring → equipment/layout`, `reports → readiness/settings/notifications/audit`; регулярный поиск не претендует на полную разрешённую сборщиком карту динамических импортов. `core/lib/services` дают дополнительные связи вне этой карты.

## CI и процессы: что хорошо и что ещё доказать

[ci.yml](D:/PillingR/wt-module-fixes-1022/.github/workflows/ci.yml:16) содержит lint, tsc, layer boundaries, migration guard, unit/contract coverage; отдельно workers Docker smoke и настоящие миграции/Postgres/RLS. Это сильнее проверки одного tsc.

[integration.yml](D:/PillingR/wt-module-fixes-1022/.github/workflows/integration.yml:132) собирает disposable HTTP stand, выполняет реальные интеграции и reject missing/skipped сценариев, затем Chromium golden path/roles/layout S3. [nightly-e2e.yml](D:/PillingR/wt-module-fixes-1022/.github/workflows/nightly-e2e.yml:166) добавляет сценарии на нескольких профилях с HTTPS и workers. Это **предусмотренные workflow**, а не подтверждённые в этом обзоре успешные GitHub runs.

[deploy.yml](D:/PillingR/wt-module-fixes-1022/.github/workflows/deploy.yml:36) ограничивает владельца/main, проверяет SHA, задаёт production environment, последовательное переключение поколения и health/version. Конкретный пробел gate: шаг Verify CI запрашивает **только ci.yml** ([deploy.yml](D:/PillingR/wt-module-fixes-1022/.github/workflows/deploy.yml:60)); независимый integration.yml из этого условия обязательным не становится. Branch protection и environment approval settings не читались, поэтому нельзя утверждать, что интеграция обходится в фактическом процессе. Для 10/10 нужен единый список обязательных результатов именно для развёртываемого SHA, включая выбранную браузерную/интеграционную приёмку.

[restore-drill.sh](D:/PillingR/wt-module-fixes-1022/scripts/restore-drill.sh:1) проверяет dump/manifest и восстанавливает только в новый помеченный контейнер, затем проверяет данные/роли. Наличие скрипта и synthetic CI drill ещё не доказывают доступность внешней копии, реальный off-site restore, production RPO/RTO. Их нужно измерять отдельно. Сетевой send Telegram и снимки на настоящем оборудовании также не доказываются PostgreSQL fixtures.

## Самые недооценённые части

1. **Layout** — небольшой код, но сильный ограниченный контракт: реестр допустимых поверхностей + валидаторы + fallback устраняют необходимость делать отдельный редактор на каждый экран. Оценивать его только числом файлов несправедливо.
2. **Settings** — транзакционный merge и корректный timezone влияют на смену, отчёты и уведомления сильнее, чем вид формы настроек. Важно сохранить точную семантику fallback, а не украшать форму.
3. **Inspections и notifications** — основная ценность в исполнении обязанностей: незавершённый обход, дефект, моточасы, ТО и доставка с подтверждениями по получателям. Это реальные доменные и отказные состояния, которые скрываются за простыми экранными названиями.
4. **Users/operator-clearance** — документы являются частью серверного решения о работе; это не второстепенный CRUD справочника.

Самые недооценённые **риски** — взаимное влияние писателей общих таблиц, неполная обязательность раздельных CI workflow и различие «записано/обработано/доставлено». Их не закрывают количество unit-тестов и аккуратное расположение папок.

## Практический путь к 10/10

1. **Согласовать доказуемый release contract:** один SHA, установленные зависимости/образы, обязательные CI/integration/browser checks без скрытых skips, артефакты и owner acceptance. Сначала закрыть неясность deploy gate, а не расширять стек.
2. **Зафиксировать владельцев общих операций:** Report original/correction/passport/version, факт ТО/регламент/показание, допуск человека/пуск смены. Для каждой границы — один воспроизводимый конкурентный и один replay/rollback сценарий в существующем контуре проверок; новые файлы/изменения требуют отдельной согласованной задачи.
3. **Проверить полный рабочий день на реальном телефоне:** все фазы, потеря сети/возврат, повтор отправки, фото, закрытие, веб-правка, журнал, экспорт и уведомление. Frozen экраны не менять без явной задачи владельца. Матрицу допуска к технике подключать к пуску только после отдельного решения и заполнения данных.
4. **Измерить эксплуатационные границы:** p95 SQL аналитики/мониторинга на ожидаемой истории и размере парка, очередь/старейшее событие, leader loss, stopped generation, длительность Telegram transaction, отказ Redis/S3. Для каждого бюджета есть владелец и проверенный сигнал.
5. **Проверить восстановление и физические интеграции:** внешняя копия и RPO/RTO; фактические получатели Telegram; для telemetry — durable acknowledgement policy, допустимая потеря, dedupe/порядок/clock, нагрузка нескольких процессов, настоящие датчики. До этого telemetry остаётся подготовленным каркасом.
6. **Только затем снимать конкретную связность:** узкие публичные чистые экспорты для подтверждённого цикла, типы поверхностей layout и документы владения записью. Массовая services→modules миграция, микросервисы, новые очереди и «переписать монолит» не требуются. Нынешние фасады — допустимая архитектура.

Критерий завершения каждого пункта — наблюдаемое воспроизведение с сохранённым результатом и ограничениями, а не новый README или рост тестового счётчика.

## Мнение основного исполнителя после последних изменений

Точный lock-снимок после установки: Next/eslint-config-next **16.4.1**, React/React DOM **19.3.0**, TypeScript **6.0.3**, Prisma/client **7.10.0**, BullMQ **6.3.12**, ioredis **6.0.0**, Sharp **0.35.5**, Vitest **5.0.3**, Playwright **1.64.0**. Ранее приведённые `^` значения — диапазоны manifest. Обновление этой задачи затрагивает только пакеты семейства Next; React/Prisma уже имели указанные версии в базовом lock. Установленное дерево этого worktree изолировано от исходного `my-project/node_modules`.

Сохранять модульный монолит — правильное направление для этого приложения. Текущий стек соответствует работе небольшого диспетчерского центра и полевых бригад: единый TypeScript-контур, транзакционная PostgreSQL, отдельный worker, файловое хранилище и проекции. Замена Next.js или Prisma сама по себе не устранит разные способы записи производственного факта. Микросервисы сейчас добавят сетевые отказы и усложнят транзакции между сменой, осмотром и ТО.

Моя ориентировочная оценка структуры — **7/10**, с погрешностью около одного балла; это не оценка эксплуатации production. Технологический выбор — 8/10, границы архитектуры — 7/10, доменная выразительность — 8/10, доказанность эксплуатации — 6/10, воспроизводимость разработки — 7/10. Пять исправлений повышают согласованность конкретных процессов, но не дают оснований объявить приложение 10/10.

Главное достоинство домена — он описывает обязанности и факты строительной смены, а не только таблицы. Важно сохранять различие между планом, выполненной работой, подписанным документом, допуском к работе и доставленным уведомлением. `PileWork.count` допускает пачку, а паспорт относится к отдельной свае; строку, сваю и паспорт нельзя считать одной единицей. Готовность машины не равна факту сдачи отчёта. Положительный ответ HTTP не равен выполненному фоновому эффекту. Последние R1–R5 исправляли именно такие стыки.

Самая ценная и требующая углубления область — **readiness** вместе с inspections/equipment: здесь система может объяснить, почему работа заблокирована и какое действие снимает блокировку. Наиболее недооценённые небольшие модули — **layout и settings**; качество этих общих механизмов влияет сразу на несколько экранов. Самый слабый по готовности к реальной эксплуатации — **telemetry**: это подготовленный контур с допустимой потерей RAM-буфера, а не подтверждённая измерительная система. Это основание сохранить его и проверить на оборудовании, а не удалить.

## Какие дальнейшие изменения действительно нужны

Доменный каркас следует читать как `Site → PileField → Cluster → Picket`, назначение `User → Crew → Equipment/Site`, выполнение `Shift → PileWork/LeaderDrilling/ReportDowntime → Report`, подтверждение `PilePassport/Media/подпись`, обслуживание `Inspection → MaintenanceRecord → MaintenancePlan/готовность`. Это разные жизненные циклы. Не каждый новый сценарий требует нового aggregate или таблицы; сначала нужно определить, какой факт он добавляет и кто имеет право изменить его.

Помимо 17 каталогов modules есть общие подсистемы, которые не следует пропускать при оценке приложения:

| Подсистема | Оценка устройства | Что нужно доказать дальше |
|---|---|---|
| API и auth/security | Общие wrappers, ограничения мутаций, tenant context и RLS дают полезный единый периметр; это не самостоятельное доказательство безопасности каждого маршрута | Полная матрица непривилегированных ролей, негативные мутации/чужие ресурсы, отзыв сессий. Принятые платформенные ADMIN/DISPATCHER не менять |
| Outbox/worker/PDF | Отдельный worker, lease, replay и DLQ соответствуют асинхронным эффектам предметной области | Отказ worker во время обработки, смена лидера и повтор с сохранением конечного результата; старейшее необработанное событие важнее одного health=200 |
| Media/S3 | Общая точка хранения и контроль доступа позволяют не смешивать доказательства отчёта с произвольными файлами | Обрыв загрузки, очистка неподтверждённых загрузок, восстановление БД вместе с объектами, реальная камера; существующий Media не заменять dormant ReportPhoto |
| UI и операторские варианты | Разделение client/server контрактов и общая UI-библиотека полезны; варианты экранов увеличивают цену одинакового бизнес-изменения | Утверждённый владельцем набор поддерживаемых сценариев, доступность клавиатурой, видимость ошибок и сохранение ввода на телефоне. Замороженные варианты здесь не удаляются |
| CI/локальные проверки/доставка | Уже есть lint, типы, unit, интеграции и browser lanes; текущие проходящие локальные проверки воспроизводимы на disposable стенде | Один release manifest и обязательность проверок для SHA; документировать отдельно старые ручные обходы и регрессионные тесты |

Количество строк, файлов и тестов не использовано как самостоятельный рейтинг. Свежая AST-карта в `output/followup-1022/module-map.json` содержит все 17 модулей, буквальные import/export-ссылки и размеры production-файлов. Она не показывает зависимости через общую БД, HTTP, outbox или динамически вычисленные импорты.

Практический процессный долг обнаружен и в самих QA-проверках. `e2e/qa/roles-clickthrough.spec.ts:27` превращает любой сбой входа в ожидаемое падение через `test.fail`; итоговый зелёный счётчик может скрывать непройденный вход. Обходы дополнительно пишут DEFECT/BLOCKED в CSV и не всегда падают по этим строкам. Такой результат требует отдельного разбора артефактов. `e2e/qa-ac/mobile.spec.ts:59` измеряет визуальный прямоугольник кнопки; например Checkbox имеет 16px в DOMRect, но 44px цель через `.hit-target::after` на узком экране (`src/app/globals.css:195`). Все подписи/вспомогательный текст меньше 14px этот тест тоже считает нарушением. Это смесь полезных UX-наблюдений и эвристики, её нельзя автоматически преобразовать в список подтверждённых багов или повод массово менять дизайн.

Нужный следующий шаг — сохранить реальные регрессии как самостоятельные сценарии с предусловиями, а для наблюдательных обходов выдавать отдельные статусы: пройдено, подтверждённый дефект, кандидат, отсутствует состояние/данные, лимит обхода, ожидаемый пропуск. Существующие frozen варианты не удалять. Фактическую цель нажатия проверять кликом и hit testing, а правила размера текста согласовать для основного и вспомогательного контента.

| Приоритет | Работа | Обоснование в текущем коде | Критерий приёмки |
|---|---|---|---|
| P0 | Поддерживать исправленную зависимость Next и проверять release SHA | Manifest/lock содержали 16.4.0; обычный успешный build не означает отсутствия известной уязвимости | Lock и установленная версия исправлены; сборка/типы/lint/unit и основные браузерные сценарии проходят на этом lock; production обновляет владелец отдельной командой |
| P1 | Разделить воспроизводимые регрессии и исторические QA-обходы | `e2e/qa*` читает внешнюю матрицу/пароли, некоторые specs используют прежний контейнер, даты и идентификаторы | Каждый обязательный тест сам подготавливает условия на disposable DB; stale/fixme и отсутствие предусловий видны в отчёте; «запустился» не считается доказательством полного покрытия |
| P1 | Зафиксировать обязательные проверки именно развёртываемого SHA | deploy.yml явно проверяет ci.yml; отдельный integration workflow не указан в этом шаге | Проверен и согласован единый список обязательных checks + настройки защиты ветки/окружения; при отсутствии или провале любого требуемого результата выпуск блокируется |
| P1 | Закрепить владельца каждого общего хозяйственного действия | reports/operator-mobile пишут общий факт; inspections/equipment/readiness координируют ТО | Матрица входов и инвариантов; один реальный конкурентный сценарий и replay/rollback для каждой критической операции в существующих тестах |
| P1 | Пройти рабочий день на физическом телефоне | Browser profiles не моделируют камеру, слабую сеть, уход приложения в фон и поведение устройства | Смена от допуска до принятого отчёта, обрыв/возврат сети, повтор отправки, фото, веб-правка, паспорт и экспорт; неизменность чисел и истории подтверждена владельцем |
| P1 | Доказать восстановление с внешней копии | Есть restore-drill, но синтетический dump не подтверждает production recovery | Время восстановления и потеря данных измерены; копия доступна после потери основной площадки; владелец принимает RPO/RTO |
| P2 | Сделать свежесть проекций и доставку частью эксплуатационной картины | Outbox, projection и Telegram имеют разные стадии и повторные попытки | Видны возраст старейшего события, backlog/DLQ, задержка снимка, недоставленные получатели и ответственный за реакцию; остановка worker обнаруживается проверкой полного пути |
| P2 | Измерить предел SQL и мониторинга | Analytics использует сложные агрегаты, monitoring собирает окно отчётов и фото парка | Зафиксированы ожидаемые объёмы, p95 и бюджет; EXPLAIN на сопоставимой истории; оптимизируется только измеренное узкое место |
| P2 | Раскрыть telemetry одним каналом | Sampling/RAM buffer/локальные лимиты не дают гарантии доставки каждого измерения | Единицы, часы, порядок, повтор, пропуск, перегрузка и потеря питания проверены на настоящем приборе; допустимая потеря явно согласована |

Эти пункты не являются разрешением на изменение замороженных экранов, схемы, безопасности или production. В этой задаче выполнены проверяемые исправления и обновление зависимости; архитектурные перестройки и физические испытания не подменяются записью плана.

## Варианты развития продукта

1. **Операционное управление парком — ближайшее направление.** Из карточки состояния вести к следующему действию: причина простоя/блокировки → исполнитель → срок → выполненный осмотр/ремонт → повторная оценка готовности. Использовать readiness/inspections/equipment/notifications, не создавать второй независимый статус «готов».
2. **Доказательная исполнительная документация.** Связать смену, паспорт сваи, измерения, фото, изменения и принятое решение. Показывать происхождение чисел, неизменяемую историю и версию выгрузки. Этим повышать доверие заказчика; юридическое/инженерное соответствие требует отдельной проверки специалистом.
3. **Экономика объектов и установок.** После согласования стоимости машино-часа, причин потерь и календаря строить объяснимый план/факт, потери от простоя и прогноз срока. Прогноз обязан показывать полноту исходных данных, а не выдавать точное число по неполной истории.
4. **Измерительный контур.** Подключать один подтверждённый датчик и связывать его численные данные со сменой/установкой/паспортом. Машинное зрение и автоматические инженерные заключения — отдельная исследовательская задача с калибровкой и проверкой точности.
5. **Второй tenant/SaaS — после решения владельца.** Сначала воспроизводимое подключение второй организации, проверка изоляции непривилегированных ролей, резервирования и поддержки. Текущие ADMIN/DISPATCHER являются платформенными по принятой модели; это не дефект, который следует молча менять.

Для ближайшего этапа я выбрал бы первое направление плюс доверие к исполнительным фактам из второго. Расширение числа экранов и новые технологии дадут меньше пользы, чем согласованный полный рабочий процесс и проверенное восстановление.

## Источник проверки зависимости

Официальное обновление Next от 14.10.2026 перечисляет исправления в 16.4.1: [Next.js Security Update for Upstream Vulnerabilities](https://nextjs.org/blog/nextjs-security-update-october-14-2026). В проверенной рабочей копии первоначально был установлен Next 16.4.0. Подготовлены manifest/lock на 16.4.1 и соответствующий eslint-config-next; остальные зависимости целенаправленно не обновлялись. В production ничего не устанавливалось.

## Выполненная проверка изменений

Независимое ревью пяти коммитов `0fc414d1 → 551e9f4c` не выявило введённых регрессий; рецензент отдельно сообщил 107 пройденных целевых проверок. Это техническая рекомендация, а не принятие изменений владельцем. Исправления: сохранение мобильных поправок веб-отчётом, границы простоя, перенос регламента после осмотра, подпись ознакомления и полный заголовок журнала. Подробности первоначальной правки сохранены в `output/module-fixes-1022/REPORT.md`.

Новый коммит **03acea2d** обновляет только Next/eslint-config-next и зависимые пакеты семейства Next: два файла, +51/−51 строк. Перед редактированием выполнен impact; UNKNOWN у nextConfig не трактовался как отсутствие риска. Исходники приложения при этом не менялись. Проверки выполнены в изолированном worktree с собственным установленным node_modules и одноразовыми Postgres/Redis/S3, без production и чтения `.env`.

| Проверка | Exit | Фактический результат |
|---|---:|---|
| `npm run build` | 0 | Next 16.4.1, production build; `output/followup-1022/stand/stand-build.log` |
| `npx tsc --noEmit` | 0 | `.next/dev/types` отсутствовал; финальный `tsc-final.log` |
| `npm run lint` | 0 | Без предупреждений; финальный `lint-final.log` |
| `npm run test:unit` | 0 | 5365 passed, 265 skipped, 5630 всего; 488 файлов passed, 15 skipped; финальный `unit-final.log`, 144.60 секунды |
| `npx playwright test --list` | 0 | 315 тестов в 28 файлах; `playwright-list.log` |
| `npm run check:layers` | 0 | 4 прежних исключения, новых нет |
| `npm run db:check-migrations` | 0 | Migration guard пройден, схема не менялась |
| Полные интеграции на свежей БД | 0 | 378 passed, 0 skipped, 22 файла; `regression-stand/integration.log` |
| Основные E2E, 3 браузерных профиля | 0 | 111 passed, 9 skipped, 0 failed, 0 flaky; 120 случаев, 11.7 минуты; `e2e-results.json` |
| Локальное восстановление полного сервиса | 0 | 84 таблицы и 12 объектов в независимые БД/хранилище; повторный вход, отчёт и контрольные суммы PNG/PDF проверены; `recovery/service-restore-result.json` |
| `npm audit --omit=dev --json` | 0 | Реестр вернул 0 уязвимостей; это не полный аудит безопасности |

Пути журналов в таблице, кроме явно указанных, относятся к `output/followup-1022`. 265 пропусков unit не считаются пройденными тестами: в обычном запуске нет окружения интеграций, которые отдельно выполнены на стенде. 9 основных E2E-пропусков заданы в specs: один WebKit-сценарий редактора, два исключения rate limit по профилям и шесть повторов трёх изменяющих данные critical-path сценариев.

Восстановление заняло **20.03 секунды от получения уже готовой копии** на локальном синтетическом стенде. Это не время полного резервирования и не production RTO; внешний носитель/потеря площадки и production RPO не проверены. Контейнеры восстановления и регрессионного стенда штатно удалены их собственными guarded cleanup.

Предупреждение Next SecurityFatalError на исправленной версии не повторилось. Осталось предупреждение о необязательном `@valkey/valkey-glide`; в unit/runtime также есть диагностические предупреждения listeners/pg deprecation. Они не превращены в необоснованное обновление остальных зависимостей.

При разборе старого QA дополнительно воспроизведён сбой самого тестового входа: до гидрации email очищался, пароль оставался, HTTP-запрос login не уходил. Коммит **050f32de**: `e2e/qa/helpers.ts`, +4/−6 строк. Он переиспользует существующий `LoginPage.login`, который повторяет заполнение и отправку до реального ответа, и очищает cookies перед свежим входом. Production auth не менялся. Независимый статический reviewer замечаний не нашёл. Повторный браузерный прогон с исправленным helper: **24/24 passed, без skips/xfail/flaky, exit 0**, три профиля; проверены входы, негативные права/IDOR, CSV/XLSX/PDF. Артефакт `qa-24-results.json`, журнал `stand/qa-recheck.log`.

Первоначальный impact helper дал HIGH, 27 символов и 2 процесса. Последующий detect_changes со старым индексом ошибочно связал пустой ID символа со всеми 1221 процессами (CRITICAL). Оба предупреждения переданы пользователю. Выполнена **полная принудительная переиндексация**, exit 0. После неё у helper появился корректный UID `Function:e2e/qa/helpers.ts:login`: impact показывает **16 прямых тестовых потребителей, HIGH**, 0 production execution flows; один неразрешённый call site остаётся границей покрытия. Итоговый detect_changes распознал одну изменённую функцию, без partial/truncated. Нулевое число production flows не трактуется как отсутствие потребителей: реальные QA callers подтверждены текстом и браузером. Ни граф с пустым ID, ни его прежний CRITICAL не объявлялись чистой проверкой. Исходные и уточнённые результаты сохранены в `impact-qa-login.log`, `graph-qa.json`, `detect-changes.json`, `gitnexus-force.log`.

## Результат оставшихся 195 E2E

Все 195 случаев действительно выполнены в диагностическом запуске: **117 фактически passed, 51 skipped, 2 expected failures, 25 unexpected**, exit **1**, без flaky. CLI напечатал «119 passed», поскольку включает два ожидаемых падения; здесь они намеренно отделены от фактических успехов. JSON: `qa-195-results.json`; подробный разбор: `qa-195-summary.json`; журнал: `stand/qa-195.log`. Этот набор **не зелёный**.

Они являются старыми ручными QA-обходами, а не однородным регрессионным пакетом. Использованы теневые копии исходных specs в игнорируемом output: изменены только пути артефактов, цель Docker/БД и источник синтетических учёток; assertions, skip и fixme сохранены. Обходы с прежними бюджетами до 45 минут ограничены **120 секундами на случай**. Поэтому тайм-ауты данного диагностического запуска не являются доказательством зависания приложения. Все профили взяты из общего Playwright config; часть старых specs изначально предназначена только для desktop `playwright.acqa.config.ts` и несовместима с мобильным профилем. Существующие QA-пароли и реальные записи не использовались.

| Причина unexpected | Количество случаев | Вывод |
|---|---:|---|
| Лимит диагностического обхода | 6 | Нужны меньшие самостоятельные сценарии, а не утверждение о полном обходе всех кнопок |
| Отсутствующие справочники в собственной начальной фикстуре | 1 | Добавлены drilling/downtime fixtures; затем выгрузки прошли в отдельных браузерных проверках |
| Эвристика 44px/14px | 3 | По 14 групп наблюдений на профиль; есть ложное измерение Checkbox без учёта hit-target. Не равно 42 подтверждённым дефектам |
| Старые персональные/датированные данные и ожидание более 1000 свай | 8 | На синтетической БД отсутствуют именно требуемые записи. Нужны самостоятельные fixtures |
| `mouse.wheel` в mobile WebKit | 1 | Несовместимость desktop-spec с выбранным мобильным профилем |
| Сбой прежнего тестового входа | 5 | Helper исправлен; отдельный повтор 24/24 прошёл |
| Desktop-предположение о видимом меню на мобильном профиле | 1 | После исправления входа дополнительно проверено отдельно, см. ниже |

51 skip — это 17 явно заданных причин, повторённых на трёх профилях: отсутствие исторических отчётов/паспортов, инструктажа и знаний, открытой смены/осмотра, нужной фазы выработки либо старое fixme с датами 04–06 октября. Они не подтверждают соответствующие бизнес-сценарии. Два expected failures: неудавшийся вход помощника и локальный `ERR_NO_BUFFER_SPACE`; не засчитаны фактическими успехами.

Дополнительный повтор карты ролей с новым helper: **desktop Chromium passed, Mobile Safari/Chrome failed, exit 1**. На мобильном экране sidebar скрыт, а spec ищет видимые `nav a` без открытия меню; он написан для desktop-конфига. Это сохраняется как ограничение теста и покрытия, а не исправляется ослаблением assert или переделкой интерфейса. Артефакт `qa-map-results.json`, журнал `stand/qa-map.log`. Входы и разрешения тех же ролей на мобильных профилях отдельно прошли в основных E2E и повторе 24/24.

После правки helper повторный сбор теневого QA-набора: **195 тестов, 16 файлов, exit 0** (`qa-collection.log`). Основные 120 случаев в 12 файлах сохранены: суммарный состав 315/28 не уменьшен. Отслеживаемые test-файлы не добавлялись и не удалялись.

Полный набор 195 после исправления входа повторно не объявляется пройденным: выполнены адресные 24 и отдельные 3 проверки, остальные исходные статусы и пробелы сохранены. Архитектурные рекомендации выше учитывают это ограничение. Все собственные стенды после проверок штатно остановлены; production, реальные телефоны и физические датчики не проверялись.
