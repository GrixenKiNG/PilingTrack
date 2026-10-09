# AU114-S5-API-ERROR-SHAPE: единый вид ошибок API

Версия проверки: `git rev-parse HEAD` = `8fc8b1a76e487674dfa81c3ea9e24d9f09478238` (ветка `hermes/q4-0926`).
Область: `src/core/api-wrapper.ts` и все `src/app/api/**/route.ts` (кроме тестов и замороженных зон).
Статусы выводов: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА.

## Итог

1. Единой формы ошибок нет: сосуществуют две несовместимые — плоская `{ error: "<строка>" }` (доминирует, 222 вхождения в маршрутах) и вложенная `{ error: { code, message, details, correlationId } }` (контур `/api/readiness/*`).
2. Хуже: один и тот же namespace смешивает обе формы — `src/app/api/readiness/bootstrap/route.ts:57` отдаёт плоскую, а `src/app/api/readiness/history/route.ts:69` и соседи — вложенную.
3. 50 маршрутов собирают тело ошибки вручную через `NextResponse.json({ error: '…' })`; 47 из них при этом ещё и обёрнуты (`withApi`/`withMutation`) — то есть дублируют обработку, которую обёртка делает сама.
4. Поле `details` существует в 4 разных формах; клиентский разборщик `src/lib/api-error-message.ts:58` понимает только 2 из них — остальные построчные ошибки до человека не доходят.
5. Критично ничего: утечек стека и SQL в ответы не найдено (ПРОЙДЕНО); но есть утечка английских текстов в русский интерфейс (`Unauthorized`, `Tenant settings are not configured`).

Всего маршрутов: 141. Через обёртку: 133. Без обёртки: 8. Вложенная форма: контур readiness (21 через адаптер + 1 inline + 2 служебных). Плоская форма: остальные.

## Методика

Команды (bash, из корня `D:\PillingR\wt-night`), проверялись на HEAD выше:

```bash
# общее число маршрутов
find src/app/api -name 'route.ts' | wc -l                      # 141
# маршруты через обёртку (api-wrapper или route-adapter, кавычки не важны)
grep -rlE "api-wrapper|route-adapter" src/app/api --include=route.ts | wc -l   # 133
# маршруты БЕЗ обёртки
comm -23 <(find src/app/api -name 'route.ts' | sort) \
         <(grep -rlE "api-wrapper|route-adapter" src/app/api --include=route.ts | sort)
# файлы с ручным телом ошибки
grep -rlE "NextResponse\.json\(\s*\{\s*error:\s*['\"\`]" src/app/api --include=route.ts | wc -l  # 50
# из них обёрнутые (дублирование)
comm -12 /tmp/inline.txt /tmp/wr.txt | wc -l                   # 47
# вхождения плоской формы
grep -rhoE "error:\s*['\"\`]" src/app/api --include=route.ts | wc -l           # 222
# вложенная форма
grep -rnE "error:\s*\{" src/app/api --include=route.ts src/app/api/readiness/_shared/*.ts
# формы details
grep -rn "details:" src/app/api --include=route.ts             # 57 строк
grep -rho "flatten()" src/app/api --include=route.ts | wc -l   # 33
grep -rhoE "issues\.map\(" src/app/api --include=route.ts | wc -l              # 30
# статусы
grep -rhoE "status:\s*[0-9]{3}" src/app/api --include=route.ts | sort | uniq -c | sort -rn
# утечки
grep -rnE "error\.stack|\.stack\b" src/app/api src/core/api-wrapper.ts         # пусто
```

Дополнительно читались файлы (не только grep): `src/core/api-wrapper.ts`, `src/app/api/readiness/_shared/response.ts`, `.../route-adapter.ts`, `.../request-context.ts`, `src/lib/service-error.ts`, `src/lib/api-error-message.ts`, `src/lib/request-context.ts`, `src/lib/auth.ts`, `src/modules/readiness/application/bootstrap-query.ts`, `src/components/piling/to/readiness/api/client.ts`, `src/components/piling/to/readiness/screens/shared.tsx`, `src/app/api/auth/login/route.ts`, `src/app/api/reports/upsert/route.ts`, `src/app/api/reports/delete/route.ts`, `src/app/api/feedback/events/route.ts`, `src/app/api/telemetry/ingest/route.ts`, `src/app/api/alerts/webhook/route.ts`, `src/app/api/health*/route.ts`, `src/app/api/ready/route.ts`, `src/app/api/liveness/route.ts`, `src/app/api/readiness/route.ts`, `src/app/api/readiness/bootstrap/route.ts`, `src/app/api/readiness/history/route.ts`, `src/app/api/inspections/[id]/complete/route.ts`, `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts`.

### Форма ответа об ошибке | число маршрутов | примеры | риск для клиента

