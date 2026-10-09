# AU126-S2-REPORT-STATE-MACHINE: Отчёт — состояния и переходы по коду

Версия кода (git rev-parse HEAD): `208951493268dbd7fb4273c227df073495d94f6b`
Ветка: `hermes/q4-0926`. Аудит только на чтение: изменений в коде нет, создан один файл — этот отчёт.
Статусы ниже: ПРОЙДЕНО (подтверждено кодом/тестом, который я открыл), ГИПОТЕЗА (вывод из прочитанного без прямого подтверждения), НЕ ПРОВЕРЕНО (не смотрел / нет доступа).

## Итог

Всего находок: 20. По важности: 0 критично, 11 важно, 9 мелочь.
Состояний в `Report.status` всего два — `draft` и `submitted`; третьего (напр. `deleted`, `corrected`) в схеме нет: удаление — это удаление строки, «исправлен» — производное от `version > 1`.
Главное: путь сменного отчёта `POST /api/reports/upsert` переводит отчёт в `submitted`, но **никогда не пишет ни `submittedAt`, ни строку истории с действием `submitted`** — сдачу по этому пути в журнале отчёта не видно (только «Создан/Изменён»), а окно правки считается от `createdAt`.
Второе: поле `status` принимается схемой `reportUpsertSchema` (дефолт `draft`), но команда его игнорирует — клиент, отправивший `status:'draft'`, молча получает `submitted`.
Третье: состояние необратимо — перехода `submitted → draft` («отозвать сдачу») нет ни в коде, ни в API; удаление необратимо и не оставляет доступной истории.
Топ-5 по значимости: №1 (нет `submittedAt` на форме), №2 (нет истории «Отправлен» на форме), №6 (`status` игнорируется), №10 (неидемпотентная сдача `submit-report`), №8 (нет доступа к истории удалённого отчёта).

## Методика

Что смотрел (только чтение; пути от корня репозитория):

- Схема: `prisma/schema.prisma` (модели `Report`, `ReportVersion`, `ReportAudit`), миграции — поиск CHECK/ENUM по `status`.
- Домен: `src/modules/reports/domain/report.aggregate.ts`, `report-event-types.ts`.
- Команды/инфраструктура: `src/modules/reports/application/commands/report-command.service.ts`, `upsert-report.command.ts`, `src/modules/reports/infrastructure/report.repository.ts`.
- API: все 12 `route.ts` под `src/app/api/reports/` (`upsert`, `admin-upsert`, `edit`, `delete`, `all`, `my`, `period`, `export`, `pdf`, `single-pdf`, `recent`, `[id]/history`), плюс `src/app/api/operator/mobile/command/route.ts`, `src/app/api/operator/shift/route.ts`.
- Второй контур записи (мобильный/готовность): `src/modules/operator-mobile/application/commands/{shared,production,production-corrections,shift-close}.ts`, `src/modules/readiness/application/scheduler.ts`, `src/modules/readiness/application/shifts/commands.ts`.
- Аудит/история: `src/services/reports/audit-service.ts`, `src/services/audit/audit-service.ts`, `src/services/reports/report-history-service.ts`, `src/services/reports/report-history.ts`, `src/services/reports/event-handlers.ts`.
- Права: `src/services/auth/authorization-service.ts`, `src/services/auth/resource-access-service.ts`.
- Чтение/UI: `src/modules/reports/application/queries/report-query.service.ts`, `report-export.service.ts`, `src/lib/report-status.ts`, `src/lib/validation-schemas.ts`, `src/components/piling/admin-reports/admin-reports.tsx`, `report-form-dialog.tsx`, `src/components/piling/report-form/{report-form.tsx,use-report-form.ts}`, `src/modules/sites/application/commands/site-command.service.ts`.

Как искать (команды воспроизводимы):

```bash
git rev-parse HEAD
rg -n "status: 'submitted'|status: 'draft'" src -g '!**/__tests__/**' -g '!**/*.test.*'
rg -n "action: '(created|updated|submitted|deleted)'" src -g '!**/__tests__/**' -g '!**/*.test.*'
rg -n "submittedAt" src
rg -n "reportQuerySchema|isSubmittedReport" src
find src/app/api/reports -name route.ts | wc -l   # 12
grep -rn "status" prisma/migrations/*/migration.sql | grep -iE "CHECK|Report"
```

Числа из команд (не из памяти):

