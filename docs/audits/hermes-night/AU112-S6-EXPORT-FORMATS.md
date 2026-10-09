# AU112-S6-EXPORT-FORMATS: Экспорты (xlsx, PDF, CSV) — форматы дат, чисел и единиц

Версия кода: `git rev-parse HEAD` = `9b9ad184321318a5f6ea0ee34d51cca88e5dfc69` (ветка `hermes/q4-0926`).
Только чтение; код приложения не менялся.

## Итог

Найдено 14 расхождений форматов: 0 критично, 4 важно, 10 мелочь.

- Все три формата (CSV, XLSX, PDF) используют запятую как разделитель дробной части — единообразно (ПРОЙДЕНО). XLSX хранит числа числами через `<v>` (точка внутри XML — норма OOXML, Excel показывает по локали), CSV — запятая, PDF — запятая с неразрывными разрядами.
- Важно №1: часы простоя в CSV/XLSX — десятичное число («1,25»), на экране — «1 ч 15 мин»: одна величина, две единицы.
- Важно №2: метры (сваи и бурение) в XLSX «Итоги»/«Детализация» и в CSV бурения не округляются, а экран округляет до 1 знака — подшитый файл и экран дают разные цифры после запятой.
- Важно №3: в таблице журнала забивки на экране дробь печатается точкой (`String(value)`), тогда как карточка той же строки и остальные экраны — запятой.
- Важно №4: дата забивки в журнале печатается по поясу браузера (на экране) и по поясу тенанта (в выгрузке .xlsx) — на границе суток дни расходятся.

## Методика

- `git rev-parse HEAD` — версия зафиксирована.
- `find src/modules/reports -type f`, `find src/workers -type f`, `find src/lib/pdf-generator -type f`, `ls src/app/api/reports` — карта экспортов.
- `search_files` по `src/` на `buildXlsx|Content-Disposition|text/csv|application/vnd.openxml` (37 совпадений в 15 файлах), `exceljs|xlsx|ExcelJS|PDFDocument|pdfkit`, `toFixed|replace('.', ',')`, `formatCountMeters|formatMeters|formatFixed|formatDowntimeHours` — найдены ВСЕ точки выгрузки и форматирования.
- Прочитаны целиком: `src/lib/xlsx-writer.ts`, `src/modules/reports/application/queries/report-export.service.ts`, `pile-journal-export.ts`, `pile-journal-totals.ts`, `pile-journal-list.ts`, `pile-passport.service.ts`, `pile-journal-types.ts`, `src/lib/format.ts`, `src/lib/downtime-hours.ts`, `src/lib/pile-length.ts`, `src/lib/timezone.ts`, `src/lib/pdf-generator/*.ts` (format, components, period-pdf, single-pdf, period-row), `src/lib/pdf-data.ts`, `src/workers/unified-worker/pdf.ts`, `src/modules/reports/domain/period-summary.ts`, `src/modules/readiness/application/csv-export.ts`, `src/app/api/reports/{export,pdf,single-pdf,period}/route.ts`, `src/app/api/pile-passports/{,export}/route.ts`, `src/app/api/readiness/export/route.ts`, экраны `src/components/piling/pile-journal/{index,journal-title-block,pile-detail}.tsx`, `src/components/piling/admin-reports/{admin-reports,report-evidence-row,report-totals,report-list-format}.ts(x)`, `equipment-analytics.tsx`.
- Наличие каждого `path:line` проверено чтением файла (строки существуют).
- Исследованы только нефроузенные зоны: экраны оператора (`operator*`, `operator-mobile`), сценарии ORION и `src/modules/operator-mobile/**` пропущены.

Фактические владельцы формата (единый источник): `src/lib/format.ts` (числа, даты), `src/lib/downtime-hours.ts` (простой), `src/lib/pile-length.ts` (м.п.), `src/lib/pdf-generator/format.ts` (свои обёртки над `@/lib/format`).

## Таблица: формат по экспортам

