# W97 — маршруты API, читающие тело без schema.safeParse

Аудит только на чтение. Код не изменялся. Область: `src/app/api/**` (worktree `D:\PillingR\wt-night`, ветка `hermes/q4-0926`).

## Итог

- Всего файлов `route.ts` под `src/app/api`: **141** (без `node_modules`).
- Файлов с обработчиком изменения (`POST`/`PUT`/`PATCH`/`DELETE`): **86**.
  - Обёрнуты `withMutation` (или `withReadinessCommand`, который оборачивает `withMutation` — `readiness/_shared/route-adapter.ts:13-29`): **80**.
  - НЕ обёрнуты: **6** — `auth/login`, `telemetry/route`, `telemetry/batch`, `telemetry/ingest`, `alerts/webhook`, `orion/lead` (заморожен, см. AGENTS.md §1).
- Файлов, которые читают тело (`request.json()`, `readJsonBody()`, `req.json()`): **74**.
- Из них тело НЕ проходит через `schema.safeParse` (файл не содержит `safeParse`): **7**.
- Severity: критично — **0**, важно — **4**, мелочь — **8**.
- Топ-5:
  1. `settings/route.ts:32` — тело PUT не валидируется схемой (только `sanitizeSettings`-коэрция), нет ответа 400 на мусор.
  2. `readiness-rules/route.ts:29` — тело PUT (правила готовности) не валидируется схемой (только `sanitizeRuleSet`).
  3. `readiness/access-matrix/route.ts:35` — тело PUT (матрица доступов) не валидируется схемой (только `sanitizeAccessMatrix`).
  4. `alerts/webhook/route.ts:87` — сырой `export async function POST`, мимо `withApi`/`withMutation` (нет общего контекста тенанта, метрик и границы ошибок).
  5. `telemetry/ingest/route.ts:95,141` — POST/PATCH под `withApi` без CSRF, тело проверяется самописным `validateTelemetry`, а не `schema.safeParse`.

Критичных находок нет: во всех случаях невалидированное тело доходит либо до allowlist-санитайзера, либо до рантайм-валидатора, либо до сервиса, который (с учётом ролей) не позволяет инъекций. Однако правило проекта (CLAUDE.md: «Тело — `schema.safeParse`, при ошибке 400, дальше только `validated.data`») в перечисленных ниже местах не соблюдено буквально.

## Методика

Всё воспроизводится поиском (read-only), без запуска кода. GitNexus не использовался: правило проекта для точечной работы допускает поиск по тексту, правок кода здесь нет.

1. Список маршрутов: `search_files(target=files, pattern="route.ts", path="src/app/api")` → 141 файл.
2. Обработчики изменения: `search_files(pattern="export (const|async function) (POST|PUT|PATCH|DELETE)\\b", file_glob="route.ts")` → 86 файлов.
3. Обёртки: `search_files(pattern="withMutation")`; реализации — `src/core/api-wrapper.ts:178-223` (`withMutation` = CSRF + лимит + `withApi`), `src/core/api-wrapper.ts:62-147` (`withApi`), `src/app/api/readiness/_shared/route-adapter.ts` (`withReadinessCommand` → `withMutation`).
4. Чтение тела: `search_files(pattern="request\\.json\\(|readJsonBody\\(|\\breq\\.json\\(", file_glob="route.ts")` → 74 файла.
5. Наличие схемной проверки: `search_files(pattern="safeParse", file_glob="route.ts")` → 68 файлов.
6. Пересечение списков (3) и (5) минус (4): файлы, читающие тело, но без `safeParse`. Каждый такой файл открыт целиком (`read_file`) и прослежен до вызываемого сервиса.
7. Сервисы-получатели невалидированного тела открыты: `modules/settings/domain/settings.ts` (`sanitizeSettings`), `modules/readiness/domain/readiness-rules.ts` (`sanitizeRuleSet`), `modules/readiness/domain/access-matrix.ts` (`sanitizeAccessMatrix`), `modules/layout/application/layout-service.ts` (`surface.validate`), `modules/monitoring/application/template-service.ts`.
8. Что означает `readJsonBody` (важно для оценки): `src/core/api-wrapper.ts:162-168` — это только разбор JSON, при битом теле бросает `ServiceError(..., 400)`. Это НЕ валидатор схемы: `safeParse` всё равно обязателен.

