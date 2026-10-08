# W130 — Приведения `as any` и двойное приведение `as unknown as`

Только чтение. Изменений в коде нет. Опись приведений типов в `src/**` (исключены `*.d.ts` и `src/generated/**`).

## Итог

- Всего в `src/` (без `generated`/`.d.ts`): **244 вхождения** — `as any` **85**, `as unknown as` **159**.
- Из них рабочий код (не `*.test.*`/`__tests__`): `as any` **40**, `as unknown as` **53** (=93).
- По каталогам верхнего уровня (as any / as unknown as): components 6/95, modules 17/35, core 24/6, lib 14/7, app 11/4, services 11/6, workers 2/6.
- **Критично: 0.** **Важно: 4 группы.** Остальное — **мелочь** (приведения на границе JSON-колонок Prisma и на границе внешних библиотек, почти все с `eslint-disable`).
- **`src/services/auth/`: ровно 0 вхождений** — запрет «`as any` в auth» соблюдён во всех 4 рабочих файлах.
- В `src/core/security/` — 2 вхождения, оба `globalThis as unknown as {…}` (типизация глобального хранилища, ввод не участвует).
- Замороженные зоны: в `src/modules/operator-mobile/**` и `src/components/piling/operator*/**` — 41 вхождение `as unknown as` (в отчёт не разворачиваю, см. «Не проверено»).

**Топ-5:**
1. `src/services/reports/outbox-publisher.ts:137` — восстановленное из `payload` доменное событие приводится к `ReportDomainEvent` без валидации; при битой нагрузке обработчики получат неверную форму молча.
2. `src/modules/inspections/application/commands/inspection-commands.ts:328,362` — `templateSnapshot` из БД приводится к `SnapItem[]`/`DefectRuleItem[]` без проверки рядом; битый/старый снимок ломает завершение осмотра.
3. `src/modules/reports/application/queries/report-export.service.ts:328-363` — 9 приведений включённых связей отчёта к `any[]`; дрейф колонок даёт тихую пустоту в CSV/Excel.
4. `src/modules/readiness/application/projection/project-event.ts:23` — приведение payload события готовности после частичной проверки только трёх ключей.
5. `src/modules/monitoring/application/template-service.ts:13` — чтение шаблона плиток приводится к `EquipmentTileTemplate` без валидации на чтении (запись валидируется глубже — см. находки).

## Методика

- Поиск: `rg -n "as any"` и `rg -n "as unknown as"` по `src/`, исключая `src/generated/**` и `*.d.ts`. Дата-сет из 85 + 159 строк разобран скриптом на Node (доступен по записи, повторяемо): классификация по первому каталогу под `src/`, отделение тестов (`*.test.ts(x)`, `__tests__/`), отделение замороженных зон (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, `src/app/orion/**`, `src/app/api/orion/**`, `src/components/orion/**`).
- Каждое вхождение в рабочем коде открыто и прочитано по месту (`read_file`, окно вокруг строки) — проверено, есть ли рядом `safeParse`, `validate*`, `typeof`-проверка или `eslint-disable`-обоснование.
- Правило проекта (AGENTS.md §3): «No `as any` in auth/security code». Проверено отдельным поиском по `src/services/auth/` и `src/core/security/`.
- Замороженные зоны из отчёта исключены (правило 3 задачи/AGENTS.md §1) — их вхождения только посчитаны.
- Команды для повтора:
  - `rg -n --no-heading "as any" src -g '!src/generated/**' -g '!*.d.ts' | wc -l` → 85
  - `rg -n --no-heading "as unknown as" src -g '!src/generated/**' -g '!*.d.ts' | wc -l` → 159
  - `rg -n "as any|as unknown as" src/services/auth` → пусто

## Находки

### Сводка по каталогам

