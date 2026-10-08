# W120 — утечка текста ошибок в ответах API (API-ERROR-LEAK)

## Итог

Задача — опись мест, где в ответ клиенту попадает текст внутренней ошибки
(`error.message`, `err.message`, `e.stack`, `String(error)`, `JSON.stringify(error)`),
и проверка обработчика ошибок в обёртках `withApi`/`withMutation`.

Итог: **утечек высокого риска нет**.

- Обёртки защищают: `withApi` на любой необработанной ошибке отдаёт клиенту
  фиксированную фразу при 500 и отдельную фразу для известных кодов Prisma;
  текст исключения уходит только в лог/Sentry (`src/core/api-wrapper.ts:119-133`).
  `withMutation` и `withReadinessCommand` делегируют в `withApi`.
- Текста исключений Prisma, стек-трейсов и имён таблиц в ответах **не найдено**
  (критично — **0**). Все ветки, возвращающие `*.message`, ограничены проверкой
  `instanceof ServiceError` / `ReadinessCommandError` / `OperatorCommandError`, а
  эти классы наполняются контролируемыми бизнес-строками.
- **Важно — 1**: скрытая передача произвольного текста исключения в `ServiceError`
  в `inspection-commands.ts:120` (сегодня безопасно, защиты нет).
- **Мелочь — 11** (12 строк, одна из них — группа из ~27 маршрутов): в ответ
  уходят технические тексты валидатора zod (англ. сообщения + внутренние пути
  полей) и контролируемые бизнес-сообщения сервисов.

Топ-5:

1. `src/modules/inspections/application/commands/inspection-commands.ts:120` —
   `new ServiceError(e instanceof Error ? e.message : …)` превращает любой текст
   исключения из `composeChecklist` в тело ответа (400). Сегодня
   `composeChecklist` бросает только фиксированную русскую строку
   (`block-composition.ts:119`), поэтому утечки нет; но обёртка ничем не
   ограничена.
2. `src/app/api/assistant/command/route.ts:46`, `src/app/api/operator/mobile/command/route.ts:196`,
   `src/app/api/pile-passports/[id]/decide/route.ts:36` — в ответ 400 уходят
   сырые объекты zod `issues` (англ. текст, `code`, внутренние пути полей).
3. `src/app/api/admin/dlq/route.ts:116`, `src/app/api/reports/delete/route.ts:55`,
   `src/app/api/equipment/[id]/device-keys/route.ts:78,140` — `parsed.error.flatten()`
   в ответе 400.
4. `src/app/api/readiness/work-permits/route.ts:66` — `details {fieldErrors}` из
   zod попадают в тело через `readiness/_shared/response.ts:35`.
5. `src/app/api/reports/upsert/route.ts:118 → :151` — `meterError` (`.message`
   от `ServiceError` 422) уходит в тело успешного 200 (контролируемый текст).

## Методика

Инструменты: `search_files` (ripgrep) по содержимому, `read_file` для каждого
попавшего места. Только чтение, код не менялся.

Что искал:

1. `src/app/api/` — `\.message`, `\.stack`, `String(err|error)`,
   `JSON.stringify(err|error)`, `\$\{(err|error|…)`, `.toString()`, `catch (`.
2. `src/lib/`, `src/core/` — те же шаблоны + поиск обёрток:
   `withApi|withMutation|withErrorBoundary` (файлы-обёртки), `handleApiError|apiError|errorResponse|sendError|jsonError|toErrorResponse`.
3. `src/` — `new ServiceError((\`|$|буква)`, `ServiceError(… 500)`,
   `assertNotSelfAction(`, `new OperatorCommandError(`, `new ReadinessCommandError(`.
4. `src/app/api` — `Prisma|P20\d\d|isPrismaKnownError|error.code`, чтобы убедиться,
   что ни один маршрут сам не разбирает ошибки Prisma и не отдаёт их текст.
5. Полный список файлов `route.ts` (141 шт.) сопоставлен с файлами, где
   встречается `withApi|withMutation`: файлы без обёртки (`health`, `health/deep`,
   `ready`, `readiness`(алиас), `liveness`, `alerts/webhook`, `orion/lead`)
   прочитаны вручную.

