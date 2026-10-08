# AU21-S6-REPORT-CORRECTIONS-AUDIT-R2 — История исправлений отчёта и журнал аудита

Версия: `git rev-parse HEAD` = `aa00725133392d1aaf1e9b446ba45de3ae45e19c` (ветка `hermes/q4-0926`).
Аудит только по чтению: код приложения не менялся. Существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не открывались (независимость первого прохода).

## Итог

- Находок: **16** — критично **0**, важно **12**, мелочь **4**. Записи журнала `ReportAudit` в приложении не редактируются и не удаляются (0 вхождений на изменение), но **БД этого не запрещает** (нет триггера, роль приложения имеет UPDATE/DELETE на все таблицы).
- `ReportAudit` — не настоящая неизменяемая цепочка: у строки есть `beforeHash`/`afterHash`, но это **некриптографический** хэш, который к тому же теряет вложенные поля и **нигде не проверяется**; функции проверки цепочки для отчёта нет вовсе (для `AuditLog` готовности — есть).
- Удаление отчёта не оставляет строки в `ReportAudit`: нет ни FK `ReportAudit→Report`, ни записи действия `deleted`; строки остаются сиротами и становятся нечитаемыми (RLS). Единственный след удаления — `FeedbackEvent` в общей ленте.
- Мобильный контур смены (приём, «завершить работу», закрытие) почти не аудируется: `acceptEquipment`/`finishWork` не пишут ни в `ReportAudit`, ни в `AuditLog`; мобильное создание отчёта и записи выработки/поправки видны **только** в истории самого отчёта (`ReportAudit`), но не в общей ленте (`FeedbackEvent`).
- Главное: **5 самых значимых** — №1 (сироты и нечитаемость истории при удалении), №3 (иммутабельность держится только на дисциплине кода), №4 (хэш целостности не работает и не проверяется), №6 (нет следа у мобильных действий со сменой), №7 (мобильное создание отчёта без шага «создан»).

## Методика

Что искал и как (можно повторить):

- Точка входа — модель `ReportAudit` (`prisma/schema.prisma:2010`) и сервис `src/services/audit/**` (`audit-service.ts`, `audit-history-service.ts`), связанные сервисы `src/services/reports/**`.
- Все места записи/чтения: `search_files` по `writeReportAuditRow`, `recordAuditEvent`, `recordPostCommitAuditEvent`, `reportAudit.`, `getReportHistory`, `getEntityHistory`, `reportVersion.create`.
- Ограничения БД: чтение `prisma/migrations/**` (создание таблицы, RLS, триггеры), `scripts/app-role-grants.sql`, `scripts/apply-postgres-hardening.ts`.
- События смены: чтение команд мобильного контура (`modules/operator-mobile/application/commands/*`) и команд готовности (`modules/readiness/application/shifts/*`).
- Поведение хэша воспроизведено `node -e` (см. №4).

Команды и их вывод (выполнены в `D:\PillingR\wt-night`):

```
git rev-parse HEAD
  -> aa00725133392d1aaf1e9b446ba45de3ae45e19c

rg -n "writeReportAuditRow\(" src -g '!**/__tests__/**' -g '!**/*.test.*' | wc -l
  -> 7   (включая определение функции в audit-service.ts и внутренний вызов в recordAudit)

rg -n "recordAuditEvent\(" src -g '!**/__tests__/**' -g '!**/*.test.*' | wc -l
  -> 75  (вхождений, включая импорты/определения; не только вызовы)

rg -n "reportAudit\.(update|delete)" src | wc -l
  -> 0   (приложение не меняет и не удаляет строки ReportAudit)

rg -n "ReportAudit.*FOREIGN|FOREIGN.*ReportAudit" prisma | wc -l
  -> 0   (внешнего ключа ReportAudit -> Report нет)

node -e "const o={id:'r1',piles:[{pileGradeId:'g1',count:5}],status:'draft'}; console.log(JSON.stringify(o,Object.keys(o).sort()));"
  -> {"id":"r1","piles":[{}],"status":"draft"}   (вложенные поля выброшены)

node -e "<hashState как в audit-service.ts>" для двух разных вложенных состояний
  -> kd8op7 / kd8op7   (разные данные дают одинаковый хэш)
```

