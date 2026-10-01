# R67 — проект правки к находке R64 #2: GET-триггер генерации PDF

Отчёт только на чтение. Ни один существующий файл не изменён; создан только этот
документ. Все утверждения — открытые строки, путь от корня `D:\PillingR\wt-night`.
Ветка `hermes/q4-0926`. Задача: разобрать `GET /api/reports/pdf` и
`GET /api/reports/single-pdf` (кто вызывает, что делает метод, идемпотентность,
лимиты) и предложить минимальную правку с оценкой охвата.

## Итог

- Найдено **17** замечаний: **критично — 0**, **важно — 5**, **мелочь — 12**.
- Главное: **предпосылка R64 #2 сформулирована неточно** — GET не ставит PDF в
  очередь, а генерирует его **синхронно в самом запросе**; постановка в очередь
  живёт только в POST (который CSRF проходит). Реальный эффект чужого перехода —
  не «задача в очереди», а тяжёлая синхронная работа (SQL-агрегация + рендер
  PDFKit) в рамках сессии жертвы, без лимита и без кэша.
- Данные чужой странице это не отдаёт: ответ читать кросс-доменно нельзя (SOP +
  нет `Access-Control-Allow-Origin` для чужого Origin, `proxy.ts:219-223`), файл
  отдаётся как `attachment`. То есть это усиление нагрузки и шума в ленте
  обратной связи, а не утечка.
- Все три экранных вызова — GET: `<a href download>` (`report-evidence-preview.tsx:201`),
  iframe предпросмотра (`pdf-preview-dialog.tsx:24`), `window.open`/`location.href`
  (`equipment-report-export.tsx:110,118`). POST-ветку не вызывает ни один экран.
- Ссылок на PDF в Telegram **нет**: PDF уходит документом (`event-handlers.ts:621`),
  ссылок «открыть отчёт в браузере» в алертах не найдено. Значит вариант (а) не
  ломает Telegram — только веб-интерфейс.
- Топ-5 по значимости:
  1. **GET генерирует синхронно, а R64 говорит «в очередь»** (R64 неточен):
     `route.ts:179-182` → `:227-277`; `single-pdf/route.ts:146-149` → `:201-234`.
  2. **Ни лимита, ни кэша у GET**: `withApi` лимитов не ставит
     (`api-wrapper.ts:62-65`), лимитер подключён только к `withMutation`
     (`:196-219`); `proxy.ts:193-229` запросы не ограничивает.
  3. **Не идемпотентно**: каждое открытие PDF считает отчёт заново; предпросмотр
     вдобавок добавляет `t=Date.now()` (`pdf-preview-dialog.tsx:24`).
  4. **При ошибке — запись в FeedbackEvent** (`route.ts:284-293`,
     `single-pdf/route.ts:251-260`): чужой сайт может набивать ленту обратной
     связи оперативным отделом.
  5. Рекомендуемый минимальный вариант — **(в): оставить GET, но требовать
     same-origin сигнал на ветках генерации** (переиспользовать слои 1-3 из
     `withCsrf`). Правка — 1 helper + 2 вызова в маршрутах; интерфейс,
     `<a href>`, iframe, `window.open` и Bearer-скрипты не ломаются.

## Методика

Поиск и чтение (все пути от корня `D:\PillingR\wt-night`):

1. `search_files` (content) по: `reports/(pdf|single-pdf)`,
   `window\.open\(|location\.href\s*=`, `PdfPreviewDialog|onPreviewPdf`,
   `telegram|Telegram|t\.me|tg://`, `APP_URL|BASE_URL|reportUrl|pdfUrl`,
   `sendDocument|sendReportDocument|sendPdf`, `sameSite|httpOnly`,
   `http|ссылка|Открыть|/api` (в `core/notifications/telegram.ts`).
2. Прочитаны целиком: `src/app/api/reports/pdf/route.ts`,
   `src/app/api/reports/single-pdf/route.ts`, `src/lib/csrf-protection.ts`,
   `src/core/api-wrapper.ts`, `src/lib/pdf-queue.ts`, `src/proxy.ts`,
   `src/lib/auth.ts`, `src/lib/__tests__/csrf-protection.test.ts`,
   `src/components/piling/pdf-preview-dialog.tsx`,
   `src/components/piling/admin-equipment/detail/equipment-report-export.tsx`,
   `src/lib/pdf-generator/index.ts`, `src/lib/pdf-generator/fonts.ts`.
