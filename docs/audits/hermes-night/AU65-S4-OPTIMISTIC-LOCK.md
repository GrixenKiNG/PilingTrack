# AU65-S4-OPTIMISTIC-LOCK — Конкурентные правки: где есть версия, где нет

Аудит только чтением. Код приложения не менялся. git rev-parse HEAD рабочей папки:
`326bade36741f66b90780e898bb0d03cb9c0aaca` (ветка hermes/q4-0926).

## Итог

Разобрано 13 сущностей с полем `version`/`version String` и 9 сущностей без версии.
Найдено защит: 6 путей на optimistic-lock по `version`, 1 путь по `updatedAt`,
7 наборов advisory-замков, 1 обёртка Serializable-транзакции (используется всеми
командами техготовности). Найдено сущностей, изменяемых с двух устройств без
всякого сигнала о конфликте (last-write-wins): 11.

Счёт по важности: **критично — 1, важно — 7, мелочь — 14** (всего 22 находки).

Топ-5:
1. **КРИТИЧНО.** WorkPermit.submit/approve/revoke не увеличивают `version`
   (`work-permit-repository.ts:199,247,256`), а `updateContent` проверяет только
   версию, без состояния (`:175`). Устаревший клиент (version=1) после того, как
   другой пользователь отправил и согласовал наряд, своей правкой молча
   возвращает **согласованный** наряд в DRAFT и аннулирует все подписи — 409 не
   приходит, потому что версия не сдвинулась.
2. **ВАЖНО.** `decidePilePassport` (`pile-passport.service.ts:65`) — решение
   мастера по свае принимается `updateMany` по `id+tenantId`, без версии: два
   мастера решают одну сваю, побеждает последний, конфликт не показывается.
3. **ВАЖНО.** Поправка выработки (`production-corrections.ts:104-112`, READ
   COMMITTED) читает текущий итог и создаёт дельту: две одновременные поправки
   к одной записи считают дельту от одного «до», итог расходится.
4. **ВАЖНО.** Проверка пересечения простоев (`production.ts:485-506`) —
   «прочитать и записать» в READ COMMITTED без замка: два устройства записывают
   пересекающиеся простои, оба проходят проверку.
5. **МЕЛОЧЬ.** `ConflictAudit` и `Report.vectorClock` объявлены в схеме
   (`schema.prisma:2753,1941`), но **ни одна строка кода их не пишет** — журнала
   разрешения конфликтов фактически нет.

## Резюме для владельца (5 строк)

1. Основные «бумажные» документы защищены хорошо: смена, передача смены, наряд-допуск, дефект, отчёт, настройки, правила готовности и матрица доступов — с версией, advisory-замком или Serializable-транзакцией, и всегда отвечают 409 вместо молчаливой перезаписи.
2. Одна дыра в наряде-допуске: версия не двигается при «отправить»/«согласовать»/«отозвать», поэтому устаревший браузер может молча вернуть уже согласованный наряд в черновик. Это единственная критичная находка.
3. Справочники (марки свай, типы бурения, причины простоя, места работ, объекты), карточка пользователя, решения по сваям и поправки выработки правятся «кто последний — тот и прав», без сообщения о конфликте.
4. В замороженной зоне `src/modules/operator-mobile/**` две гонки: поправка выработки и проверка пересечения простоев — их по правилам репозитория править нельзя, поэтому только фиксирую.
5. Тесты на все существующие защиты есть; на места без защиты тестов, естественно, нет.

## Методика

Что искал и как (можно повторить):

- `search_files` по `prisma/schema.prisma` на `^model |^enum ` и на
  `version|updatedAt` — инвентаризация сущностей и полей версии.
- `search_files` по `src/` на
  `version:\s*(input\.)?expected|version:\s*input\.version|where:\s*\{[^}]*version`
  — все пути, где версия участвует в условии записи.
- `search_files` по `src/` на `advisory|pg_advisory|FOR UPDATE|hashtext` — все замки.
- `search_files` по `src/` на `IsolationLevel|Serializable|isolationLevel` — все
  транзакции с уровнем изоляции.
- `search_files` по `src/` на `(db|tx|client)\.(model)\.(update|updateMany|upsert)`
  — все пути записи без условия версии (для таблицы LWW).
- `search_files` по тестам на `VERSION_CONFLICT|expectedVersion|expectedUpdatedAt|
  last-admin|advisory_xact_lock|Serializable` — какие защиты покрыты тестами.