- Writer-мест, задающих `Report.status` в не-тестовом коде: 10 вхождений `status: 'draft'|'submitted'` (rg выше); непустой список моделей: `report.aggregate.ts:142`, `report-command.service.ts:224`, `shared.ts:413` (draft); `shift-close.ts:175,209`, `scheduler.ts:216` (submitted); остальные — фильтры `where`, не запись.
- Запись аудита отчёта с `action: 'submitted'` — ровно одна точка: `src/modules/operator-mobile/application/commands/shift-close.ts:206`.
- Маршрутов API отчётов: 12.
- Тесты (запускал): `node node_modules/vitest/vitest.mjs run src/modules/reports/domain/__tests__/report-aggregate.test.ts src/modules/reports/application/commands/__tests__/report-command-service.test.ts src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts src/modules/readiness/application/__tests__/scheduler.test.ts src/app/api/reports/delete/__tests__/route.test.ts` → **Test Files 5 passed (5), Tests 85 passed (85), exit code 0**. Скипов нет (эти наборы — юнит-тесты на моках, БД не нужна).

## Состояния

| Состояние | Значение в БД | Ярлык в UI/выгрузке | Источник |
| --- | --- | --- | --- |
| Черновик | `draft` | «Черновик» | `src/services/reports/report-history.ts:33` (`STATUS_LABELS`), `src/components/piling/admin-reports/admin-reports.tsx:37` |
| Сдан | `submitted` | «Отправлен» / в выгрузке «сдан» | `src/services/reports/report-history.ts:29,33`, `src/modules/reports/application/queries/report-export.service.ts:100-104` |
| Удалён | строки нет (жёсткое удаление) | состояния нет; в ленте — «Отчёт удалён» | `src/app/api/reports/delete/route.ts:109,190` |
| «Исправлен» | НЕ хранится: `status` остаётся `submitted`, растёт `version` | «Корректировка отчёта (ред. №N)» (Telegram) | `src/services/reports/event-handlers.ts:613-638` |

Важно: `Report.status` в схеме — обычная строка `String @default("draft")` без ENUM и без CHECK (`prisma/schema.prisma:1939`; в миграциях — только индексы вида `CREATE INDEX "Report_status_idx"`, ENUM/CHECK для `Report.status` не найден). Достоверность состояния гарантирует только код приложения.

## Переходы

