# AU153-S5 — Ввод текста: экранирование и длины

Версия: `git rev-parse HEAD` → **a0d2837ff01fb9048b9113d0997b475d46bfe3de**
Дата: 2026-10-10. Только чтение; код приложения не менялся.

## Итог

- Проверены каналы вывода пользовательского текста: PDF (pdfkit), Excel (.xlsx / CSV), Telegram (parse_mode=HTML), HTML-экран (React).
- Найдено находок: **критично — 0**, **важно — 2**, **мелочь — 3**; отдельно 5 «ПРОЙДЕНО».
- Топ-5:
  1. (важно) Алерт DLQ собирает Telegram-сообщение с `parse_mode=HTML`, вставляя текст ошибки **без экранирования** — `<`/`&` в сообщении исключения ломают разбор, алерт не доходит (`src/core/outbox/dead-letter-queue.ts:99`).
  2. (важно) Нет обрезки под лимит Telegram 4096 симв.; алерт о происшествии с описанием на пределе `max(4000)` даёт ≈4166 симв. → Telegram отвечает 400, алерт теряется/уходит в DLQ (`incidents.ts:127` + `telegram.ts:160`).
  3. (мелочь) Имя файла в `Content-Disposition` sync-фолбэка PDF подставляется из имени пользователя **без очистки** (несогласованно с соседними ветками) — `src/app/api/reports/single-pdf/route.ts:119`.
  4. (мелочь) У генератора .xlsx нет защиты от подстановки формул (в отличие от обоих CSV-экспортёров) и нет ни одного юнит-теста (`src/lib/xlsx-writer.ts:67`).
  5. (мелочь) Имя листа xlsx режется по длине **после** XML-экранирования — может разрезать `&amp;` (`src/lib/xlsx-writer.ts:125`).
- Экранирование в основном сделано аккуратно: Telegram-алерты отчётов/дефектов/ТО и оба CSV-экспортёра защищены (см. «ПРОЙДЕНО»).

## Методика

Поиск по репозиторию (Git Bash, `rg`), каталоги `src/`, без `docs/audits`, `CODEX-REPORT*`, `docs/strategy` (существующие отчёты не читались):