| Форма | Число маршрутов | Примеры (path:line) | Риск для клиента |
|---|---|---|---|
| Плоская `{ error: "<рус>" }` (обёртка или throw ServiceError) | ~60 без ручного тела + 47 дублирующих | `src/core/api-wrapper.ts:109`, `src/app/api/reports/upsert/route.ts` | Базовый случай, риск низкий |
| Плоская ручная `NextResponse.json({ error: '…' })` | 50 файлов (47 из них ещё и обёрнуты) | `src/app/api/alerts/webhook/route.ts:90`, `src/app/api/media/route.ts:43` | При правке обёртки эти места отстанут по форме |
| Плоская `{ error, details }` — массив `{field,message}` | 30 вхождений | `src/app/api/users/route.ts:61` | Понятна клиенту `apiErrorMessage` |
| Плоская `{ error, details }` — zod `flatten()` | 33 вхождения в 26 файлах | `src/app/api/feedback/events/route.ts:102` | Понятна `apiErrorMessage` (ветка fieldErrors) |
| Плоская `{ error, details }` — сырой `issues[]` (zod, англ. путь) | 3 | `src/app/api/admin/incidents/route.ts:112` | НЕ понятна `apiErrorMessage` — строки теряются |
| Плоская `{ error, details: string[] / [{index,errors}] }` | 2 | `src/app/api/telemetry/ingest/route.ts:121`, `:187` | НЕ понятна `apiErrorMessage` |
| Плоская + `requestId` | 6 (createJsonResponse) | `src/app/api/auth/login/route.ts:40`, `src/app/api/feedback/events/route.ts:102` | Нет поля у остальных — сопоставление с логом неполное |
| Плоская + `retryAfter` | 2 | `src/app/api/auth/login/route.ts:66`, `src/app/api/telemetry/batch/route.ts:75` | В прочих 429 только заголовок `Retry-After` |
| Вложенная `{ error: { code, message, details, correlationId } }` | контур readiness (21 через адаптер) | `src/app/api/readiness/_shared/response.ts:31` | Клиент `client.ts` её НЕ читает — показывает фолбэк |
| Вложенная укороченная `{ error: { code, message } }` | 5 inline | `src/app/api/readiness/access-matrix/route.ts:26`, `src/app/api/readiness/_shared/request-context.ts:74` | Без `details`/`correlationId` — 2-й под-вид вложенной |
| Без поля `error` (пробы `{ status, checks }`) | 4 | `src/app/api/health/route.ts:34`, `src/app/api/ready/route.ts:31`, `src/app/api/liveness/route.ts:15`, `src/app/api/health/deep/route.ts:61` | Намеренно; риск низкий |

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/readiness/_shared/response.ts:31` | Вложенная форма `{error:{code,message,details,correlationId}}` — единственный контур с такой формой | Любой клиент, рассчитанный на `body.error` как строку, видит `undefined` | Привести readiness к плоской форме ИЛИ научить клиентов обеим через один парсер |
| 2 | важно | `src/app/api/readiness/bootstrap/route.ts:57` | В том же namespace `/api/readiness/*` отдаётся ПЛОСКАЯ форма, тогда как `history/current/audit` — вложенную | Один экран получает две формы с одного префикса — парсер надо писать под каждый маршрут | Единый хелпер ответа для всего readiness |
| 3 | важно | `src/app/api/readiness/history/route.ts:69` | Маршрут отдаёт вложенную форму для `ReadinessCommandError`, но при иной ошибке `throw` уходит в `withApi` и превращается в плоскую 500 | Одна и та же ручка отвечает в двух формах в зависимости от типа сбоя | Ловить все ошибки в одном хелпере, а не только `ReadinessCommandError` |
| 4 | важно | `src/components/piling/to/readiness/api/client.ts:51` | `messageFromBody` читает `body.error` ТОЛЬКО как строку → вложенное сообщение readiness теряется, экран показывает фолбэк | Формулировка сервера («Дефект изменился…») не доходит до пользователя | Читать и `error.message`, как в `screens/shared.tsx:119` |
| 5 | важно | `src/components/piling/to/readiness/screens/shared.tsx:119` | Второй парсер того же ответа умеет и строку, и `error.message` — два клиента трактуют одну форму по-разному | Ярлык ошибки различается на разных экранах при одном ответе | Один общий парсер ошибок на проект |
| 6 | важно | `src/lib/auth.ts:166` | `requireAuth` отдаёт `{ error: 'Unauthorized' }` — английский текст на русском экране | При истечении сессии (401) пользователь читает «Unauthorized» | Русский текст в самом источнике или перевод в общем парсере |
| 7 | важно | `src/modules/readiness/application/bootstrap-query.ts:185` | `throw new ServiceError('Tenant settings are not configured', 503)` — английский текст уходит клиенту через плоскую форму | Экран допусков показывает английскую строку вместо объяснения | Перевести сообщение (и аналогичные ServiceError) |
| 8 | мелочь | `src/app/api/admin/incidents/route.ts:112` | `details: parsed.error.issues` — сырой массив zod-issue (`path`, англ. `message`) | `apiErrorMessage` такие записи игнорирует — построчная причина не видна | Заменить на `issues.map(i => ({field:i.path.join('.'), message:i.message}))` |
| 9 | мелочь | `src/app/api/assistant/command/route.ts:46`, `src/app/api/operator/mobile/command/route.ts:202` | То же: `details: parsed.error.issues` в сыром виде | То же, что #8 | То же |
| 10 | мелочь | `src/app/api/telemetry/ingest/route.ts:121`, `:187` | `details` — строка/`[{index,errors}]`, третья форма | Клиентский разборщик их не понимает | Унифицировать до `{field,message}` |
| 11 | мелочь | `src/app/api/reports/upsert/route.ts:47` | `{ error, requestId, details }` — порядок/набор полей иной, чем у большинства | Нестандартный набор полей в одной ручке | Привести к общему набору |
| 12 | мелочь | `src/app/api/reports/upsert/route.ts:151` | Успех несёт поля `meterWarning`/`meterError` вперемешку с `report`/`requestId` | Клиенту надо знать эти особые поля вручную | Вынести в согласованное поле или `details` |
| 13 | мелочь | `src/app/api/reports/delete/route.ts:141` | 404 определяется по вхождению англ. подстрок `'Record to delete'`/`'not found'` в текст Prisma | Хрупко: смена локали/версии Prisma — и 404 превращается в 500 | Ловить код Prisma (`P2025`) как в `api-wrapper.ts:119` |
| 14 | мелочь | `src/app/api/readiness/access-matrix/route.ts:26` | Вложенная форма без `details`/`correlationId` (отличается от `response.ts:31`) | Ещё один под-вид той же формы | Общий хелпер |
| 15 | мелочь | `src/app/api/readiness/_shared/request-context.ts:74` | Вложенная форма `{error:{code,message}}` без `details`/`correlationId` | То же, что #14 | То же |
| 16 | мелочь | `src/app/api/readiness/_shared/response.ts:15` | Заголовки `X-Correlation-Id`/`X-Request-Id` здесь против `x-request-id` в `src/lib/request-context.ts:50` | Три разных заголовка трассировки в проекте | Свести к одному имени |
| 17 | мелочь | `src/app/api/auth/login/route.ts:66`, `src/app/api/telemetry/batch/route.ts:75` | `retryAfter` в теле только у двух ручек; обёртка (`src/core/api-wrapper.ts:116`) кладёт `retryAfter`, а inline 429 — нет | 429 в остальных ручках: клиент видит только заголовок | Единый 429-ответ из обёртки |
| 18 | мелочь | `src/core/api-wrapper.ts:109` (и 47 файлов) | 47 маршрутов вручную повторяют `catch { if (err instanceof ServiceError) … }`, хотя уже обёрнуты | При изменении формы в обёртке эти 47 мест отстанут | Убрать ручные `catch`, отдавать `throw` обёртке |
| 19 | мелочь | `src/app/api/alerts/webhook/route.ts:90`, `src/app/api/feedback/stream/route.ts`, `src/app/api/orion/lead/route.ts:60` | 3 маршрута без обёртки строят свои тела ошибки (webhook, SSE, ORION — ORION заморожен) | Форма не гарантирована обёрткой; для webhook/SSE это осознанно | Оставить, но зафиксировать контракт |

Итого: критично — 0; важно — 7; мелочь — 12.

## ПРОЙДЕНО

- Утечек стека в ответы API не найдено: `grep -rnE "error\.stack|\.stack\b" src/app/api src/core/api-wrapper.ts` — пусто.
- Утечек SQL/имён таблиц Prisma не найдено: обёртка подменяет P2002/P2025 на общую русскую фразу (`src/core/api-wrapper.ts:119-126`), прочие Prisma-ошибки → общая 500 (`:130-133`); `error.message` в тела ответов берётся только из `ServiceError` (домен) либо логируется (`src/app/api/inspections/[id]/complete/route.ts:71`, `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts:154` — оба в `logger.warn`, не в ответ).
- Обёртка даёт один текст 500 без внутренних деталей (`src/core/api-wrapper.ts:131`).

## Не проверено

- Реальные тела ответов на живом сервере: сервер не поднимался, все выводы — чтение кода и grep (статусы/формы — статические).
- Полнота разбора маршрутов, возвращающих бинарь (xlsx/pdf/csv/SSE, `src/app/api/reports/export/route.ts:70`, `src/app/api/pile-passports/export/route.ts:88`, `src/app/api/feedback/stream/route.ts:64`): проверено, что успешный путь отдаёт не-JSON; их собственные ветки отказа разобраны не построчно.
- Замороженные зоны (`src/app/api/orion/**`, варианты экрана оператора) — кроме факта наличия `orion/lead` без обёртки, внутрь не заглядывал.
- Модульные тесты, фиксирующие форму ошибок (`src/app/api/__tests__/*`), не запускались — соответствие тестов фактическому коду не сверял.
- Контрактные тесты Fastify/Next route types и `npm run build` не запускались (нужен env).
