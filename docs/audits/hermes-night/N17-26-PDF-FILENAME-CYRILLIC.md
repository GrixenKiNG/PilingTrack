# N17-26-PDF-FILENAME-CYRILLIC — PDF отчёта в Telegram: имя файла с кириллицей

Аудит только для чтения. Версия: `cc144696dad29317377d36419e239e15705ec543` (branch `hermes/code-1011`).

## Итог

- Наблюдение со стенда 16.10 (`report-2026-10-16-LOAD__________1.pdf`) **воспроизведено по коду**: кириллицу имени оператора вырезает одна строка — `src/services/reports/event-handlers.ts:653`, белый список `[^A-Za-z0-9._-]` → `_`. Транслитерации нет, каждая запретная буква — отдельное подчёркивание.
- Находок: **критично — 0, важно — 2, мелочь — 4**; отдельно 2 подтверждения (ПРОЙДЕНО). Больше 30 не набралось.
- Топ-5: (1) `event-handlers.ts:653` — все живые операторы с русским ФИО дают нечитаемое имя файла; (2) `src/app/api/reports/single-pdf/route.ts:119` — сырое русское ФИО в HTTP-заголовке роняет `Response` (`TypeError`, проверено node) — фолбэк отдаёт 500; (3) у `:653` нет обрезки длины (до 222 символов при ФИО в 200, `validation-schemas.ts:40`); (4) нет сворачивания повторов — длинные «полосы» подчёркиваний; (5) на имя отчёта **нет теста** (`daily-summary.test.ts` проверяет только подпись).
- Механическая потеря происходит **только** на `:653`: транспорт в Telegram имя файла не портит (`telegram.ts:285` кладёт имя в multipart, undici пишет байты UTF-8 — проверено `node`).
- Рекомендация (одно правило): общий `buildReportFileName(date, name, ext)` — транслит кириллицы в латиницу → белый список → свернуть повторы `_` → обрезать до ~80 символов → добавить `.pdf`. Тогда имя одинаково читаемо в Telegram, в веб-скачивании и в выгрузках.

## Методика

Всё — только чтение, рабочая папка `D:/PillingR/wt-night-code`; PowerShell-терминал, пути через `/`.

1. `rg -n "deliverReportPdf" src` → точка входа и её тесты.
2. `rg -n "filename" src/services/reports src/workers src/core/notifications src/core/media` → места сборки имени.
3. `rg -n "Content-Disposition|filename=|\.replace\(/\[\^" src --glob '!**/node_modules/**'` → все выдачи файлов (PDF/XLSX/CSV) и «обеззараживающие» регулярки.
4. `rg -n 'user\?\.name|name\}\.pdf' src` → где в имя файла попадает имя пользователя (нашлось ровно 2 места).
5. Открыты построчно: `event-handlers.ts:599-672`, `telegram.ts:267-299,384-398`, `single-pdf/route.ts:105-134,255-344`, `reports/pdf/route.ts:55-84`, `reports/export/route.ts:55-87`, `pile-passports/export/route.ts:85-93`, `readiness/export/route.ts:130-168`, `media-content.ts:78-107,160-176`, `validation-schemas.ts:40`, `daily-summary.test.ts:100-159,700-741`, `telegram.test.ts:223,279,529`, `prisma/seed.ts:190-240`.
6. Числовой прогон правила и HTTP-заголовка — `node`-скриптом во временном каталоге (вне репозитория), команды приведены в строках-доказательствах ниже.
7. `git log -S "[^A-Za-z0-9._-]"` — история правила (введено в `105f61e0`, 2026-04-27).
8. Правки кода не делались; изменён только этот отчёт.

## Ответы на 5 вопросов задания

1. **Какая функция и по какому правилу.** `src/services/reports/event-handlers.ts:653`:
   `const filename = \`report-${d.date}-${d.user?.name || 'unknown'}.pdf\`.replace(/[^A-Za-z0-9._-]/g, '_');`
   Правило — **белый список, не транслитерация**: разрешены только `A-Z a-z 0-9 . _ -`; любой другой символ (кириллица, пробел, слэш, кавычка, CR/LF) → один `_`, повторы не сворачиваются. Функция формирует имя в `deliverReportPdf` (`:599`), которая затем зовёт `telegramNotifier.sendDocument(filename, pdfBuffer, caption, progress)` (`:665`).