```
git rev-parse HEAD
rg -n "escapeHtml|escapeMarkdown|escapeCsv|escapeXml|sanitiz|innerHTML" src -g '*.ts' -g '*.tsx'
rg -n "dangerouslySetInnerHTML|document.write|insertAdjacentHTML" src
rg -n "parse_mode|MarkdownV2|'Markdown'" src
rg -n "<code>|<b>|<pre>|<a href" src -g '*.ts' -g '*.tsx'
rg -n "sendMessage\(|sendAlert\(|sendDocument\(|telegramNotifier\." src
rg -n "buildXlsx|xlsx-writer|text/csv|Content-Disposition|exportPileJournal|exportReports" src
rg -n "\.max\(|z\.string\(\)" src/lib/validation-schemas.ts
sed -n '1,240p' src/lib/xlsx-writer.ts
sed -n '160,420p' src/core/notifications/telegram.ts
sed -n '500,665p' src/services/reports/event-handlers.ts
sed -n '1,120p' src/core/outbox/dead-letter-queue.ts
sed -n '1,80p'  src/modules/reports/application/queries/pile-journal-export.ts
sed -n '1,80p'  src/modules/readiness/application/csv-export.ts
sed -n '1,160p' src/app/api/reports/single-pdf/route.ts
node -e '…'   # расчёт длины Telegram-сообщения под лимит 4096
```

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|----------|-----------|----------|--------------------------|---------------------|
| 1 | важно | `src/core/outbox/dead-letter-queue.ts:99` (строки 101–104) | Telegram-сообщение отправляется через `sendMessage(...)` с `parse_mode=HTML`, но `errorMessage` (и `attempts`, `aggregateId`) вставляются в `<code>…</code>` **без `escapeHtml`**. | `errorMessage = error.message` (`:59`) — это текст исключения; в нём часто есть `<` (`x < 5`, `<=`, `<html>502</html>`, JSON). Telegram вернёт 400 `can't parse entities`. Ветка 400 без совпадения с шаблоном `permanent` (`telegram.ts:206`) считается **временной** → outbox повторяет бесконечно, алерт о недоставленных событиях не приходит. Дополнительно во внешний чат утекает англоязычный внутренний текст ошибки. | Экранировать: `escapeHtml(errorMessage.substring(0,200))`, как в `event-handlers.ts:524`; либо вынести общий `escapeHtml` и переиспользовать. |
| 2 | важно | `src/modules/operator-mobile/application/commands/incidents.ts:127` + `src/services/notifications/durable-alert-delivery.ts:51` + `src/core/notifications/telegram.ts:160` | Сообщение алерта нигде не обрезается под лимит Telegram (4096 симв.). `description` инцидента валидируется как `max(4000)` (`src/app/api/operator/mobile/command/route.ts:158`). | При описании на пределе: `"Происшествие: требуется прекратить работы. " + description(4000)` + `"\nСобытие: "+event.id` + обёртка `<b>/<code>/⏰`. Расчёт (node) дал **4166 симв. > 4096**. Telegram → 400 `message is too long`; как и в п.1, не `permanent` → алерт не доставлен, ретраи до DLQ. Критичный для безопасности алерт теряется. | Обрезать `text` перед отправкой: `< 4096` с запасом (полезно резать `alert.message`, а не весь текст), напр. `slice(0, 3800)`. |
| 3 | мелочь | `src/app/api/reports/single-pdf/route.ts:119` | `Content-Disposition: attachment; filename="otchet-${date}-${context.report.user?.name}.pdf"` — имя пользователя подставляется **сырым**. | Имя оператора `max(200)` (`validation-schemas.ts:40`) может содержать `"`, `;`, кириллицу. Соседние ветки так не делают: sync-GET чистит дату (`:269` `replace(/[^0-9-]/g,'')`, `:274`), а доставка в Telegram чистит имя файла (`event-handlers.ts:652` `replace(/[^A-Za-z0-9._-]/g,'_')`). Кавычка в имени ломает разбор имени файла браузером. CR/LF, к счастью, отклонит HTTP-слой (инъекция заголовка не проходит). Путь достижим, когда Redis недоступен (ветка `if (!jobId)`, `:108`). | Прогнать имя через ту же очистку, что в `event-handlers.ts:652`. |
| 4 | мелочь | `src/lib/xlsx-writer.ts:67` (`sheetXml`), `:42` (`xmlEscape`) | В генераторе .xlsx нет защиты от подстановки формул (`=`,`+`,`-`,`@`), в отличие от обоих CSV-экспортёров. Юнит-теста на `xlsx-writer` нет вовсе. | Ячейки пишутся как `t="inlineStr"` с `<is><t>` (`:80`), поэтому Excel/LibreOffice показывает значение как **текст** и не вычисляет — фактической инъекции нет. Но защита держится только на типе ячейки; тест отсутствует (`find src -name '*xlsx*test*'` — пусто; `export-reports-csv.test.ts:24` мокает `buildXlsx`, реальный XML не проверяется). | Оставить как есть по сути, но добавить тест на отсутствие формулы (defense-in-depth апострофом, как `csvCell`). |
| 5 | мелочь | `src/lib/xlsx-writer.ts:125` | `xmlEscape(sanitize(sheet.name)).slice(0, 31)` — обрезка идёт **после** экранирования, потому может разрезать entity (`&amp;`→`&am`), дав некорректный XML. | Сейчас имена листов — константы (`'Детализация'`, `'Итоги'`, `'Титул'`, …), пользовательский текст туда не попадает, поэтому вреда нет. Риск появится, если имя листа когда-нибудь построят из данных. | Резать до экранирования (`sanitize(sheet.name).slice(0,31)` затем `xmlEscape`). |
| 6 | ПРОЙДЕНО | `src/modules/reports/application/queries/report-export.service.ts:44` (`csvCell`, `:28–50`) | Подстановка формул в CSV отчётов обезврежена апострофом с учётом ведущих пробелов; обычные числа не портятся. | Есть тест `export-reports-csv.test.ts` (`=HYPERLINK(...)` → `"'…"`). | — |
| 7 | ПРОЙДЕНО | `src/modules/readiness/application/csv-export.ts:5` (`FORMULA_PREFIX`), `:44` (`safeCsvCell`) | CSV готовности: та же защита, плюс разбор `Date`/ISO и запятая как десятичный разделитель. | Есть тест `csv-export.test.ts` (`=SUM`, `+cmd`, `-1+2`, `@value`, таб). | — |
| 8 | ПРОЙДЕНО | `src/core/notifications/telegram.ts:194` (`escapeHtml`), `:161–176`; `src/services/reports/event-handlers.ts:524`, `:640–645` | Все «человеческие» вставки в Telegram-алерт (объект, дата, оператор, оборудование, номер/ID отчёта, правило) и заголовок PDF-капшена проходят `escapeHtml` (`&`,`<`,`>`). | Пользовательские имена/названия объектов ограничены `max(200)`. Есть тесты экранирования (`telegram.test.ts`, «Объект `<b>Север</b> & Co»). | — |
| 9 | ПРОЙДЕНО | `src/lib/pdf-generator/render.ts:8` + `components.ts:80` (`safeText`) | PDF рисуется pdfkit напрямую (текстовые примитивы), HTML/Markdown-инъекции невозможны; `safeText` схлопывает пробелы и подставляет `—`. | Имя PDF-файла при доставке чистится (`event-handlers.ts:652`). | — |
| 10 | ПРОЙДЕНО | `src/app/layout.tsx:110`, `briefing-journal-print.tsx:64`, `print-screen.tsx:41` | `dangerouslySetInnerHTML` встречается только со **статическими** константами (CSS, JSON-LD ORION) — пользовательский текст туда не попадает; печатные формы рендерятся через JSX (React экранирует). | ORION (`src/app/orion/**`) — замороженная зона, не проверялся детально. | — |
| 11 | ПРОЙДЕНО | `src/lib/validation-schemas.ts:281,283,285` | Пределы длины на пути **записи** заданы: комментарий простоя `max(1000)`, комментарий отчёта `max(2000)`, имя помощника `max(200)`; операторский маршрут `src/app/api/operator/mobile/command/route.ts:73,108,130,145,158` — `max(500)/max(2000)/max(4000)`; решение по свае `pile-passports/[id]/decide/route.ts:17` — `note max(2000)`. | Бесконтрольно длинный пользовательский текст в БД не попадает. Замечание: `max(4000)` у описания инцидента и есть причина п.2 при отправке в Telegram. | — |

## Не проверено

- **Excel-файл глазами Excel.** Утверждение «`t="inlineStr"` → значение текст, формула не вычисляется» (п.4) — из спецификации OOXML, **файл в Excel/LibreOffice не открывался**: статус **ГИПОТЕЗА**, не «ПРОЙДЕНО».
- **Реальный ответ Telegram на 4166 симв.** (п.2) — длина посчитана node по коду, но запроса в Bot API не делалось (нет токена/сети): статус **ГИПОТЕЗА** по факту отказа, длина — факт.
- **Замороженные зоны** не аудировались: `src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**` (в т.ч. рендер базы знаний `knowledge-screen`), `src/app/orion/**`, `src/app/api/orion/**`, `src/components/orion/**`. В частности, экранирование/рендер HTML в экране базы знаний машиниста **не проверено**.
- **Медиа/загрузки** (имена загружаемых файлов, `media-content.ts`) — вне темы данного среза, отдельно не разбирались, кроме ссылки на существующие тесты `extension-injection`/`build-media-key`.
- **Каналы, которых в коде нет:** почтовый транспорт отсутствует (см. комментарий `src/app/api/orion/lead/route.ts:24` «Серверная почта не подключена») — HTML-письма непроверяемы, канала нет.
- **Markdown Telegram** (`parse_mode=MarkdownV2`) не используется нигде (`rg "MarkdownV2|'Markdown'"` — пусто), поэтому риск «Markdown-инъекции» неприменим; отдельно не тестировался.
- **Полнота лимитов по всем полям** — проверены основные схемы (`validation-schemas.ts` и операторский/админский маршруты); сплошной перебор всех `z.string()` без `.max()` по репозиторию не выполнялся.
