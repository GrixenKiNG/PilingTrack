# Аудит валидации API-маршрутов (src/app/api/**/route.ts)

Проверка: читает ли каждый API-маршрут, принимающий тело запроса или query-параметры, валидирует их перед использованием. Критерий (CLAUDE.md): тело проходит через zod-схему `schema.safeParse(body)`, при неудаче — 400 с деталями, обработчик использует ТОЛЬКО `validated.data`; мутации — через `withMutation`, чтения — через `withApi`.

## Итог

- Маршрутов в области проверки (исключая `src/app/api/orion/**`): **141**. Мутационных (POST/PUT/PATCH/DELETE): **85**. Читают тело запроса: **74**. Полностью валидированы: **71** (66 — zod `safeParse`/`.parse`/`validateTelemetry` прямо в route-файле, ещё 5 — валидация на уровне модуля: `sanitizeSettings`, `sanitizeRuleSet`, `sanitizeAccessMatrix`, `surface.validate`).
- **Критично: 0** · **Важно: 5** · **Мелочь: 9**.
- Критичных находок нет: все пути, пишущие в БД, проходят либо zod `safeParse`, либо модульную санитизацию до записи; «сырых» SQL-запросов с невалидированным вводом нет (используется параметризованный `$queryRaw`, инъекций не обнаружено).
- Топ-5 по значимости:
  1. `reports/pdf` POST — тело разбирается без всякой схемы: `const { dateFrom, dateTo, siteId, filterUserId, equipmentId } = body`, проверяется только наличие `dateFrom`/`dateTo`, типы и значения не валидируются, поля уходят в параметризованный `$queryRaw`-запрос, а `dateFrom`/`dateTo` дополнительно копируются в заголовок `Content-Disposition` (риск header-injection).
  2. `reports/period` GET — `dateFrom`/`dateTo` передаются в raw-запрос строкой без проверки формата/диапазона.
  3. `telemetry` GET — `limit = parseInt(...)` без границ и без проверки NaN, а `new Date(from)`/`new Date(to)` — без проверки валидности даты (Invalid Date уходит в Prisma-запрос → 500).
  4. `audit` GET — `limit` ограничен только снизу (`> 0`), верхней границы нет → неограниченный fetch по истории сущности.
  5. `reports/single-pdf` POST — `reportId` из тела без валидации типа уходит в `findUnique` (реальный impact снижен: при несовпадении — 404 и проверка владельца).

## Методика

1. `find src/app/api -name "route.ts"` — 142 файла; исключён `src/app/api/orion/lead/route.ts`, 141 в области.
2. Node-скрипт по всем route.ts вывел: HTTP-обработчики (`export const GET|POST|PUT|PATCH|DELETE`), признак чтения тела (`request.json`, `req.json`, `.formData()`, `readJsonBody`), признак валидации (`safeParse`, `.parse`, `validateTelemetry`, `telemetryBatchSchema`), использование `searchParams`, обёртки (`withApi`/`withMutation`).
3. Все 141 route.ts прочитаны файлами (выборочно полностью — все 8 тел без `safeParse`, все `withMutation`-без-обёртки, все идентифицированные `parseInt`/`Number`/`new Date`).
4. Для каждого подозрительного маршрута прослежен поток данных вниз: модуль (`src/modules/**`, `src/services/**`) — проверено, валидируется ли ввод до записи/чтения. Проверены `sanitizeSettings`, `sanitizeAccessMatrix`, `sanitizeRuleSet`, `surface.validate`, `saveLayout`, `saveTemplate`, `getReportsByPeriodRaw` (параметризованный `$queryRaw`).
5. Проверка «raw `body.x` после валидации»: grep `body\.` по route-файлам; в `assistant/command` и `operator/mobile/command` переменная `body` — это `parsed.data` (валидированное значение), сырого использования после `safeParse` не найдено.
6. Проверка числовых/датовых query-параметров на границы: `parseInt`/`Number`/`new Date(searchParams...)` по всем route.ts; сверены клэмпы `Math.min/Math.max` и проверки `Number.isNaN`.

Повтор запуска: скрипты-измерения сохранены вне репозитория (scratch), при желании пересчёт — по шагам 2–4.

## Находки