2. **Что делает Telegram с именем.** Механически имя доходит до Bot API корректно: `src/core/notifications/telegram.ts:285` — `form.append('document', new Blob([arr],…), filename)`; проверено `node`: undici печатает в multipart `filename="otchet-…-Иванов И.П..pdf"` байтами UTF-8, т.е. кириллицу передать можно. Сохраняет ли Telegram Unicode-имя — **не проверено** (нет сети: `core.telegram.org` недоступен, websearch отменён); статус — ГИПОТЕЗА: Bot API отдаёт `document.file_name` в UTF-8 и обычно сохраняет кириллицу. Но текущий код этого не использует — он режет кириллицу ещё до отправки.
3. **Нужна ли функция для других выгрузок.** Имя из ФИО пользователя строят **ровно два** места во всём `src`: Telegram (`event-handlers.ts:653`, обрезает) и `src/app/api/reports/single-pdf/route.ts:119` (не обрезает). Прочие выгрузки имя из ФИО не строят и кириллицы в имени не содержат: `reports/export/route.ts:73,82` (`pilingtrack-reports-<today>`), `pile-passports/export/route.ts:91` (`pile-driving-journal-<today>`), `readiness/export/route.ts:156` (`pilingtrack-readiness-<dataset>-<day>`), `reports/pdf/route.ts:146,312,364` (`pilingtrack-report-<from>-<to>` / `<jobId>`), `single-pdf/route.ts:274` (`pilingtrack-report-<safeDate>`). Архива/ZIP-выгрузки в коде нет (`rg 'archiver|jszip|ZipFile'` — пусто). Итог: единый помощник имени нужен, но одинаковой формула «сейчас как раз нет» — каждый канал формирует имя по-своему.
4. **Есть ли тест на имя файла.** Нет. В `daily-summary.test.ts:122-159` `sendDocument` замокан и проверяется **только подпись** (`caption`), имя файла не проверяется; остальные тесты `deliverReportPdf` (`:129-142`, `:726-741`) смотрят на доставку/published, не на имя. В `telegram.test.ts:223,279,529` имя всегда ASCII (`test.pdf`, `slow.pdf`, `r.pdf`). Регрессию правила `[^A-Za-z0-9._-]` ничто не ловит.
5. **Пробелы / слэши / точки / длинный текст.** Проверено `node` на реальном правиле `report-${date}-${name||'unknown'}.pdf` → `replace(/[^A-Za-z0-9._-]/g,'_')`:
   - `Иванов И.П.` → `report-2026-10-16-________._..pdf` (31→33 симв.);
   - `LOAD ЗАГРУЗЧИК 1` → `report-2026-10-16-LOAD___________1.pdf` — совпадает с наблюдением стенда;
   - `Иванов/../../etc/passwd` → `report-2026-10-16-_______.._.._etc_passwd.pdf` — путь **не** протекает (слэши `_`);
   - `А`×200 → 222-символьное имя, обрезки нет;
   - `''` → подставляется `unknown`.

## Таблица «символ / ситуация → результат»