- Вручную прочитаны: `report.repository.ts`, `report-command.service.ts`,
  `tenant-transaction.ts`, `shift-repository.ts`, `handover-repository.ts`,
  `work-permit-repository.ts`, `permits/commands.ts`, `defect-repository.ts`,
  `defects/commands.ts`, `equipment-command.service.ts`,
  `equipment-maintenance.ts`, `settings-service.ts`, `readiness-rules-service.ts`,
  `access-matrix-service.ts`, `user-service.ts`, `scheduler.ts`,
  `pile-passport.service.ts`, `dictionary-service.ts`, `production.ts`,
  `production-corrections.ts`, `checklist.ts`, `etag.ts`, `upsert/route.ts`.

Команды, числа из которых приведены ниже:

```
git rev-parse HEAD
# -> 326bade36741f66b90780e898bb0d03cb9c0aaca
git branch --show-current
# -> hermes/q4-0926
```

Важно про методику: справочники обновляются через динамический клиент
(`const model = db[type]`, `dictionary-service.ts:264,274`) — по имени модели их
запись не находится текстовым поиском, поэтому проверял вызов вручную.

Статусы в таблицах: **ПРОЙДЕНО** — подтверждено чтением кода и строкой;
**ГИПОТЕЗА** — вывод по коду без прогона сценария; **НЕ ПРОВЕРЕНО** — см. отдельный
раздел.

## Таблица 1. Защита от одновременных правок (что есть)

| # | Сущность | Операция | Защита | Что при двух одновременных правках | Файл:строка | Тест |
|---|---|---|---|---|---|---|
| 1 | Report | сохранение | advisory-замок по ключу `report:tenant:user:site:date` + optimistic-lock по `version` + `updateMany ... where version` | вторая правка получает 409 «Отчёт был изменён другим пользователем» | `report-command.service.ts:114,117,325`; `report.repository.ts:118,134,148` | `report.repository.test.ts:58,75`; `report-command-service.test.ts:671,724` |
| 2 | ReportVersion | снимок версии | уникальный `(reportId, version)`, вставка в той же транзакции | дубль номера ломает транзакцию | `report.repository.ts:243` | `report.repository.test.ts:72` |
| 3 | Shift | create/update/start/cancel/request/decline/handoverPending/close/reopen | Serializable-обёртка + `version` + `updateMany where version` + ETag/If-Match | второй проигрывает: 409, `safeCurrent` возвращает актуальную строку | `shift-repository.ts:89,99,109,121,129,137,144,151`; `tenant-transaction.ts:98` | `commands-contract.test.ts:15`; `tenant-transaction.test.ts:58` |
| 4 | ShiftHandover | submit/resubmit/accept/rework | Serializable + `version` + `updateMany where version,state` | 409 «Передача изменилась» | `handover-repository.ts:47,57,65` | `commands-contract.test.ts`; `decideHandover` (`commands.ts:406`) |
| 5 | WorkPermit | правка содержимого | Serializable + ETag + `version` + `updateMany where version`; `version: input.nextVersion` | 409, правки не накладываются | `work-permit-repository.ts:175,188`; `commands.ts:226` | — (проверено кодом) |
| 6 | WorkPermit | submit/approve/revoke | Serializable + `version`-условие (версия НЕ инкрементируется) + `lockForApproval` (`FOR UPDATE`) для подписи | переход защищён условием на **состояние**; по версии — см. находку №1 | `work-permit-repository.ts:199,247,256,221`; `commands.ts:253` | — |
| 7 | EquipmentDefect | triage/resolve/reject | Serializable + `version` + `updateMany where version` с инкрементом | 409 «Дефект изменился» | `defect-repository.ts:113-118`; `defects/commands.ts:163` | — |
| 8 | Equipment | правка карточки | `expectedUpdatedAt` + `SELECT ... FOR UPDATE` | 409 «Карточка изменена другим пользователем» | `equipment-command.service.ts:22-30` | `equipment/[id]/__tests__/route.test.ts:59,186` |
| 9 | Equipment | удаление | `FOR UPDATE` + проверка счётчиков в транзакции | удаление ждёт завершения чужой вставки | `equipment-command.service.ts:64` | — |
| 10 | MaintenanceRecord | update/accept | условие в самом `update` (`acceptedById: null`, `status`) | повтор/гонка не меняет ни строки → ошибка | `equipment-maintenance.ts:251,300` | — |
| 11 | Inspection | saveAnswers/complete | advisory-замок на ключ дефекта + `updateMany` с условием статуса | второй видит чужой дефект/ответы не задваиваются | `inspection-commands.ts:400,414` | `inspection-commands.test.ts:353` |
| 12 | TenantSettings | сохранение | advisory-замок `settings:{tenant}` (чтение+запись в одной транзакции) | сериализуется, правки не теряются | `settings-service.ts:99-107` | `settings-service.test.ts:70` |
| 13 | ReadinessRuleSet | сохранить черновик / опубликовать | advisory-замок `readiness-draft:rules:{tenant}` | второй черновик не создаётся | `readiness-rules-service.ts:106,225` | `readiness-rules-service.test.ts:155,182` |
| 14 | ReadinessAccessMatrix | сохранить / опубликовать | advisory-замок `readiness-draft:matrix:{tenant}` | то же | `access-matrix-service.ts:169,206` | `access-matrix-service.test.ts:160,186` |
| 15 | User | снятие роли «последний админ» | advisory-замок `last-admin:{tenant}` только вокруг подсчёта админов | без замка два админа сняли бы друг друга | `user-service.ts:272` | `user-service.test.ts:308` |
| 16 | MaintenanceRecord (планировщик ТО) | создание планового наряда | advisory-замок `pm:{tenant}:{equipment}:{type}` + дедуп по открытым | не появляется два одинаковых наряда ТО | `pm-scheduler.ts:105-107` | `pm-scheduler.test.ts:104` |
| 17 | Shift / WorkPermit / Report (планировщик) | автозакрытие смены, истечение наряда, сдача черновика | условный `updateMany` по `state` (внутри tenant-транзакции), идемпотентно | повтор прогона ничего не находит | `scheduler.ts:135,169,214` | — |
| 18 | SafetyIncident | разбор происшествия | условный `updateMany where reviewedAt: null` | повтор разбора отбивается 409 | `admin/incidents/route.ts:119-129` | — |