| Каталог | `as any` | `as unknown as` | всего | из них рабочий код (any+unk) | замороженные |
|---|---|---|---|---|---|
| `src/components/` | 6 | 95 | 101 | 6 | 41 (operator\*) |
| `src/modules/` | 17 | 35 | 52 | 45 | 13 (operator-mobile) |
| `src/core/` | 24 | 6 | 30 | 9 | 0 |
| `src/lib/` | 14 | 7 | 21 | 7 | 0 |
| `src/app/` | 11 | 4 | 15 | 11 | 0 |
| `src/services/` | 11 | 6 | 17 | 15 | 0 |
| `src/workers/` | 2 | 6 | 8 | 0 (все тесты) | 0 |
| **Итого** | **85** | **159** | **244** | **93** | **54** |

### Таблица высокого риска (auth / security)

| # | файл:строка | что приводится | проверка в рантайме рядом | риск |
|---|---|---|---|---|
| 1 | `src/services/auth/authorization-service.ts`, `auth-service.ts`, `resource-access-service.ts`, `session-service.ts` (и весь `src/services/auth/**`) | — | вхождений `as any`/`as unknown as` нет вообще | правило соблюдено (фактический риск 0) |
| 2 | `src/core/security/tenant-context.ts:47` | `globalThis as unknown as { tenantContextStorage?: AsyncLocalStorage<TenantContextStore> }` | не требуется: приводится типизация глобального слота, значение создаётся в коде (`new AsyncLocalStorage`), внешний ввод не участвует | высокий по расположению / фактически низкий |
| 3 | `src/core/security/tenant-rls.ts:33` | `globalThis as unknown as { gucAppliedStorage?: AsyncLocalStorage<true> }` | не требуется: тот же приём globalThis-слота, значения не из ввода | высокий по расположению / фактически низкий |

Пояснение: оба приведения в `src/core/security/` — не ослабление проверок доступа, а идиома «один экземпляр AsyncLocalStorage на сборку» (модульных экземпляров несколько, см. комментарии в файлах). К безопасности доступа не относятся, рантайм-проверка не нужна; указаны как требует задача (каталог с высоким приоритетом).

### Рабочий код: остальные файлы (39 файлов, 93 вхождения)

