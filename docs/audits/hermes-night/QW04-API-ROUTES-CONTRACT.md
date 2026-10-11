# QW04 — Контракт API-маршрутов

Аудит контракта HTTP-маршрутов `src/app/api`. Только чтение: код приложения не
изменялся. git rev-parse HEAD: `3ace936fd37ad178c3a7558aedea65a877ad218b`.
Версия Next.js 16 + Prisma 7.

## Итог

Пройден весь API-слой: **142 файла route.ts, 203 открытых HTTP-хендлера**
(GET 94, POST 65, PUT 15, PATCH 7, DELETE 22). Контракт «GET → withApi,
POST/PUT/DELETE → withMutation, тело через `schema.safeParse`, ошибки 400 на
русском» выполнен в подавляющем большинстве, но есть системные отклонения.

Находок в таблице — **14** (критичных 0, важных 4, мелких 10); остальные
отклонения вынесены в список путь:строка в приложении «А».

Пять главных:
1. `src/app/api/settings/route.ts:38,46` — PUT передаёт сырое `body` в
   `saveSettings` без схемы и без `try/catch`: некорректное тело даст 500, а не
   400 (нарушение «валидируй через safeParse, используй только validated.data»).
2. 6 мутаций (5 POST + 1 PATCH) обёрнуты `withApi` вместо `withMutation`:
   telemetry route/batch/ingest (POST/PATCH) и `auth/login`. Все закрыты
   инлайном (CSRF + rateLimit + requireAuth/ключ устройства) — защищено, но
   выходит за рамки заявленного контракта; ревьюер, полагающийся на withMutation,
   увидит «нет лимитера» и должен читать построчно.
3. `src/app/api/alerts/webhook/route.ts:88` — вебхук без rate limit: только
   bearer-токен; при компрометации токена можно залить Telegram/outbox (нет
   ни сессионного лимитера withMutation, ни своего).
4. `src/app/api/auth/me/route.ts:35` — английский текст `'User not found'`
   при 404 — единственный латинский текст ошибки в API; остальные — на русском.
5. Публичные/инфра-маршруты без withApi (health, deep, liveness, ready,
   readiness, feedback/stream) — все осознанно: либо публичные пробы, либо SSE,
   который не может ждать конца потока (комментарий
   `src/app/api/feedback/stream/route.ts:13`).

## Методика

Всё воспроизводится из корня репозитория. Использовался ripgrep + node-скрипты
(Windows/Git Bash; пути вперёд). Никаких новых зависимостей, ни одной записи.

- Файлы и методы:
  `find src/app/api -name route.ts | wc -l` → 142;
  `rg -o "export (async function|const) (GET|POST|PUT|PATCH|DELETE)" src/app/api | rg -o "(GET|POST|PUT|PATCH|DELETE)" | sort | uniq -c`.
- Обёртка на строке экспорта (okno в 6 строк от `export`): node-скрипт
  `qw04_classify.js` — сопоставляет метод и ближайший `withApi(`/`withMutation(`/
  `withReadinessCommand(`/`withReadinessApi(`/«NONE».
- Тело: в тех мутациях, где есть `request.json()`, проверялось, есть ли
  `schema.safeParse` рядом; 21 маршрут без safeParse проверен скриптом
  `qw04_body21.js` (читает ли body, отвечает ли 400 на битый JSON).