| символ / ситуация | результат сейчас | ожидаемый результат | файл:строка |
|---|---|---|---|
| Кириллица (`Иванов`) | `________` (по `_` на букву) | `Ivanov` (транслит) или Unicode-имя | `src/services/reports/event-handlers.ts:653` |
| Пробел | `_` | `_` | `src/services/reports/event-handlers.ts:653` |
| Слэш `/`, `\`, `..` | `_` (пройти по пути нельзя) | `_` (безопасно) | `src/services/reports/event-handlers.ts:653` |
| Точка `.` | сохраняется (`._..pdf`) | сохраняется | `src/services/reports/event-handlers.ts:653` |
| Дефис `-`, подчёркивание `_` | сохраняются | сохраняются | `src/services/reports/event-handlers.ts:653` |
| Латинские буквы/цифры | сохраняются | сохраняются | `src/services/reports/event-handlers.ts:653` |
| Смешанное `LOAD ЗАГРУЗЧИК 1` | `LOAD___________1` | `LOAD_ZAGRUZCHIK_1` | `src/services/reports/event-handlers.ts:653` |
| Пустое имя | `unknown` | `unknown` (ок) | `src/services/reports/event-handlers.ts:653` |
| Кавычки `"`, `;`, CR/LF | `_` (инъекции нет) | `_` | `src/services/reports/event-handlers.ts:653` |
| ФИО длиной 200 (лимит) | имя ~222 симв. без обрезки | обрезать до ~80 | `src/services/reports/event-handlers.ts:653`, `src/lib/validation-schemas.ts:40` |
| Подряд запретные (`  `) | `__` (не сворачивает) | `_` | `src/services/reports/event-handlers.ts:653` |
| Веб-фолбэк PDF (сырое ФИО) | THROW в заголовке → 500 | ASCII/`filename*=UTF-8''` | `src/app/api/reports/single-pdf/route.ts:119` |

Рекомендация по правилу имени (без правки кода): одна общая функция `buildReportFileName(date: string, name: string | null, ext: string)` в `src/lib` (или `src/core/media`), применяемая и в `event-handlers.ts:653`, и в `single-pdf/route.ts:119`: 1) транслитерация кириллицы в латиницу по фиксированной таблице (`Иванов И.П.` → `Ivanov_I.P.`); 2) `replace(/[^A-Za-z0-9._-]+/g,'_')` — свернуть повторы; 3) обрезать основу до ~80 символов; 4) `safeName || 'unknown'`; 5) для HTTP-заголовка дополнительно `filename*=UTF-8''${encodeURIComponent(name)}`, если владелец хочет видеть живое русское имя в браузере.

## Находки