| # | severity | path:line | проблема | почему важно / сценарий | предлагаемая правка |
|---|---|---|---|---|---|
| 4 | важно | `src/services/reports/outbox-publisher.ts:137` | `… as unknown as ReportDomainEvent` — событие воссоздаётся из `payload` БД без проверки формы | воркер диспетчит обработчик по `type`; при битой нагрузке (старый формат/частичная запись) обработчик получит неверную форму молча, без ошибки | добавить type guard/схему на нагрузку перед приведением |
| 5 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:328,362` | `ins.templateSnapshot as unknown as SnapItem[]` / `… as DefectRuleItem[]` | снимок читается из БД; битый/устаревший снимок обрушит расчёт дефектов и завершение осмотра; проверки рядом нет | валидировать снимок (zod/guard), fallback на пустой список |
| 6 | важно | `src/modules/reports/application/queries/report-export.service.ts:328,336,338,352,354,357,359,361,363` | 9× `r.piles/drillings/downtimes as any[]` | если форма `include` отчёта разойдётся с ожиданием, экспорт CSV/Excel даст тихие пустоты/нули вместо ошибки | ввести тип строки отчёта, убрать `any[]` |
| 7 | важно | `src/modules/readiness/application/projection/project-event.ts:23` | `row as unknown as SnapshotRequestPayload` после проверки только трёх обязательных ключей | необязательные поля (`shiftId`, `triggerOccurredAt`) не проверяются — неверный тип пройдёт дальше в расчёт готовности | расширить guard на все поля либо схему `safeParse` |
| 8 | мелочь | `src/modules/monitoring/application/template-service.ts:13,21` | `getLayout(...) as unknown as Promise<EquipmentTileTemplate>` (чтение и запись) | запись валидируется глубже (`saveLayout` → `surface.validate`, `layout-service.ts:83-84`); на чтении валидации нет — легаси-шаблон пройдёт как валидный | сузить тип через фасад layout вместо двойного приведения |
| 9 | мелочь | `src/app/api/telemetry/ingest/route.ts:312-324,332` | `record as Record<string, unknown>`, `r.type as string`, `telemetryRecords as any` | значения уже прошли `validateTelemetry` (`route.ts:211-282`) выше — приведение безопасно, но тип теряется | типизировать результат валидатора |
| 10 | мелочь | `src/app/api/telemetry/route.ts:160,167,196,209,280,355,361` | `d.type as any`, `… as any` на границе ingestion | ввод проверен `telemetryRecordSchema.safeParse` (`route.ts:135,178`); приведение к Prisma-типу enum | кодировать enum реальным типом/`z.enum` |
| 11 | мелочь | `src/app/api/telemetry/batch/route.ts:143,150` | `d.type as any`, `… as any` | ввод через `safeParse` (см. `validated.data`), приведение на границе | как п.10 |
| 12 | мелочь | `src/app/api/operator/mobile/command/route.ts:150` | `z.enum(INCIDENT_SIGNS as unknown as [string, ...string[]])` | приведение массива констант к кортежу для zod; при пустом/переопределённом списке zod получит неверную форму | `z.enum` по `as const`-кортежу без двойного приведения |
| 13 | мелочь | `src/services/dictionaries/dictionary-service.ts:42,43,44` | `db.pileGrade/drillingType/downtimeReason as unknown as DictDelegate` | делегаты Prisma приводятся к локальному интерфейсу; форма совпадает по конструкции, но проверки нет | вывести интерфейс из типа Prisma-клиента |
| 14 | мелочь | `src/services/reports/outbox-publisher.ts:68,102,158,163,208` | `payload: event as any`, `where: {…} as any` | JSON-колонка Prisma и динамический ключ-колонка; есть `eslint-disable` | оставить (обосновано), либо типобезопасная обёртка |
| 15 | мелочь | `src/services/reports/event-handlers.ts:560` | `where: {…} as any` | обход строгости типа `where`; есть `eslint-disable` | — |
| 16 | мелочь | `src/services/reports/audit-service.ts:34` | `(tx ?? db) as any` | тип callback-клиента интерактивной транзакции Prisma не экспортируется; есть `eslint-disable` | экспортировать/сузить тип |
| 17 | мелочь | `src/services/audit/audit-service.ts:955` | `event as unknown as Record<string, unknown>` | передача события в `logger.info`; форма события не проверяется, но лог только читается | — |
| 18 | мелочь | `src/services/feedback/feedback-event-service.ts:128` | `(input.metadata as any) \|\| undefined` | JSON-колонка; есть `eslint-disable` | — |
| 19 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:108,202` | `message.type as any`, `mqttClient as any` | enum/граница библиотеки; `eslint-disable`; источник — MQTT-сообщение (`tenantId` берётся из оборудования, не из payload) | типизировать enum |
| 20 | мелочь | `src/core/outbox/dead-letter-queue.ts:63,137` | `payload as any` | JSON-колонка Prisma; есть `eslint-disable` | — |
| 21 | мелочь | `src/core/cache/response-cache.ts:201` | `cloneResponse(value) as any` | граница библиотеки; `eslint-disable` | — |
| 22 | мелочь | `src/core/event-bus/schema-registry/registry.ts:146,148` | `(oldSchema as any).properties`, `(newSchema as any).properties` | схема — внешний JSON-объект; `.properties` читается без проверки типа | сузить до `{ properties?: Record<string, unknown> }` |
| 23 | мелочь | `src/core/error-boundary/bulkhead.ts:94` | `null as unknown as ReturnType<typeof setTimeout>` | заглушка поля до `setTimeout`; безопасно | — |
| 24 | мелочь | `src/core/infrastructure/raw-queries.ts:101` | `rows as unknown as RawReportRow[]` | результат сырого SQL приводится к типу строки; форма задаётся запросом рядом (select) | — |
| 25 | мелочь | `src/lib/db.ts:31,122,123,174,185` | `globalThis as unknown as {…}`, `createPrismaClient() as unknown as …`, `client as unknown as …` | типизация globalThis-слота клиента Prisma и границы обёртки тенанта; ввод не участвует | — |
| 26 | мелочь | `src/lib/request-context.ts:143` | `{…} as any` | контекст трассировки; есть `eslint-disable` | типизировать объект контекста |
| 27 | мелочь | `src/lib/pdf-generator/render.ts:12` | `font: false as any` | опция PDFDocument шире типа pdfkit; `eslint-disable`; ввод не участвует | — |
| 28 | мелочь | `src/modules/crews/infrastructure/crew.repository.ts:57` | `data.payload as any` | JSON-колонка outbox; `eslint-disable` | — |
| 29 | мелочь | `src/modules/reports/infrastructure/report.repository.ts:254` | `{…} as any` (поле `data` версии отчёта) | граница типов Prisma; `eslint-disable` | — |
| 30 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:157` | `db.report.findMany(args as any)` | граница типов Prisma в пагинаторе; `eslint-disable` | — |
| 31 | мелочь | `src/modules/equipment/application/commands/maintenance-plan.ts:62` | `(input.type as any) ?? 'TO1'` | enum техобслуживания; `eslint-disable` | типизировать enum |
| 32 | мелочь | `src/modules/equipment/infrastructure/equipment.prisma.mapper.ts:18` | `e as unknown as Prisma.JsonObject` | событие агрегата в JSON-колонку outbox | — |
| 33 | мелочь | `src/modules/layout/domain/layout-template.ts:152` | `value as unknown as LayoutTemplate` | приведение ВНУТРИ `validateLayoutTemplate` — сразу после проверок формы (`:144-152`); корректный образец «guard → приведение» | — |
| 34 | мелочь | `src/modules/layout/domain/page-layout-template.ts:71` | `value as unknown as PageLayoutTemplate` | аналогично: внутри `validatePageLayout` после проверок (`:65-71`) | — |
| 35 | мелочь | `src/modules/readiness/application/readiness-score.ts:218,219,220` | `… as unknown as Prisma.InputJsonValue` (blockers/warnings/evidence) | запись в JSON-колонку; значения — результат доменного расчёта, не ввод | — |
| 36 | мелочь | `src/modules/readiness/application/readiness-rules-service.ts:117,118,156,157,201` | `criteria/blockers as unknown as Prisma.InputJsonValue`, `tx as unknown as typeof db` | JSON-колонка + приведение транзакционного клиента; правил не ослабляет | — |
| 37 | мелочь | `src/modules/readiness/application/access-matrix-service.ts:180,223` | `grants as unknown as Prisma.InputJsonValue` | JSON-колонка, значения из `sanitize`-функции | — |
| 38 | мелочь | `src/modules/readiness/application/scheduler.ts:263` | `tx as unknown as typeof db` | приведение транзакционного клиента для передачи в `requestReadinessSnapshot`; тенант уже выставлен обёрткой | — |
| 39 | мелочь | `src/modules/readiness/application/shifts/commands.ts:275` | `after: {…} as unknown as AuditJsonValue` | запись в аудит-JSON; данные из доменного объекта | — |
| 40 | мелочь | `src/components/piling/admin-equipment/equipment-dialogs.tsx:138,144` | `item as unknown as Record<string, unknown> \| null` | приведение DTO к generic-объекту для хелпера формы; источник — пропс, не сетевой ввод напрямую | — |
| 41 | мелочь | `src/components/piling/to/readiness/authoritative-presentation.ts:142` | `value as unknown as EvidenceRecord` | приведение ПОСЛЕ type guard по всем полям (`:128-141`) — корректный образец | — |

### Приложение A — тестовые файлы (только `path:line`, разворачивать не требуется)

`as any` в тестах (45 вхождений): `src/core/__tests__/api-wrapper.test.ts:214,228,244,333,377`, `src/core/media/__tests__/media-auth.test.ts:25,27,33,41,43,51,53,60,68,80,82,163,172,179`, `src/components/piling/__tests__/login-page.test.tsx:91,99,125,159,169,195`, `src/workers/__tests__/pdf-worker.test.ts:18`, `src/workers/__tests__/outbox-worker.test.ts:345`, `src/modules/sites/application/commands/__tests__/site-admin-command.test.ts:151,153`, `src/lib/__tests__/validation-schemas.test.ts:101,124,130,156,174,199,208,261,267,269,300,328`, `src/modules/reports/application/commands/__tests__/report-command-service.test.ts:246`, `src/modules/reports/application/queries/__tests__/report-query.service.test.ts:52`, `src/services/telegram/__tests__/telegram-config-service.test.ts:201`, `src/app/api/__tests__/api-routes.test.ts:88`.

`as unknown as` в тестах и fixtures (106 вхождений) — по файлам: `operator-mobile` (v7/v10/screens/queue-flow/fixtures/api/field-readability/closing-screen/operator-mobile-app), `operator-next/__tests__/*`, `operator-v5/__tests__/*`, `operator-v2/__tests__/*`, `admin-crews/__tests__/*`, `admin-reports/__tests__/*`, `to/readiness/screens/__tests__/*`, `admin-dictionaries`, `admin-equipment/detail`, `admin-sites/__tests__/use-site-mutations.test.ts`, `workers/__tests__/unified-worker.test.ts`, `lib/__tests__/pile-meters-invariant.test.ts`, `lib/__tests__/csrf-protection.test.ts`, `core/infrastructure/__tests__/raw-queries.test.ts`, `core/media/__tests__/confirm-upload-validation.test.ts`, `services/reports/__tests__/daily-summary.test.ts`, `modules/reports/.../__tests__/report-validation.test.ts`, `modules/operator-mobile/domain/__tests__/*`, `app/(app)/admin/__tests__/layout.test.tsx`, `app/(app)/(readiness-admin)/__tests__/layout.test.tsx`, `modules/layout/domain/*` (см. п.33-34, это рабочий код).

### Приложение B — замороженные зоны (посчитаны, не разбирались)

- `src/components/piling/operator-v5/operator-v5-app.tsx:294` — `doc.expiresAt as unknown as string` (рабочий код).
- `src/components/piling/operator-mobile/v10/operator-v10-app.tsx:215`, `…/operator-mobile/safety/documents-summary.ts:50` — `expiresAt as unknown as string`.
- `src/modules/operator-mobile/application/commands/{incidents,equipment,checklist,shift-close,production-corrections,production}.ts` — 13× `as unknown as` (JSON/тенант-клиент).
- Остальные ~40 вхождений — тесты/fixtures операторских экранов.

## Не проверено

- **Поведенческой проверки не делалось** — задача только про опись; рантайм-валидация оценивалась по чтению кода рядом, а не запуском.
- Для п.8 (`template-service.ts:13`) — **не проверено**, может ли в БД лежать шаблон плиток, не проходящий текущий `validate` (нет доступа к данным); поэтому риск понижен до мелочи.
- Для п.19 (`mqtt-ingestion-service.ts`) — **не проверено** построчно, как приходит `message.metadata.siteId` из MQTT-моста MQTT→domain (форма сообщения задаётся внешним брокером; проверен только код на стороне сервиса).
- `src/app/api/telemetry/ingest/route.ts` — проверено, что `validateTelemetry` вызывается до `ingestTelemetry` (`route.ts:180-193`), но **не проверено** полнота этого валидатора по всем полям (custom-проверка, не zod).
- Замороженные зоны (`operator*`, `orion`) — **не разбирались** по содержанию (правило 3 задачи и AGENTS.md §1), только посчитаны вхождения.
- Не проверялись файлы вне `src/` (`e2e/`, `tests/`, `scripts/`, `prisma/`, корневые конфиги) — задача ограничивает область `src/`.