Отдельно: `version String` у `ReadinessRuleSet` (`schema.prisma:937`) и
`ReadinessAccessMatrix` (`:957`) — это **семантическая** версия политики
(`bumpVersion`), не токен конкурентности; конкурентность здесь закрыта
advisory-замком. `OperatorChecklistTemplate.version` (`:1203`) — часть
уникального ключа `(tenantId, templateKey, version)`, тоже не OCC.

## Таблица 2. Правки с двух устройств без сигнала о конфликте (last-write-wins)

| # | Сущность | Операция | Защита | Что при двух одновременных правках | Файл:строка |
|---|---|---|---|---|---|
| L1 | PilePassport | решение мастера (принять / на добивку) | нет | побеждает последний; первый не узнаёт, что его решение перезаписали | `pile-passport.service.ts:65-75` |
| L2 | PileGrade | длина, сечение, примечание, архивация | нет | последняя запись затирает первую молча | `dictionary-service.ts:274,319,338,365` |
| L3 | DrillingType / DowntimeReason / PermitWorkType | переименование, архивация | нет (динамический клиент) | то же | `dictionary-service.ts:264,274` |
| L4 | User | правка карточки (роль, ФИО, телефон, активность) | нет (кроме «последнего админа») | две правки разных полей — второй сохранивший затирает первый | `user-service.ts:291` |
| L5 | Site | правка/план объекта | нет | то же | `site-admin-command.service.ts:179,292` |
| L6 | Crew | upsert бригады | нет | то же | `crew.repository.ts:32` |
| L7 | ModuleLayoutTemplate | раскладка интерфейса | нет | то же | `layout-service.ts:85` |
| L8 | TelegramConfig | токен бота / вкл-выкл | нет | то же | `telegram-config-service.ts:128`; `core/notifications/telegram.ts:212` |
| L9 | MaintenancePlan | правило ТО | нет | то же | `maintenance-plan.ts:122`; `maintenance-regulation.ts:103` |
| L10 | EquipmentDocument | правка документа | нет | то же | `equipment-document.ts:77` |
| L11 | ChecklistTemplate | архивация шаблона | нет | то же | `template-commands.ts:86` |

