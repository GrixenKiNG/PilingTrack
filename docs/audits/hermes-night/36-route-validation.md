# Аудит 36: соответствие src/app/api правилам «API Routes» (CLAUDE.md)

Дата: 2026-09-26. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`).
Режим: READ ONLY — ни один существующий файл не изменён, создан только этот отчёт.

## Итог

Просмотрено 142 файла `src/app/api/**/route.ts` (203 обработчика: 93 GET, 110 мутаций). ORION (`src/app/api/orion/**`) и внутренности `src/app/api/auth/**` из скоупа исключены, кроме проверок обёртки и валидации.

- **критично — 2**: `telemetry/ingest` POST и PATCH — поля тела, не описанные схемой (`unit`, `metadata`, `timestamp`), уходят в запись в базу.
- **важно — 4**: четыре мутации телеметрии обёрнуты `withApi` вместо `withMutation`, и CSRF/лимит продублированы inline.
- **мелочь — 22**: обход паттерна `safeParse` (тело уходит в сервис как `unknown`), невалидированные enum/число-подобные query-параметры, 53 продублированных `try/catch` с `instanceof ServiceError`, 3 места, где битый JSON даёт 500 вместо 400, 3 места с датами без проверки формата, 2 точечные шероховатости.
- **Всего находок: 28.**

Пять самых значимых:

1. `src/app/api/telemetry/ingest/route.ts:95` и `:138` — самописный `validateTelemetry` (строка 205) не покрывает `unit`/`metadata`/`timestamp`; в `ingestTelemetry` (строка 282) они попадают в `db.telemetryRecord.createMany` (строка 326) как есть. Произвольный JSON в `metadata` и `Invalid Date` из мусорного `timestamp` (строка 318) — это и есть «невалидированный ввод в запись в базу».
2. `src/app/api/telemetry/route.ts:83` (POST) — `withApi` вместо `withMutation`; inline `withCsrf` (строка 84) и inline `rateLimiter.check` (строки 88–101) дублируют обёртку.
3. `src/app/api/telemetry/batch/route.ts:64` (POST) — то же: inline CSRF (строка 65) и лимит (строки 68–75).
4. `src/app/api/telemetry/ingest/route.ts:95`/`:138` — `withApi`, CSRF не применяется вовсе, лимит продублирован inline (строки 99–106 и 141–148). Обёртка `withMutation` умеет то же самое через опцию `rateLimit` (`src/core/api-wrapper.ts:177`, `:201`).
5. Инлайновые `try/catch` с `if (err instanceof ServiceError) return NextResponse.json({error: err.message}, ...)` — 53 штуки в 35 файлах. `withApi` уже маппит `ServiceError` в статус и текст (`src/core/api-wrapper.ts:107–112`), то есть весь этот код недостижим по назначению. Это ровно тот пункт из таблицы «Common Pitfalls», который CLAUDE.md просит не делать.

**Главная находка:** пункт 1 — невалидированное тело в `telemetry/ingest` доходит до записи в `TelemetryRecord`; всё остальное — систематический стиль, разросшийся вокруг обёрток.

## Методика

Скоуп и инвентаризация:

1. `find src/app/api -name 'route.ts'` — 142 файла; из них исключён `src/app/api/orion/lead/route.ts` (ORION, заморожен).
2. Разбор каждого файла скриптом (`node`, только чтение): для каждого `export const GET|POST|PUT|PATCH|DELETE …` извлекались строка объявления, выражение-обёртка и текст обработчика до следующего `export`. Скрипт дал 203 обработчика и таблицу «обёртка × метод».
3. По каждому обработчику проверялись 6 признаков задачи: наличие `withApi`/`withMutation`/`withReadinessCommand`; наличие `.safeParse(`; `await request.json()`; `searchParams.get(`; `try {`; `err instanceof ServiceError`/`error.message`; упоминания CSRF и rate-limit. Совпадения по этим признакам — гипотезы, каждое подтверждено чтением файла.
4. Дополнительные машинные срезы: `grep -rn 'searchParams.get'` (список параметров), `grep -rn 'Number(|parseInt('`, `grep -rn 'await request.json()'`, `grep -rn 'instanceof ServiceError'`, `grep -rn 'err.message'`.
5. Ручное чтение с `path:line`: 46 файлов маршрутов + `src/core/api-wrapper.ts`, `src/app/api/readiness/_shared/{route-adapter,request-context}.ts`, `src/core/media/{media-auth,media-service}.ts`, `src/modules/readiness/**` (access-matrix, capabilities, правила), `src/modules/{settings,layout,monitoring}/**` сервисы-приёмники тела, `src/modules/reports/application/queries/report-query.service.ts`, `src/services/analytics/site-analytics-service.ts`, `prisma/schema.prisma` (модель `DeadLetterQueue`).
6. Обёртки: `src/core/api-wrapper.ts` прочитан целиком, чтобы утверждать, что именно даёт `withMutation` (CSRF + лимит + маппинг ошибок), прежде чем называть дублирование дублированием.

Проверка «по признаку» против «по файлу»:

- Таблица в конце построена скриптом. Колонка «wrapper» — точное имя функции-обёртки из объявления. Колонка «validation» — наличие `.safeParse(` в теле обработчика либо `readJsonBody`; для GET-обработчиков там почти всегда «нет», и это не ошибка: валидация GET идёт через явные проверки, которые в колонку не попадают. Единственный достоверный источник для «validation» — раздел «Находки».
- Колонка «issues» — номера подтверждённых находок; `F20` проставлен там, где в теле обработчика есть `err instanceof ServiceError`.

Воспроизведение: перечисленные в пп. 1–4 `grep`-команды и чтение `path:line` из таблицы находок; скрипт разбора — обычный `node`-скрипт на 90 строк, читающий только файлы маршрутов.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| F1 | критично | `src/app/api/telemetry/ingest/route.ts:95` (тело: 112–131, валидатор 205–276, запись 326) | POST проходит через `withApi`, тело читается `readJsonBody` (112) и проверяется самописной `validateTelemetry` (115 → 205), которая смотрит только `type`, `value`, широту/долготу. В `ingestTelemetry` (282) `unit`, `metadata`, `timestamp` берутся из тела как есть: `unit: (r.unit as string) || null` (314), `metadata: r.metadata ?? null` (317), `timestamp: r.timestamp ? new Date(r.timestamp as string) : undefined` (318) → `createMany` (326). | Устройство с валидным ключом шлёт `{"type":"fuel_level","value":1,"timestamp":"нет"}` — `new Date('нет')` даёт `Invalid Date`, Prisma падает, клиент видит 500; в `metadata` пишется произвольный JSON любого объёма без схемы. Формулировка задачи: невалидированный ввод доходит до записи в базу. | Описать тело zod-схемой (`telemetryRecordSchema` уже есть в `telemetry/batch/route.ts:12`) и передавать в `ingestTelemetry` только `parsed.data`. |
| F2 | критично | `src/app/api/telemetry/ingest/route.ts:138` (тело: 153–193) | PATCH (батч) — та же дыра, что F1: `validateTelemetry` по каждому элементу (173), затем `ingestTelemetry(identity, body)` (187) с исходным телом и теми же полями. | То же, но пачкой до 1000 записей: одна запись с мусорным `timestamp` роняет весь батч в 500 после того, как первые записи уже могли быть приняты буфером. | То же: валидировать zod-схемой (в `telemetry/batch` это `telemetryBatchSchema`, строка 24) до вызова `ingestTelemetry`. |
| F3 | важно | `src/app/api/telemetry/route.ts:83` (CSRF 84–85, лимит 88–101) | Мутация обёрнута `withApi` вместо `withMutation`; CSRF и лимит продублированы inline. | Правило CLAUDE.md «Always wrap with withApi or withMutation» нарушено в сторону более слабой обёртки; копия лимита не учитывает ключ `mut:<path>:<session>:<ip>`, который строит обёртка (api-wrapper.ts:200), то есть два разных лимита на один маршрут. Любая будущая правка лимита в обёртке этот маршрут не затронет. | `export const POST = withMutation(handler, {domain:'telemetry', rateLimit: {maxAttempts: 1000, windowMs: 60000, blockDurationMs: 60000}})` и удалить строки 84–101. |
| F4 | важно | `src/app/api/telemetry/batch/route.ts:64` (CSRF 65–66, лимит 68–75) | То же, что F3. | То же. | То же, с `TELEMETRY_RATE_LIMIT` из строки 28. |
| F5 | важно | `src/app/api/telemetry/ingest/route.ts:95` (лимит 99–106) | `withApi`; CSRF не применяется; лимит продублирован inline. | Маршрут принимает записи от устройства по ключу, поэтому CSRF в браузерном смысле неприменим — но тогда это должно быть решением в коде (комментарий), а не следствием более слабой обёртки: `withApi` не даёт ни CSRF, ни лимита, и на каждом новом таком маршруте их снова придётся писать руками. | Оставить `withApi` осознанно и дописать комментарий, либо завести `withDeviceMutation` рядом с `withMutation` (общая обёртка для устройств), чтобы ключ лимита и лог ошибок не разъезжались. |
| F6 | важно | `src/app/api/telemetry/ingest/route.ts:138` (лимит 141–148) | То же, что F5, для PATCH. | То же. | То же. |
| F7 | мелочь | `src/app/api/alerts/webhook/route.ts:85` | Единственная мутация в скоупе вообще без обёртки. | Осознанно: это машинный вебхук Alertmanager с собственным shared-secret (`isAuthorized`, строки 74–83, `timingSafeEqual`), и `withMutation` добавил бы CSRF-проверку, которую Alertmanager пройти не может. Фиксирую как исключение, а не дефект; в таблице ниже помечено. | Ничего; при желании — комментарий в шапке файла, что обёртка пропущена намеренно. |
| F8 | мелочь | `src/app/api/readiness/access-matrix/route.ts:31` (тело 35, приёмник `saveAccessMatrixDraft` 39) | PUT читает тело как `unknown` (35) и передаёт его в сервис без `safeParse`. | Спасает только внутренняя санитизация: `sanitizeAccessMatrix` (`src/modules/readiness/domain/access-matrix.ts:63–87`) отбрасывает неизвестные роли и полномочия. То есть дыры нет, но контракт «валидируем на входе» разорван: следующая правка сервиса может принять тело как есть. | Описать тело zod-схемой в маршруте (как в соседнем `readiness/defects/route.ts:71`). |
| F9 | мелочь | `src/app/api/settings/route.ts:23` (тело 30–35, приёмник 42) | PUT — тело `unknown` без схемы, дальше `saveSettings` → `sanitizeSettings` (`src/modules/settings/application/settings-service.ts:68`). | Как F8: санитизация есть, схемы на входе нет. | Добавить zod-схему настроек в маршрут. |
| F10 | мелочь | `src/app/api/monitoring/template/route.ts:25`; `src/app/api/layout/[surfaceId]/route.ts:51` | PUT — тело `unknown` без схемы, дальше `saveLayout` → `surface.validate` (`src/modules/layout/application/layout-service.ts:83`). | Как F8: валидация есть, но в сервисе, а не на границе. | Описать `template` схемой на маршруте. |
| F11 | мелочь | `src/app/api/readiness-rules/route.ts:21` (тело 27–32) | PUT — тело `unknown` без схемы, дальше `saveReadinessDraft` → `sanitizeRuleSet` (`src/modules/readiness/application/readiness-rules-service.ts:94`). | Как F8. | Схема на маршруте. |
| F12 | мелочь | `src/app/api/media/route.ts:19` (тело 27–33, запись `src/core/media/media-service.ts:130`) | POST без zod: `fileName`, `contentType`, `fileSize` читаются руками (35) и уходят в `getPresignedUrl`. | `contentType` и `fileSize` сервис проверяет сам (`media-service.ts:97` и `:110–121`), а `fileName` пишется в колонку `fileName` (`media-service.ts:133`) без ограничения длины и формата. Это единственное непроверенное поле. | Добавить `fileName: z.string().max(255)`. |
| F13 | мелочь | `src/app/api/sites/[id]/assign/route.ts:36` (строка 46) | DELETE читает `userId` из query и передаёт в `unassignUserFromSite(id, userId \|\| '', …)` без схемы. | Тенант передаётся явно (`tenantId`), поэтому утечки нет; но пустой `userId` доходит до сервиса, а проверка формата id отсутствует. | `z.string().min(1)` на `userId`, 400 при отсутствии. |
| F14 | мелочь | `src/app/api/admin/dlq/route.ts:16` (строка 23, 36) | GET берёт `status` из query без проверки на множество значений и подставляет в `where: { status }` (36). | Колонка `status` в `DeadLetterQueue` — `String` (`prisma/schema.prisma:2831`), поэтому мусорное значение даёт пустую выборку, а не ошибку: молчаливый пустой ответ вместо 400. | `z.enum(['pending','resolved','discarded','all'])`. |
| F15 | мелочь | `src/app/api/checklist-templates/route.ts:43` (строка 51) | GET: `level as never` — приведение типа вместо проверки значения, уходит в `listTemplates`. | `as never` отключает проверку типа; при неверном значении поведение зависит от Prisma (пусто или ошибка валидации → 500). | `z.enum(['EO','TO1','TO2','TO3','SEASONAL']).optional()`. |
| F16 | мелочь | `src/app/api/inspections/route.ts:33` (строка 42) | GET: `level` из query без проверки идёт в `listInspections(tenantId, {equipmentId, level}, …)`. | То же, что F15, но без приведения типа — значение «как есть» уходит в фильтр. | Схема или явный `includes`-фильтр. |
| F17 | мелочь | `src/app/api/users/route.ts:15` (строка 30) | GET: `role` из query без проверки идёт в `listUsers(tenantId, role, …)`. | Роль — enum; неизвестное значение даёт либо пустой список, либо ошибку Prisma → 500. | `z.enum(ROLES).optional()`. |
| F18 | мелочь | `src/app/api/feedback/events/route.ts:77` (строка 90) | POST читает `const operation = body.operation` до всякой валидации и разветвляется по нему (92, 98). | Значение используется только в сравнениях, до базы не доходит, поэтому последствий нет — но это тот самый «use only validated data»: сейчас безопасно случайно, а не по конструкции. | Разбирать `operation` zod-схемой до ветвления. |
| F19 | мелочь | `src/app/api/telemetry/route.ts:237` (строки 292–294, 352) | GET: `type` и `siteId` из query уходят в `getTelemetryByRange` через `as any` (352). | `type` — enum; `as any` глушит и проверку типа, и валидацию значения. | `z.enum([...]).optional()`. |
| F20 | мелочь | 53 места в 35 файлах, напр. `src/app/api/briefings/route.ts:60`, `src/app/api/media/route.ts:43`, `src/app/api/reports/pdf/route.ts:135`, `src/app/api/readiness/bootstrap/route.ts:57` | `try { … } catch (err) { if (err instanceof ServiceError) return NextResponse.json({error: err.message}, {status: err.status}); throw err; }` — дублирование того, что уже делает `withApi` (`src/core/api-wrapper.ts:107–112`). | CLAUDE.md, «Common Pitfalls»: «Inline try/catch in routes when withApi/withMutation exist → Use the wrapper». Ответ один и тот же, поэтому код недостижим по назначению и умножает места, где форму ответа на ошибку можно случайно поменять. Полный список файлов — в приложении А. | Удалить блоки; ловить точечно только те ошибки, которых обёртка не знает (как `UnknownSurfaceError` в `layout/[surfaceId]/route.ts:46`). |
| F21 | мелочь | `src/app/api/feedback/events/route.ts:89` | `await request.json()` без `readJsonBody` внутри общего `try` (191). | Битый JSON (не валидный, а просто мусор в теле) бросает `SyntaxError`, который ловится общим `catch` и превращается в 500 «Внутренняя ошибка сервера» (192). Ошибка клиента выглядит как отказ сервера. | `readJsonBody(request)` (`src/core/api-wrapper.ts:162`). |
| F22 | мелочь | `src/app/api/reports/pdf/route.ts:69` | То же, что F21: `await request.json()` без `readJsonBody` внутри `try` (65) → 500 на битом теле (160). | То же. | `readJsonBody`. |
| F23 | мелочь | `src/app/api/reports/single-pdf/route.ts:39` | То же, что F21 (общий `try` с 38, ответ 500 в конце обработчика). | То же. | `readJsonBody`. |
| F24 | мелочь | `src/app/api/analytics/sites/route.ts:12` (строки 22–23) | GET: `dateFrom`/`dateTo` не проверяются на `YYYY-MM-DD` и попадают параметрами в raw-SQL (`src/services/analytics/site-analytics-service.ts:108`, `:119`). | Инъекции нет — параметры шаблонные; но произвольная строка тихо сравнивается со строковой датой `"Report".date`, то есть запрос «за всё время» или мусор дают неверные цифры без ошибки. Соседние маршруты (`reports/export/route.ts:46`, `admin/analytics/overview/route.ts:160`) такой же параметр проверяют. | Перенести проверку формата (как `reports/export/route.ts:46`) в маршрут. |
| F25 | мелочь | `src/app/api/reports/edit/route.ts:12` (строка 20) | GET: `date` из query без проверки формата уходит в `where: { date }` (`src/modules/reports/application/queries/report-query.service.ts:57`). | `siteId`/`date` обязательным условием сервис проверяет (строки 47–49), но формат — нет: мусорная дата даёт «отчёт не найден» вместо 400. | `isDateOnly`-проверка, уже написанная в `reports/period/route.ts:20`. |
| F26 | мелочь | `src/app/api/telemetry/route.ts:237` (строки 295–321) | GET: `from`/`to` принимаются любым значением, которое разбирает `new Date` (314–316), а не строго `YYYY-MM-DD`. | Проверка на `Invalid Date` есть, поэтому мусор отсекается; но `?from=2026`, `?from=2026-9-1` или полный ISO с временем проходят и меняют границы выборки иначе, чем ожидает экран. | Требовать `YYYY-MM-DD` (как `reports/period/route.ts:20`). |
| F27 | мелочь | `src/app/api/reports/delete/route.ts:40` (строки 140–142) | «Отчёт не найден» (404) определяется по подстроке текста ошибки Prisma: `message.includes('Record to delete')`. | Текст ошибки — не контракт: смена версии Prisma или локали ломает распознавание, и 404 превращается в 500 (`throw err`, 144). Обёртка для этого использует код `P2025` (`src/core/api-wrapper.ts:26–29`). | Проверять `error.code === 'P2025'`. |
| F28 | мелочь | `src/app/api/readiness/bootstrap/route.ts:64` (строки 30–39) | GET берёт `actingAs` из query-параметра, тогда как все остальные маршруты готовности берут замещение из сессии (`src/app/api/readiness/_shared/request-context.ts:78`, `user.actingAs`). | Эскалации нет: значение проверяется `isActingRole` (33) и `canActAs(user.role, actingAs)` (37), и лишние параметры запрещены (31–35). Но «источник замещения» раздвоен: комментарий в `request-context.ts:51–64` прямо утверждает, что источник один, а этот маршрут — второй. | Либо брать `context.actingAs` после `resolveReadinessRequestContext`, либо дописать в `request-context.ts` оговорку про bootstrap. |

## Не проверено

- **Where-условия и тенант-скоуп внутри сервисов.** Проверял только то, что нужно для вердикта «доходит ли параметр до запроса»: для F24/F25 прочитал приёмники (`site-analytics-service.ts:50–119`, `report-query.service.ts:41–68`). Остальные сервисы, вызываемые из маршрутов, на предмет строгого равенства `tenantId` не смотрел — это тема аудита 26, здесь скоуп другой.
- **Права (RBAC).** Наличие `requireAuth`/`assertCan` фиксировал, но соответствие право↔экран не разбирал (аудит 18).
- **ORION** (`src/app/api/orion/lead/route.ts`) — исключён из скоупа; в таблице он приведён для полноты, но не разбирался.
- **Замороженные области.** `src/app/api/operator/**` прочитан (`operator/mobile/command/route.ts` — полная zod-схема на дискриминированном объединении, нарушений нет), но правки туда не предполагаются: заморозка «варианты экрана оператора». `src/modules/operator-mobile/**` не открывал.
- **`src/app/api/auth/**`.** Прочитал `login` и `pin` целиком: обе обёрнуты `withApi` осознанно (предавторизация, CSRF-токена ещё нет; лимит — внутри `auth-service` по `getRateLimitIdentifier`), валидация zod есть. `logout`, `me` — только по машинному срезу, не открывал.
- **Динамическое поведение.** Всё выше — чтение кода. Реальных запросов не отправлял, `tsc`/`lint`/тесты не запускал (задача read-only, правок нет), поэтому про «Alertmanager не пройдёт CSRF» и «Prisma падает на `Invalid Date`» — выводы из кода, а не из прогона.
- **Полный перечень 203 обработчиков** просмотрен машинно; вручную открыто 46 файлов маршрутов. Для неоткрытых вручную колонка «issues» таблицы содержит только автоматический признак `F20` (наличие `instanceof ServiceError`), и не означает, что там нет чего-то ещё, кроме F20 и F8–F19.

## Приложение А. Файлы F20 (53 инлайновых `instanceof ServiceError`, 35 файлов)

`briefings/[id]/sign/route.ts`, `briefings/journal/route.ts`, `briefings/route.ts`, `checklist-templates/[id]/route.ts`, `checklist-templates/route.ts`, `equipment/[id]/documents/[docId]/route.ts`, `equipment/[id]/fuel/[entryId]/route.ts`, `equipment/[id]/fuel/route.ts`, `equipment/[id]/maintenance/[recordId]/route.ts`, `equipment/[id]/maintenance/route.ts`, `equipment/[id]/meter-readings/[readingId]/route.ts`, `equipment/[id]/meter-readings/route.ts`, `inspections/[id]/complete/route.ts`, `inspections/[id]/route.ts`, `inspections/route.ts`, `maintenance/[id]/accept/route.ts`, `maintenance/[id]/route.ts`, `maintenance-plans/[id]/route.ts`, `maintenance-plans/route.ts`, `maintenance-plans/run/route.ts`, `media/[id]/confirm/route.ts`, `media/[id]/download/route.ts`, `media/[id]/route.ts`, `media/route.ts`, `readiness/bootstrap/route.ts`, `reports/pdf/route.ts`, `reports/single-pdf/route.ts`, `reports/upsert/route.ts`, `safety/clearance/route.ts`, `safety/equipment-permits/[id]/route.ts`, `safety/equipment-permits/route.ts`, `safety/my-clearance/route.ts`, `user-document-types/[id]/route.ts`, `user-document-types/route.ts`, `user-documents/control/route.ts`, `users/[id]/documents/[docId]/route.ts`, `users/[id]/documents/route.ts`.

## Приложение Б. Таблица route → method → wrapper → validation → issues

Пустое первое поле означает «тот же файл, что строкой выше». Колонка «validation» — машинный признак (`.safeParse` / `readJsonBody`); для GET она почти всегда «нет», см. «Методику».

| route | method | wrapper | validation | issues |
|---|---|---|---|---|
| `admin/analytics/overview/route.ts` | GET (148) | withApi | нет | - |
| `admin/analytics/site-weekly-trend/route.ts` | GET (9) | withApi | нет | - |
| `admin/dlq/route.ts` | GET (16) | withApi | нет | F14 |
| | POST (66) | withMutation | zod safeParse | - |
| `admin/equipment-analytics/route.ts` | GET (9) | withApi | нет | - |
| `admin/incidents/route.ts` | GET (25) | withApi | нет | - |
| | POST (102) | withMutation | zod safeParse | - |
| `admin/projections/rebuild/route.ts` | POST (35) | withMutation | нет | - |
| `alerts/webhook/route.ts` | POST (85) | нет | zod safeParse | F7 |
| `analytics/sites/route.ts` | GET (12) | withApi | нет | F24 |
| `assistant/command/route.ts` | POST (33) | withMutation | zod safeParse | - |
| `assistant/state/route.ts` | GET (16) | withApi | нет | - |
| `audit/route.ts` | GET (11) | withApi | нет | - |
| `auth/login/route.ts` | POST (16) | withApi | zod safeParse | осознанно (предавторизация) |
| `auth/logout/route.ts` | POST (12) | withMutation | нет | - |
| `auth/me/route.ts` | GET (17) | withApi | нет | - |
| `auth/pin/route.ts` | POST (15) | withApi | zod safeParse | осознанно (предавторизация) |
| `briefings/[id]/sign/route.ts` | POST (19) | withMutation | нет (params) | F20 |
| `briefings/journal/route.ts` | GET (27) | withApi | нет | F20 |
| `briefings/route.ts` | POST (30) | withMutation | zod safeParse | F20 |
| `checklist-templates/[id]/route.ts` | GET (43) | withApi | нет (params) | F20 |
| | PUT (63) | withMutation | zod safeParse | F20 |
| | DELETE (91) | withMutation | нет (params) | F20 |
| `checklist-templates/route.ts` | GET (43) | withApi | нет | F15 |
| | POST (58) | withMutation | zod safeParse | F20 |
| `crews/[id]/route.ts` | GET (17) | withApi | нет (params) | - |
| | PUT (34) | withMutation | zod safeParse | - |
| | DELETE (74) | withMutation | нет (params) | - |
| `crews/all/route.ts` | GET (17) | withApi | нет | - |
| `crews/my/route.ts` | GET (13) | withApi | нет | - |
| `crews/route.ts` | GET (17) | withApi | нет | - |
| | POST (36) | withMutation | zod safeParse | - |
| `dictionary/all/route.ts` | GET (9) | withApi | нет | - |
| `dictionary/manage/route.ts` | GET (65) | withApi | нет | - |
| | POST (89) | withMutation | zod safeParse | - |
| | PATCH (104) | withMutation | zod safeParse | - |
| | DELETE (127) | withMutation | zod safeParse | - |
| `equipment/[id]/details/route.ts` | GET (20) | withApi | нет (params) | - |
| `equipment/[id]/device-keys/route.ts` | POST (66) | withMutation | zod safeParse | - |
| | GET (98) | withApi | нет | - |
| | DELETE (128) | withMutation | zod safeParse | - |
| `equipment/[id]/documents/[docId]/route.ts` | PUT (28) | withMutation | zod safeParse | F20 |
| | DELETE (58) | withMutation | нет (params) | F20 |
| `equipment/[id]/documents/route.ts` | POST (27) | withMutation | zod safeParse | - |
| `equipment/[id]/fuel/[entryId]/route.ts` | DELETE (11) | withMutation | нет (params) | F20 |
| `equipment/[id]/fuel/route.ts` | GET (43) | withApi | нет (params) | F20 |
| | POST (79) | withMutation | zod safeParse | F20 |
| `equipment/[id]/maintenance/[recordId]/route.ts` | PUT (38) | withMutation | zod safeParse | F20 |
| | DELETE (69) | withMutation | нет (params) | F20 |
| `equipment/[id]/maintenance/route.ts` | GET (37) | withApi | нет (params) | - |
| | POST (53) | withMutation | zod safeParse | F20 |
| `equipment/[id]/meter-readings/[readingId]/route.ts` | DELETE (11) | withMutation | нет (params) | F20 |
| `equipment/[id]/meter-readings/route.ts` | GET (40) | withApi | нет (params) | F20 |
| | POST (63) | withMutation | zod safeParse | F20 |
| `equipment/[id]/route.ts` | GET (11) | withApi | нет (params) | - |
| | PUT (25) | withMutation | zod safeParse | - |
| | DELETE (71) | withMutation | нет (params) | - |
| `equipment/route.ts` | GET (12) | withApi | нет | - |
| | POST (30) | withMutation | zod safeParse | - |
| `feedback/events/route.ts` | GET (57) | withApi | нет | - |
| | POST (77) | withMutation | zod safeParse | F18,F21 |
| | PATCH (196) | нет | нет | - (алиас POST) |
| `feedback/stream/route.ts` | GET (9) | нет | нет | - (SSE) |
| `health/deep/route.ts` | GET (34) | нет | нет | - (проба) |
| `health/route.ts` | GET (18) | нет | нет | - (проба) |
| `inspections/[id]/complete/route.ts` | POST (14) | withMutation | zod safeParse | F20 |
| `inspections/[id]/route.ts` | GET (24) | withApi | нет (params) | F20 |
| | PUT (46) | withMutation | zod safeParse | F20 |
| `inspections/route.ts` | GET (33) | withApi | нет | F16 |
| | POST (53) | withMutation | zod safeParse | F20 |
| `layout/[surfaceId]/route.ts` | GET (31) | withApi | нет | - |
| | PUT (51) | withMutation | нет (params) | F10 |
| | DELETE (78) | withMutation | нет | - |
| `liveness/route.ts` | GET (13) | нет | нет | - (проба) |
| `maintenance-plans/[id]/route.ts` | PATCH (26) | withMutation | zod safeParse | F20 |
| | DELETE (56) | withMutation | нет (params) | F20 |
| `maintenance-plans/route.ts` | GET (27) | withApi | нет | - |
| | POST (51) | withMutation | zod safeParse | F20 |
| `maintenance-plans/run/route.ts` | POST (13) | withMutation | нет | F20 |
| `maintenance/[id]/accept/route.ts` | POST (12) | withMutation | нет (params) | F20 |
| `maintenance/[id]/route.ts` | GET (11) | withApi | нет (params) | F20 |
| `maintenance/assignees/route.ts` | GET (10) | withApi | нет | - |
| `maintenance/kpi/route.ts` | GET (13) | withApi | нет | - |
| `maintenance/route.ts` | GET (10) | withApi | нет | - |
| `media/[id]/confirm/route.ts` | POST (8) | withMutation | нет (params) | F20 |
| `media/[id]/download/route.ts` | GET (10) | withApi | нет (params) | F20 |
| `media/[id]/route.ts` | DELETE (8) | withMutation | нет (params) | F20 |
| `media/download-batch/route.ts` | GET (31) | withApi | нет | - |
| `media/route.ts` | POST (19) | withMutation | readJsonBody (без zod) | F12,F20 |
| | GET (63) | withApi | нет | F20 |
| `metrics/route.ts` | GET (46) | withApi | нет | - |
| `monitoring/fleet/route.ts` | GET (21) | withApi | нет | - |
| `monitoring/template/route.ts` | GET (17) | withApi | нет | - |
| | PUT (25) | withMutation | нет (params) | F10 |
| `notifications/telegram/test/route.ts` | POST (19) | withMutation | нет | - |
| `operator/knowledge-attempt/route.ts` | GET (6) | withApi | нет | - |
| `operator/mobile/command/route.ts` | POST (180) | withMutation | zod safeParse | - |
| `operator/mobile/state/route.ts` | GET (16) | withApi | нет | - |
| `operator/shift/route.ts` | GET (15) | withApi | нет | - |
| `orion/lead/route.ts` | POST (56) | нет | zod safeParse | вне скоупа |
| `pile-passports/[id]/decide/route.ts` | POST (17) | withMutation | zod safeParse | - |
| `pile-passports/export/route.ts` | GET (25) | withApi | нет | - |
| `pile-passports/route.ts` | GET (27) | withApi | нет | - |
| `readiness-rules/publish/route.ts` | POST (10) | withMutation | нет | - |
| `readiness-rules/route.ts` | GET (13) | withApi | нет | - |
| | PUT (21) | withMutation | нет (params) | F11 |
| `readiness/access-matrix/route.ts` | PUT (31) | withReadinessCommand | нет (params) | F8 |
| | POST (45) | withReadinessCommand | нет | - |
| | GET (55) | withApi | нет | - |
| `readiness/audit/route.ts` | GET (54) | withApi | нет | - |
| `readiness/bootstrap/route.ts` | GET (64) | withApi | нет | F28 |
| `readiness/current/route.ts` | GET (56) | withApi | нет | - |
| `readiness/defects/[id]/reject/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/defects/[id]/resolve/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/defects/[id]/triage/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/defects/route.ts` | POST (67) | withReadinessCommand | zod safeParse | - |
| | GET (83) | withApi | нет | - |
| `readiness/export/route.ts` | GET (176) | withApi | нет | - |
| `readiness/handovers/[id]/accept/route.ts` | POST (10) | withReadinessCommand | zod safeParse | - |
| `readiness/handovers/[id]/rework/route.ts` | POST (9) | withReadinessCommand | zod safeParse | - |
| `readiness/handovers/[id]/route.ts` | GET (18) | withApi | нет | - |
| `readiness/history/route.ts` | GET (74) | withApi | нет | - |
| `readiness/permit-form-options/route.ts` | GET (83) | withApi | нет | - |
| `readiness/place-presets/route.ts` | POST (32) | withReadinessCommand | zod safeParse | - |
| | DELETE (91) | withMutation | нет | - |
| `readiness/route.ts` | GET (26) | нет | нет | - (проба, deprecated) |
| `readiness/shifts/[id]/cancel/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/shifts/[id]/decline/route.ts` | POST (12) | withReadinessCommand | zod safeParse | - |
| `readiness/shifts/[id]/handover/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/shifts/[id]/request-acceptance/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/shifts/[id]/route.ts` | PATCH (26) | withReadinessCommand | zod safeParse | - |
| | GET (35) | withApi | нет | - |
| `readiness/shifts/[id]/start/route.ts` | POST (12) | withReadinessCommand | zod safeParse | - |
| `readiness/shifts/[id]/waiver/route.ts` | POST (15) | withReadinessCommand | zod safeParse | - |
| `readiness/shifts/route.ts` | POST (45) | withReadinessCommand | zod safeParse | - |
| | GET (62) | withApi | нет | - |
| `readiness/work-permits/[id]/approve/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/work-permits/[id]/revoke/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/work-permits/[id]/route.ts` | PATCH (34) | withReadinessCommand | zod safeParse | - |
| | GET (47) | withApi | нет | - |
| `readiness/work-permits/[id]/submit/route.ts` | POST (11) | withReadinessCommand | zod safeParse | - |
| `readiness/work-permits/route.ts` | POST (64) | withReadinessCommand | zod safeParse | - |
| | GET (73) | withApi | нет | - |
| `ready/route.ts` | GET (27) | нет | нет | - (проба) |
| `reports/[id]/history/route.ts` | GET (9) | withApi | нет (params) | - |
| `reports/admin-upsert/route.ts` | POST (16) | withMutation | zod safeParse | - |
| `reports/all/route.ts` | GET (13) | withApi | нет | - |
| `reports/delete/route.ts` | DELETE (40) | withMutation | zod safeParse | F27 |
| `reports/edit/route.ts` | GET (12) | withApi | нет | F25 |
| `reports/export/route.ts` | GET (16) | withApi | нет | - |
| `reports/my/route.ts` | GET (13) | withApi | нет | - |
| `reports/pdf/route.ts` | POST (60) | withMutation | zod safeParse | F22 |
| | GET (168) | withApi | zod safeParse | - |
| `reports/period/route.ts` | GET (30) | withApi | нет | - |
| `reports/recent/route.ts` | GET (16) | withApi | нет | - |
| `reports/single-pdf/route.ts` | POST (33) | withMutation | zod safeParse | F23 |
| | GET (137) | withApi | нет | - |
| `reports/upsert/route.ts` | POST (16) | withMutation | zod safeParse | F20 |
| `route.ts` | GET (13) | withApi | нет | - (health) |
| `safety/clearance/route.ts` | GET (19) | withApi | нет | F20 |
| `safety/equipment-permits/[id]/route.ts` | DELETE (13) | withMutation | нет (params) | F20 |
| `safety/equipment-permits/route.ts` | GET (31) | withApi | нет | F20 |
| | POST (64) | withMutation | zod safeParse | F20 |
| `safety/my-clearance/route.ts` | GET (18) | withApi | нет | F20 |
| `settings/route.ts` | GET (15) | withApi | нет | - |
| | PUT (23) | withMutation | нет (params) | F9 |
| `sites/[id]/assign/route.ts` | POST (13) | withMutation | zod safeParse | - |
| | DELETE (36) | withMutation | нет (params) | F13 |
| `sites/[id]/hierarchy/route.ts` | POST (13) | withMutation | zod safeParse | - |
| | DELETE (44) | withMutation | zod safeParse | - |
| `sites/[id]/route.ts` | GET (15) | withApi | нет (params) | - |
| | PUT (31) | withMutation | zod safeParse | - |
| | DELETE (108) | withMutation | нет (params) | - |
| `sites/all/route.ts` | GET (11) | withApi | нет | - |
| `sites/create/route.ts` | POST (14) | withMutation | zod safeParse | - |
| `sites/route.ts` | GET (11) | withApi | нет | - |
| `system/route.ts` | GET (11) | withApi | нет | - |
| `system/status/route.ts` | GET (24) | withApi | нет | - |
| `telegram/configs/route.ts` | GET (22) | withApi | нет | - |
| | POST (37) | withMutation | zod safeParse | - |
| | PUT (63) | withMutation | zod safeParse | - |
| | DELETE (90) | withMutation | zod safeParse | - |
| `telemetry/batch/route.ts` | POST (64) | withApi | zod safeParse | F4 |
| `telemetry/ingest/route.ts` | POST (95) | withApi | readJsonBody (без zod) | F1,F5 |
| | PATCH (138) | withApi | readJsonBody (без zod) | F2,F6 |
| | GET (335) | withApi | нет | - (health устройств) |
| `telemetry/route.ts` | POST (83) | withApi | zod safeParse | F3,F26 |
| | GET (237) | withApi | нет | F19,F26 |
| `to/journal/route.ts` | GET (11) | withApi | нет | - |
| `user-document-types/[id]/route.ts` | PATCH (14) | withMutation | zod safeParse | F20 |
| | DELETE (37) | withMutation | нет (params) | F20 |
| `user-document-types/route.ts` | GET (16) | withApi | нет | F20 |
| | POST (41) | withMutation | zod safeParse | F20 |
| `user-documents/control/route.ts` | GET (15) | withApi | нет | F20 |
| `users/[id]/documents/[docId]/route.ts` | PUT (27) | withMutation | zod safeParse | F20 |
| | DELETE (56) | withMutation | нет (params) | F20 |
| `users/[id]/documents/route.ts` | GET (34) | withApi | нет (params) | F20 |
| | POST (55) | withMutation | zod safeParse | F20 |
| `users/route.ts` | GET (15) | withApi | нет | F17 |
| | POST (40) | withMutation | zod safeParse | - |
| | PUT (90) | withMutation | zod safeParse | - |
| | DELETE (124) | withMutation | zod safeParse | - |
| `weather/route.ts` | GET (40) | withApi | нет | - |

Итог по таблице: 203 обработчика — `withApi` 93, `withMutation` 79, `withReadinessCommand` 22 (= `withMutation` + контекст готовности, `src/app/api/readiness/_shared/route-adapter.ts:17`), без обёртки 9 (6 GET-проб + `feedback/stream` SSE + `feedback/events` PATCH-алиас + `alerts/webhook` POST), из них мутаций без обёртки с CSRF — 3 (webhook Alertmanager и ORION POST осознанно, `feedback/events` PATCH — тот же обработчик, что POST).

## Проверено и нарушений не найдено (чтобы не искали заново)

- **Числовые параметры без границ (пункт 5 задачи).** Все пять числовых параметров ограничены сверху и снизу: `limit` — `feedback/events/route.ts:65` (≤100), `reports/all/route.ts:24` (≤100), `audit/route.ts:27` (≤200), `admin/dlq/route.ts:26` (≤500), `users/route.ts:31` через `parseCursorPagination({maxLimit: 100})`; `weeks` — `admin/analytics/site-weekly-trend/route.ts:20` (1…52, `take` = weeks×10); `limit` телеметрии — `telemetry/route.ts:303` (≤1000). Неограниченных `take`/`skip` не найдено.
- **Даты.** `reports/export/route.ts:46`, `reports/period/route.ts:44`, `reports/pdf/route.ts:242`, `admin/analytics/overview/route.ts:160` проверяют `YYYY-MM-DD` с обратной сверкой через `toISOString`; `equipment/[id]/fuel/route.ts:66` и `telemetry/route.ts:316` — через `Invalid Date`. Замечания только к F24–F26.
- **CSRF/лимит продублированы** — только в четырёх маршрутах телеметрии (F3–F6). В остальных мутациях inline-проверок CSRF нет.
- **Инъекции.** `$queryRaw` в задействованных маршрутах параметризован (`site-analytics-service.ts:108`); `$queryRawUnsafe` в `src/app/api/**` не встречается.
- **`validateTelemetry` вместо zod** (`telemetry/ingest/route.ts:205`) — отдельно от F1/F2: сам факт самописного валидатора в проекте, где принят zod, отмечен в F1; дополнительно считать это «дублированием» не стал.
