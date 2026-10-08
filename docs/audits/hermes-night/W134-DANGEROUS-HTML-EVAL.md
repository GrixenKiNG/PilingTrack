# W134 — Вставка HTML и динамический код (dangerouslySetInnerHTML / eval-класс)

## Итог

Проект почти не пользуется опасными sink-ами: `innerHTML`, `outerHTML`,
`insertAdjacentHTML`, `document.write`, `new Function(` и `setTimeout('...')`
в `src/` не найдены вообще. Все срабатывания `dangerouslySetInnerHTML`
(3 шт.) и `eval(` (3 шт.) — это константы, а не пользовательские данные.

- критично: 0
- важно: 1 — `dead-letter-queue.ts:104`: текст ошибки подставляется в
  Telegram-сообщение с `parse_mode=HTML` без экранирования.
- мелочь: 11 (константные вставки, dev-only скрипт, Redis-Lua `eval`,
  `eval('require')`, JSON-LD, same-origin iframe).

Топ-5:
1. `src/core/outbox/dead-letter-queue.ts:104` — неэкранированный `errorMessage`
   в `<code>` при `parse_mode=HTML` (единственная реальная находка).
2. `src/lib/db.ts:64` — `eval('require')` (косвенный eval, но строка-константа).
3. `src/app/layout.tsx:110` — `dangerouslySetInnerHTML` со скриптом,
   только в режиме разработки, значение — константа.
4. `src/core/infrastructure/leader-election.ts:172,250` и
   `src/lib/rate-limiter.ts:228` — `client.eval(...)`: это Redis/Lua, а не
   JS-`eval`; скрипт — константа модуля.
5. `src/components/piling/briefings/briefing-journal-print.tsx:64` и
   `src/components/piling/admin-reports/print-screen.tsx:41` — вставка `<style>`
   с CSS-константой.

Итог по классу «HTML письма / PDF / Telegram»: HTML-письма в проекте нет
(почтовой отправки не найдено). PDF собирается через `pdfkit` (`doc.text(...)`),
HTML не строится вовсе — класс не применим. Telegram-сообщения экранируются
через локальный `escapeHtml` (см. находки 10–12 таблицы), кроме одного места —
находки №1.

## Методика

Работал только на чтение в `D:\PillingR\wt-night` (ветка `hermes/q4-0926`).

1. Поиск sink-ов по `src/` (исключая `__tests__`, `*.test.*`, `src/generated/`):
   шаблон `dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|
   document\.write|\beval\(|new Function\(` — 11 совпадений в 9 файлах
   (2 в тестах, 1 в `src/app/orion/**` — заморозка).
2. Отдельный поиск `setTimeout\(\s*['"\`]` / `setInterval\(\s*['"\`]` (строка
   первым аргументом) — 0 совпадений.
3. Отдельный поиск `new Function|Function\(` — в `src/` только проверки AST в
   тестах (`ts.isFunctionExpression` и т.п.), не вызовы.
4. Поиск XSS-класса в каналах уведомлений: `parse_mode|sendMessage|sendDocument|
   telegram|nodemailer|resend|smtp|mailto` и `escapeHtml|sanitize|DOMPurify`.
5. HTML/PDF/письма: `renderToString|renderToStaticMarkup|<!DOCTYPE|<html` — 0
   совпадений по `src/`; PDF-модуль `src/lib/pdf-generator/**` прочитан целиком,
   вставки HTML нет.
6. CSP: `src/proxy.ts:155-172` — в проде `script-src 'self' 'nonce-…'
   'strict-dynamic'` (без `unsafe-inline`); `style-src 'self' 'unsafe-inline'`.
   Это снижает последствия любого инлайн-скрипта; важно для оценки находок.
7. Для каждой находки открывал файл целиком и смотрел источник значения
   («константа / из БД / параметр запроса / поле пользователя») и наличие
   санитизации рядом.