## Находки

| # | severity | path:line | проблема | риск (да/нет, почему) | предлагаемая правка |
|---|----------|-----------|----------|------------------------|---------------------|
| 1 | важно | `readiness/access-matrix/route.ts:35` | `PUT` читает `await request.json().catch(() => null)` и передаёт `body` в `saveAccessMatrixDraft` без `safeParse`; проверка формы только внутри `sanitizeAccessMatrix` (`modules/readiness/domain/access-matrix.ts:63-87`) | да, но низкий: тело задаёт матрицу доступов (кто что может), ошибка формы возвращает не 400, а молча нормализуется; неизвестные роли/полномочия отбрасываются allowlist-ом, поэтому произвольного расширения прав нет | добавить `zod`-схему `{ grants?: ... }` и `safeParse` перед вызовом; на `.null` (битый JSON) — 400 |
| 2 | важно | `readiness-rules/route.ts:29` | `PUT` читает `await request.json()` в try/catch и передаёт `body` в `saveReadinessDraft` без `safeParse`; форма нормализуется `sanitizeRuleSet` (`modules/readiness/domain/readiness-rules.ts:248-294`) | да, но низкий: набор правил влияет на допуск техники к работе; системные блокеры безопасности принудительно включаются, веса клампятся, поэтому «выключить критический дефект» нельзя, но невалидный ввод не отвергается 400 | `safeParse` схемы правил; невалидный ввод → 400 |
| 3 | важно | `settings/route.ts:32` | `PUT` читает `await request.json()` в try/catch, передаёт в `saveSettings` без `safeParse`; значения коэрцируются `sanitizeSettings` (`modules/settings/domain/settings.ts:120-136`) | да, но низкий: тело пишет настройки организации (в т.ч. `timezone` — валидируется через `Intl`); неизвестные поля отбрасываются, длины ограничены, но мусор принимается молча, без 400 | `safeParse` схемы настроек → 400 при несоответствии |
| 4 | важно | `alerts/webhook/route.ts:87` | `export async function POST` — сырой обработчик, без `withApi`/`withMutation`. Свой токен-гейт (`isAuthorized`, `:76-85`), свой `runWithTenantContext` в теле (`:140`) | да: мимо обёртки теряются общий контекст тенанта, `recordHttpRequest`-метрики и единая граница ошибок (`api-wrapper.ts`). Ошибки вне `try` (например, до цикла) уйдут клиенту как необработанные. Тело при этом валидируется (`safeParse`, `:94`) | обернуть в `withMutation` с отдельной политикой (или `withApi` + явный `withCsrf`-исключение), как сделано у теле‑маршрутов |
| 5 | мелочь | `telemetry/ingest/route.ts:95` (POST), `:141` (PATCH) | POST/PATCH под `withApi` (не `withMutation`), тело разбирается `readJsonBody` и проверяется самописным `validateTelemetry` (`:211-282`), а не `schema.safeParse` | нет: аутентификация по ключу устройства (`authenticateDevice`), cookie нет → CSRF неприменим; есть свой лимитер и полная структурная проверка полей | по желанию — перевести `validateTelemetry` на zod-схему для единообразия; не срочно |
| 6 | мелочь | `media/route.ts:27-37` | POST читает `readJsonBody<{...}>` и проверяет только наличие `fileName`/`contentType` вручную; zod-схемы нет (комментарий прямо это фиксирует, `:24-26`) | нет: `entityType`/`entityId` проверяются доступом (`assertCanAccessMediaEntity`, `:41`), ключ хранилища собирается сервисом (`buildMediaKey`), имя/тип не влияют на путь | завести `schema.safeParse` для явности (поля `fileSize`/`entityType`/`entityId` сейчас лишь проверяются на истинность) |
| 7 | мелочь | `layout/[surfaceId]/route.ts:63` | PUT читает `await request.json()` в try/catch и передаёт в `saveLayout`; схемы нет, валидация — `surface.validate` (`modules/layout/application/layout-service.ts:83-84`), невалидное бросает `TypeError` → 400 (`:73`) | нет: валидатор поверхности отвергает неверный шаблон и маршрут отдаёт 400 — поведение корректное, отличается только способ (не zod) | оставить; при желании обернуть в `safeParse` по форме поверхности |
| 8 | мелочь | `monitoring/template/route.ts:34` | PUT читает `await request.json()` в try/catch; делегирует в `saveTemplate` → `saveLayout` (та же `surface.validate`, `:16-22`) | нет: устаревший алиас `/api/layout/[surfaceId]`, отвергает невалидное через `saveLayout` → TypeError → 400 (`:42-44`) | маршрут помечен как миграционный (`template-service.ts:3-6`); править не нужно |
| 9 | мелочь | `feedback/events/route.ts:89-90` | POST читает `await request.json()`, затем читает `body.operation` ДО любой валидации; `safeParse` применяется позже и только в ветках (`:99`, `:138`) | нет, но: ветка `operation === 'read_all'` вообще не валидирует тело; если тело — не объект (`null`), `body.operation` бросит и `catch` (`:191`) вернёт 500 вместо 400 | сначала `safeParse` тела (дискриминированное объединение по `operation`), потом ветвление; не-объект → 400 |
| 10 | мелочь | `telemetry/route.ts:83`, `telemetry/batch/route.ts:64` | POST под `withApi`, а не `withMutation`; CSRF (`withCsrf`) и лимит (`rateLimiter.check`) вписаны в маршрут вручную | нет: дублирование осознанное — высоконагруженный приём телеметрии с собственным порогом (комментарии `:87-104` и `:68-78`); тело валидируется `safeParse` (`:135`/`:178`, `:114`) | оставить; при рефакторинге — параметризовать `withMutation` лимитом вместо inline-дублирования |
| 11 | мелочь | `auth/login/route.ts:17` | POST под `withApi` (не `withMutation`), CSRF (`withCsrf`, `:27`) и лимит вписаны вручную | нет: единственный маршрут, работающий до появления сессии, поэтому не может идти через `withMutation`; тело валидируется `loginSchema.safeParse` (`:34`); обоснование в комментарии `:21-26` | оставить; поведение задокументировано |
| 12 | мелочь | `orion/lead/route.ts:55` | сырой `export async function POST` без обёртки | нет в рамках аудита: файл входит в замороженную область ORION (`AGENTS.md` §1, `src/app/api/orion/**`), тело валидируется `leadSchema.safeParse` (`:71`), есть лимитер и тенант-контекст вручную | не трогать — заморожено |

