# W109 — обходы проверки типов (`as any`, `: any`, `@ts-*`, `eslint-disable`)

Дата: 2026-10-08. Ветка: `hermes/q4-0926`. Только чтение, код не менялся.

## Итог

Всего 293 вхождения четырёх образцов в `src/` (`.ts/.tsx`, без `node_modules` и `src/generated`):
`as any` — 85, `: any` — 56, `@ts-*` — 7 совпадений на 5 строках (3 реальные директивы),
`eslint-disable … no-explicit-any|ban-ts-comment` — 145 строк. Крупнейшие папки: `modules` 103, `core` 55, `lib` 36.

Главное хорошее: в защищённых папках (`src/services/auth/`, `src/core/security/`, `src/lib/rate-limiter.ts`,
`src/lib/csrf-protection.ts`) **ни одного** из четырёх образцов — правило CLAUDE.md «без `as any` в auth» сейчас
выполняется. Там есть только смежные вещи: `no-non-null-assertion` и два `as unknown as` на `globalThis`.

Находок в таблице: 24 — критично 0, важно 8, мелочь 16.

Топ-5:
1. `src/app/api/telemetry/route.ts:160` (и `ingest/route.ts:332`, `batch/route.ts:143`) — `type` из zod
   (`z.string().max(50)`) через `as any` уходит в Prisma-перечисление; дрейф имени не поймает компилятор.
2. `src/services/reports/outbox-publisher.ts:102` — `where: { … } as any` в выборке outbox: ошибка в условии/
   тенанте не проверяется типами.
3. `src/modules/reports/application/queries/report-export.service.ts:183` — `report.piles.map((pile: any) …`:
   переименование поля молча даёт пустую колонку в CSV/Excel.
4. `src/modules/reports/application/commands/upsert-report.command.ts:28` — результат команды `report: any`,
   а комментарий ссылается на «library boundary», которым это не является.
5. `src/services/reports/report-history.ts:42` — файловый `eslint-disable`, три функции разбирают JSON без типов.

## Методика

1. `rg`-эквивалент (`search_files`) по `src/` отдельно по каждому образцу:
   `\bas\s+any\b`, `:\s*any\b`, `@ts-(ignore|expect-error|nocheck)`,
   `eslint-disable[^\n]*@typescript-eslint/(no-explicit-any|ban-ts-comment)`.
   `node_modules` и `src/generated` (gitignore) в результаты не попадают — проверено отдельным поиском по
   `src/generated` (0 совпадений).
2. Точный пересчёт и группировка по папкам — скрипт на node (вне репозитория, в TMPDIR, в git не попадает):
   обход `src/**/*.ts(x)`, пропуск `node_modules`/`generated`, счёт совпадений регулярками выше по папке верхнего
   уровня и по файлу. Скрипт печатает totals / by folder / by file (sum>5) / protected paths.
3. Отдельно посчитаны смежные формы, не входящие в четыре образца: `: any` в генериках (`<any>`, `Array<any>`,
   `Record<string,any>`, `Promise<any>`, `readonly any[]`) — 16; `as unknown as` — 159; `no-non-null-assertion`
   eslint-disable — не считался (вне задачи).
4. Правила ESLint подтверждены: `eslint.config.mjs:16` `no-explicit-any: warn`, `:18`
   `no-non-null-assertion: warn`, `:22` `ban-ts-comment: warn` — поэтому каждый обход закрыт inline-комментарием
   (базовая линия линта «ноль предупреждений»).

Повторить: те же четыре регулярки `search_files` по `src/`; для цифр — скрипт из п.2.

### Сводка по папкам верхнего уровня `src/` (все 4 образца)

