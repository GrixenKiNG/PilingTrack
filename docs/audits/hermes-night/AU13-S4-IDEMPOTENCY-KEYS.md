# AU13-S4-IDEMPOTENCY-KEYS — Ключи идемпотентности и уникальные индексы команд записи

Версия кода (рабочая папка): ветка `hermes/q4-0926`, commit `a27f841115e7bf504245c16ca322b49a2742beb6`
(`git rev-parse HEAD` в `D:\PillingR\wt-night`). Отчёт читается только с этим HEAD.

## Итог

- Разобраны команды записи семи контуров: отчёт, выработка, осмотр, смена, допуск, медиа, инцидент.
- Всего находок: 10 (критично — 0, важно — 2, мелочь — 6, плюс 2 заметки по методике/гипотезе).
- Два больших контура защищены по-разному: контур готовности (`/api/readiness/**`) имеет полноценный
  конвейер идемпотентности (заголовок `idempotency-key` + таблица `IdempotencyKey`), а мобильный
  контур машиниста использует `clientCommandId` в теле команды. Остальные, более старые маршруты —
  без ключа.
- Топ-5 по важности:
  1. `submit-report` (сдача отчёта без закрытия смены) — нет ключа и нет проверки «уже сдан»:
     повтор пишет вторую строку истории и второе событие `ReportSubmitted` (поведение зафиксировано
     тестом как факт).
  2. Легаси-старт осмотра `POST /api/inspections` с `templateId` — вообще без защиты: повтор создаёт
     второй `Inspection` и второй `MaintenanceRecord` (уникальный индекс `(tenantId, shiftId, phase)`
     не срабатывает, т.к. у этого пути `shiftId = NULL`).
  3. Три команды мобильного контура (`correct-production`, `submit-checklist`, `report-incident`)
     проверяют повтор чтением ДО вставки, но не перехватывают `P2002` — при одновременном повторе
     клиент получит сырую 500 (в `log-production` такой перехват есть, в этих трёх — нет).
  4. `accept-equipment`: ключ команды защищает только «свидетельство» (`OperatorShiftEvidence`), а не
     саму `Shift`; повтор после закрытия смены создаёт новую смену со случайным UUID.
  5. `POST /api/media` (выдача presigned-URL) не идемпотентен — повтор плодит «висячие» строки `Media`
     в статусе `pending`.
- Хорошо закрыто (ПРОЙДЕНО): весь контур готовности (смены/наряды/дефекты/передачи), `log-production`,
  `completeInspectionWithOutcome`, upsert отчёта, все модели с `@@unique([tenantId, clientCommandId])`.

## Методика

Только чтение. Изменялся лишь этот файл. Отчёты в `docs/audits/` (кроме этого), `CODEX-REPORT*`,
`docs/strategy` не читались — независимость первого прохода.

Что сделано:
1. `git rev-parse HEAD` / `git branch --show-current` / `git status --short` — фиксация версии.
2. Просмотр `prisma/schema.prisma` целиком по разделам: все `@unique` / `@@unique` (инструмент нашёл
   74 совпадения по шаблону `@@unique|@unique|clientCommandId|commandId|idempotenc`) и все модели,
   участвующие в записи.
3. Трассировка маршрутов записи по `src/app/api/**/route.ts` (инструмент: 141 файл `route.ts`) и их
   команд в `src/modules/**` и `src/services/**`.
4. Проверка конвейера идемпотентности: `src/modules/readiness/application/command-pipeline/**`,
   `src/modules/readiness/infrastructure/command-pipeline/idempotency-repository.ts`.
5. Проверка SQL-миграций на частичные уникальные индексы и CHECK-ограничения, которые Prisma не
   описывает (`prisma/migrations/**`).
6. Поиск `idempotency-key` по маршрутам готовности — 19 совпадений (файлов), каждое открыто.

Команды, числа (реальные результаты инструмента, не оценки):
- `git rev-parse HEAD` → `a27f841115e7bf504245c16ca322b49a2742beb6`.
- поиск `@@unique|@unique|clientCommandId|commandId|idempotenc` в `prisma/schema.prisma` → 74 совпадения.
- поиск файлов `route.ts` в `src/app/api` → 141 файл.
- поиск `idempotency-key` в `src/app/api/readiness` → 19 совпадений.
- поиск `clientCommandId` в `src` → 186 совпадений; поиск `idempotenc` в `src` → 96 совпадений.