3. Частично: `src/components/piling/admin-reports/report-evidence-preview.tsx`
   (строки 160-238), `admin-reports.tsx` (54-65, 147-150, 440-457),
   `report-history.tsx` (191-198, 360-380), `report-history-detail-dialog.tsx`,
   `report-evidence-row.tsx` (170-235), `src/workers/pdf-worker.ts`,
   `src/workers/unified-worker/pdf.ts`, `src/services/reports/event-handlers.ts`
   (320-379, 550-636), `next.config.ts` (70-110),
   `src/services/auth/session-service.ts` (270-300),
   `src/services/auth/authorization-service.ts` (50-100),
   тесты маршрутов `src/app/api/reports/*/__tests__/route.test.ts`,
   скрипты `scripts/smoke-auth-access.js:282-301`,
   `scripts/test-pilingtrack.sh:142-156`, `tests/manual-test-runner.js:420-435`,
   `tests/manual-test-runner-v2.js:460-484`, `e2e/` (files_only по `pdf`).
4. Файлы кеша/лимитов: `src/lib/rate-limiter.ts` (только через `withMutation` и
   точечные вызовы), `src/core/cache` через `withApi { cache: true }` — у
   исследуемых маршрутов опция не выставлена.

Как повторить: те же `search_files` по перечисленным шаблонам; затем открыть
`src/app/api/reports/pdf/route.ts` (169-296 и 60-163) и
`src/app/api/reports/single-pdf/route.ts` (137-263 и 33-131).

## Что делает GET (проверено по строкам)

- Период, `src/app/api/reports/pdf/route.ts`:
  - `:169` `export const GET = withApi(...)` — CSRF сюда не применяется
    (в `withMutation` его нет, `withApi` CSRF не вызывает: `api-wrapper.ts:62-65,182-184`).
  - `:179-182` если пришли и `dateFrom`, и `dateTo` → `handleSyncGeneration`;
    `:185-188` то же для `sync=1`.
  - `:227-277` `handleSyncGeneration`: `assertCan('reports.read_all')` (`:231`),
    разбор `periodPdfQuerySchema` (`:243-249`), `buildPeriodPdfData` (`:261`),
    `generatePeriodPdf` (`:269`), отдача `application/pdf` (`:271-277`).
  - **Очереди здесь нет.** `enqueuePdfGeneration` вызывается только в POST
    (`:103`). Ветка `:190-220` (jobId) — только статус/скачивание готового файла.
- Одиночный отчёт, `src/app/api/reports/single-pdf/route.ts`:
  - `:137` GET через `withApi`; `:146-149` при `reportId` → `handleSyncGeneration`;
    `:152-155` при `sync=1` — то же.
  - `:201-234`: `loadSingleReportPdfContext` (`:211`), `ensureTenantAccess` +
    `assertCanAccessReportOwner` (`:217,219`), `generateSinglePdf` (`:221`),
    отдача PDF (`:225-234`). Очередь — только POST `:71`.
- Права: `reports.read_all` = ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER
  (`authorization-service.ts:64`). Master/Инженер ОТ пользователей не имеют, значит
  на практике чужой переход работает для администратора и диспетчера.