## Что фиксируется: таблица событий

Отчёт (модель `Report`, `prisma/schema.prisma:1927`; версия `ReportVersion:1993`; аудит `ReportAudit:2010`):

| Событие | Кто пишет (файл:строка) | Что в следе (кто/когда/что было/стало/причина) | Изменяемость записи | Как проверить |
|---|---|---|---|---|
| Создание отчёта формой | `src/modules/reports/application/commands/report-command.service.ts:290,311-318,323` (`action='created'`, in-tx через `onBeforeCommit`) | actorId + actorName + actorRole; `createdAt`; `newData` (полное состояние) → `afterHash`; `diff` нет. Причина не пишется | Только INSERT (код); БД не запрещает UPDATE/DELETE (№3) | `db.reportAudit.findMany({where:{reportId}})` по деловому `RM-…`; целостность не проверяется (№5) |
| Правка отчёта формой | `report-command.service.ts:290,293-310,323` (`action='updated'`) | actorId/Name/Role; `oldData`→`beforeHash`, `newData`→`afterHash`, `diff=computeDiff(old,new)`; причина не пишется | То же | То же; цепочка не проверяется |
| Сдача отчёта формой | Прямой записи «submitted» в `ReportAudit` НЕТ; `aggregate.submit()` на `report-command.service.ts:280`, действие остаётся `created`/`updated` (№9). След в `FeedbackEvent` — из outbox-события `ReportSubmitted` (`src/services/reports/event-handlers.ts:452,467`) | В ленте: актор, время, текст «Отчёт сдан». В `ReportAudit` — только смена `status` внутри `diff` | — | Лента `/api/audit` по scope=`reports`, targetId=`reportId` |
| Сдача/закрытие смены (мобильный контур) | `src/modules/operator-mobile/application/commands/shift-close.ts:204-213` (`action='submitted'`, in-tx) | actorId (имя/роль = NULL, №12); `newData` (status/submittedAt/closingComment); `diff` нет; IP/UA/requestId NULL (№13) | Только INSERT (код) | `db.reportAudit.findMany`; имя исполнителя в панели пустое (№12) |
| Дозапись выработки (сваи/паспорт/бурение/простой), мобильный | `src/modules/operator-mobile/application/commands/production.ts:547-552` (`action='updated'`, in-tx) | actorId; `diff = {'Выработка': {old, new}}` — краткий текст; имя/роль NULL; причина не пишется | Только INSERT (код) | `db.reportAudit.findMany` (по деловому `RM-…`, `shared.ts:433`); в общую ленту НЕ попадает (№8) |
| Поправка выработки, мобильный | `src/modules/operator-mobile/application/commands/production-corrections.ts:25-33,126,167,209` (`action='updated'`) | actorId; `diff = {'Выработка': {old:'было N', new:'стало M'}}`; причина (`reason`) хранится в записи поправки (`correctionNote`), в `ReportAudit.diff` не дублируется | Только INSERT (код) | То же |
| Версии отчёта (снимки) | `src/modules/reports/infrastructure/report.repository.ts:243-257` (в той же транзакции) | `ReportVersion`: reportId, version, полный `data`, actorId, `createdAt`. Триггера иммутабельности нет (№15) | Только INSERT (код) | `db.reportVersion.findMany({where:{reportId},orderBy:{version:'desc'}})` |
| Удаление отчёта | `src/app/api/reports/delete/route.ts:109` (`tx.report.delete`) — строку в `ReportAudit` НЕ пишет; след только в `FeedbackEvent` (`route.ts:185-196`) и в outbox `ReportDeleted` (`route.ts:116-136`) | `ReportAudit`: нет записи о действии `deleted` (№2). Сироты остаются (№1). В ленте: актор, время, дата/объект/итоги из снимка `before` | — | Историю отчёта после удаления открыть нельзя: `getReportHistory` сначала делает `report.findUnique` и бросает 404 (`src/services/reports/report-history-service.ts:43-47`) |

Смена (модель `Shift`, `prisma/schema.prisma:1081`):