Статусы ниже: **ПРОЙДЕНО** — защита подтверждена кодом и индексом; **ГИПОТЕЗА** — механизм выведен из
кода, но поведение под одновременностью не воспроизводилось; **НЕ ПРОВЕРЕНО** — см. одноимённый
раздел.

## Таблица команд записи

Колонки: команда | где принимается (файл:строка) | ключ идемпотентности | уникальный индекс/ограничение
| что при повторе той же команды | что при двух разных командах.

### Контур готовности (`/api/readiness/**`) — сквозной конвейер

| Команда | Где принимается | Ключ | Уникальный индекс/ограничение | Повтор той же команды | Две разные команды |
|---|---|---|---|---|---|
| Создать смену | `src/app/api/readiness/shifts/route.ts:57` → `shifts/commands.ts:98` | header `idempotency-key` (16–128 ASCII) | `IdempotencyKey @@unique([tenantId, scope, key])` (`schema.prisma:2651`) | `tryClaim` → `ON CONFLICT DO NOTHING` → возврат прежнего ответа (`idempotency-repository.ts:32-41`, `execute-command.ts:82-99`) | Разные ключи = разные смены; защита от двух активных — `Shift_one_active_per_equipment_key` |
| Изменить / запустить / отклонить / отменить смену, передача/приёмка | `shifts/[id]/**` (напр. `shifts/[id]/start/route.ts:16`), `handovers/[id]/**` | header `idempotency-key` + `if-match` (ETag) | то же + `version` строки | повтор с тем же ключом → прежний ответ; расхождение хэша → `IDEMPOTENCY_KEY_REUSED` 409 | Разные ключи + устаревший `version` → `VERSION_CONFLICT` 409 (`shifts/commands.ts:168`) |
| Создать / изменить / подать / согласовать / отозвать наряд-допуск | `src/app/api/readiness/work-permits/**` (напр. `work-permits/route.ts:68`) | header `idempotency-key` + `if-match` | `IdempotencyKey` + `WorkPermitApproval @@unique([tenantId, permitId, permitVersion, role])` (`schema.prisma:1532`) | идемпотентно через конвейер | Повторная подпись той же роли/версии ловится уникальным индексом подписей |
| Завести / разобрать / отклонить / устранить дефект | `src/app/api/readiness/defects/**` (напр. `defects/route.ts:78`) | header `idempotency-key` + `if-match` | `IdempotencyKey` | идемпотентно через конвейер | Разные ключи — разные действия |

Итог: **ПРОЙДЕНО**. Это единственный контур с настоящим ключом «сервер хранит и переигрывает ответ».

### Мобильный контур машиниста (`POST /api/operator/mobile/command`)

Единый маршрут: `src/app/api/operator/mobile/command/route.ts`. Ключ — `clientCommandId` в теле
(схема: строки 50, 56, 66, 139, 150), а не заголовок.