| Папка | всего | as any | : any | @ts-* | eslint-disable |
|---|---:|---:|---:|---:|---:|
| modules | 103 | 17 | 34 | 0 | 52 |
| core | 55 | 24 | 2 | 0 | 29 |
| lib | 36 | 14 | 0 | 6 | 16 |
| components | 32 | 6 | 10 | 0 | 16 |
| services | 31 | 11 | 5 | 1 | 14 |
| app | 29 | 11 | 4 | 0 | 14 |
| workers | 7 | 2 | 1 | 0 | 4 |
| (root: instrumentation*.ts, proxy.ts) | 0 | 0 | 0 | 0 | 0 |
| **Итого** | **293** | **85** | **56** | **7** | **145** |

Оговорки к цифрам: колонка `@ts-*` считает совпадения, а не строки — в `lib/db.ts:20` и `lib/redis-cache.ts:29`
строка-пояснение содержит и «@ts-ignore», и «@ts-expect-error», поэтому 7 совпадений на 5 строках, а реальных
директив 3. `eslint-disable-next-line … no-explicit-any` почти всегда стоит строкой выше самого `any`-каста, т.е.
пары «комментарий + каст» = один обход; в таблице папок они посчитаны раздельно (как просили — «вхождения»).
`modules=103` включает 18 вхождений во **frozen** `src/modules/operator-mobile/**` (только `__tests__`).

### Защищённые папки (высокий приоритет по CLAUDE.md)

Четыре образца — 0 вхождений ни в одной из четырёх локаций. Ближайшее окружение:

| # | severity | path:line | что там | почему важно |
|---|---|---|---|---|
| P1 | мелочь | `src/services/auth/**` | 0 из 4 образцов; ближайшее — 11 × `no-non-null-assertion` в `__tests__/session-service.test.ts:69…285` | правило «без `as any` в auth» выполнено; в тестах — только `!` с пояснением |
| P2 | мелочь | `src/core/security/tenant-rls.ts:33` | `globalThis as unknown as { gucAppliedStorage?: … }` | двойной каст в безопасности; здесь — сознательный singleton, безопасно, но это «обход» |
| P3 | мелочь | `src/core/security/tenant-context.ts:47` | `globalThis as unknown as { tenantContextStorage?: … }` | то же (документировано комментарием выше) |
| P4 | мелочь | `src/core/security/encryption.ts:134` | `eslint-disable-next-line no-non-null-assertion` | `!` с пояснением об инварианте |
| P5 | мелочь | `src/lib/rate-limiter.ts:357` | `eslint-disable-next-line no-non-null-assertion` | то же |
| P6 | мелочь | `src/lib/csrf-protection.ts` | 0 совпадений вообще | чисто |

Итог по защищённым папкам: **критичных находок нет**. `as unknown as` (P2/P3) — единственная форма, формально
эквивалентная «отключению» проверки; трогать не нужно.

### Файлы с наибольшим числом обходов (>5)