| из | в | действие | роль | условия | события | запись в аудит | файл:строка | тест |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| — | `draft` | запись выработки с приложения (первая): `logProduction` → `ensureReport` (upsert по `[tenantId, shiftId]`) | OPERATOR (закреплён за установкой) | смена не `CLOSED/CANCELLED` и ведётся этим машинистом; `requireCrew`; `requireProductionPermit` | доменного `ReportCreated` НЕТ (прямой `tx.report.upsert`) | строки `ReportAudit` при создании нет; последующие записи пишут `action: 'updated'` | `src/modules/operator-mobile/application/commands/shared.ts:398-422`; `.../production.ts:547-552` | `.../commands/__tests__/production.test.ts` (ПРОЙДЕНО) |
| — / `draft` | `submitted` | `POST /api/reports/upsert` (форма сменного отчёта) | OPERATOR за себя; ADMIN/DISPATCHER за другого (`reports.manage_all`/`read_cross_user`) | план объекта, пикеты принадлежат объекту, `assertUserAssignedToSite`, владелец и тенант совпадают, смена НЕ `STARTED/HANDOVER_PENDING`, окно 24 ч | `ReportCreated`, `PileWorkAdded`/`DrillingAdded`/`DowntimeAdded`, `ReportSubmitted` | `ReportAudit` `action: 'created'|'updated'` (НЕ `'submitted'`) + `AuditLog` `report.created`/`report.updated` | `src/modules/reports/application/commands/report-command.service.ts:280,290-318` | `src/modules/reports/application/commands/__tests__/report-command-service.test.ts`; `e2e/release-critical-path.spec.ts:45-46` (ПРОЙДЕНО) |
| `draft` | `submitted` | `closeShift` — закрытие смены | OPERATOR (владелец смены) | смена открыта, своя бригада, `EO_AFTER` COMPLETED | `ReportSubmitted` (outbox, в той же транзакции) | `ReportAudit` `action: 'submitted'` + `AuditLog` `ReportSubmitted` | `src/modules/operator-mobile/application/commands/shift-close.ts:172-216` | `.../commands/__tests__/shift-close.test.ts` (ПРОЙДЕНО) |
| `draft` | `submitted` | `submitReport` — сдача без закрытия смены (контур готовности) | OPERATOR | смена открыта, своя бригада, осмотр (`EO_AFTER` чек-лист ИЛИ `Inspection` фазы `POST_SHIFT`) | `ReportSubmitted` | `ReportAudit` `action: 'submitted'` | `.../shift-close.ts:227-294` | `.../commands/__tests__/shift-close.test.ts:206-244` (ПРОЙДЕНО) |
| `draft` | `submitted` | автозакрытие смены планировщиком (`runReadinessScheduler`) | СИСТЕМА (`actorId: null`) | смена просрочена (истекли производственные сутки), `status: 'draft'` по `shiftId` | `ReportSubmitted` c `autoClosed: true` | `ReportAudit` НЕ пишется (`updateMany` минует `writeReportAuditRow`); `AuditLog` `ReportSubmitted`, актор null | `src/modules/readiness/application/scheduler.ts:204-239` | `src/modules/readiness/application/__tests__/scheduler.test.ts:212-216` (ПРОЙДЕНО) |
| `submitted` | `submitted` (ред. N, `version`++) | повторный `POST /api/reports/upsert` в окне правки | OPERATOR за себя | как у upsert, окно считается от `submittedAt ?? createdAt` | повторно `ReportSubmitted` + элементы | `ReportAudit` `action: 'updated'` | `report-command.service.ts:210-228,290` | `report-command-service.test.ts:265+` (ПРОЙДЕНО) |
| `submitted` | `submitted` (правка любой давности) | `POST /api/reports/admin-upsert` | ADMIN, DISPATCHER (`reports.manage_all`) | без окна (`enforceEditWindow: false`); остальные проверки как у upsert | повторно `ReportSubmitted` | `ReportAudit` `action: 'updated'` | `src/app/api/reports/admin-upsert/route.ts:45-65` | `src/components/piling/admin-reports/__tests__/report-form-dialog.test.tsx` (ПРОЙДЕНО/частично) |
| `draft` | `draft` (встречная запись поправки) | `correct-production` | OPERATOR | смена открыта; отчёт НЕ `submitted`; причина ≥ 3 симв.; правимая строка не является поправкой | доменных событий нет | `ReportAudit` `action: 'updated'` | `src/modules/operator-mobile/application/commands/production-corrections.ts:25-34,85-90` | `.../commands/__tests__/production-corrections.test.ts` (ПРОЙДЕНО) |
| `draft` / `submitted` | — (строка удалена) | `DELETE /api/reports/delete` | ADMIN, DISPATCHER (`reports.manage_all`) | тенант совпадает (иначе 404); отчёт найден | `ReportDeleted` (outbox, со снимком) | `ReportAudit` НЕ пишется; `AuditLog` `report.deleted` (заголовок задан вручную) | `src/app/api/reports/delete/route.ts:41-207` | `src/app/api/reports/delete/__tests__/route.test.ts` (ПРОЙДЕНО) |
| `submitted` | `draft` | — | — | **перехода не существует** | — | — | `src/modules/reports/domain/report.aggregate.ts:363-367` (`assertDraft`) | `src/modules/reports/domain/__tests__/report-aggregate.test.ts:113-120` (ПРОЙДЕНО) |

Сопутствующее правило (не переход самого отчёта): передача машины в контуре готовности (`submitHandoverCommand`) требует уже сданного отчёта — `src/modules/readiness/application/shifts/commands.ts:326-330`.

## Переходы, достижимые прямым API в обход интерфейса