Команды для повторения:
- `rg -n "dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function\(" src`
- `rg -n "setTimeout\(\s*['\"\`]|setInterval\(\s*['\"\`]" src`
- `rg -n "escapeHtml|parse_mode|sendDocument|sendMessage" src`

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | предлагаемое исправление |
|---|----------|-----------|----------|----------------------|--------------------------|
| 1 | важно | `src/core/outbox/dead-letter-queue.ts:104` | Текст ошибки вставляется в текст Telegram-сообщения с `parse_mode=HTML`: `` `Ошибка: <code>${errorMessage.substring(0, 200)}</code>` `` — без `escapeHtml`. `errorMessage` (`:55`) — это `error.message` любого упавшего обработчика outbox, может содержать `&`, `<`, `>`, кавычки. | Telegram распарсит `<>` как разметку: чужой текст в сообщении может подставить ссылку (`<a href="...">`), а при невалидной разметке Bot API вернёт 400 и алерт о потерянном событии не дойдёт (тот же путь, что уже логировался для прочих ошибок). Источник — не прямое поле пользователя, а строки ошибок (Prisma, валидация, `No handlers for domain event …`); попадание данных пользователя внутрь `error.message` **не проверено**. | Пропустить `errorMessage` через локальный `escapeHtml` (копия есть ниже по коду и в `telegram.ts:194`) либо перейти на `parse_mode` без разметки для этого алерта. |
| 2 | мелочь | `src/app/layout.tsx:110` | `<script dangerouslySetInnerHTML={{ __html: DEV_PERFORMANCE_MEASURE_GUARD }} />`; значение — константа `layout.tsx:46-64`, обёрнута в `process.env.NODE_ENV === 'development'`. | Запускает код в браузере, но только в dev, из константы; прод-сборка скрипт не отдаёт. Данных пользователя нет. | Не требуется. |
| 3 | мелочь | `src/components/piling/briefings/briefing-journal-print.tsx:64` | `<style dangerouslySetInnerHTML={{ __html: JOURNAL_PRINT_CSS }} />`; `JOURNAL_PRINT_CSS` — константа `:45-61`. | Вставка CSS-строки без данных пользователя. Инъекция невозможна. | Не требуется. |
| 4 | мелочь | `src/components/piling/admin-reports/print-screen.tsx:41` | `<style dangerouslySetInnerHTML={{ __html: PRINT_SCREEN_CSS }} />`; константа `:1-38`. | То же — константа, данных пользователя нет. | Не требуется. |
| 5 | мелочь | `src/lib/db.ts:64` | `const runtimeRequire = eval('require') as NodeRequire;` — использование `eval` как косвенного `require`, чтобы Turbopack не трогал CommonJS. | Строка-литерал `'require'`, пользовательского ввода нет. Риск — только «плохой пример» и запрет CSP `unsafe-eval` в проде (но этот код исполняется на сервере в Node, CSP браузера на него не действует). | Не требуется. |
| 6 | мелочь | `src/core/infrastructure/leader-election.ts:172` | `client.eval(RENEW_LEASE, 1, this.resource, this.config.nodeId, this.config.ttl)`. | Это Redis/Lua `eval`, а не JS. `RENEW_LEASE` — константа `:28`; аргументы — `resource`/`nodeId`/`ttl` передаются как параметры Lua, а не конкатенируются в скрипт. Инъекции нет. | Не требуется. |
| 7 | мелочь | `src/core/infrastructure/leader-election.ts:250` | `client.eval(RELEASE_LEASE, 1, this.resource, this.config.nodeId)`. | То же, что №6; `RELEASE_LEASE` — константа `:29`. | Не требуется. |
| 8 | мелочь | `src/lib/rate-limiter.ts:228` | `this.redis.eval(RATE_LIMIT_LUA, 2, counterKey, blockKey, String(...), …)` — фолбэк на EVAL, если скрипт не закэширован (строка 216 — `evalsha`). | Redis/Lua `eval`; `RATE_LIMIT_LUA` — константа; ключи/числа передаются как параметры. Инъекции нет. Файл — из списка security-critical (правку не предлагаю). | Не требуется. |
| 9 | мелочь | `src/app/orion/page.tsx:71-72` | `<script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }} />` (и `faqPageSchema`). | Значения — константы `:41+`. Файл в зоне заморозки (`src/app/orion/**`), по правилам задачи не исследовал глубже. Формально при пользовательских данных `JSON.stringify` не экранирует `</script>`, но здесь данных пользователя нет. | Не требуется (зона заморозки). |
| 10 | мелочь (проверено, безопасно) | `src/core/notifications/telegram.ts:160-176` | Сборка Telegram-сообщения: `label` — из константного словаря (`severityLabel`), а `message`, `siteName`, `siteId`, `reportNumber`, `reportId`, `ruleId` обёрнуты `escapeHtml` (`:161-176`); `escapeHtml` — `:194-199`. | Экранирование на месте; `severity` валидируется `z.enum` в `durable-alert.ts:5` при штатном пути. Данных без экранирования нет. | Не требуется. |
| 11 | мелочь (проверено, безопасно) | `src/services/reports/event-handlers.ts:640-644` | Подпись к PDF-документу Telegram: `d.site?.name`, `d.date`, `d.user?.name`, `operatorName`, `d.equipmentName` — все через локальный `escapeHtml` (`:524-526`); `filename` (`:653`) чистится `replace(/[^A-Za-z0-9._-]/g, '_')`. | Поля из БД (название объекта, имя оператора, дата) экранируются перед `parse_mode=HTML`. Инъекции нет. | Не требуется. |
| 12 | мелочь | `src/components/piling/pdf-preview-dialog.tsx:60` | `<iframe src={previewUrl}>`; `previewUrl` = `/api/reports/single-pdf?reportId=…&inline=1…`, `reportId` кодируется `encodeURIComponent` (`:24`). | Same-origin URL API с закодированным id; это не вставка HTML-строки. `srcdoc`/`contentWindow.document.write` не используются (печать через `frameWindow.print()`, `:38`). Риск низкий. | Не требуется. |
| 13 | мелочь (вне класса) | `src/lib/xlsx-writer.ts:42-49` | Генератор .xlsx сам собирает XML и корректно экранирует: `xmlEscape` (`& < > " '`) + вычистка управляющих символов (`:52-55`). | Это XML, а не HTML, но из того же класса «строка собирается вручную». Экранирование полное, причём `"`/`'` тоже (в отличие от Telegram-`escapeHtml`). | Не требуется. |