| Команда | Где принимается | Ключ | Уникальный индекс/ограничение | Повтор той же команды | Две разные команды |
|---|---|---|---|---|---|
| Приёмка установки `accept-equipment` | `route.ts:49-53` → `commands/equipment.ts:22` | `clientCommandId` (только на свидетельство) | `OperatorShiftEvidence @@unique([tenantId, clientCommandId])` (`schema.prisma:1291`); `Shift_one_active_per_equipment_key` | Свидетельство дедуплицируется (`shared.ts:312-333`); смена не пересоздаётся, пока открыта | Разные ключи → новая `OperatorShiftEvidence`; вторая активная смена блокируется `Shift_one_active_per_equipment_key` |
| Осмотр по чек-листу `submit-checklist` | `route.ts:55-63` → `commands/checklist.ts:69` | `clientCommandId` | `OperatorChecklistExecution @@unique([tenantId, clientCommandId])` (`schema.prisma:1243`); ответы — `OperatorChecklistAnswerRecord @@unique([tenantId, clientCommandId])` (`:1268`) | Пред-проверка `findUnique` (`checklist.ts:107-111`) → возврат `executionId` | Разные ключи — два осмотра; один пункт — один ответ (`@@unique([tenantId, executionId, itemId])` `:1269`) |
| Выработка (сваи/паспорт/бурение/простой) `log-production` | `route.ts:64-136` → `commands/production.ts:96` | `clientCommandId` | `PileWork @@unique([tenantId, clientCommandId])` (`:2206`); `LeaderDrilling` (`:2383`); `ReportDowntime` (`:2427`); `PilePassport` (`:2307`) | Пред-проверка `findByCommand` ДО правил (`production.ts:118-121`) + перехват `P2002` с повторным чтением (`:570-577`) | Разные ключи — разные записи; легаси-путь пишет те же таблицы с `clientCommandId = NULL` |
| Поправка выработки `correct-production` | `route.ts:137-147` → `commands/production-corrections.ts:51` | `clientCommandId` | те же три таблицы | Пред-проверка `findByCommand` (`:76-77`), **без** перехвата `P2002` | Разные ключи — разные поправки |
| Происшествие `report-incident` | `route.ts:148-160` → `commands/incidents.ts:30` | `clientCommandId` | `SafetyIncident @@unique([tenantId, clientCommandId])` (`:1334`) | Пред-проверка `findUnique` (`:61-73`), **без** перехвата `P2002` | Разные ключи — разные происшествия |
| Инструктаж `acknowledge-briefing` | `route.ts:31` → `commands/admission.ts:254` | нет | `UserDocument` — по типу; `BriefingRecord` — по дню+версии (в коде) | Дедуп по «сутки + код + версия» (`admission.ts:147-173, 269-292`) | Повтор другим днём/редакцией законен и пишется |
| СИЗ `confirm-ppe` | `route.ts:32-39` → `admission.ts:209` | нет | `PpeCheck @@unique([tenantId, userId, productionDate])` (`schema.prisma:252`) | `upsert` — перезапись за те же сутки (`:224-241`) | Разные сутки — разные записи |
| Проверка знаний `submit-knowledge` | `route.ts:40-47` → `admission.ts:304` | нет | нет | Переписывает документ; **историю пишет всегда** (`admission.ts:341-350`) | — |
| Конец работы `finish-work` | `route.ts:161` → `commands/shift-close.ts:16` | нет | нет | `update` в `HANDOVER_PENDING` — повтор безвреден (то же состояние) | — |
| Сдача отчёта `submit-report` | `route.ts:167-171` → `shift-close.ts:227` | **нет** | **нет** | **Повтор принимается**: вторая строка `ReportAudit` + второе `ReportSubmitted` (`shift-close.ts:204-215`) | См. находку 1 |
| Закрытие смены `close-shift` | `route.ts:172-176` → `shift-close.ts:41` | нет | состояние смены (`Shift.state`) | Повтор → `requireOpenShift` отвергает `CLOSED` 409 (`shared.ts:66-68`) | — |

### Отчёт (наследие, вне готовности)

| Команда | Где принимается | Ключ | Уникальный индекс/ограничение | Повтор | Две разные команды |
|---|---|---|---|---|---|
| Upsert отчёта (оператор / админ) | `src/app/api/reports/upsert/route.ts:17`, `reports/admin-upsert/route.ts:17` → `report-command.service.ts:81` | нет (`reportId`/`id` из тела, иначе `crypto.randomUUID()` — `upsert/route.ts:71`) | `Report.reportId @unique` (`:1930`), `Report @@unique([tenantId, shiftId])` (`:1986`), частичный `Report_user_site_date_without_shift_key` (миграция `20260829200000_report_legacy_identity_guard/migration.sql:15`) | advisory-замок на «пользователь+объект+дату» (`report-command.service.ts:114-128`) → повтор находит тот же отчёт и перезаписывает | Разные отчёты различаются `reportId`; без `reportId` при другой дате/объекте — разные отчёты |
| Удалить отчёт | `reports/delete/route.ts:41` | нет | `reportId` | Повтор → 404 (`:148-150`) | — |

### Осмотр (наследие)

| Команда | Где принимается | Ключ | Уникальный индекс/ограничение | Повтор | Две разные команды |
|---|---|---|---|---|---|
| Старт осмотра блочный (ЕО/ТО) | `src/app/api/inspections/route.ts:53` → `inspection-commands.ts:60` | нет | `Inspection @@unique([tenantId, shiftId, phase])` (`schema.prisma:1584`) | При заданном `shiftId` — дедуп `findUnique` (`:79-84`); без `shiftId` — дедупа нет | Разные `shiftId`/`phase` — разные осмотры |
| Старт осмотра легаси (по `templateId`) | `route.ts:64` → `inspection-commands.ts:184` | нет | тот же, но `shiftId`/`phase` не задаются | **Дубликат** (см. находку 2) | — |
| Сохранить ответы | `inspections/[id]/route.ts` → `inspection-commands.ts:265` | нет | нет | «стереть+вставить» под блокировкой строки (`:285-319`) — идемпотентно | — |
| Завершить осмотр | `inspections/[id]/complete/route.ts:17` → `inspection-commands.ts:332` | нет | `updateMany ... status != COMPLETED` (`:414`) | Идемпотентно, `replayed: true` (`:418-427`) | Параллельно — один переход, проигравший получает `replayed` |