Плюс `ReportDowntime.version` (`schema.prisma:2413`) — поле есть, но ни один
запрос его не проверяет и не увеличивает: создание в `production.ts:426,509`,
`production-corrections.ts:193`, `report.repository.ts:171` идёт без версии.
То же можно сказать про `Report.vectorClock` (`schema.prisma:1941`) и таблицу
`ConflictAudit` (`schema.prisma:2753`) — кода, который их пишет, нет.

## Находки

| # | Важность | path:line | Проблема | Сценарий / почему это важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/infrastructure/permits/work-permit-repository.ts:199,247,256` (и `:175`) | submit/approve/revoke меняют состояние, но **не** увеличивают `version`; `updateContent` проверяет только `version`, без состояния | Двое открыли один наряд (v1): один отправил и согласовал его, второй — с тем же v1 — сохраняет правку. Условие `where version=1` совпадает → наряд молча возвращается в DRAFT, все подписи аннулируются, 409 не приходит | Увеличивать `version` во всех переходах состояния (`submit/approve/revoke/expire`) либо явно возвращать 409, если `state` наряда сдвинулся с момента загрузки |
| 2 | важно | `src/modules/reports/application/queries/pile-passport.service.ts:65-75` | решение по свае без версии | Два мастера разбирают одну сваю: оба жмут «принять/на добивку», побеждает последний, первый не увидит конфликта | Добавить условие `where version` + инкремент (поле есть в схеме) и 409 при несовпадении |
| 3 | важно | `src/modules/operator-mobile/application/commands/production-corrections.ts:104-112` (заморожено) | «прочитать текущий итог → создать дельту» в READ COMMITTED | Две поправки одной записи читают один и тот же «до», обе пишут дельту → итог расходится | Брать advisory-замок по `entryId` перед чтением либо перейти на Serializable; править нельзя — зона заморожена |
| 4 | важно | `src/modules/operator-mobile/application/commands/production.ts:485-506` (заморожено) | проверка пересечения простоев «прочитать → создать» без замка | Два устройства пишут пересекающиеся простои, оба проходят проверку | Замок по `(tenantId, shiftId)` или ограничение в БД; зона заморожена |
| 5 | важно | `src/modules/operator-mobile/application/commands/production.ts:107,118-121` (заморожено) | весь `logProduction` идёт в READ COMMITTED (не Serializable), идемпотентность — только по `clientCommandId` | Гонки внутри проверок (привязка к смене, ТБ-чек-лист) не сериализуются | Обернуть в Serializable; зона заморожена |
| 6 | важно | `src/modules/reports/application/commands/upsert-report.service` → `report-command.service.ts:325` | OCC срабатывает только если клиент прислал `version`; при отсутствии тихо берётся версия из текущей транзакции | Оффлайн/старый клиент без `version` перезаписывает чужую правку без 409 (это осознанно, но внешне неотличимо от ошибки) | Отдавать признак «проверка не выполнялась» в ответе либо требовать `version` там, где оффлайн не нужен |
| 7 | важно | `src/modules/reports/application/queries/pile-passport.service.ts:65` + `src/lib/validation-schemas.ts:256` | см. №2 и №6 вместе: у паспорта сваи нет даже необязательного токена | Правки, влияющие на нормативный журнал забивки, не защищены вовсе | Ввести необязательный `version` в DTO решения по свае |
| 8 | важно | `src/modules/readiness/application/scheduler.ts:214-217` | автозакрытие сдаёт отчёт (`draft→submitted`) без создания `ReportVersion` и без увеличения `Report.version` | В истории версий отчёта пропуск: состояние сдано, снимка нет; клиент с прежней версией считает, что правка ещё возможна | Писать `ReportVersion` и увеличивать `version` в том же `updateMany` |
| 9 | мелочь | `prisma/schema.prisma:2753` | таблица `ConflictAudit` объявлена, но ни одна строка кода её не пишет | Журнал разрешения конфликтов пуст — «страховки» нет, хотя схема её обещает | Либо писать при 409, либо помечать как задел (комментарий, чтобы не вводить в заблуждение) |
| 10 | мелочь | `prisma/schema.prisma:1941` | `Report.vectorClock` объявлен, но не записывается | Векторные часы не используются, при этом код-наследие на них ссылается (`report-history.ts:38` исключает поле) | Убрать из выдачи/документировать как задел |
| 11 | мелочь | `prisma/schema.prisma:2413` | `ReportDowntime.version` не проверяется и не увеличивается | Создание простоев идёт без версии; поле создаёт ложное ощущение защиты | Либо использовать в правках простоя, либо убрать из модели |
| 12 | мелочь | `prisma/schema.prisma:1359` | `RepairVerification.version` не читается кодом | Верификация ремонта через `version` не защищена | Использовать или убрать |
| 13 | мелочь | `prisma/schema.prisma:1329` | `SafetyIncident.version` не читается кодом | Разбор происшествия защищён только условием `reviewedAt: null` | То же |
| 14 | мелочь | `src/services/users/user-service.ts:291` | правка пользователя — `update` без версии | Два админа правят разные поля одного пользователя, сохраняется последний | Добавить `version`/`updatedAt` в условие |
| 15 | мелочь | `src/services/dictionaries/dictionary-service.ts:274,319,338,365` | правки справочников без версии | Правки марок свай/типов бурения теряются молча | Версия или `updatedAt`-условие |
| 16 | мелочь | `src/modules/sites/application/commands/site-admin-command.service.ts:179,292` | правка объекта без версии | то же | То же |
| 17 | мелочь | `src/modules/layout/application/layout-service.ts:85` | `moduleLayoutTemplate.upsert` без версии | Двое админов правят раскладку — побеждает последний | То же |
| 18 | мелочь | `src/services/telegram/telegram-config-service.ts:128`; `src/core/notifications/telegram.ts:212` | токен бота/вкл-выкл без версии | то же | То же |
| 19 | мелочь | `src/modules/equipment/application/commands/maintenance-plan.ts:122` | правило ТО без версии | то же | То же |
| 20 | мелочь | `src/modules/equipment/application/commands/equipment-document.ts:77` | документ установки без версии | то же | То же |
| 21 | мелочь | `src/modules/inspections/application/commands/template-commands.ts:86` | архивация шаблона чек-листа без версии | то же | То же |
| 22 | мелочь | `src/modules/operator-mobile/application/commands/checklist.ts:27-31` (заморожено) | `ensureTemplate` — «найти → создать» без перехвата `P2002` | Два одновременных осмотра могут оба создать шаблон; второй упадёт сырой ошибкой Prisma вместо понятного сообщения | Перехватить `P2002` и перечитать; зона заморожена |