| Событие | Кто пишет (файл:строка) | Что в следе | Изменяемость | Как проверить |
|---|---|---|---|---|
| Создание/правка/старт/приёмка/отмена смены (контур готовности) | `src/modules/readiness/application/shifts/commands.ts:68-96,118,144,183,195,202,221,272,296,312` → `recordChainedReadinessAudit` | Цепочечный журнал `AuditLog`: tenantId, sequence, actor (id/name/role/actingAs), action `shift.*`/`handover.*`, entityType/Id/Version, before/after, prevHash+hash | Append-only **триггером БД** (`prisma/migrations/20260730103000_audit_chain_v1/migration.sql:43-58`) + unique(tenantId,hash) | `verifyAuditEvents` (`src/modules/readiness/infrastructure/audit/verify-chain.ts:23`) через `GET /api/readiness/audit` (`src/app/api/readiness/audit/route.ts:33`) |
| Авто-закрытие смены планировщиком | `src/modules/readiness/application/scheduler.ts:177-185` | `AuditLog`: action `shift.auto-closed`, актор-планировщик | Как выше | Как выше |
| Приём установки с телефона (открытие смены) | `src/modules/operator-mobile/application/commands/equipment.ts:75-108` — **аудита нет**; пишет только `OperatorShiftEvidence` (`:135`) | Ни `ReportAudit`, ни `AuditLog` | — | След отсутствует (№6) |
| «Завершить работу» с телефона (→HANDOVER_PENDING) | `src/modules/operator-mobile/application/commands/shift-close.ts:23-26` — **аудита нет** | — | — | След отсутствует (№6) |
| Закрытие смены с телефона (→CLOSED) | `shift-close.ts:86-92` — состояние смены не аудируется; в `ReportAudit` пишется только `submitted` отчёта (`:204`) | — | — | Само изменение смены следа не оставляет (№6) |

## Находки