| Экспорт | Величина | Формат | Файл:строка | Совпадает с экраном? |
|---|---|---|---|---|
| Отчёты CSV | дата | ДД.ММ.ГГГГ (`formatRuDate`) | `src/modules/reports/application/queries/report-export.service.ts:173` | НЕТ (экран — ДД.ММ) |
| Отчёты CSV | сваи, м.п. | запятая, ровно 1 знак (`csvMeters`) | `src/modules/reports/application/queries/report-export.service.ts:191` + `:74-76` | да (по знаку) |
| Отчёты CSV | метры бурения | запятая, БЕЗ округления (`csvDecimal`) | `src/modules/reports/application/queries/report-export.service.ts:207` + `:85-87` | НЕТ (экран 1 знак) |
| Отчёты CSV | часы простоя | число запятой, БЕЗ округления | `src/modules/reports/application/queries/report-export.service.ts:222` | НЕТ (экран «ч мин») |
| Отчёты XLSX «Детализация» | дата | ДД.ММ.ГГГГ | `src/modules/reports/application/queries/report-export.service.ts:321` | НЕТ (экран ДД.ММ) |
| Отчёты XLSX «Детализация» | сваи, м.п. | число полной точности | `src/modules/reports/application/queries/report-export.service.ts:333` | НЕТ (экран/CSV 1 знак) |
| Отчёты XLSX «Итоги» | сваи, м.п. | число полной точности | `src/modules/reports/application/queries/report-export.service.ts:354` `:366` | НЕТ (экран 1 знак) |
| Отчёты XLSX «Итоги» | часы простоя | число | `src/modules/reports/application/queries/report-export.service.ts:363` `:338` | НЕТ (экран «ч мин») |
| Отчёты XLSX «Выгружено» | момент | ДД.ММ.ГГГГ ЧЧ:ММ, пояс тенанта | `src/modules/reports/application/queries/report-export.service.ts:269`(printMoment) `:306` | н/д (нет на экране) |
| Журнал забивки XLSX | дата забивки | ДД.ММ.ГГГГ, пояс тенанта | `src/modules/reports/application/queries/pile-journal-export.ts:12`(printDay) `:138` | НЕТ (экран — пояс браузера) |
| Журнал забивки XLSX | длина/глубина/отметки, м | число (Excel) | `src/modules/reports/application/queries/pile-journal-export.ts:144-155` | НЕТ (экран — точка) |
| Журнал забивки XLSX | период титула | ДД.ММ.ГГГГ, пояс тенанта | `src/modules/reports/application/queries/pile-journal-totals.ts:98-101`(printYmd) `:133` | да (титул тот же с сервера) |
| PDF (свод/одиночный) | дата | ДД.ММ.ГГГГ (strict) | `src/lib/pdf-generator/format.ts:24-40` | да |
| PDF (свод/одиночный) | метры | запятая, ровно 1 знак, разряды пробелом | `src/lib/pdf-generator/format.ts:20-22` | почти (экран — до 1 знака) |
| PDF футер | «сформировано» | locale сервера, БЕЗ timezone | `src/lib/pdf-generator/components.ts:274` | НЕТ (везде пояс тенанта) |
| readiness CSV | дата/время | ДД.ММ.ГГГГ / ДД.ММ.ГГГГ ЧЧ:ММ, пояс тенанта | `src/modules/readiness/application/csv-export.ts:23-42` | НЕ ПРОВЕРЕНО |
| Все XLSX | числа | `<v>` числом (точка в XML) | `src/lib/xlsx-writer.ts:76-78` | да (Excel рендерит по локали) |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемый фикс | статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/modules/reports/application/queries/report-export.service.ts:222` | Часы простоя в CSV — десятичное число запятой (`csvDecimal`), а на экране — «1 ч 15 мин» (`formatDowntimeHours`) | Диспетчер выгружает CSV, сверяет колонку «Часы простоя» с экраном отчётов: видит «1,25» вместо «1 ч 15 мин». Одна величина, две единицы | Печатать часы одним правилом (часы-минуты) либо явно называть колонку «Часы простоя, ч» | ПРОЙДЕНО (чтение кода) |
| 2 | важно | `src/modules/reports/application/queries/report-export.service.ts:354` и `:333` | XLSX «Итоги»/«Детализация» пишут метры числом полной точности; CSV (`:191`) и экран (`src/components/piling/admin-reports/report-evidence-row.tsx:145`) округляют до 1 знака | Подшитый .xlsx и экран дают разные цифры после запятой (37,55 против 37,5/37,6); при сверке «файл ≠ экран» | Округлять сумму м.п. до 1 знака в .xlsx тем же правилом, что и экран, либо оставлять дробь намеренно и подписывать точность | ПРОЙДЕНО |
| 3 | важно | `src/components/piling/pile-journal/index.tsx:497-499` (`num`) | В таблице журнала забивки дробь печатается точкой (`String(value)` → «30.5»), тогда как карточка той же строки (`src/components/piling/pile-detail.tsx:150-152`) и остальные экраны — запятой | Два формата одной величины на одном экране; инспектор видит «30.5 м» в строке и «30,5 м» в раскрытой карточке | Заменить `String(value)` на `formatNumber(value, 1)` в `num()` | ПРОЙДЕНО |
| 4 | важно | `src/components/piling/pile-journal/index.tsx:419` | Дата забивки в таблице журнала — `toLocaleDateString('ru-RU')` без `timeZone` (пояс браузера), выгрузка .xlsx — по поясу тенанта (`src/modules/reports/application/queries/pile-journal-export.ts:12-18`) | Свая, забитая около полуночи МСК, на экране и в подшитом файле датируется разными днями | Печатать дату на экране тем же поясом тенанта, что и выгрузка | ПРОЙДЕНО |
| 5 | мелочь | `src/components/piling/pile-journal/pile-detail.tsx:47` | `new Date(row.drivenAt).toLocaleString('ru-RU')` без `timeZone` — пояс браузера | Дата/время смены в карточке сваи расходится с выгрузкой по тз тенанта у граничных времён | Передавать `timeZone: tenantTimezone` | ПРОЙДЕНО |
| 6 | мелочь | `src/components/piling/pile-journal/index.tsx:236` | Имя файла журнала задаёт клиент через `getTodayInTimezone()` без аргумента (по умолчанию Europe/Moscow), перезаписывая серверное `Content-Disposition` (`src/app/api/pile-passports/export/route.ts:87-91`, пояс тенанта) | Тенант с другим поясом получает файл, датированный московским днём, а не своим | Имя брать из `Content-Disposition` сервера, как в отчётах (`src/components/piling/admin-reports/admin-reports.tsx:170`) | ПРОЙДЕНО |
| 7 | мелочь | `src/lib/pdf-generator/components.ts:274` | PDF-футер печатает `new Date().toLocaleString('ru-RU')` без `timeZone` — время хоста (в контейнере, вероятно, UTC), тогда как остальные «моменты» выгрузок печатаются по поясу тенанта (`report-export.service.ts:269`, `pile-journal-export.ts:22`) | «сформировано» в PDF может отставать от локального на часы | Печатать момент по поясу тенанта (передавать tz в `addFooterAndPageNumbers`) | ГИПОТЕЗА (пояс хоста не измерен, только чтение кода) |
| 8 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:173` против `src/components/piling/admin-reports/report-list-format.ts:24-28` | CSV/XLSX отчётов печатают дату ДД.ММ.ГГГГ, а экран журнала отчётов — только ДД.ММ (`shortDate`) | Один отчёт датируется на экране без года, в файле с годом — мешает сверке в пределах года | Привести экранные подписи к формату файла или наоборот | ПРОЙДЕНО |
| 9 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:207` (`csvDecimal`) | Метры бурения в CSV выводятся без округления (`String(value)`): возможно «16,666666», тогда как экран — 1 знак | Длинный хвост дроби в подшитом CSV; расходится с экраном | Округлять до 1 знака (как `csvMeters`) | ПРОЙДЕНО |
| 10 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:222` (`csvDecimal`) | Часы простоя в CSV без округления — «1,2499999» из `durationSeconds`/расчёта | Некрасивая и ложно-точная дробь в файле | `toFixed(...)` перед печатью | ПРОЙДЕНО |
| 11 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:191` | `meters > 0 ? csvMeters(meters) : 'длина марки не задана'`: при `count = 0` и известной длине метры тоже 0 → печатается «длина марки не задана», хотя длина задана | Строка-поправка с нулевым счётом подписана как «нет длины марки» — вводит в заблуждение | Проверять отдельно `lengthMm == null`, а не `meters > 0` | ПРОЙДЕНО (логика) |
| 12 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:157` | Клиент читает `x-export-row-count`, но `src/app/api/reports/export/route.ts` его не выставляет (заголовок есть только у readiness и pile-passports) | Для XLSX `dataRows = null` → пустая выгрузка не отсекается предупреждением, как для CSV | Выставлять заголовок в reports/export либо убрать зависимость | ПРОЙДЕНО |
| 13 | мелочь | `src/lib/pdf-generator/format.ts:20-22` (`formatMeters`) | PDF метры — `formatFixed(...,1)` (ровно 1 знак, разряды неразрывным пробелом), экран — `formatNumber(...,1)` (до 1 знака, разряды обычным пробелом) | «12,0 м» в PDF против «12 м» на экране; символ пробела разрядов разный | Осознанно зафиксировать: PDF — нормативный документ, экран — компактный (уже так) | ПРОЙДЕНО (не дефект, отличие) |
| 14 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:333` | Числовая колонка «Свай, м.п.» в XLSX печатает `meters` (float) — Excel покажет столько знаков, сколько в double | «37,550000000000004»-подобный хвост в подшитом файле | Округлять до 1 знака | ПРОЙДЕНО |

Проверка положительных моментов (ПРОЙДЕНО):
- Разделитель дробной части: CSV (`report-export.service.ts:74-76,85-87`), readiness CSV (`src/modules/readiness/application/csv-export.ts:32-34`) и PDF (`src/lib/pdf-generator/format.ts:4`) используют запятую — единообразно.
- XLSX хранит числа числом (`src/lib/xlsx-writer.ts:76-78`), не текстом — колонки суммируются в Excel.
- Защита от формул CSV (CWE-1236) присутствует: `report-export.service.ts:37-45`, `csv-export.ts:5-9,44-48`.
- Часовой пояс тенанта явно применяется в XLSX-реквизитах и титуле журнала: `report-export.service.ts:269` `pile-journal-export.ts:22` `pile-journal-totals.ts:93`.
- PDF-формат нулей/пустых значений защищён `safeText` (`src/lib/pdf-generator/format.ts:6-13`).

## Что не проверено

- Не запускались команды §6 AGENTS.md (`tsc`, `lint`, `test:unit`, `playwright --list`, `build`) — задача только читательская, файлы приложения не менялись; числа в отчёте взяты из кода, не из прогонов.
- Реальные выгрузки не генерировались (нет доступа к БД/env; запрещено). Все выводы — из чтения кода, статус ПРОЙДЕНО = «строка кода прочитана», а не «файл воспроизведён».
- Пояс хоста/контейнера для PDF-футера №7 не измерен (гипотеза UTC), т.к. `new Date().toLocaleString` зависит от окружения исполнения.
- Форматы экрана readiness-модуля (`src/modules/readiness/**` UI) не сопоставлены с readiness CSV — не проверено.
- Экраны оператора и ORION (замороженные зоны) не смотрелись; найденные там `.toFixed(1)` (например `src/components/piling/operator-mobile/screens/work-screen.tsx:452,457`) в аудит не включены по правилу задачи.
- `src/components/piling/admin-analytics.tsx` и `equipment-analytics.tsx` просмотрены частично: подтверждено, что дашборды используют `formatCountMeters` и локальный `fmtHours` в формате «ч/мин» (`equipment-analytics.tsx:403-410`), но полного построчного разбора их таблиц не делалось.