### Что искал и НЕ нашёл (нулевые результаты)

- `innerHTML` — 0 в продакшн-коде (`src/components/piling/to/readiness/tech-readiness-module.test.tsx:54` — это тест, читает DOM для проверки вёрстки).
- `outerHTML`, `insertAdjacentHTML`, `document.write` — 0 во всём `src/`.
- `new Function(` — 0 (совпадения `Function(` есть только в AST-проверках тестов: `src/lib/__tests__/no-global-db-in-tx.test.ts:138`, `src/app/api/__tests__/route-guards.test.ts:55`, `src/app/api/__tests__/api-routes.test.ts:296,358,377`).
- `setTimeout('строка')` / `setInterval('строка')` — 0.
- HTML-письма: почтовой библиотеки в проекте нет (`smtp|nodemailer|sendgrid|mailgun` в `package.json` — 0); «email»-совпадения по коду — это колонки/поля БД, не отправка писем.
- PDF: `src/lib/pdf-generator/**` — сборка через `pdfkit`, HTML-строки не создаются.
- Markdown→HTML/рендереры HTML (`marked|remark|rehype|dompurify|sanitize-html`) — в `package.json` 0, в `src/` 0.
- `srcdoc`, `createElement('script')` — 0.

## Не проверено

- **Происхождение `errorMessage` (находка №1).** Я подтвердил, что это
  `error.message` упавшего обработчика (`dead-letter-queue.ts:55`), но не
  проследил все обработчики outbox до конца, чтобы доказать, что реальный
  пользовательский ввод может попасть внутрь строки ошибки. Практический эффект
  (невалидная разметка → Telegram 400 → потеря алерта) от этого не зависит, но
  «есть ли здесь XSS/фишинг-подстановка» — не проверено.
- **Зона заморозки** `src/app/orion/**`, `src/app/api/orion/**`,
  `src/components/orion/**` — не исследовал (правило 3). Знаю только, что в
  `src/app/api/orion/lead/route.ts:112-117` поля заявки проходят `escapeHtml`,
  но полную инвентаризацию по этим путям не делал.
- **Варианты экрана оператора** (`src/app/operator/**`,
  `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) —
  зона заморозки, пропущены; там есть клиентский код, потенциально содержащий
  DOM-манипуляции, но по правилам задачи не проверялся.
- **Строки, попадающие в Telegram из `src/app/api/alerts/webhook/route.ts`.**
  Прочитал, что `summary/description` из Alertmanager уходят в `sendAlert` и
  дальше экранируются в `telegram.ts`; но полный путь `deliverQueuedAlert` →
  `alertSchema.parse` на живых данных Alertmanager не гонял.
- **Клиентские sink-и за пределами найденных шаблонов** (`element.setAttribute`
  с `href`, `location =`, вставка через `Element.prototype` и т.п.) не
  сканировал: задача ограничивала список шаблонов.