- Параметры: период — `dateFrom`, `dateTo`, `siteId`, `userId` (в GET) /
  `filterUserId` (в POST), `equipmentId`, `inline`, `sync` (`route.ts:43-54,119,259`);
  одиночный — `reportId`, `inline`, `sync` (`single-pdf/route.ts:142,224`).

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/reports/pdf/route.ts:179-182,227-277`; `src/app/api/reports/single-pdf/route.ts:146-149,201-234` | Предпосылка R64 #2 неточна: GET **не ставит PDF в очередь**, а генерирует синхронно (`generatePeriodPdf`/`generateSinglePdf` прямо в обработчике). Очередь — только в POST (`:103` / `:71`). | Оценка риска и правки в R64 опирается на «постановку в очередь»; фактический эффект — тяжёлый запрос в рамках сессии жертвы (SQL-агрегация + рендер PDFKit, `pdf-generator/fonts.ts:9-59` читает шрифты). | Уточнить формулировку R64; правку делать под синхронную генерацию (варианты ниже). |
| 2 | важно | `src/lib/csrf-protection.ts:52-55`; `src/services/auth/session-service.ts:279` | GET пропускается CSRF, cookie `pt-session` — `SameSite=Lax`. Переход верхнего уровня с чужого сайта несёт сессию. | Чужая страница делает `window.location='/api/reports/pdf?dateFrom=…&dateTo=…'` → генерация от имени жертвы. Ответ читать нельзя (SOP; `proxy.ts:219-223` не отдаёт `ACAO` чужому Origin), но нагрузка и шум — реальные. | Вариант (в) ниже: same-origin проверка на ветках генерации. |
| 3 | важно | `src/core/api-wrapper.ts:62-65,196-219`; `src/proxy.ts:193-229` | У GET-веток нет ни лимита, ни кэша: `withApi` лимитов не ставит, `withMutation`-лимитер (100/мин на маршрут+сессию+IP, `:213`; 1800/мин на IP, `:201`) сюда не доходит; `proxy.ts` запросы не считает. | Повторные открытия/скрипт без сессии-специфичного лимита могут держать CPU и пул БД; `buildPeriodPdfData` тянет агрегацию за период. | Добавить `rateLimiter.check` на ветку генерации (по сессии+IP) и/или включить короткий кэш. |
| 4 | важно | `src/app/api/reports/pdf/route.ts:169` (`withApi` без `opts.cache`); `pdf-preview-dialog.tsx:24` | Идемпотентности нет: каждый GET генерирует файл заново; предпросмотр добавляет `t=Date.now()`, чтобы гарантированно промахнуться по кэшу. | Дважды открытая одна и та же смена = два полных прохода; принудительное повторное открытие из чужой страницы не отсекается. | Кэш по (дата/период, фильтры, пользователь) или отдача уже готового файла, если он есть в хранилище. |
| 5 | важно | `src/app/api/reports/pdf/route.ts:284-293`; `src/app/api/reports/single-pdf/route.ts:251-260` | При ошибке генерации пишется `recordFeedbackEvent` (`audience: 'OPERATIONS'`). | Чужая страница, вызывая генерацию с заведомо «битым» периодом (например, пустой период/ошибка БД), набивает ленту обратной связи оперативным отделом (`feedback-center` рендерит такие события). | После ограничения cross-site переходов (вариант в) риск снимается; дополнительно можно не писать feedback для sync-ветки. |
| 6 | важно | `src/components/piling/pdf-preview-dialog.tsx:22-25,59-66` | Предпросмотр — это `<iframe src={url}>` с GET-URL; **iframe не умеет POST и не может добавить заголовок**. | Любой вариант, требующий POST или CSRF-заголовка на GET, ломает предпросмотр: придётся получать PDF `fetch`-ом и подставлять blob-URL. Это расширяет правку с 2 файлов до 3-4 компонентов. | Учесть при выборе варианта: (в) — не трогает; (а)/(б1) — требует переделки iframe. |
| 7 | мелочь | `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:62-66,110,118` | Период-PDF открывается из UI как `window.open(url(true))` (печать) и `window.location.href = url(false)` (скачивание) — навигацией, без заголовков. | Это второй (после одиночного PDF) экран, который сломается при переходе на POST. | При варианте (а)/(б) — получать PDF `authFetch` + `URL.createObjectURL`; при (в) — без изменений. |
| 8 | мелочь | `src/components/piling/admin-reports/report-evidence-preview.tsx:200-205` | «Скачать» — это `<a href={/api/reports/single-pdf?reportId=…} download>`; ссылку нельзя заменить на POST без JS. | То же, что №7: при (а)/(б1) ссылка ломается, при (в) работает. | Как №7. |
| 9 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:147-150,449-450`; `src/components/piling/report-history.tsx:195-198,376` | Оба экрана открывают `PdfPreviewDialog` по `reportId` — сами URL не строят. | При оценке охвата их менять не нужно, но тесты/типы прогоняются через них. | Не трогать. |
| 10 | мелочь | `src/services/reports/event-handlers.ts:611-621` | В Telegram уходит **сам PDF** (`sendDocument(filename, pdfBuffer, caption)`), ссылок на `/api/reports/pdf`/`single-pdf` в сообщении нет; поиск по `APP_URL|reportUrl|pdfUrl|http://` в нотификациях ссылок не нашёл. | Утверждение из задания «Telegram-сообщения со ссылками» на текущем коде не подтверждается: доставка PDF в Telegram — отдельный канал (`report.submitted`-событие), он не зависит от GET-маршрутов. | Считать Telegram защищённым от этой правки; при варианте (а) ломается только веб-интерфейс. |
| 11 | мелочь | `src/app/api/reports/pdf/route.ts:179-182` vs `:191` | `dateFrom && dateTo` проверяется **раньше** `jobId`: ссылка с датами и jobId уйдёт в генерацию, а не в статус. | Не уязвимость, но усложняет разбор: «статус по jobId» достижим только без дат. | Документировать порядок либо отдавать приоритет jobId. |
| 12 | мелочь | `tests/manual-test-runner.js:430-432` | Ожидает `status === 200` от `GET /api/reports/pdf` **без параметров**; фактически маршрут ответит 400 (`route.ts:194-198`). | Ручной прогон показывает WARN/FAIL на исправном коде — ложный сигнал. | Привести пробу к параметрам (`?dateFrom&dateTo`) или к ожиданию 400. |
| 13 | мелочь | `tests/manual-test-runner-v2.js:476` | Шлёт `GET /api/reports/single-pdf?id=test` — параметр `id` не поддерживается, ответ 400 (`single-pdf/route.ts:161-165`). | То же: стейл-проверка. | Заменить на `reportId`. |
| 14 | мелочь | `scripts/test-pilingtrack.sh:149`; `scripts/smoke-auth-access.js:290` | Оба скрипта опираются на GET: `test-pilingtrack.sh` ждёт 200 от `GET /api/reports/pdf?reportId=…` (период-PDF с чужим параметром — фактически 400), `smoke-auth-access.js` ждёт 403 от `GET /api/reports/single-pdf?reportId=…`. | При варианте (а)/(б1) оба скрипта придётся переписать; при (в) — второй остаётся валидным. | Перепроверить после правки. |
| 15 | мелочь | `next.config.ts:91-99`; `src/proxy.ts:67` | Несогласованная политика фрейминга: `next.config` ставит `X-Frame-Options: SAMEORIGIN` и `frame-ancestors 'self'` только для `/api/reports/single-pdf/*`, а `proxy.ts` для всех `/api` ставит `X-Frame-Options: DENY`. | Чужой сайт не может вставить PDF в iframe (DENY/DENY эффект), но какая из политик побеждает для period-PDF на практике — не проверено в рантайме. | Не критично; при желании выровнять заголовки для обоих маршрутов. |
| 16 | мелочь | `src/app/api/reports/pdf/route.ts:259,271-277` | `inline=1` в sync-ветке period-PDF тоже управляется GET-ссылкой. | Даёт чужому сайту выбор `inline`/`attachment` для навигации; влияния на данные нет. | Покрывается вариантом (в). |
| 17 | мелочь | `e2e/` (поиск по `pdf` — только `orion-industrial-cinematic.spec.ts` со статической ссылкой) | Ни один сценарий (GET-sync, POST-очередь, предпросмотр) e2e не покрыт (подтверждает R25 #6). | Правку нельзя защитить регрессом на уровне Playwright — только юнит-тестами маршрутов. | Добавить пробу на GET-sync с `content-type: application/pdf` (или 403 для cross-site после варианта (в)). |

## Варианты минимальной правки

### (а) GET только отдаёт готовый файл; генерация — POST через `withMutation`

Суть: из GET-обработчиков убрать ветки генерации (период `route.ts:179-188`,
одиночный `single-pdf/route.ts:146-155`); оставить вызов готовой задачи через jobId
(либо отдачу уже сохранённого файла). Создание PDF — только POST (`withMutation`
даёт CSRF + лимит).

Файлы:
- `src/app/api/reports/pdf/route.ts` (убрать `handleSyncGeneration`, `:227-296`);
- `src/app/api/reports/single-pdf/route.ts` (то же, `:201-263`);
- `src/components/piling/pdf-preview-dialog.tsx` (iframe → `fetch POST` + blob);
- `src/components/piling/admin-equipment/detail/equipment-report-export.tsx` (2 вызова);
- `src/components/piling/admin-reports/report-evidence-preview.tsx` (`<a href download>`);
- тесты маршрутов + `tests/manual-test-runner*.js`, `scripts/test-pilingtrack.sh`,
  `scripts/smoke-auth-access.js`.

Что ломается у пользователя: исчезает возможность «открыть/скачать по ссылке»
(закладка, пересланная ссылка, «Сохранить ссылку»); предпросмотр требует JS-blob;
печать из iframe переезжает на blob. Telegram не затронут. Это самый честный по
CSRF вариант, но и самый широкий по охвату (5 файлов кода + скрипты/тесты).

### (б) GET остаётся, но генерация требует CSRF-заголовка/токена

- **(б1) заголовок** (`X-Requested-With`/`Origin`-подобный): браузерная навигация
  `<a href>`, `window.open` и iframe заголовок поставить не могут → ломается ровно
  то же, что в (а) (см. №6-8), а выгоды над (в) нет. Отвергнуть.
- **(б2) токен в query-параметре** (одноразовый/сессионный): ссылки и iframe
  работают, но токен придётся рендерить в URL на каждом экране (2 компонента +
  диалог + источник токена), токен утекает в логи/Referer, и это превращается в
  самодельную схему вместо уже имеющейся `withCsrf`. Охват больше, чем у (в), выгода — неочевидна.

### (в) Рекомендуется: GET остаётся, но ветка генерации требует same-origin сигнала

Суть: переиспользовать слои 1-3 из `withCsrf` (`csrf-protection.ts:57-106`), но
**без привязки к методу**: пропускать запросы с `Sec-Fetch-Site: same-origin|none`,
а `cross-site` (и несовпадающий Origin/Referer при их наличии) отклонять 403.
«Нет ни одного сигнала» (Bearer-скрипты, curl) — **пропускать**: cookie `Lax` без
браузерной навигации туда всё равно не попадёт, а ломать скрипты незачем.

Почему это закрывает атаку: переход верхнего уровня с чужого сайта приходит с
`Sec-Fetch-Site: cross-site` (и/или Origin/Referer чужого хоста) → 403; свои
ссылки, iframe и `window.open` дают `same-origin`; вставка адреса вручную —
`none`.

Файлы:
- `src/lib/csrf-protection.ts` — новый экспорт (например `checkSameOrigin`),
  переиспользующий слои 1-3 (≈15 строк; `withCsrf` не менять);
- `src/app/api/reports/pdf/route.ts:227` — вызов в начале `handleSyncGeneration`;
- `src/app/api/reports/single-pdf/route.ts:201` — то же;
- тесты: `src/lib/__tests__/csrf-protection.test.ts` (кейсы `cross-site`/`same-origin`),
  `src/app/api/reports/single-pdf/__tests__/route.test.ts:41` (там `withCsrf`
  замокан — добавить мок нового helper).

Что ломается у пользователя: ничего из найденного интерфейса. Telegram — не
затронут (ссылок нет). Bearer-скрипты (smoke/тест-раннеры) — не затронуты.
Из минусов: остаётся возможность эксплуатировать маршрут со своего origin
(например, XSS), поэтому желательно вдобавок ограничить частоту (находка №3).

## Не проверено

- Рантайм не запускался: фактическая длительность синхронной генерации и её
  влияние на пул соединений не измерялись — оценка «тяжело» сделана по коду
  (`buildPeriodPdfData` → raw-агрегация, `generatePeriodPdf` → PDFKit + чтение
  шрифтов, `pdf-generator/fonts.ts:9-59`), без замера.
- Реальное поведение браузера (наличие `Sec-Fetch-Site: cross-site` при переходе с
  чужого сайта при `SameSite=Lax`) не воспроизводилось инструментально — опираюсь
  на стандарт и на комментарии/тесты `csrf-protection.test.ts:99-123`.
- Взаимодействие `X-Frame-Options: DENY` из `proxy.ts:67` и `SAMEORIGIN` из
  `next.config.ts:91-99` (какой заголовок доезжает до клиента) не проверялось.
- Использует ли POST-очередь кто-то извне репозитория (мобильные клиенты, внешние
  интеграции) — по тексту репозитория вызовов POST нет ни в одном экране, но
  внешние потребители не проверялись.
- Не открывал замороженные области (оператор, ORION) и не проверял, есть ли там
  ссылки на эти маршруты сверх найденных.
- Прогоны `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`,
  `npx playwright test --list`, `npm run build` не выполнялись: правок нет, а
  задача — только чтение и проект.