Ключевые точки, прочитанные целиком: `src/core/api-wrapper.ts`,
`src/core/error-boundary/api-error-boundary.ts`, `src/lib/auth.ts`,
`src/lib/service-error.ts`, `src/lib/api.ts`, `src/app/api/readiness/_shared/route-adapter.ts`,
`_shared/response.ts`, `_shared/request-context.ts`,
`src/modules/readiness/application/command-pipeline/errors.ts`,
репозитории `src/modules/readiness/infrastructure/**`,
`src/core/observability/health-checks.ts`, `health-tracker/**`.

Обработчик 500 в обёртке (пункт 2 задания) — проверен:
`src/core/api-wrapper.ts:127-134` возвращает
`{ error: 'Внутренняя ошибка сервера. Повторите попытку; если повторится — сообщите администратору.' }`
с `status: 500`; туда же уходит `Sentry.captureException`. Текст Prisma-ошибки
не отдаётся, только логируется (`:122`). Ветка `ServiceError` (`:108-112`)
возвращает `error.message` — это контролируемый класс (`src/lib/service-error.ts`),
его наполнение проверено отдельно (см. ниже).

Проверено, что `requireAuth` (`src/lib/auth.ts:158-211`) на любой сбой отдаёт
обезличенный текст (`'Authentication failed'`, 500 на `:206`), а тест
`src/app/api/health/deep/__tests__/route.test.ts:189` прямо проверяет, что тело
`/api/health/deep` не содержит слова `error`.