| # | severity | path | всего | разбор |
|---|---|---:|---|
| F1 | мелочь | `src/core/media/__tests__/media-auth.test.ts` | 28 | 14 `as any` + 14 disable (текаче-стабы актора) |
| F2 | мелочь | `src/components/piling/__tests__/login-page.test.tsx` | 24 | 6 `as any` + 6 `: any` + 12 disable |
| F3 | мелочь | `src/lib/__tests__/validation-schemas.test.ts` | 24 | 12 `as any` + 12 disable |
| F4 | **важно** | `src/modules/reports/application/queries/report-export.service.ts` | 24 | 9 `as any` + 3 `: any` + 12 disable (см. B5) |
| F5 | **важно** | `src/app/api/telemetry/route.ts` | 14 | 7 `as any` + 7 disable (см. B1) |
| F6 | **важно** | `src/services/reports/outbox-publisher.ts` | 12 | 5 `as any` + 1 `: any` + 6 disable (см. B4) |
| F7 | мелочь | `src/core/__tests__/api-wrapper.test.ts` | 10 | тест |
| F8 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts` | 7 | `@ts-expect-error` на optional-dep + enum-каст |
| F9 | мелочь | `src/app/(app)/__tests__/layout.test.tsx` | 6 | тест (моки framer-motion) |
| F10 | мелочь | `src/modules/crews/infrastructure/crew.repository.ts` | 6 | `tx: any` в транзакции (см. B19) |
| F11 | мелочь | `src/modules/operator-mobile/…/__tests__/production-corrections.test.ts` | 6 | frozen, тест |
| F12 | мелочь | `src/modules/operator-mobile/…/__tests__/production.test.ts` | 6 | frozen, тест |
| F13 | мелочь | `src/modules/reports/infrastructure/report.repository.ts` | 6 | `tx: any` + Prisma-boundary `as any` |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| B1 | важно | `src/app/api/telemetry/route.ts:160` (также `:167,196,209,280,355,361`) | zod-схема `type: z.string().max(50)` (`route.ts:27`) приводится `as any` и уходит в Prisma-перечисление телеметрии | любая строка ≤50 символов проходит валидацию; если имя enum в схеме и в Prisma разойдётся (переименование, миграция), компилятор промолчит — ошибка вылезет только в рантайме на проде | сузить схему до `z.enum([...])` и убрать каст; либо отдельный маппер строки→enum с явной проверкой |
| B2 | важно | `src/app/api/telemetry/ingest/route.ts:332` | `db.telemetryRecord.createMany({ data: telemetryRecords as any })` | набор полей записи не сверяется с моделью Prisma: пропущенное/лишнее поле не поймает `tsc` | типизировать массив как `Prisma.TelemetryRecordCreateManyInput[]` на сборке |
| B3 | важно | `src/app/api/telemetry/batch/route.ts:143` (и `:150`) | тот же `type: d.type as any` / `} as any` в batch-пути | то же, что B1, но пачкой — ошибка масштабируется на весь батч | как B1 |
| B4 | важно | `src/services/reports/outbox-publisher.ts:102` (также `:158,163,208`) | `where: { [consumerColumn]: false, OR: [ … ] } as any` и `data … as any` в выборке/отметке outbox | ошибка в условии (лишний/забытый ключ, тенант) не проверяется типами; при этом это consumer — тихая обработка чужого/пропущенного события | убрать `as any`, собрать `where` типизированным объектом `Prisma.OutboxEventWhereInput` |
| B5 | важно | `src/modules/reports/application/queries/report-export.service.ts:183` (также `:201,214,328,336,338,352-363`) | `report.piles.map((pile: any) => …)` и `(r.piles as any[])` в CSV/Excel-выгрузке | переименование поля (`pileGrade`, `meters`, `duration`) не поймает компилятор — колонка молча станет пустой, отчёт уедет клиенту с дырой | типизировать вход выгрузки (доменные DTO) и убрать `any[]` |
| B6 | важно | `src/services/reports/report-history.ts:42` (диапазон до `:55`) | файловый `/* eslint-disable @typescript-eslint/no-explicit-any */`; три функции `fmtPiles/fmtDrillings/fmtDowntimes` разбирают `unknown` как `(p: any)` | это печать истории отчёта из «сырых» JSON; опечатка в имени поля (напр. `typeId` вместо `pileGradeId`) даёт `undefined` в тексте без ошибки | заменить на разбор с узким типом-«контрактом» строки либо zod-`.safeParse` перед форматированием |
| B7 | важно | `src/modules/reports/application/commands/upsert-report.command.ts:28` (и `:30`) | результат команды `report: any`, `events: readonly any[]`; комментарий говорит «untyped external/library boundary», хотя это доменный агрегат, а не библиотека | теряется связь результата команды с типом агрегата отчёта — изменения в агрегате не отразятся на вызывающих | типизировать результат реальным типом (`ReportAggregate`/DTO); поправить неверный комментарий |
| B8 | важно | `src/modules/reports/infrastructure/report.prisma.mapper.ts:63` (и `:94`; также `sites/…/site.prisma.mapper.ts:24,48`, `crews/…/crew.prisma.mapper.ts:20,39`) | `fromPrismaToState(prismaX: any)` / `toOutboxData(event: any)` — вход маппера без типа | маппер — единственное место, где строка БД превращается в домен; переименование колонки в Prisma не даст ошибки компиляции, а даст `undefined` в поле | типизировать вход `Prisma.<Model>GetPayload<…>` |
| B9 | мелочь | `src/core/api-wrapper.ts:62` (и `:178`) | `withApi<T extends any[]>` / `withMutation<T extends any[]>` | `any[]` вместо `unknown[]` — устаревшая привычка; через эти обёртки идёт каждый маршрут | заменить `any[]` на `unknown[]` |
| B10 | мелочь | `src/core/cache/response-cache.ts:201` | `value: cloneResponse(value) as any` | каст ответа при кэшировании; риск — расхождение с ожидаемым типом значения кэша | типизировать `cloneResponse` |
| B11 | мелочь | `src/core/outbox/dead-letter-queue.ts:63` (и `:137`) | `payload: payload as any` в Prisma JSON-колонку | Prisma JSON — произвольная форма; комментарий честно поясняет | оставить; при желании `Prisma.InputJsonValue` |
| B12 | мелочь | `src/core/event-bus/schema-registry/registry.ts:146` (и `:148`) | `(oldSchema as any).properties` / `(newSchema as any).properties` | сравнение JSON-схем; читаются свойства без типа | описать минимальный интерфейс схемы |
| B13 | мелочь | `src/lib/db.ts:21` (коммент-обоснование `:20`) | `// @ts-ignore` + `eslint-disable-next-line ban-ts-comment` | осознанно: `server-only` есть в Next, нет в worker/CJS — `@ts-expect-error` сам бы упал. Обоснование в коде | оставить |
| B14 | мелочь | `src/lib/redis-cache.ts:30` (и `:29`) | то же `@ts-ignore` + disable | то же, что B13 | оставить |
| B15 | мелочь | `src/lib/request-context.ts:143` | `} as any` | каст объекта контекста запроса | типизировать |
| B16 | мелочь | `src/lib/pdf-generator/render.ts:12` | `new PDFDocument({ … font: false as any })` | параметр библиотеки pdfkit не типизирован так, как нужно | оставить либо локальный интерфейс опций |
| B17 | мелочь | `src/services/telemetry/mqtt-ingestion-service.ts:141` (и `:139,108,202`) | `// @ts-expect-error mqtt is optional` + `let mqtt: any` + `message.type as any` | опциональная зависимость: `@ts-expect-error` осознан; enum-каст — как B1, но на ingest из MQTT | для enum — как B1; `let mqtt: typeof import('mqtt')` |
| B18 | мелочь | `src/services/reports/audit-service.ts:34` | `const client = (tx ?? db) as any` | общий клиент для tx/не-tx ветки — типизация теряется | использовать тип клиента Prisma |
| B19 | мелочь | `src/modules/crews/infrastructure/crew.repository.ts:16` (и `:31,57`; также `report.repository.ts:24,108`, `equipment.repository.ts:23`) | `onBeforeCommit?: (tx: any)` и `db.$transaction(async (tx: any) …)` | тип tx-клиента Prisma не экспортируется чисто — комментарий честен; `any` снимает проверку запросов внутри транзакции | оставить, либо `Prisma.TransactionClient` |
| B20 | мелочь | `src/modules/equipment/application/commands/maintenance-plan.ts:62` | `type: (input.type as any) ?? 'TO1'` | enum-каст на границе команды; невалидное значение превратится в дефолт `TO1` молча | валидировать `type` до каста |
| B21 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:157` | `db.report.findMany(args as any)` | аргументы запроса без типа — ошибка в `where`/`include` не проверяется | типизировать `args` |
| B22 | мелочь | `src/core/media/media-service.ts:473` (и `:433`) | `toMediaRecord(media: any)` / `media.map((m: any) => …)` | строка медиа без типа на границе сервиса | типизировать вход |
| B23 | мелочь | `src/components/piling/inspections/template-editor.tsx:103` (и `:107`) | `(template.sections ?? []).map((s: any) …)` в UI-редакторе | шаблон инспекции разбирается без типа — ошибка формы не поймается | типизировать шаблон |
| B24 | мелочь | `src/app/api/settings/route.ts:3` | **ложное срабатывание**: `* GET: any authenticated user` — слово «any» в комментарии | не является обходом типов | ничего; учтено, чтобы не путать цифру `: any` |

Тестовые файлы (только `__tests__`, моки/стабы) — отдельной строкой, к продукту не относятся:
`core/media/__tests__/media-auth.test.ts` (28), `components/piling/__tests__/login-page.test.tsx` (24),
`lib/__tests__/validation-schemas.test.ts` (24), `core/__tests__/api-wrapper.test.ts:214,228,244,333,377`,
`app/(app)/__tests__/layout.test.tsx`, `workers/__tests__/{pdf,outbox}-worker.test.ts`,
`modules/sites|crews|equipment|reports/infrastructure/__tests__/*` (шемы транзакций),
`components/piling/__tests__/{admin-telegram,admin-dlq}.test.tsx`, `modules/reports/…/__tests__/*`.
Итого тестовых вхождений ~120 из 293.

## Приложение

**Другие формы `any`, не вошедшие в четыре образца (16):** `core/infrastructure/raw-queries.ts:251`
`Promise<any>`, `core/api-wrapper.ts:62,178` `T extends any[]`, `workers/unified-worker/pdf.ts:32`
`Record<string, any>`, `modules/reports/application/commands/upsert-report.command.ts:30` `readonly any[]`,
`workers/__tests__/outbox-worker.test.ts:345` `as any[]`, `report-export.service.ts` `as any[]` (9).
Полный список — по регулярке `(<|\bArray<|Record<[^>]*,\s*)any\b|any\[\]`.

**`as unknown as` (159 вхождений)** — формально тоже снимает проверку типов (двойной каст). В защищённых
папках 2 (`core/security/tenant-rls.ts:33`, `tenant-context.ts:47`). Больше всего — в тестах
(`admin-crews.test.tsx` 18, `admin-reports.test.tsx` 11, `briefings-screen.test.tsx` 6) и в
**frozen** `components/piling/operator-*/**`. В продакшн-коде вне frozen заметно: `lib/db.ts` (5),
`modules/readiness/application/readiness-rules-service.ts` (5), `services/dictionaries/dictionary-service.ts` (3).
Ключ `as unknown as` по всем папкам: `search_files "as unknown as"`.

**Frozen-зоны (не трогать, по AGENTS.md):** `src/modules/operator-mobile/**` — 18 вхождений 4 образцов (все в
`__tests__`); `components/piling/operator-next|v2|v5|operator-mobile/**` — вхождения `as unknown as`. В отчёт
включены только для полноты картины.

## Не проверено

- Сканировался только `src/` (`.ts/.tsx`). `e2e/`, `tests/`, `scripts/`, `docs/`, конфиги вне `src/` — **не
  проверено** (не входило в задачу; известно, что `tests/integration/rls-tenant-enforcement.spec.ts:41,45` имеет
  `no-explicit-any`-disable).
- Не проверено, каждый ли `eslint-disable-next-line no-explicit-any` действительно закрывает именно `any`-каст
  (в отчёте строки комментария и строка каста считаются как отдельные «вхождения»).
- `no-non-null-assertion` (`!`) как отдельный класс обходов **не инвентаризован** (вне списка образцов задачи);
  его много в `src/app/api/**` (например `users/route.ts`, `user-document-types/[id]/route.ts`).
- Глубина «сценария» проверена чтением кода вокруг находок; проверка влияния (кто вызывает, что упадёт) —
  **не проверено**: это read-only опись, `impact`/`detect-changes` не запускались (код не менялся).
- Проверки §6 AGENTS.md (`tsc`, `lint`, `test`, `build`) **не запускались** — задача только про опись, код не
  менялся.