Severity: критично / важно / мелочь. Каждая строка — с реально открытым `path:line`.

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `prisma/schema.prisma:2010-2028`; `prisma/migrations/20260419190903_init/migration.sql:242-258`; `src/app/api/reports/delete/route.ts:109`; RLS `prisma/migrations/20260903000000_rls_remaining_tables/migration.sql:192-194` | У `ReportAudit` нет внешнего ключа на `Report` (0 FK по rg). Удаление отчёта не трогает строки аудита | Отчёт удалён → строки `ReportAudit` остаются сиротами; RLS-политика (`EXISTS … Report r …`) делает их нечитаемыми, связь не восстановить | Добавить FK `reportId → Report.reportId ON DELETE CASCADE` (или удалять строки аудита в той же транзакции) |
| 2 | важно | `src/app/api/reports/delete/route.ts:109-196`; `src/services/reports/audit-service.ts:11`; `src/services/reports/report-history.ts:29` | Удаление отчёта не пишет строку в `ReportAudit`, хотя действие `deleted` объявлено и имеет подпись | В самом журнале отчёта нет факта удаления; кто и что удалил — только в общей ленте. Тип `AuditRecord.action` включает `deleted`, но ни один вызов его не использует (rg: `action:'deleted'` → 0) | Писать `writeReportAuditRow({action:'deleted',…})` внутри транзакции удаления (или явно описать, что история удалённого отчёта не хранится) |
| 3 | важно | `prisma/schema.prisma:2007,2010-2028`; `scripts/app-role-grants.sql:98,112-113`; сравнение: `prisma/migrations/20260730103000_audit_chain_v1/migration.sql:43-58`; `..._readiness_snapshot_immutability/migration.sql:8-12`; `..._operator_v3_mobile_new_spec/migration.sql:109-110` | Иммутабельность `ReportAudit` (`"Immutable diff tracking"`) держится только на дисциплине кода: триггера `BEFORE UPDATE/DELETE` нет, роль приложения `pilingtrack_app` имеет UPDATE и DELETE на все таблицы | Ошибка в любом скрипте/запросе с доступом к БД может переписать или удалить историю без следа; для `AuditLog` готовности такое запрещено триггером | Добавить триггер `BEFORE UPDATE OR DELETE` (как для `AuditLog`), при необходимости — REVOKE UPDATE/DELETE у роли приложения на `ReportAudit`/`ReportVersion` |
| 4 | важно | `src/services/reports/audit-service.ts:101-109,46-47`; `prisma/schema.prisma:2018-2019` | `beforeHash`/`afterHash`: некриптографический 32-битный хэш от `JSON.stringify(obj, Object.keys(obj).sort())`. Массив-разрешение выбрасывает вложенные поля (проверено `node`: `{piles:[{pileGradeId,count}],status}` → `{"piles":[{}],…}`), разные вложенные состояния дают одинаковый хэш (`kd8op7`). Нигде не читается/не проверяется | Заявленная «Hash of previous state for integrity verification» не работает: целостность строки доказать нельзя, возможны коллизии | Если целостность нужна — считать SHA-256 от канонического JSON (без allow-list), сохранять и проверять; иначе убрать поля/обещание из схемы |
| 5 | важно | `src/modules/readiness/infrastructure/audit/verify-chain.ts:23`; `src/app/api/readiness/audit/route.ts:33` (только для `AuditLog`); для отчёта проверки нет | Нет функции и endpoint проверки цепочки для `ReportAudit`; `ReportAudit` вообще не цепочка (нет prevHash/sequence) | На вопрос «как проверить цепочку» по отчёту ответить нечем; «проверено» превращается в «доверяем коду» | Либо признать в доке, что история отчёта — не цепочка, либо строить её по образцу `AuditLog` (sequence+prevHash+verify) |
| 6 | важно | `src/modules/operator-mobile/application/commands/equipment.ts:75-108`; `shift-close.ts:23-26`; `shift-close.ts:86-92` | Мобильные действия со сменой (открытие/приёмка, «завершить работу», закрытие) не оставляют следа: ни `ReportAudit`, ни `AuditLog`. `acceptEquipment` пишет только `OperatorShiftEvidence` (`:135`) | Кто и когда открыл/завершил/закрыл смену с телефона — нигде; контур готовности пишет в `AuditLog`, а мобильный — нет, ответы на один вопрос расходятся | Писать аудит смены и в мобильном контуре (через `recordChainedReadinessAudit` или отдельный журнал) |
| 7 | важно | `src/modules/operator-mobile/application/commands/shared.ts:402-419`; `production.ts:547` | Отчёт, созданный сменой, заводится через `ensureReport` без записи `ReportAudit 'created'`; первая запись истории — `updated` | В истории отчёта нет шага «создан»; последовательность начинается с «Изменён» | Писать `created` при первом создании отчёта (или обеспечить единый `ensureReport`, который это делает) |
| 8 | важно | `production.ts:547-552`; `production-corrections.ts:28-33`; `src/services/reports/audit-service.ts:61-74,81-96` | Выработка и поправки мобильного контура пишут только `ReportAudit`, но НЕ `recordAuditEvent`/`recordPostCommitAuditEvent` | Общая лента (`/api/audit`, `/admin`) не покажет, что в отчёт дописали сваи или поправку; видно только в истории конкретного отчёта | Добавить post-commit событие (или в outbox) для записей выработки/поправок |
| 9 | важно | `src/modules/reports/application/commands/report-command.service.ts:280,290,298,312` | Форма вызывает `aggregate.submit()`, но в `ReportAudit` пишет всегда `created`/`updated`; действие `submitted` для формы не пишется (у мобильного — пишется, `shift-close.ts:206`) | «Отправлен» в истории отчёта появляется не для всех способов сдачи | Различать `submitted` в `upsertReport` (или в репозитории) для формы |
| 10 | важно | `src/services/reports/event-handlers.ts:449-453`; `src/modules/reports/domain/report-event-types.ts:3,6` | `registerAuditEventHandler` подписан на `ReportUpdated` и `ReportVersionCreated`, но эти доменные события никто не порождает (rg `createReportEvent('ReportUpdated'/'ReportVersionCreated')` → 0). Подписки на `ReportDeleted` нет | Ожидаемых записей в ленте нет; `ReportDeleted` через outbox не аудируется (writeFeedbackEvent только вручную в delete-route) | Убрать мёртвые подписки либо начать порождать события; добавить обработку `ReportDeleted` или убрать событие |
| 11 | мелочь | `report-command.service.ts:334`; `src/services/reports/audit-service.ts:62,83,86`; `event-handlers.ts:452,467` | Для формы одна правка даёт два следа в `FeedbackEvent`: post-commit `report.created`/`report.updated` и outbox `ReportCreated`/`ReportSubmitted` | Лента зашумлена дублями по одному действию | Оставить один путь эмиссии |
| 12 | важно | `production.ts:547-552`; `shift-close.ts:204-213` (нет `userName`/`userRole`); `src/services/reports/report-history-service.ts:70-71` | Мобильные записи `ReportAudit` не заполняют `actorName`/`actorRole`; `getReportHistory` не подставляет имя из `userMap`, а отдаёт `row.actorName ?? null` | В истории отчёта у мобильных действий нет имени/роли исполнителя (только `actorId`) | Передавать имя/роль (как форма) либо разрешать их из `actorId` при чтении |
| 13 | важно | `prisma/migrations/20260419190903_init/migration.sql:252-254`; `prisma/schema.prisma:2020-2022`; `src/services/reports/audit-service.ts:48-49,71-72,92-93`; вызовы `production.ts:547`, `shift-close.ts:204`, `report-command.service.ts:323` | Колонки `ipAddress`, `userAgent`, `requestId` объявлены («Correlation ID from request»), но ни один вызов `writeReportAuditRow` их не передаёт (rg `ipAddress:`/`userAgent:` → только внутри `audit-service.ts`) | След нельзя привязать к запросу/IP; корреляция с логами невозможна | Заполнять поля из контекста запроса или убрать из схемы |
| 14 | мелочь | `src/services/reports/audit-service.ts:37` | `writeReportAuditRow` молча выходит, если в Prisma-клиенте нет модели `reportAudit` | При отставшем сгенерированном клиенте аудит пропадёт без ошибки | Логировать/бросать при отсутствии модели в проде |
| 15 | важно | `prisma/schema.prisma:1990,1993-2004`; `scripts/app-role-grants.sql:98`; сравнение с триггерами (см. №3) | `ReportVersion` объявлена «Immutable snapshots for audit/legal», но без FK на `Report` и без триггера иммутабельности; роль приложения может UPDATE/DELETE | Снимки версий можно переписать/удалить без следа; при удалении отчёта версии остаются сиротами | Триггер `BEFORE UPDATE OR DELETE` и/или FK, либо поправить формулировку в схеме |
| 16 | мелочь | `src/modules/operator-mobile/application/commands/shared.ts:402-419` | `ensureReport` пишет `Report` через `tx.report.upsert` в обход репозитория («SINGLE write path», `report.repository.ts:4`) | Изменение отчёта идёт путём, который не проходит через аудирующий репозиторный слой | Провести создание через репозиторий либо явно задокументировать исключение |