### Медиа и прочее

| Команда | Где принимается | Ключ | Уникальный индекс/ограничение | Повтор | Две разные команды |
|---|---|---|---|---|---|
| Запрос presigned-URL | `src/app/api/media/route.ts:19` | нет | `Media.key @unique` (ключ хранилища) | Новая строка `Media` `pending` на каждый вызов (находка 5) | — |
| Подтверждение загрузки | `media/[id]/confirm/route.ts:8` | нет | `id` | Идемпотентно (смена статуса) | — |
| Разбор происшествия | `src/app/api/admin/incidents/route.ts:103` | нет | `updateMany ... reviewedAt = null` (`:119-126`) | Повтор → 409 (`:127-129`) | — |

### Команды без защиты от повтора (отдельный список)

- `submit-report` — `src/app/api/operator/mobile/command/route.ts:167` → `shift-close.ts:227`.
- Старт осмотра легаси — `src/app/api/inspections/route.ts:64` → `inspection-commands.ts:184`.
- `submit-knowledge` (проверка знаний) — `route.ts:40` → `admission.ts:304` (история пишется всегда).
- `POST /api/media` (presigned-URL) — `media/route.ts:19`.
- `correct-production`, `submit-checklist`, `report-incident` — ключ есть, но нет перехвата `P2002`
  (защита от одиночного повтора есть, от одновременного — нет).
- `accept-equipment` — ключ покрывает только свидетельство, не смену (`equipment.ts:22`).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/operator-mobile/application/commands/shift-close.ts:227`; `src/app/api/operator/mobile/command/route.ts:167` | У команды `submit-report` нет ни `clientCommandId`, ни проверки «отчёт уже сдан». Контур готовности держит смену открытой после сдачи, поэтому `requireOpenShift` пропускает повтор | Потеря ответа/двойной тап: вторая строка `ReportAudit` и второе событие `ReportSubmitted` → двойной счёт в аналитике/уведомлении. Поведение зафиксировано тестом как факт: `shift-close.test.ts:229-244` («повторная сдача принимается и пишет вторую строку истории») | Либо добавить `clientCommandId` в схему `submit-report`, либо проверять `report.status === 'submitted'` и возвращать прежний результат; на стороне конвейера — поставить `dedupeKey` на событие `ReportSubmitted` |
| 2 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:184`; `src/app/api/inspections/route.ts:64` | Легаси-старт осмотра по `templateId` создаёт `Inspection` и `MaintenanceRecord` без дедупа; уникальный `Inspection @@unique([tenantId, shiftId, phase])` (`schema.prisma:1584`) не работает, т.к. здесь `shiftId = NULL` (NULL в уникальном индексе ≠ NULL) | Повтор запроса (обрыв, ретрай) заводит второй осмотр и второй наряд ТО на ту же машину | Добавить пред-проверку/`clientCommandId` по аналогии с `startToInspection`; либо закрыть легаси-путь, если экранов на нём нет |
| 3 | мелочь | `src/modules/operator-mobile/application/commands/production-corrections.ts:76` | `correct-production` делает пред-проверку `findByCommand`, но не перехватывает `P2002`, в отличие от `log-production` (`production.ts:570-577`) | Два одновременных повтора прошли пред-проверку → один падает `P2002` → сырая 500 вместо прежнего результата | Повторить приём `log-production`: на `P2002` перечитать `findByCommand` и вернуть результат |
| 4 | мелочь | `src/modules/operator-mobile/application/commands/checklist.ts:107` | `submit-checklist` — только пред-проверка, без перехвата `P2002` | Одновременная двойная отправка чек-листа (две вкладки) → 500 у одной | Тот же приём, что в `log-production` |
| 5 | мелочь | `src/modules/operator-mobile/application/commands/incidents.ts:61` | `report-incident` — только пред-проверка, без перехвата `P2002` | То же: одновременный повтор → 500 | Тот же приём |
| 6 | мелочь | `src/app/api/media/route.ts:19-61` | Выдача presigned-URL не идемпотентна: каждый вызов создаёт новую строку `Media` (`pending`) с новым ключом хранилища | Ретрай → «висячие» `pending`-строки, мусор в хранилище/БД | Принимать `clientCommandId`/хеш (файл+сущность) и возвращать уже выданный URL для той же команды |
| 7 | мелочь | `src/modules/operator-mobile/application/commands/admission.ts:341` | `submit-knowledge` всегда создаёт `BriefingRecord` (нет ключа, нет дедупа по дню, в отличие от `acknowledge-briefing`) | Повтор команды добавляет вторую строку в журнал ОТ | Ввести дедуп «сутки + код + версия», как в `briefingRecordedOnDay` |
| 8 | гипотеза | `src/modules/operator-mobile/application/commands/equipment.ts:63-108` | `accept-equipment` не имеет ключа на `Shift`; при создании берётся `randomUUID()` (`:74`). Ключ команды покрывает только `OperatorShiftEvidence` (`:135-144`) | Если смена, заведённая первой попыткой, уже закрыта, повтор `accept-equipment` создаст НОВУЮ смену (свидетельство при этом дедуплицируется). Под одновременностью не воспроизводилось | Перенести ключ команды на создание смены или принимать `shiftId` в команде |
| 9 | гипотеза | `prisma/schema.prisma:1584` | `Inspection @@unique([tenantId, shiftId, phase])` не ограничивает строки с `shiftId IS NULL` | Осмотры вне смены (механик, легаси) от этого индекса не защищены | Если нужна защита осмотров вне смены — частичный уникальный индекс по аналогии с `Report_user_site_date_without_shift_key` |
| 10 | методика | `src/core/security/idempotency.ts:1-11`; `prisma/schema.prisma:2632-2656` | Таблица `IdempotencyKey` обслуживает только конвейер готовности. Легаси-хелперы (`withIdempotency` и др.) удалены 01.10.2026; глобальный `@@unique([scope, key])` (`:2650`) сохранён ради совместимости, но сейчас его никто, кроме конвейера, не использует | Не баг, а факт: искать вторую («скрытую») реализацию идемпотентности негде | Учесть при будущем расширении ключа на другие маршруты |