Примечание к строкам 1–3 и 7–8: во всех этих маршрутах тело всё же доходит до проверки/санитайзера, поэтому «дыры» (запись произвольных данных в базу) нет. Находка в том, что нарушен контракт проекта из CLAUDE.md: невалидное тело не отвергается ответом 400 на границе маршрута, а молча нормализуется внутри сервиса. Для #1–#3 это нежелательно именно потому, что тело описывает правила безопасности и доступов.

## Не проверено

- **Не проверено:** поведение `sanitizeRuleSet`/`sanitizeAccessMatrix`/`sanitizeSettings` на «мусорных» телах через фактический HTTP-запуск (не поднимались сервер/БД; вывод о «молча нормализуется, без 400» сделан по чтению кода — `settings.ts:120-136`, `readiness-rules.ts:248-294`, `access-matrix.ts:63-87`).
- **Не проверено:** точный набор названий полей, которые ждёт `assertCanAccessMediaEntity` для `entityType` (`media/route.ts:41`) — сама функция не открывалась (вне задачи).
- **Обёртка не проверена:** `withReadinessCommand` (используется большинством маршрутов `readiness/**`) разобран по `readiness/_shared/route-adapter.ts:13-29`; его зависимость `resolveReadinessRequestContext` и `readinessErrorResponse` не открывались, поэтому «обёрнуто в `withMutation`» для `readiness/**` принято по факту вызова `withMutation` внутри `route-adapter.ts:17`.
- **Не проверено:** маршруты только с GET (`src/app/api/**` их 55 из 141) — вне задачи; на чтение тела не проверялись.
- **Не проверено:** e2e/интеграционные прогоны (задача — опись, а не воспроизведение); серверы/БД не запускались, `.env` не читался.