| # | серьёзность | статус | path:line | проблема | сценарий / почему важно | предлагаемый фикс |
|---|---|---|---|---|---|---|
| 1 | важно | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:653` | Имя файла в Telegram строится из ФИО оператора и «обеззараживается» белым списком ASCII: `.replace(/[^A-Za-z0-9._-]/g, '_')`. Кириллица вырезается без транслитерации. | В проде все операторы с русскими ФИО (`prisma/seed.ts:194` — «Иванов И.П.», `:212` «Герасимов Сергей»). Следствие: менеджер получает `report-2026-10-16-________._..pdf` вместо «Иванов И.П.» — файл не отличить среди однотипных `report-<дата>-`. Воспроизведено node на самом правиле. | Транслит кириллицы + белый список + свернуть повторы + обрезка (см. рекомендацию выше); либо передавать Unicode-имя (п.2 «ГИПОТЕЗА»). |
| 2 | важно | ПРОЙДЕНО | `src/app/api/reports/single-pdf/route.ts:119` | `Content-Disposition: attachment; filename="otchet-<date>-<user.name>.pdf"` — ФИО подставляется **сырым**. | Проверено `node`: `new Response('x',{headers:{'Content-Disposition':'…Иванов И.П.…'}})` бросает `TypeError: Cannot convert argument to a ByteString because the character at index 40 has a value of 1048 which is greater than 255`. Это ветка `if (!jobId)` (Redis недоступен) — синхронный фолбэк PDF для любого русского ФИО падает в `catch` и отдаёт 500 вместо файла. Соседний sync-GET так не делает (`:274` — только `<safeDate>`). | Прогнать имя через тот же общий помощник; либо `filename*=UTF-8''${encodeURIComponent(name)}`. |
| 3 | мелочь | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:653` | Обрезки длины нет. | При ФИО в 200 символов (`src/lib/validation-schemas.ts:40` — `name … .max(200)`) имя файла достигает 222 символов (проверено node). Верхняя граница имён у Telegram не подтверждена (см. «Не проверено»), но длинное имя неудобно и рискованно. | `slice(0, 80)` после очистки. |
| 4 | мелочь | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:653` | Повторяющиеся запретные символы не сворачиваются: каждый даёт свой `_`. | `LOAD ЗАГРУЗЧИК 1` → `LOAD___________1` (совпадает с наблюдением стенда); результат хуже читается, чем `LOAD_ZAGRUZCHIK_1`. | Заменить `+` в классе повторов или нормализовать `_+` → `_`. |
| 5 | мелочь | ПРОЙДЕНО | `src/services/reports/__tests__/daily-summary.test.ts:150-159` | Нет теста на имя файла. `sendDocument` замокан, проверяется только `caption`; в `src/core/notifications/__tests__/telegram.test.ts:223,279,529` имя всегда ASCII. | Правило `[^A-Za-z0-9._-]` может быть случайно изменено/удалено — тест не упадёт; регрессия «кириллица → подчёркивания» вернётся незаметно. | После введения общего помощника — 3-4 кейса на `buildReportFileName` (кириллица, слэш, `..`, длинная строка). |
| 6 | мелочь | ПРОЙДЕНО | `src/services/reports/event-handlers.ts:665` vs `src/app/api/reports/single-pdf/route.ts:274` | Имя отчёта формируется по-разному в разных каналах: Telegram `report-<date>-<name>`, веб `pilingtrack-report-<date>`, период `pilingtrack-report-<from>-<to>`, XLSX/CSV `pilingtrack-reports-<today>` (`reports/export/route.ts:73,82`, `pile-passports/export/route.ts:91`, `readiness/export/route.ts:156`). | Пользователь видит разные имена одного и того же отчёта в Telegram и в браузере; единого правила нет. Прямого отказа нет — неудобство и лишние вопросы поддержки. | Один `buildReportFileName` с фиксированным префиксом; привести к нему все каналы. |
| — | — | ПРОЙДЕНО (в пользу кода) | `src/services/reports/event-handlers.ts:640-646,653` | Подпись к PDF экранируется `escapeHtml`, а имя файла вырезается до ASCII — инъекции нет (совпадает с `docs/audits/hermes-night/W134-DANGEROUS-HTML-EVAL.md`). | Не находка, подтверждение безопасности. | — |
| — | — | ПРОЙДЕНО (в пользу кода) | `src/services/reports/event-handlers.ts:653` | Слэши/`..`/CR-LF превращаются в `_` (node: `Иванов/../../etc/passwd` → `…_.._.._etc_passwd.pdf`). | Path traversal через имя файла невозможен. | — |

Приложение (прочие пути с формированием имени, кириллицы в них нет, поэтому в таблицу не выносились): `src/app/api/reports/pdf/route.ts:146`, `src/app/api/reports/pdf/route.ts:312`, `src/app/api/reports/pdf/route.ts:364`, `src/app/api/reports/single-pdf/route.ts:274`, `src/app/api/reports/single-pdf/route.ts:339`, `src/app/api/reports/export/route.ts:73`, `src/app/api/reports/export/route.ts:82`, `src/app/api/pile-passports/export/route.ts:91`, `src/app/api/readiness/export/route.ts:156`, `src/core/media/media-content.ts:173`.

## Что не проверено

- **Сохраняет ли Telegram Unicode-имя файла.** Сети нет: `webfetch` на `core.telegram.org/bots/api#senddocument` вернул Transport error, `websearch` отменён. В самом коде комментариев об этом нет. Подтверждено только, что undici отправляет `filename` байтами UTF-8 (`node`-прогон), но ответ `document.file_name` от живого Bot API я не видел. Статус п.2 — ГИПОТЕЗА.
- **Максимальная длина имени файла, которую принимает Telegram.** Документация недоступна; наш локальный лимит пропускает 222 символа. Не проверено.
- **Живая отправка в Telegram** не выполнялась (нет токена/сети; это стенд-наблюдение владельца, воспроизведено только по коду и на `node`-модели правила).
- **Ветка `single-pdf` при доступном Redis** (асинхронная, `:339`) — имя берётся из `jobId`, кириллицы нет; поведение в проде не запускалось, только чтение кода.
- **Замороженные зоны** (экраны оператора, сайт ORION) в находки не включались; проверялась только сборка имени файла отчёта.