ГИПОТЕЗА помечены только №6 (поведение при отсутствии `version` — по коду, без
прогона), №8 (пропуск снимка — по коду) и №22 (гонка возможна, но не
воспроизводилась). Остальные — ПРОЙДЕНО чтением кода и строкой.

## Не проверено / Что не проверено

- **Сам факт гонки не воспроизводился.** Ни один сценарий «два запроса
  одновременно» не запускался: аудит только чтением, запуск требует БД. Все
  выводы о поведении «при двух одновременных правках» — аналитические
  (ГИПОТЕЗА там, где не следует напрямую из условия запроса).
- **Уровень изоляции по умолчанию не подтверждён запуском.** `DEFAULT_TX_OPTIONS`
  прочитан как `ReadCommitted` в `src/lib/db.ts:57`; что именно этот объект
  попадает во все не-Serializable транзакции, проверено по коду, не измерением.
- **Prod-БД не читалась и миграции не проверялись**: не проверял, совпадают ли
  реальные CHECK/партиальные индексы (например, `ShiftHandover_one_live_per_shift_key`,
  `ReportDowntime_reason_present`) с описанием в схеме.
- **Фронтенд не проверялся**: отправляет ли веб-клиент `If-Match`/`version`
  последовательно во всех формах (смотрел только серверную часть и
  `validation-schemas.ts:256`).
- **`prisma/schema.prisma` — заморожен для правок** (нельзя менять по AGENTS.md);
  предложенные «убрать/использовать поле» — рекомендации владельцу, а не
  сделанная работа.
- Не проверял `src/services/auth/**`, `src/core/security/**`, `src/lib/rate-limiter.ts`
  и прочие файлы из списка «security-critical» — они вне области этого аудита.
- Замороженные зоны (`src/modules/operator-mobile/**`, варианты экрана оператора,
  сайт ORION) только читал; находки №3, №4, №5, №22 указывают на них и **не
  подлежат правке** по AGENTS.md — вынесены отдельно именно поэтому.
- Существующие отчёты в `docs/audits/` (кроме этого файла), `CODEX-REPORT*`,
  `docs/strategy` намеренно не открывал — независимость первого прохода.