## Что не проверено

- **Не проверялись сами данные БД**: строки `ReportAudit`/`FeedbackEvent`/`AuditLog` не читались (нет доступа/prod запрещён). Всё выше — вывод из кода, схемы и миграций, а не из живой базы. Статус выводов: **ПРОЙДЕНО** для мест записи/чтения кода и для поведения хэша (воспроизведено `node`), **ГИПОТЕЗА** там, где утверждение о поведении БД зависит от реально задеплоенной роли/политик.
- **Фактическая роль подключения приложения**: фактические права `pilingtrack_app` в проде не проверялись — вывод о UPDATE/DELETE сделан по `scripts/app-role-grants.sql`, а не по `\dp` на живой базе.
- **RLS в рантайме**: что `app.current_tenant` действительно выставляется на каждой транзакции `ReportAudit` — не проверялось (только чтение политики в миграции).
- **Триггеры в проде**: наличие/отсутствие триггеров подтверждено только по файлам миграций; применения миграций к боевой БД не видел.
- **Кто ещё пишет в `ReportAudit`** через динамические/строковые вызовы или скрипты — проверено текстовым поиском по `src/` и `scripts/`; GitNexus-граф не использовался.
- **Тесты аудита** (`src/services/audit/__tests__/*`, `src/services/reports/__tests__/report-history-service.test.ts`) прочитаны не полностью — их утверждения о поведении в этом отчёте не перепроверялись.
- Заморожённые области (варианты экрана оператора, ORION) не анализировались.