1. `POST /api/reports/upsert` со `status: 'draft'` — поле принимается, но игнорируется; фактический статус всегда `submitted` (см. табл. переходов, строка 2; находка №6).
2. `POST /api/reports/admin-upsert` — правка сданного отчёта **без 24-часового окна**, которое действует для формы (`admin-upsert/route.ts:64`). Кнопки окна в интерфейсе нет — правило снимается телом запроса (находка №7).
3. `DELETE /api/reports/delete` — необратимое удаление без экранного подтверждения (интерфейс показывает диалог, API — нет), жёсткое, без мягкого статуса (находка №8).
4. `GET /api/reports/edit` отдаёт отчёт любого статуса (`report-query.service.ts:41-68`) — форма открывает и пересдаёт сданный отчёт; серверного гейта по статусу нет (находка №11).
5. `command: 'submit-report'` (`/api/operator/mobile/command`) вызывается повторно с тем же `shiftId` — второй раз пишет вторую строку истории и второе событие (находка №10; поведение зафиксировано тестом как фактическое).

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | `src/modules/reports/application/commands/report-command.service.ts:206-211`, `src/modules/reports/infrastructure/report.repository.ts:177-224` | Путь формы (`upsert`) ставит `status='submitted'`, но `submittedAt` не пишет ни при создании, ни при обновлении. Столбец остаётся NULL. | Отчёт, сданный через форму, не имеет отметки сдачи. Окно правки для него считается от `createdAt` (`report-command.service.ts:211`); всё, что читает `submittedAt` (мобильная смена, PDF-доставка), получает `null`. Два способа сдать один документ пишут разные колонки. | Устанавливать `submittedAt` в `report.repository.ts` при переходе в `submitted` (или явно задокументировать, что форма — вне отметки сдачи). ПРОЙДЕНО по коду. |
| 2 | важно | `src/modules/reports/application/commands/report-command.service.ts:290-318`; `src/modules/operator-mobile/application/commands/shift-close.ts:204-213` | `ReportAudit` с `action: 'submitted'` пишет только контур смены (одна точка в коде). Путь формы всегда пишет `created`/`updated`, даже когда отчёт фактически сдан. | В истории отчёта, заведённого формой, шага «Отправлен» нет — видно «Создан»/«Изменён». По журналу нельзя установить, когда отчёт был сдан. | Писать отдельную строку `action:'submitted'` при переходе `draft→submitted` в командном сервисе. ПРОЙДЕНО. |
| 3 | важно | `src/modules/readiness/application/scheduler.ts:214-217` | Автозакрытие переводит `draft→submitted` через `updateMany`, минуя `writeReportAuditRow` (`src/services/reports/audit-service.ts:29-53`). | Для автосданного отчёта в истории тоже нет шага «Отправлен»; в общей ленте событие есть (`AuditLog`), но `ReportAudit` (история отчёта) пуст. | Писать `ReportAudit` и при автосдаче (в той же транзакции). ПРОЙДЕНО по коду. |
| 4 | важно | `prisma/schema.prisma:1939` | `Report.status` — `String @default("draft")`, без ENUM и без CHECK-ограничения; в миграциях для него только индекс. | Состояние держит исключительно код. Любая запись сырым SQL или будущая рассогласованность кода создадут недопустимый статус, а фильтры (`status: 'submitted'`) молча его потеряют (выработка не попадёт в аналитику/выгрузки). | CHECK-ограничение на `status IN ('draft','submitted')` (схему не менять в этой задаче — предложение). ПРОЙДЕНО. |
| 5 | важно | `src/modules/reports/domain/report.aggregate.ts:363-367` | Перехода `submitted → draft` («отозвать сдачу») нет нигде: `assertDraft` запрещает любые изменения сданного агрегата. | Ошибочно сданный отчёт нельзя вернуть в работу — только править поверх (что всегда остаётся `submitted`) либо удалять безвозвратно. Необратимость — скрытое ограничение процесса. | Явно описать как решение владельца; если нужен отзыв — отдельная команда со своей историей. ПРОЙДЕНО. |
| 6 | важно | `src/lib/validation-schemas.ts:251`; `src/modules/reports/application/commands/upsert-report.command.ts:5-24` | `reportUpsertSchema` содержит `status: z.enum(['draft','submitted']).default('draft')`, но `UpsertReportCommand` поля `status` не содержит и команда его не читает; отчёт всегда сдаётся (`report-command.service.ts:280`). | Клиент (или внешний вызов) с `status:'draft'` уверен, что создал черновик, — фактически получает сданный отчёт. Молчаливое расхождение контракта и поведения. | Убрать `status` из входной схемы upsert либо честно реализовать черновик. ПРОЙДЕНО. |
| 7 | важно | `src/app/api/reports/admin-upsert/route.ts:64` | Админский upsert вызывает команду с `enforceEditWindow: false`. | Правило «правка — через администратора в течение 24 ч» обходится тем же администратором без окна и без следа в интерфейсе; выработка давнего отчёта переписывается напрямую. | Явно назвать это административным правом и логировать факт правки давнего отчёта; либо оставить окно и для админа. ПРОЙДЕНО. |
| 8 | важно | `src/app/api/reports/delete/route.ts:109`; `src/services/reports/report-history-service.ts:43-48`; `src/services/auth/resource-access-service.ts:80-82` | Удаление жёсткое; строки `ReportAudit`/`ReportVersion` остаются, но `getReportHistory` читает `Report` по `reportId` — после удаления `report` = null, `ensureTenantAccess(user, null)` бросает 404. | История удалённого отчёта через API недоступна: удаление стирает и рабочий, и «архивный» след для пользователя. `ReportAudit`-данные лежат, но прочитать их нечем. | Дать админский путь чтения истории по `reportId` без опоры на живую строку `Report` (или мягкое удаление). ПРОЙДЕНО по коду. |
| 9 | мелочь | `src/app/api/reports/delete/route.ts:74-89` | Поиск перед удалением — `findFirst({ reportId, tenantId })`; у легаси-отчётов `tenantId = NULL`. | Админ видит легаси-отчёт в журнале, но удалить не может — API отвечает 404 «Отчёт не найден» (сравнение `NULL = 'orion'` ложно). | Отдельная ветка для строк без тенанта либо перенос данных. ГИПОТЕЗА (логика прочитана, на живой БД не воспроизводил). |
| 10 | важно | `src/modules/operator-mobile/application/commands/shift-close.ts:204-216` | `submit-report` не идемпотентен: нет `clientCommandId`, повтор проходит проверку и пишет вторую строку `ReportAudit` и второе событие `ReportSubmitted`. | Двойная сдача → второй PDF в Telegram, повторный пересчёт проекций, в истории две «Отправлен». Поведение зафиксировано тестом как фактическое. | Ввести идемпотентность по `clientCommandId` или гейт «уже `submitted`». ПРОЙДЕНО (`shift-close.test.ts:238-244`). |
| 11 | важно | `src/modules/reports/application/queries/report-query.service.ts:41-68` | `getEditableReport` не фильтрует по `status`. | Форма оператора открывает и пересдаёт уже сданный отчёт (в пределах окна) — нет гейта «сданный документ не редактируется» на чтении; правки уходят повторным upsert. | Возвращать признак «уже сдан» и запрещать правку в форме, либо явно оставить как право окна. ПРОЙДЕНО. |
| 12 | важно | `src/modules/operator-mobile/application/commands/production.ts:220-227`, `production-corrections.ts:85-90` | Мобильный контур запрещает любую запись в сданный отчёт («закрытый документ»), а форма/upsert — разрешает (пересобирает отчёт). | Два контура отвечают на вопрос «можно ли менять сданный отчёт» по-разному: с телефона — нет, из формы — да (в окне). Одно и то же действие доступно одним путём и запрещено другим. | Свести правило в одно место или явно задокументировать разницу контуров. ПРОЙДЕНО. |
| 13 | мелочь | `src/lib/validation-schemas.ts:294-300` | `reportQuerySchema` (с фильтром `status`) объявлен, но не используется: `rg` находит только само определение и производный тип. | Мёртвая схема с фильтром по статусу вводит в заблуждение: серверного фильтра статуса нет, фильтрация — только на клиенте (`admin-reports.tsx:247-251`). | Удалить неиспользуемую схему (после проверки текстовым поиском) либо задействовать. ПРОЙДЕНО (`rg`). |
| 14 | мелочь | `src/services/audit/audit-service.ts:411-421` | В `AUDIT_DESCRIPTIONS` нет `report.submitted` и `report.deleted` (только `report.created`/`report.updated`). | Заголовок для удаления задаётся вручную в маршруте (`delete/route.ts:185-190`); для пути формы «Отправлен» в ленту вообще не пишется. Словарь не покрывает жизненный цикл. | Дополнить словарь или писать события через общий helper. ПРОЙДЕНО. |
| 15 | мелочь | `src/modules/operator-mobile/application/commands/shared.ts:398-422` | `ensureReport` создаёт отчёт напрямую (`tx.report.upsert`), без доменного события `ReportCreated`. | У черновика идущей смены нет события создания: проекции/аналитика на `ReportCreated` его не увидят, пока он не сдан. Следующий шаг (`logProduction`) при этом пишет `ReportAudit 'updated'` о том, чего «не создавали». | Писать событие создания при заведении отчёта смены. ПРОЙДЕНО по коду. |
| 16 | мелочь | `src/modules/sites/application/commands/site-command.service.ts:103-111` | Деактивация объекта блокируется черновиками (`status: 'draft'`), но удаление сданного отчёта объекта на это не влияет. | Отчёт в `draft` навсегда блокирует деактивацию объекта, пока его не сдадут или не удалят; сообщение об отказе требует «завершить или удалить». Связь с состоянием отчёта неочевидна. | — (информационно; правило существует). ПРОЙДЕНО. |
| 17 | мелочь | `src/modules/reports/infrastructure/report.repository.ts:243-257` | Снимок `ReportVersion` пишется на каждое сохранение, включая повторные правки сданного отчёта; `version` берётся `existing.version + 1`. | Версии и состояние рассинхронизированы по смыслу: `version` растёт от правок, а «сданность» — это отдельный `status`, не выводимый из `version` (в Telegram-обработчике `version>1` трактуется как «корректировка», `event-handlers.ts:616-617`). | — (информационно: «исправлен» — производное, не состояние). ПРОЙДЕНО. |
| 18 | мелочь | `src/lib/report-status.ts:2-6` | `SUBMITTED_REPORT_STATUS='submitted'` и `isSubmittedReport` есть, но сам агрегат статус не валидирует (`report.aggregate.ts:43` — тип, не проверки). | Строковые литералы `'submitted'` разбросаны по коду (`rg` — 10 мест записи), единого источника правды о значении нет. | Использовать константу вместо литералов. ПРОЙДЕНО (`rg`). |
| 19 | мелочь | `src/modules/reports/application/projections/rebuild.ts:188-222` | `rebuild` берёт `status` из строки отчёта с фолбэком `r.status || 'draft'` и не различает «нет статуса» и «черновик». | Пустой статус в источнике превращается в `draft` в проекции — статус проекции может не совпасть с источником (пусто ≠ draft). | Падать/логировать при пустом статусе, не подставлять `draft`. ПРОЙДЕНО. |
| 20 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:30-41,247-251` | Фильтры «Черновики/Сданные/Изменены вручную» работают только на клиенте по уже загруженной странице. | «Сданные» в фильтре — про отображаемую страницу (пагинация 25–100), а не про весь срез; итоги считаются отдельно (`report-query.service.ts:92-122,152`). Фильтр по статусу может создать ложное впечатление полноты. | Серверный фильтр статуса (см. находку №13) или пояснение в UI. ПРОЙДЕНО по коду. |

## Не проверено

- Запуск полного набора проверок из AGENTS §6 (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npx playwright test --list`, `npm run build`) НЕ выполнялся: задача — аудит только на чтение, правок нет. Проверены лишь пять целевых юнит-наборов (85 passed, exit 0) — см. «Методика».
- Поведение на живой базе данных: ни одного запроса к БД не делал; вывод о легаси-отчётах с `tenantId = NULL` (находка №9) — ГИПОТЕЗА по логике кода, не воспроизведён.
- Миграции: искал ENUM/CHECK только по `status` отчёта; полный аудит ограничений `Report` не проводил. Утверждение «у `Report.status` нет CHECK» основано на `rg` по `prisma/migrations/**` — но частичный индекс `Report_user_site_date_without_shift_key` (упомянут в `prisma/schema.prisma:1981-1985`) задан миграцией, поэтому обратное тоже не доказано полностью.
- Замороженные области (`src/modules/operator-mobile/**`, `src/app/operator/**`, `src/components/piling/operator*/**`, ORION) прочитаны только как источник переходов состояния отчёта (мобильный контур сдачи). Никаких предложений по их правке не делаю — область заморожена; изменения там не предполагаются.
- UI-переходы версий operator-v2/v5/v7/v10 между собой не сверял: смотрел только факт записи статуса и обработку «уже сдан» в общем слое команд. Полная матрица «экран → разрешён ли сдать повторно» — НЕ ПРОВЕРЕНО.
- Роль «Мастер»/«Инженер ОТ» (FOREMAN/SAFETY_ENGINEER) в отчётах: по коду у них есть `reports.read_all`/`read_cross_user`, но нет `reports.manage_all`; пользователей с этими ролями нет (AGENTS §3), поэтому их реальные переходы — НЕ ПРОВЕРЕНО (пользователей нет).
- Порядок обработки outbox-событий `ReportDeleted`/`ReportSubmitted` в воркере (идемпотентность проекций) не проверял за пределами `event-handlers.ts`.
- Сколько именно отчётов в базе находится в состоянии `draft` (и есть ли они вообще, учитывая находку №6) — НЕ ПРОВЕРЕНО: к БД доступа в этой задаче нет.