### Подтверждённые механизмы (ПРОЙДЕНО, для полноты)

- Все мобильные записи выработки/осмотра/происшествия/свидетельств имеют `@@unique([tenantId, clientCommandId])`:
  `PileWork:2206`, `LeaderDrilling:2383`, `ReportDowntime:2427`, `PilePassport:2307`,
  `OperatorChecklistExecution:1243`, `OperatorChecklistAnswerRecord:1268`, `OperatorShiftEvidence:1291`,
  `SafetyIncident:1334`.
- `log-production` — образец обработки повтора: пред-проверка до правил + перехват `P2002` с повторным
  чтением (`production.ts:118-121, 555-578`).
- Upsert отчёта — advisory-замок на естественный ключ «пользователь+объект+дата» + `upsert` по
  `[tenantId, shiftId]` (`report-command.service.ts:114-117`; `shared.ts:398-422`).
- `Shift_one_active_per_equipment_key` (миграция `20260730105000_readiness_shifts_handovers/migration.sql:40-41`)
  запрещает две активные смены на установку.
- `ReportDowntime_reason_present` (миграция `20260829200100_downtime_reason_required/migration.sql:16`) —
  CHECK-ограничение Prisma-неописуемое, на идемпотентность не влияет, но относится к целостности команды простоя.

## Не проверено

- Поведение под настоящей одновременностью (гонки `P2002` в находках 3–5, новая смена в находке 8) —
  выведено из кода, но НЕ воспроизводилось запуском тестов/нагрузки: локальная БД не поднималась,
  `.env` не читался, интеграционные проверки не запускались.
- `submitKnowledgeTest`: расходуется ли `attemptToken` при повторной отправке (одноразовый ли он) —
  файл `../knowledge-attempt` не открывался; не проверено, приводит ли повтор к дублю `BriefingRecord`
  или к отказу.
- Наличие/отсутствие потерянных (не описанных в `schema.prisma`) индексов на боевой БД — сравнивался
  только `prisma/schema.prisma` и файлы миграций в репозитории; живая схема PostgreSQL не читалась.
- Экраны, которые реально вызывают легаси-путь `POST /api/inspections` с `templateId` — не искал по UI
  (находка 2 дана по коду маршрута; возможно, легаси-путь уже не вызывается ни одним экраном — тогда
  severity ниже).
- Не проверялись контуры вне списка задачи: `equipment`, `crews`, `sites`, `users`, `documents`,
  `dictionary/manage`, `settings`, `maintenance*`, `briefings`, телеметрия — их команды записи в этот
  отчёт не входят.
- `src/generated` в этой рабочей папке не генерировался (`npm run db:generate` не запускался) — на
  чтение кода это не влияло, на запуск тестов повлияло бы.