Существующие регрессионные проверки на утечку (не менялись):
`src/app/api/reports/single-pdf/__tests__/route.test.ts:127` (`'redis'`),
`:174` («does not leak a non-ServiceError (Prisma) message»),
`:128,140,141` (IP, `pdfs/`, UUID).

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|----------|-----------|---------|---------------------------|---------------|
| 1 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:120` | `throw new ServiceError(e instanceof Error ? e.message : 'Не удалось собрать чек-лист', 400)` — текст произвольного исключения становится телом ответа 400 | Сегодня `composeChecklist` бросает только фиксированную строку (`src/modules/inspections/domain/block-composition.ts:119`), утечки нет. Но обёртка не ограничена: если внутри появится исключение Prisma/драйвера, его текст (имена таблиц/полей) уйдёт клиенту | Отдавать фиксированный текст, оригинал — в лог (`logger.warn`) |
| 2 | мелочь | `src/app/api/assistant/command/route.ts:46` | `details: parsed.error.issues` — сырые zod-issues в ответе 400 | Англ. текст zod (`Invalid input` и т.п.), `code`, внутренние пути полей схемы видны клиенту | Отдавать только `{field, message}` с переведённым текстом (как в `reports/upsert:47`) |
| 3 | мелочь | `src/app/api/operator/mobile/command/route.ts:196` | `details: parsed.error.issues` — сырые zod-issues | То же; маршрут команд мобильного оператора | То же |
| 4 | мелочь | `src/app/api/pile-passports/[id]/decide/route.ts:36` | `details: parsed.error.issues` — сырые zod-issues | То же | То же |
| 5 | мелочь | `src/app/api/admin/incidents/route.ts:111` | `details: parsed.error.issues` — сырые zod-issues | То же (админский маршрут) | То же |
| 6 | мелочь | `src/app/api/admin/dlq/route.ts:116` | `details: validation.error.flatten()` | Развёрнутая структура zod с англ. текстами и путями полей | Отдавать общий текст + `{field, message}` |
| 7 | мелочь | `src/app/api/reports/delete/route.ts:55` | `details: parsed.error.flatten()` | То же | То же |
| 8 | мелочь | `src/app/api/equipment/[id]/device-keys/route.ts:78` и `:140` | `details: parsed.error.flatten()` | То же | То же |
| 9 | мелочь | `src/app/api/readiness/work-permits/route.ts:66` → `src/app/api/readiness/_shared/response.ts:35` | `ReadinessCommandError(..., {fieldErrors: parsed.error.flatten().fieldErrors})`; `response.ts:35` кладёт `details` в тело ответа | Англ. zod-тексты и пути полей уходят клиенту под ключом `details` | Не класть `fieldErrors` в `details` либо маппить в `{field, message}` |
| 10 | мелочь | `src/app/api/readiness/_shared/response.ts:34` | `message: error.message` для `ReadinessCommandError` | Сами строки контролируемые (проверены все конструкторы в `src/modules/readiness/infrastructure/**` — константы), но форма ответа полностью зависит от того, что передали в конструктор | Оставить; при новых конструкторах — не передавать текст исключения |
| 11 | мелочь | `src/app/api/reports/upsert/route.ts:118` → `:151` | `meterError = err.message` (для `ServiceError` 422) уходит в тело успешного 200 (`createJsonResponse(..., meterError, ...)`) | Контролируемый бизнес-текст показания счётчика; утечки Prisma нет | Достаточно комментария-инварианта: только `ServiceError`/фиксированные фразы |
| 12 | мелочь | ~27 маршрутов: `details: …issues.map(e => ({field: e.path.join('.'), message: e.message}))` | Англ. тексты zod по умолчанию + внутренние имена полей в теле 400/422. Это осознанный выбор (клиент переводит тексты в `src/lib/api-error-message.ts:50-56`), но технический текст всё же уходит наружу. Полный список — в приложении А | Уже транслируются на клиенте; при желании — перевести на сервере |

Не являются утечкой (проверено, `.message` идёт только в лог/сверку, не в ответ):
`src/app/api/inspections/[id]/complete/route.ts:71`,
`src/app/api/equipment/[id]/maintenance/[recordId]/route.ts:154`,
`src/app/api/reports/upsert/route.ts:124` (все — `logger.warn`),
`src/app/api/reports/delete/route.ts:141` (`err.message` только для `includes(...)`, затем `throw`),
`src/lib/api.ts:49` (сообщение сетевой ошибки на КЛИЕНТЕ идёт в `pushClientFeedback`, не в ответ API),
`src/lib/pdf-data.ts:63,97` (в лог).

## Приложение А — маршруты формы `{field, message}` (находка №12)

`src/app/api/checklist-templates/route.ts:69`; `checklist-templates/[id]/route.ts:75`;
`auth/login/route.ts:40`; `equipment/route.ts:44`; `equipment/[id]/route.ts:74`;
`crews/route.ts:48`; `maintenance-plans/[id]/route.ts:41`; `maintenance-plans/route.ts:62`;
`equipment/[id]/documents/route.ts:41`; `equipment/[id]/documents/[docId]/route.ts:45`;
`equipment/[id]/maintenance/route.ts:67`; `equipment/[id]/maintenance/[recordId]/route.ts:56`;
`equipment/[id]/fuel/route.ts:91`; `equipment/[id]/meter-readings/route.ts:77`;
`inspections/route.ts:67`; `inspections/[id]/route.ts:58`; `users/route.ts:61,110,144`;
`users/[id]/documents/route.ts:68`; `users/[id]/documents/[docId]/route.ts:40`;
`telegram/configs/route.ts:69,107,145`; `reports/upsert/route.ts:47`;
`user-document-types/route.ts:49`; `sites/create/route.ts:27`.

## Не проверено

- **ORION (замороженная зона).** `src/app/api/orion/lead/route.ts:131`
  (`deliveryError = error.message`) не анализировал — AGENTS.md §1 запрещает
  трогать `src/app/api/orion/**`. Попадает ли `deliveryError` в ответ клиенту —
  **не проверено**.
- **`withErrorBoundary`** (`src/core/error-boundary/api-error-boundary.ts`)
  **не используется ни одним маршрутом** (встречается только в определении и
  barrel-экспорте `src/core/error-boundary/index.ts`). Поведение в проде —
  **не проверено** (дормантный код). По коду: 500 отдаётся как `userMessage`
  («Внутренняя ошибка сервера…», `:139`), но ветка `UserError` отдаёт
  `error.message` (`:105`).
- **Runtime.** Приложение/тесты не запускались (задача только на чтение);
  все выводы — из статического чтения кода. Реальное тело ответа на живом
  Prisma-исключении **не проверено**.
- **Server-side страницы и server actions** (`src/app/**/page.tsx`, `'use server'`)
  вне рамок задачи (задача про `src/app/api/` и обёртки).
- **Прочие обёртки.** Отдельных `handleApiError`/`jsonError`/`toErrorResponse`
  в репозитории не нашёл (единственный похожий — клиентский
  `src/lib/api-error-message.ts`); если они существуют под другими именами —
  **не проверено**.