| # | Серьёзность | path:line | Проблема | Сценарий / почему значимо | Предложенное исправление |
|---|-------------|-----------|----------|---------------------------|---------------------------|
| 1 | важно | `src/app/api/reports/pdf/route.ts:30-47` (и `177-189`) | POST-тело разбирается без схемы: `const { dateFrom, dateTo, siteId, filterUserId, equipmentId } = body;`; проверяется лишь `if (!dateFrom || !dateTo)`. Типы и значения не валидируются. | Невалидированные поля доходят до raw-чтения `getReportsByPeriod`→`getReportsByPeriodRaw` (параметризован — инъекций нет, но мусор даёт 500/мусорные данные), а `dateFrom`/`dateTo` вставляются в `Content-Disposition` — если поле содержит `"` или CRLF, возможен header-injection. | Обернуть тело в zod: `z.object({ dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), dateTo: ... , siteId: z.string().optional(), filterUserId: ..., equipmentId: ... })`, использовать `validated.data`, экранировать filename. |
| 2 | важно | `src/app/api/reports/period/route.ts:21-27` | GET `dateFrom`/`dateTo` из query передаются в raw-запрос строкой без проверки формата/диапазона. | Кривая дата (формат, диапазон «из будущего», ширина окна) уходит в `$queryRaw`-поиск отчётов — 500 либо гигантская выборка. Право `reports.read_all`. | Регекс + проверка `Date.parse` + потолок ширины окна, как в `reports/export`. |
| 3 | важно | `src/app/api/telemetry/route.ts:297,336-338` | GET: `limit = parseInt(searchParams.get('limit')||'100')` — нет границ, NaN → `take=NaN` → 500; `new Date(from)`/`new Date(to)` без проверки валидности — Invalid Date в Prisma. | Аутентифицированный пользователь с `analytics.read` может запросить гигантский `limit` (перегрузка БД) или сломать запрос Invalid Date. | `Number.isInteger`+`Math.min(limit, max)`, проверка `Number.isNaN(date.getTime())` до вызова. |
| 4 | важно | `src/app/api/audit/route.ts:25-29` | `limit` только снизу: `Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 20` — верхней границы нет. | Неограниченный размер выборки истории сущности (право `system.read`) → риск тяжелого запроса. | Добавить `Math.min(limit, cap)`, как в `feedback/events` (100) или `readiness` (200). |
| 5 | важно | `src/app/api/reports/single-pdf/route.ts:28-35` | POST `reportId` из тела без валидации типа/формата уходит в `findUnique`. | Если `reportId` — не строка (объект/массив), Prisma может кинуть 500; реальный impact снижен проверкой владельца и 404. | Валидировать `reportId` zod-строкой. |
| 6 | мелочь | `src/app/api/settings/route.ts:29-37` | PUT-тело читается как `unknown`, валидация только внутри модуля `sanitizeSettings` (не zod в route). ADMIN-only. | Формально не соответствует конвенции «safeParse в обработчике», но вход санитизируется до записи в БД. | Вынести zod-схему в route, вернуть 400 от `safeParse`. |
| 7 | мелочь | `src/app/api/monitoring/template/route.ts:32-44` | PUT-тело без zod, валидация в модуле `surface.validate`→`saveLayout`. ADMIN-only. | Тот же стилистический разрыв; функционально валидируется. | Zod-схема в route. |
| 8 | мелочь | `src/app/api/layout/[surfaceId]/route.ts:61-75` | PUT-тело `unknown`, валидация `surface.validate` (TypeError→400). ADMIN-only. | Стилистика; валидация есть, 400 на мусор. | Zod-схема в route. |
| 9 | мелочь | `src/app/api/readiness-rules/route.ts:27-37` | PUT-тело без zod, валидация `sanitizeRuleSet` в модуле. ADMIN-only. | Стилистика; вход санитизируется перед записью. | Zod-схема в route. |
| 10 | мелочь | `src/app/api/readiness/access-matrix/route.ts:35-42` | PUT-тело без zod, валидация `sanitizeAccessMatrix`. Право `readiness.rules.manage`. | Стилистика; валидируется в модуле. | Zod-схема в route. |
| 11 | мелочь | `src/app/api/media/route.ts:27-60` | POST: ручная проверка `if (!body.fileName || !body.contentType)`, zod-схемы нет; `fileSize` не имеет типа/границ. Комментарий в коде объявляет это намеренным (storage-ключ санитизируется в `buildMediaKey`). | Формально не-convention; `fileSize` без границ уходит в получение presigned-URL. | Zod-схема с границами `fileSize`, валидация `contentType`. |
| 12 | мелочь | `src/app/api/telemetry/batch/route.ts:64`, `telemetry/ingest/route.ts:95,138` | POST/PATCH-мутации обёрнуты в `withApi`, а не `withMutation` (тело всё же валидируется: `telemetryBatchSchema.safeParse`, `validateTelemetry`). | Отход от конвенции для мутаций (без CSRF/rate-limit из `withMutation`); устройства, вероятно, шлют без браузерной сессии, поэтому допускается. | Оценить, нужен ли `withMutation` для device-каналов. |
| 13 | мелочь | `src/app/api/auth/login/route.ts:16`, `auth/pin/route.ts:15` | POST-мутации через `withApi`, не через `withMutation`. | Заведомо до-сессионные эндпоинты; CSRF-кука ещё не выдана — вероятно, осознанный выбор. | Согласовать с владельцем; хотя бы зафиксировать решение. |
| 14 | мелочь | `src/app/api/admin/analytics/site-weekly-trend/route.ts:19-20` | `weeks = Math.min(Math.max(Number(...),1),52)`: для нечислового ввода `Number('abc')=NaN`, `Math.max(NaN,1)=NaN` → `weeks=NaN` → `take=NaN` → 500. | Число клэмпится, но NaN не отсекается. | Проверить `Number.isFinite` перед клэмпом. |

Итоги по категориям: критично 0, важно 5, мелочь 9. Всего значимых находок 14.

## Не проверено

- Живое поведение (HTTP-запросы с мусором к `reports/pdf`, `telemetry`, `audit`) — только статический анализ; не делал запуск dev-сервера и эмуляцию запросов, т.к. нужна БД/env.
- Функции модулей `getSiteAnalytics` (analytics/sites), `getFleetKpiData` и анализаторы отчётов пройдены grep-ом по `new Date`/`isNaN`, но глубоко не читались — если в них есть неявный парсинг дат без проверки, находка может дополниться (в route/модуле явного `new Date`-парсинга не обнаружено).
- Маршруты `src/app/api/orion/**` исключены из области по заданию.
- Эндпоинты установки по телеграму/вебхуками (`alerts/webhook`) — safeParse присутствует, но источник вызова внешний; корректность прав не проверялась.