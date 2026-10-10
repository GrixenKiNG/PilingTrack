# AU177-S4-API-ERROR-SHAPES — форма ошибок в src/app/api

Read-only аудит. Версия кода: `git rev-parse HEAD` = **69b941cf9ba9083c5b9d01df17c74f34f0023a04**
(ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`). Код приложения не менялся;
создан только этот отчёт.

## Итог

Единого формата ошибки в API **нет**. Сосуществуют минимум четыре конверта:
плоский `{error: string}` (ядро, `src/core/api-wrapper.ts`), вложенный
`{error: {code, message, details, correlationId}}` (контур готовности,
`src/app/api/readiness/_shared/response.ts`), плоский «строковый» от контура готовности
в `bootstrap`, и неиспользуемый `{error, traceId, retryable, retryAfterMs}` из
`withErrorBoundary`. Клиент разбирает их по-разному и ломается при подмене.

Сырой стек в ответы **не отдаётся** (стек уходит только в лог, `api-error-boundary.ts:290`) —
это подтверждено. Но сырой **англоязычный** служебный текст утекает в тело: 4 строки из
`requireAuth` и 6 строк CSRF-проверки.

Статус местами не совпадает со смыслом: «нет tenantId» отдаётся и 400 (10 мест), и 403
(каноничный помощник `requireTenantId`); «не найдено» и «уже разобрано» слиты в один 409.

Числа (из команд, см. «Методику»): 141 `route.ts`; 215 плоских `error: '…'`;
4 вхождения вложенного `error: {code`; `details` трёх разных форм (14 `flatten()` /
25 `issues.map` / 3 сырых `issues`); 53 ручных перехвата `ServiceError` в 37 файлах;
10 мест с 400 на «нет организации» против статуса 403 у каноничного помощника.

Топ-5 значимых:
1. Два несовместимых конверта ошибки: плоский vs вложенный (§1).
2. Контур готовности сам раздвоен: `bootstrap` — плоский, команды — вложенный (§2).
3. Три разных формы `details` для одной ошибки валидации (§6).
4. Англоязычный текст (`Unauthorized`, `CSRF validation failed…`) в русском UI (§4, §5).
5. Статус `400` против `403` на одно условие «нет организации» (§7).

## Методика

Работал только чтением. Инструменты: `search_files` (ripgrep) и `read_file` (полный/по
диапазону). Поиск по `src/app/api` (`-g 'route.ts'`, 141 файл) плюс ядро
`src/core/api-wrapper.ts`, `src/lib/*`, `src/core/error-boundary/*`. Ключевые команды:

```
rg --files -g 'route.ts' src/app/api | wc -l                                   # 141
rg -c "error: '"  -g 'route.ts' src/app/api | awk -F: '{s+=$NF} END{print s}'  # 215
rg -c 'error: \{\s*code' -g 'route.ts' src/app/api                             # 4
rg -l 'details:.*\.flatten\(\)'  -g 'route.ts' src/app/api | wc -l             # 14
rg -l 'details:.*issues\.map'    -g 'route.ts' src/app/api | wc -l             # 25
rg -l "details: \w+\.error\.issues[,}]" -g 'route.ts' src/app/api | wc -l      # 3
rg -c 'instanceof ServiceError'  -g 'route.ts' src/app/api | awk -F: '{s+=$NF} END{print s}'  # 53
rg -o 'status: [0-9]{3}' -g 'route.ts' src/app/api | ... | sort | uniq -c
rg--files-without-match 'withApi\(|withMutation\(' -g 'route.ts' src/app/api  # 22
rg -n "error: '[A-Z]" src/lib/auth.ts                                          # 4
rg -n 'CSRF validation failed' src/lib/csrf-protection.ts                      # 6
rg -n 'withErrorBoundary' -g 'route.ts' src/app/api | wc -l                    # 0
```

Распределение статусов по `src/app/api` (команда `rg -o 'status: [0-9]{3}'`):
400 ×136, 403 ×22, 200 ×22, 201 ×17, 401 ×16, 404 ×15, 500 ×12, 429 ×10, 503 ×8,
202 ×6, 409 ×2, 413 ×1.

Читал целиком/диапазонами: `src/core/api-wrapper.ts`, `src/lib/service-error.ts`,
`src/lib/auth.ts`, `src/app/api/readiness/_shared/response.ts`,
`src/app/api/readiness/_shared/request-context.ts`,
`src/app/api/readiness/_shared/route-adapter.ts`,
`src/app/api/readiness/bootstrap/route.ts`, `src/app/api/readiness/access-matrix/route.ts`,
`src/app/api/operator/mobile/command/route.ts`, `src/app/api/auth/me/route.ts`,
`src/app/api/auth/login/route.ts`, `src/app/api/ready/route.ts`,
`src/app/api/health/deep/route.ts`, `src/app/api/reports/pdf/route.ts` (фрагменты),
`src/core/error-boundary/api-error-boundary.ts` (фрагменты), `src/lib/csrf-protection.ts`
(фрагменты), `src/components/piling/operator-mobile/api.ts` (фрагменты) и др.
Маршруты контура готовности, ORION и вариаций операторского экрана не редактировал;
ORION (`src/app/api/orion/**`) — заморозка, в находки включён только там, где паттерн
повторяет общий (`orion/lead`).

## Находки

Формат столбцов: `# | severity | path:line | проблема | сценарий / почему важно | как исправить`.

| # | severity | path:line | Проблема | Сценарий / почему важно | Предложить |
|---|---|---|---|---|---|
| 1 | важно | `src/core/api-wrapper.ts:110` ↔ `src/app/api/readiness/_shared/response.ts:31` | Два НЕсовместимых конверта: плоский `{error: string}` против вложенного `{error: {code, message, details, correlationId}}` | Один и тот же фронт разбирает их по-разному: мобильный ждёт строку (`src/components/piling/operator-mobile/api.ts:225` — `typeof payload?.error === 'string'`), readiness-экраны ждут объект (`src/components/piling/operator-v2/operator-shift-v2.tsx:649`, `src/components/piling/operator-v2/defect-sheet.tsx:68` — `?.error?.message`). Ответ одного контура на обработчике другого даёт «[object Object]» или тихую подмену на общий текст | Один конверт на всё API; вложенные поля (`code`) добавить в общий, а не заводить второй корень |
| 2 | важно | `src/app/api/readiness/bootstrap/route.ts:24,35,38,58,60` | Контур готовности сам раздвоен: `bootstrap` отдаёт ПЛОСКИЙ `{error: '…'}`, а команды `/readiness/*` — вложенный (через `readinessErrorResponse`) | Один и тот же контур (техническая готовность) отвечает двумя формами в зависимости от маршрута; клиент обязан угадывать форму | `bootstrap` перевести на `readinessErrorResponse`/общий конверт |
| 3 | важно | `src/app/api/readiness/access-matrix/route.ts:26,33,37,47` ↔ `src/app/api/readiness/_shared/response.ts:32-37` | Внутри вложенного конверта тоже два вида: `readinessErrorResponse` кладёт `details` и `correlationId`, а `access-matrix` хардкодит `{code, message}` без них; `request-context.ts:74` — тоже `{code, message}` | Поле `details` то есть, то нет в ответах одного контура — обработчик, читающий `error.details`, получает `undefined` | Свести к одной фабрике ответа на контур |
| 4 | важно | `src/lib/auth.ts:166,175,185,206` | Англоязычный служебный текст в теле: `'Unauthorized'`, `'Session is invalid'`, `'User not found'`, `'Authentication failed'` | Эти ответы отдаются как есть всем, кто делает `if (error) return error` (напр. `src/app/api/telemetry/route.ts:107`, readiness-маршруты). Русский UI показывает `Unauthorized` | Русский текст в `createJsonResponse` этого файла |
| 5 | важно | `src/lib/csrf-protection.ts:76,88,94,106,(+2)` | Англоязычный текст CSRF в теле 403: `'CSRF validation failed: …'` (6 вхождений) | Клиенты, показывающие `body.error` напрямую (`src/components/piling/admin-incidents/admin-incidents.tsx:62`, `src/components/piling/admin-reports/admin-reports.tsx:150`, `src/components/piling/admin-users/user-document-types-dialog.tsx:88`), выводят английскую строку; мобильный клиент вынужден её распознавать по префиксу (`operator-mobile/api.ts:232`) | Русский текст; признак отказа отдавать кодом, а не текстом |
| 6 | важно | `src/app/api/admin/incidents/route.ts:112`, `src/app/api/assistant/command/route.ts:46`, `src/app/api/operator/mobile/command/route.ts:202` ↔ 25 файлов с `.issues.map` и 14 с `.flatten()` | Три РАЗНЫХ структуры `details` для ошибки валидации: `error.flatten()` (14 файлов), `error.issues.map(e => ({field, message}))` (25 файлов), сырой `error.issues` (3 файла) | Клиентский разбор `details` не может быть единым: `.flatten()` даёт `{fieldErrors, formErrors}`, `.issues.map` — массив `{field,message}`, сырой `.issues` — массив zod-issue. Подсветка полей ломается при смене маршрута | Один помощник `detailsFrom(zodError)` на всё API |
| 7 | важно | `src/lib/tenant.ts:28` (403) ↔ `src/app/api/admin/incidents/route.ts:30`, `src/app/api/dictionary/manage/route.ts:77`, `src/app/api/admin/analytics/overview/route.ts:157`, `src/app/api/dictionary/all/route.ts:15` и ещё 6 мест (400) | Одно условие «нет tenantId» отдаётся двумя статусами: 400 (10 мест) и 403 (каноничный `requireTenantId`, `readiness/bootstrap:24`, `operator/mobile/command:196`) | Нет достоверного сигнала «сессия в порядке, но организация не задана»: клиент по 400 трактует как «плохой запрос», по 403 — как «нет прав» | Везде `requireTenantId` (403) либо явно утвердить 400 и починить помощник |
| 8 | важно | `src/app/api/admin/incidents/route.ts:128` | 409 «Происшествие не найдено либо уже разобрано» — слиты 404 (не найдено) и 409 (уже разобрано) в один статус | Клиент не отличает опечатку в id от повторного разбора; текст ошибки раздваивает смысл одного кода | Разделить: 404 для ненайденного, 409 для уже разобранного |
| 9 | важно | `src/app/api/reports/pdf/route.ts:354-355`, `src/app/api/reports/single-pdf/route.ts:345-346` | Статус выводится из ТЕКСТА ошибки: `message.includes('not ready') \|\| message.includes('not-found')` → 202 | Статус держится на английской подстроке в сообщении нижележащего слоя. Смена формулировки/локали молча переведёт «ещё не готов» в общий 500 | Отдавать типизированную причину (класс ошибки/код), а не матчить строку |
| 10 | мелочь | `src/app/api/auth/me/route.ts:35` | Англоязычный `{ error: 'User not found' }` при 404, при остальном русском | Единственная английская строка на этом маршруте среди русских | Русифицировать |
| 11 | мелочь | `src/app/api/auth/login/route.ts:66`, `src/app/api/feedback/events/route.ts:102,110,118,127,141`, `src/app/api/telemetry/ingest/route.ts:121,187`, `src/app/api/reports/upsert/route.ts:47`, `src/app/api/reports/pdf/route.ts:174`, `src/app/api/reports/single-pdf/route.ts:154` ↔ все прочие | `requestId` то в теле, то только в заголовке `x-request-id`: часть маршрутов кладёт в JSON (`requestId`), большинство — только заголовком (`createJsonResponse`, `src/lib/request-context.ts:84-90`) | Форма ответа об ошибке зависит от маршрута: поле `requestId` в теле то есть, то нет | Всегда отдавать `requestId` (в теле или заголовком) по одному правилу |
| 12 | мелочь | `src/core/error-boundary/api-error-boundary.ts:327-334` | Четвёртый конверт `{error, traceId, retryable, retryAfterMs}`; `withErrorBoundary` не вызывается ни одним маршрутом `src/app/api` (совпадений: 0) | Мёртвый формат ошибки: чтение даёт ложное ощущение, что он где-то применён. (Правило AGENTS.md §4: удалять только с доказательством — здесь только фиксирую факт) | Либо подключить осознанно, либо признать неиспользуемым отдельным решением |
| 13 | мелочь | `src/lib/tenant.ts:28`, `src/app/api/readiness/bootstrap/route.ts:24`, `src/app/api/readiness/_shared/request-context.ts:74`, `src/app/api/admin/equipment-analytics/route.ts:28`, 10 мест «Организация не определена» | Четыре разных текста для одного смысла: «Организация не определена», «Организация пользователя не определена», «Требуется контекст организации», «Не задан контекст организации» | Пользователь получает разные формулировки об одном и том же; аналитика по текстам ошибок невозможна | Единый текст (или код) для «организации нет» |
| 14 | мелочь | 37 файлов, 53 вхождения `instanceof ServiceError` (напр. `src/app/api/briefings/route.ts:66`, `src/app/api/checklist-templates/route.ts:83`) | Ручной перехват `ServiceError` дублирует то, что уже делает `withApi` (`src/core/api-wrapper.ts:108-112`) | Лишний код на каждый маршрут; форма совпадает, но при расхождении правок обёртки и ручных веток поведение разъедется | Полагаться на обёртку, убрать дубли (при задаче на рефакторинг) |
| 15 | мелочь | `src/app/api/telemetry/route.ts:83-105`, `src/app/api/telemetry/batch/route.ts:64-76`, `src/app/api/telemetry/ingest/route.ts:95` | POST-мутации обёрнуты в `withApi`, а не `withMutation`, и вручную повторяют `withCsrf` + `rateLimiter` + 429 (правило AGENTS.md §3 — CSRF и лимит даёт `withMutation`) | Обход штатной обвязки мутаций; формат своих 429 (`{error, retryAfter}`) отличается от общего (`{error}` + заголовок `Retry-After`) | Перевести на `withMutation` либо задокументировать исключение (устройства без сессии) |
| 16 | мелочь | `src/app/api/telemetry/route.ts:96`, `src/app/api/telemetry/batch/route.ts:75`, `src/app/api/auth/login/route.ts:66` ↔ `src/core/api-wrapper.ts:204,216` | 429-тело неоднородно: местами есть `retryAfter` в теле, у обёртки — только заголовок `Retry-After` | Клиент, читающий срок повтора из тела, на части маршрутов его не найдёт | Всегда `Retry-After` заголовком; тело опционально дополнить |
| 17 | мелочь | `src/app/api/telemetry/ingest/route.ts:68` (401) ↔ `:80` (403) | Нет ключа устройства → 401, неверный/отозванный ключ → 403 | Семантически «неверный ключ» — это 401 (не аутентифицирован), а не 403 (нет прав); 403-на-аутентификации путает клиента и логи | Оба — 401 (или 403, но единообразно и осознанно) |
| 18 | мелочь | `src/app/api/telemetry/ingest/route.ts:121,187` | Своя форма `details` для телеметрии: `validation.errors` и `errors.slice(0,5)` — не `.flatten()` и не `.issues.map` | Четвёртая структура `details`; общий разборщик её не поймёт | Свести к общему `detailsFrom` |
| 19 | мелочь | `src/app/api/alerts/webhook/route.ts:173` | Нестандартный конверт `{ok: false, forwarded, error}` при 503 (остальные тела вебхука — плоские `{error}` / `{ok:true}`) | Единственный ответ с одновременным `ok:false` и `error`; клиенты, ждущие `error`, и клиенты, ждущие `ok`, расходятся | Привести к общему конверту |
| 20 | мелочь | `src/app/api/admin/incidents/route.ts:137`, `src/app/api/admin/dlq/route.ts:132,139` и ~15 мест | Успех тоже неоднороден: `{ok:true}`, `{data}`, `{data:{ok:true}}`, `{entries,stats}`, `{user}`, `{types}` | Влияет на разбор ошибок у клиента, который определяет «свой ответ» по полю `data` (`src/components/piling/operator-mobile/api.ts:263` — `if (!('data' in payload))`) | Один успешный конверт (`{data}`) либо явно задокументировать исключения |

### Дополнение (path:line без разбора)

- 10 мест «нет tenantId → 400» (к §7): `admin/incidents:30,107`, `admin/analytics/overview:157`,
  `admin/analytics/site-weekly-trend:16`, `admin/equipment-analytics:28`, `dictionary/all:15`,
  `dictionary/manage:77,101,116,140`.
- Полный список ручных перехватов `ServiceError` (к §14) — 37 файлов под `src/app/api/**/route.ts`;
  пример строки: `if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });`.

## Что не проверено

- **Не запускались проверки из AGENTS.md §6** (`tsc`, `lint`, `test:unit`, `playwright`, `build`):
  это read-only аудит формы ответов; проверки ничего не добавили бы к тексту ответов. Отдельные
  тесты маршрутов есть (`src/app/api/**/__tests__/`), но я их не исполнял.
- **Не проверено в рантайме**, как реальный клиент отображает каждый из четырёх конвертов: выводы
  о «[object Object]» — из чтения кода разбора (`operator-mobile/api.ts:225`, `operator-v2/*`),
  а не из наблюдения. Статус: ГИПОТЕЗА по части клиентских последствий.
- **Обход всех 141 `route.ts` построчно не делал** — выборки по регуляркам покрывают `error:`-ответы,
  но маршрут, отдающий ошибку нетиповым способом (не `NextResponse.json` с `error`), мог не попасть.
  Сплошной просмотр сделан для контура готовности (29 маршрутов), `operator/mobile/command`, `auth/*`,
  `ready`/`health/deep`, `telemetry/*`, `alerts/webhook`.
- **ORION** (`src/app/api/orion/**`) — заморозка (AGENTS.md §1); `orion/lead` разобран только как
  носитель общей закономерности, не как объект замечаний.
- **Версия Prisma/Next** и её влияние на форму ошибок не сверял с документацией (context7 не
  использовался): выводы сделаны по коду проекта, а не по внешним библиотекам.
- **Полнота списка «нет tenantId → 400»**: числа получены регуляркой по тексту `'Организация не
  определена'`; формулировки, отличающиеся по регистру/форме, могли быть не учтены.