- Коды ответов: `rg -n "status: (400|401|404|409|429|500|503)" src/app/api --glob route.ts | grep -v __tests__ | wc -l`.
- Тексты ошибок: `rg -n "error: *'[A-Za-z]([A-Za-z ]*)'"` + выборочная
  вычитка (auth/me, orion/lead, alerts/webhook, auth/login, settings,
  monitoring/template, layout, feedback/events, readiness/*).
- Счётчики «доля» — только из вывода команд, без округлений.

Скрипты лежат во временной директории; отчёт — единственный создаваемый файл.

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/settings/route.ts:33,43` | PUT: `body = await request.json()` → `saveSettings(tenantId, body, actorId)` без схемы; `try/catch` только вокруг `request.json()` | Некорректный/внеплановый ключ настроек, который `saveSettings` отклонит, упадёт в 500 (withMutation) вместо 400; нарушен принцип «validated.data» | Обернуть `saveSettings` в try/catch → 400; либо ввести zod-схему PUT и проверять до записи |
| 2 | важно | `src/app/api/monitoring/template/route.ts:41` | `saveTemplate(tenantId, body, userId)`, body не прогонян через schema; 400 только в catch | Аналогично #1: валидация по факту живёт в сервисе; клиент не видит деталей | Ввести схему шаблона, safeParse до записи |
| 3 | важно | `src/app/api/layout/[surfaceId]/route.ts:68` | `saveLayout(tenantId, surfaceId, body, …)` с сырым body; неизвестная поверхность → 404, TypeError → 400, остальное rethrown → 500 | Некорректная раскладка даёт 500, а не 400; неопределённый контракт ответа | Схема раскладки + safeParse; единый 400 на валидацию |
| 4 | важно | `src/app/api/alerts/webhook/route.ts:88` | POST без rate limit (нет `rateLimiter` в файле); только bearer-токен `ALERTMANAGER_WEBHOOK_TOKEN` | Утечка токена → неограниченный поток в `deliverQueuedAlert`/Telegram; outbox переполняется | Подключить rateLimiter по идентификатору; либо withMutation для этого webhука |
| 5 | важно | `src/app/api/telemetry/route.ts:83`; `src/app/api/telemetry/batch/route.ts:64`; `src/app/api/telemetry/ingest/route.ts:95,141`; `src/app/api/auth/login/route.ts:17` | POST(×5)/PATCH(×1) обёрнуты `withApi`, а не `withMutation`; CSRF/лимит/аутентификация проставлены вручную | Защищено (см. строки), но не по шаблону; ревью по контракту пропустит эти маршруты; риск рассинхронизации при будущих правках | Привести к withMutation или дописать в контракт: «мутирующие endpoints с не-сессийной аутентификацией могут использовать withApi + инлайн-контроли» |
| 6 | мелочь | `src/app/api/telemetry/ingest/route.ts:63,76,102,112,147,156` | POST/PATCH аутентификация по `x-device-key`/`authenticateDeviceByKey`, без `withCsrf`; rate limit на строках 102–103 и 147–148 (по идентификатору `telemetry:ingest:*`) | Правильно для device API (нет сессии/cookie → CSRF неприменим), но выходит за контракт «мутация = withMutation + withCsrf» | Осознанное исключение; прописать в контракте: «маршруты с ключом устройства — с withApi + device-key + rateLimiter» |
| 7 | мелочь | `src/app/api/auth/me/route.ts:35` | `{ error: 'User not found' }` на 404 — единственный англ. текст ошибки в API | Непоследовательность UX; фронт-энд не парсирует text, но человек увидит разный язык | Заменить на «Пользователь не найден» |
| 8 | мелочь | `src/app/api/readiness/access-matrix/route.ts:31,45` | PUT/POST принимают сырой body (PUT) / не читают body (POST) — без единой схемы | Контракт PUT не определён в терминах полей; клиенту нечего верифицировать | Схемы access-matrix PUT/POST + safeParse |
| 9 | мелочь | `src/app/api/readiness-rules/route.ts:21` | PUT: `body` → сервис, без схемы | То же: 400 только если сервис бросит | Схема readiness-rules PUT |
| 10 | мелочь | `src/app/api/orion/lead/route.ts:55` | Публичный POST формы **без** `withCsrf`; защита: rate limit (5/10min), honeypot, эскейп HTML | Корректно для публичной формы (нет cookie-сессии), но отклонение от «все мутации — с CSRF-контролем» | Оставить, прописать в контракте как исключение |
| 11 | мелочь | `src/app/api/feedback/events/route.ts:199` | `export const PATCH = POST;` — алиас на withMutation POST | Работает (вкладывает сессийный rate limit), но читается как «PATCH без обёртки» статистикой | Переписать явно: `export const PATCH = POST; // = withMutation` (комментарий) |
| 12 | мелочь | `src/app/api/readiness/route.ts` (GET), `health/route.ts:24`, `health/deep/route.ts:34`, `liveness/route.ts:13`, `ready/route.ts:27`, `feedback/stream/route.ts:9` | 6 GET без withApi (5 health-проб + 1 SSE) | Все осознанные: пробы должны быть легковесными, SSE не может ждать конца потока (`stream/route.ts:13`) | Оставить; зафиксировать в контракте |
| 13 | мелочь | `src/app/api/settings/route.ts:24`; `monitoring/template/route.ts:26`; `layout/[surfaceId]/route.ts:51` | Ответ на успех — `NextResponse.json(saved)`/`saved` без единого формата `{ ok, data | requestId }`; у mутац. withMutation есть requestId только через `createJsonResponse` | Клиенту приходится гадать, есть ли `requestId` в ответе PUT | Унифицировать форму ответа мутаций (либо обвязка withMutation, либо единый createJsonResponse) |
| 14 | мелочь | `src/app/api/dictionary/manage/route.ts:104,119` | 400 с деталями `validated.error.flatten()` (raw zod-структура) в отличие от других 400 с `{ error, requestId, details: [{field, message}] }` | Разный формат errors у похожих 400-ответов; фронту сложно унифицировать обработчик | Единство формы деталей валидации |

## Не проверено

- **Runtime-поведение:** не запускался dev/prod сервер, не отправлялись реальные
  запросы; выводы по CSRF/лимитам сделаны только из кода (`withCsrf`,
  `rateLimiter.check`, `requireAuth`, `authenticateDeviceByKey`).
- **Корректность сервисов `saveSettings`/`saveTemplate`/`saveLayout`
  (находки 1–3):** возможно, они валидируют body сами; не вник — это за
  пределами «контракта API». Статус: **ГИПОТЕЗА** о наличии 500 на плохом теле.
- **readiness `_shared/route-adapter.ts`** — только имена функций
  (`withReadinessCommand`, `withReadinessApi`), внутреннее поведение не
  вычитано.
- **Прочие мутации** из 21 без safeParse: не все вычитаны; вычитаны только
  те, что читают body (#1, #2, #3, #8, #9, #14, settings). Остальные
  (DELETE/media/briefings/maintenance/equipment/logout/telemetry) — без тела или с
  custom-валидацией; не проверены построчно.
- **Коды 201/202 в API** (17/2 случая): не вычитаны; не входят в заявленный
  контракт.
- **CSRF exempt-список** (`CSRF_HEADERLESS_ALLOWED_PATHS`): не проверен на
  полноту; только упомянут в `auth/login` как осознанное применение.
- **Состояние Sentry/observability** в withApi: только чтение, не проверка
  интеграции.
- **Тесты**: не запускали; `rate-limit-key.test.ts` (telemetry) — существует,
  но не запускался и не интерпретирован.

## А. Отклонения — список путь:строка (за пределами таблицы)

Мутации с `withApi` вместо `withMutation` (5 POST + 1 PATCH — защищено
инлайном, но не по шаблону):
- `src/app/api/auth/login/route.ts:17` (POST)
- `src/app/api/telemetry/route.ts:83` (POST)
- `src/app/api/telemetry/batch/route.ts:64` (POST)
- `src/app/api/telemetry/ingest/route.ts:95` (POST)
- `src/app/api/telemetry/ingest/route.ts:141` (PATCH)

Мутации без обёртки на строке экспорта (3 — публичные/ключевые):
- `src/app/api/alerts/webhook/route.ts:88` (POST, bearer, без rate limit)
- `src/app/api/orion/lead/route.ts:55` (POST, публичная форма, rate limit есть)
- `src/app/api/feedback/events/route.ts:199` (PATCH = POST withMutation)

Мутации без `schema.safeParse` в файле (21; из них читают body: 9):
- `src/app/api/admin/projections/rebuild/route.ts:37` POST (без body)
- `src/app/api/auth/logout/route.ts:12` POST (без body)
- `src/app/api/briefings/[id]/sign/route.ts:20` POST (без body)
- `src/app/api/equipment/[id]/fuel/[entryId]/route.ts:14` DELETE (без body)
- `src/app/api/equipment/[id]/meter-readings/[readingId]/route.ts:13` DELETE (без body)
- `src/app/api/layout/[surfaceId]/route.ts:51` PUT (тело → сервис, без схемы)
- `src/app/api/layout/[surfaceId]/route.ts:77` DELETE (без body)
- `src/app/api/maintenance/[id]/accept/route.ts:14` POST (без body)
- `src/app/api/maintenance-plans/run/route.ts:13` POST (без body)
- `src/app/api/media/route.ts:19` POST (тело → сервис, без схемы)
- `src/app/api/media/[id]/confirm/route.ts:8` POST (без body)
- `src/app/api/media/[id]/route.ts:9` DELETE (без body)
- `src/app/api/monitoring/template/route.ts:26` PUT (тело → сервис, без схемы)
- `src/app/api/readiness/access-matrix/route.ts:31` PUT (тело → сервис, без схемы)
- `src/app/api/readiness/access-matrix/route.ts:45` POST (без body)
- `src/app/api/readiness-rules/publish/route.ts:10` POST (без body)
- `src/app/api/readiness-rules/route.ts:21` PUT (тело → сервис, без схемы)
- `src/app/api/safety/equipment-permits/[id]/route.ts:13` DELETE (без body)
- `src/app/api/settings/route.ts:24` PUT (тело → сервис, без схемы и без catch → 500)
- `src/app/api/telemetry/ingest/route.ts:95` POST (custom `validateTelemetry`)
- `src/app/api/telemetry/ingest/route.ts:141` PATCH (custom `validateTelemetry`)

GET без `withApi` (6 — осознанные):
- `src/app/api/health/route.ts:24`
- `src/app/api/health/deep/route.ts:34`
- `src/app/api/liveness/route.ts:13`
- `src/app/api/ready/route.ts:27`
- `src/app/api/readiness/route.ts:26`
- `src/app/api/feedback/stream/route.ts:9` (SSE)
