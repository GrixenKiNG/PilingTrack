# AU83-S6-ROUNDING-FORMATS: Округление и форматирование чисел — где расходятся экран, PDF и выгрузка

Версия кода: `git rev-parse HEAD` = `27ad3a3d2ecd8987817c5647c89c21245fe4dacc` (ветка `hermes/q4-0926`).
Аудит только чтением; код приложения не менялся.

## Итог

Аудит охватил выработку (сваи/бурение), метры, часы простоя, моточасы, проценты и деньги на экранах,
в PDF и в трёх выгрузках (CSV/XLSX отчётов, XLSX журнала забивки, CSV готовности).
Единых правил нет: одни и те же величины печатаются через 4 разных механизма — `Intl.NumberFormat` (`formatNumber`),
`toLocaleString` (`formatFixed`, а также ручные вызовы), `toFixed`/`Math.round` (домен, сервер, CSV) и «сырое» `String(value)`.
Итог по severity: **критично — 0, важно — 11, мелочь — 11** (всего 22 находки).

Топ-5:
1. **Метры бурения** и **часы простоя** в CSV/XLSX выгрузке идут **без округления** (`16,6666667`, `1,5`),
   тогда как экран и PDF показывают `16,7 м.п.` и `1 ч 30 мин` — одна величина, разные числа/единицы
   (`src/modules/reports/application/queries/report-export.service.ts:85-87`, `src/lib/format.ts:132`, `src/lib/downtime-hours.ts:119`).
2. **Моточасы** печатаются с 0, 1, «до 3» знаками и вообще сырым числом в зависимости от экрана
   (`equipment-detail-overview.tsx:156` — 0 знаков; `dictionaries-section.tsx:169` — до 1; `readiness-centre.tsx:512` — до 3;
   `equipment-detail-parts.tsx:367` — сырое `String`).
3. **Часы простоя внутри одной формы отчёта**: блок простоя `1 ч 30 мин` (`report-form/downtime-section.tsx:76,89`),
   а «Итого за смену» рядом — `1,5 ч` (`report-form/submit-bar.tsx:44`).
4. **Отказ сваи**: строка журнала печатает `1.85` (точка, 2 знака) (`pile-journal/index.tsx:497-499,431`),
   а карточка той же сваи — `1,9 мм/уд` (запятая, 1 знак) (`pile-journal/pile-detail.tsx:150-152`).
5. **Длина марки сваи**: справочник `12,00 м` (2 знака), план/формы `12,0 м` (1 знак), журнал аудита `12.35 м` (точка)
   (`admin-dictionaries.tsx:226-227`, `pile-plan-section.tsx:105`, `services/audit/audit-service.ts:597`).

## Методика

Что искалось (только чтение, никаких правок):

    git rev-parse HEAD                     -> 27ad3a3d2ecd8987817c5647c89c21245fe4dacc
    поиск по src/: Intl.NumberFormat | toFixed | toLocaleString | .replace('.', ',')
    поиск по src/: formatNumber | formatFixed | formatNum | formatHours | formatPercent |
                  formatCountMeters | formatDowntimeHours | formatDowntimeHoursOnly
    файлы формата:   src/lib/format.ts, src/lib/downtime-hours.ts, src/lib/pdf-generator/format.ts
    PDF:             src/lib/pdf-generator/{single-pdf,period-pdf,components,period-row,pdf-data}.ts
    выгрузки:        src/modules/reports/application/queries/report-export.service.ts,
                     src/modules/reports/application/queries/pile-journal-export.ts,
                     src/modules/readiness/application/csv-export.ts,
                     src/app/api/readiness/export/route.ts, src/lib/xlsx-writer.ts
    потребители:      src/components/piling/**, src/components/piling/to/readiness/**

Значения округления проверены исполнением `node` (не «на глаз»), результаты ниже в таблице колонки «Округление».
Ключевые факты из прогона (`node -e`, `Intl.NumberFormat('ru-RU')`, разделитель разрядов = U+00A0):

    16.6666667  formatNumber(x,1) -> "16,7"   formatFixed(x,1) -> "16,7"   toFixed(1)->"16,7"   String(v)->"16,6666667"
    40311       formatNumber(x,1) -> "40 311" formatFixed(x,1) -> "40 311,0" toFixed(1)->"40311,0"
    1234.5      formatNumber(x,1) -> "1 234,5"                 toFixed(1)->"1234,5"
    (1234.567).toLocaleString('ru')  -> "1 234,567"   (default maximumFractionDigits = 3)
    (1234.567).toLocaleString('ru-RU') -> "1 234,567"
    0.25        formatNumber(x,1) -> "0,3"

Статусы в таблице ниже: ПРОЙДЕНО (проверено по коду и прогоном) / ГИПОТЕЗА (следствие кода, визуально не проверено) /
НЕ ПРОВЕРЕНО (данные или окружение недоступны). API-документация Next.js/Prisma не запрашивалась: задача про числовые
форматы приложения, поведение `Intl`/`toFixed`/`toLocaleString` проверено Node-прогоном.

### Таблица форматирования (место | функция | знаков | округление | разделитель | носитель | файл:строка)

| Место | Функция | Знаков | Округление | Разделитель | Носитель | Файл:строка |
|---|---|---|---|---|---|---|
| «N шт. / M м.п.» (дашборды, аналитика, карточки, Telegram) | formatCountMeters → formatNumber(x,1) | шт 0 / м до 1 | Intl.NumberFormat (half-up) | запятая, NBSP-разряды | экран/PDF/бот | src/lib/format.ts:132-134 |
| Метры, карточный PDF (м.п.) | formatMeters → formatFixed(x,1) | 1 фикс. | toLocaleString | запятая + разряды | PDF | src/lib/pdf-generator/format.ts:20-22 |
| Бурение м.п., таблица периода PDF | formatNumber(x,1) | до 1 (срезает «,0») | Intl | запятая | PDF | src/lib/pdf-generator/components.ts:208-209 |
| Метры бурения и часы простоя, CSV | csvDecimal → String(v).replace('.',',') | НЕ ограничено | нет округления | запятая, без разрядов | CSV | src/modules/reports/application/queries/report-export.service.ts:85-87 (применение :207, :222) |
| «Свай, м.п.», CSV | csvMeters → toFixed(1) | 1 фикс. (с «,0») | JS toFixed | запятая, без разрядов | CSV | report-export.service.ts:74-76 (:191) |
| Метры/итоги, XLSX | числа как числа (сырые) | без округл. | нет | по локали Excel | XLSX | report-export.service.ts:333,336,338,354,361,363 |
| Часы простоя, экран и PDF | formatDowntimeHours | до минут | Math.round(h*60) | «ч»/«мин» | экран + PDF | src/lib/downtime-hours.ts:119-129 (components.ts:210,247; single-pdf.ts:57,101) |
| Часы простоя, экраны машиниста | formatDowntimeHoursOnly | до 2 | Math.round(h*100)/100 | запятая | экран (frozen) | src/lib/downtime-hours.ts:88-92 |
| Простой «Итого за смену» формы | formatNumber(x) | до 1 | Intl | запятая | экран | src/components/piling/report-form/submit-bar.tsx:44 |
| Моточасы, карточка оборудования | formatFixed(x,0) | 0 | toLocaleString | запятая + разряды | экран | src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:156,174; src/components/piling/monitoring/equipment-tile-block.tsx:185 |
| Моточасы, справочники | formatNumber(x) | до 1 | Intl | запятая | экран | src/components/piling/to/readiness/settings/dictionaries-section.tsx:169 |
| Моточасы, готовность/парк/ТО | toLocaleString('ru-RU') | до 3 | Intl (default) | запятая | экран | src/components/piling/to/readiness/screens/readiness-centre.tsx:512,551,803; fleet-screen.tsx:213; maintenance-screen.tsx:202,205; fleet-evidence-panel.tsx:152,193-194; src/components/piling/to/readiness-model.ts:115; src/components/piling/to/readiness-design-views.tsx:242,413 |
| Моточасы, таблица парка | toLocaleString('ru') | до 3 | Intl (default) | запятая | экран | src/components/piling/admin-equipment/equipment-table.tsx:121 (helper :11-12) |
| Моточасы, паспорт оборудования | String(value) | сырое | нет | точка (если дробь) | экран | src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:367-368 |
| Моточасы и балл, CSV готовности | csvCellText (сырое число) | сырое | нет | запятая | CSV | src/app/api/readiness/export/route.ts:52-56,124; src/modules/readiness/application/csv-export.ts:32-34 |
| % доли простоя (плитка KPI) | toLocaleString('ru-RU',max1)+' %' | до 1 | Intl | запятая, пробел перед «%» | экран | src/components/piling/analytics-dashboard/kpi-widgets.tsx:114 |
| % простоя, таблица операторов | toLocaleString('ru-RU',max1) | до 1 | Intl | запятая, «%» без пробела | экран | src/components/piling/admin-analytics.tsx:401 |
| % Парето простоя | Math.round(int)+'%' | 0 | Math.round (сервер) | «%» без пробела | экран | src/components/piling/equipment-analytics.tsx:387; src/services/analytics/equipment-analytics-service.ts:217 |
| % прогресса (плитки/мини-бары) | Math.round | 0 | Math.round | «%» | экран | src/components/piling/admin-dashboard-bits.tsx:90,165; src/components/piling/admin-dashboard.tsx:268 |
| % (formatPercent) | formatNumber + «%» | до 1 (по умолчанию) | Intl | запятая | экран | src/lib/format.ts:8-10 (потребители: admin-analytics-bits.tsx:81,84; src/components/piling/to/readiness/screens/reports-screen.tsx:114) |
| Отказ сваи, таблица журнала | String(value) | сырое (2) | нет | точка | экран + XLSX | src/components/piling/pile-journal/index.tsx:426-433,497-499; src/modules/reports/application/queries/pile-journal-export.ts:152,155 |
| Отказ сваи, карточка сваи | formatNumber(x,1) | до 1 | Intl | запятая | экран | src/components/piling/pile-journal/pile-detail.tsx:89-90,150-152 |
| Отказ сваи, расчёт/хранение | Math.round(x*100)/100 | 2 | Math.round | — (число) | домен | src/modules/operator-mobile/domain/pile-passport.ts:41,242 |
| Титул журнала (отказ, энергия удара) | join чисел (String) | сырое | нет | точка | экран + XLSX | src/components/piling/pile-journal/journal-title-block.tsx:19,34-37; pile-journal-export.ts:90-91,144-159 |
| Длина сваи, план/формы | formatFixed(x,1) | 1 фикс. | toLocaleString | запятая + разряды | экран | src/components/piling/admin-sites/site-editor/pile-plan-section.tsx:105,130; src/components/piling/admin-reports/report-detail-dialog.tsx:83,92 |
| Длина марки, справочник | toLocaleString(ru-RU,2) | 2 фикс. | Intl | запятая | экран | src/components/piling/admin-dictionaries.tsx:226-227; src/components/piling/admin-dictionaries/dictionary-table.tsx:41-43 |
| Длина марки, журнал аудита | Number((mm/1000).toFixed(2)) | до 2 | toFixed | точка | экран/лог | src/services/audit/audit-service.ts:597 |
| Затраты ₽, плитка ТО | formatNumber(cost,0) | 0 | Intl | запятая | экран | src/components/piling/admin-analytics-bits.tsx:87 |
| Затраты ₽, таблица проблемных | toLocaleString('ru') | до 3 | Intl (default) | запятая | экран | src/components/piling/admin-analytics.tsx:510 |
| Стоимость покупки | formatFixed(x,2) | 2 фикс. | toLocaleString | запятая | экран | src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:365 |
| Стоимость ТО, карточка | toLocaleString(ru-RU,0) | 0 | Intl | запятая | экран | src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:254 |
| Отработано, ч | toLocaleString(ru-RU,max1) | до 1 | Intl | запятая | экран | src/components/piling/admin-analytics.tsx:398 |
| MTBF/MTTR, ч | formatNumber (ч/дн) | до 1 | Intl | запятая | экран | src/components/piling/admin-analytics-bits.tsx:69-73,82-83 |
| Часы простоя, флит-дашборд | formatHours | до минут | Math.round | «ч»/«мин» | экран | src/components/piling/monitoring/fleet-dashboard.tsx:343; equipment-tile-block.tsx:193 (def src/lib/format.ts:23-30; дубль equipment-analytics.tsx:403-409) |
| Метры, снимок парка | formatCountMeters | до 1 | Intl | запятая | экран | src/components/piling/monitoring/fleet-dashboard.tsx:338,340 |
| Метры по объектам (сервер) | parseFloat(x.toFixed(1)) | 1 | toFixed | — (число) | сервер | src/services/analytics/site-analytics-service.ts:179-187 |
| Дни до срока | Math.round | 0 | Math.round | - | экран | src/lib/format.ts:84-103 |

## Находки

Severity: **критично** — неверные данные/утечка; **важно** — одна величина показывается по-разному, это видит человек извне;
**мелочь** — косметика оформления или риск будущего расхождения.

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | src/modules/reports/application/queries/report-export.service.ts:85-87,207 | Метры бурения в CSV — `String(v).replace('.',',')` без округления: на экран уходит `16,7`, в файл `16,6666667` | Инженер сверяет подшитую выгрузку с экраном/PDF: колонка «Метры бурения» показывает 7 знаков, а карточка отчёта — 1. Одно число — разный вид (и разное последнее значение) | Заменить на округление до 1 знака с запятой (`Number(v.toFixed(1)).toString().replace('.',',')`) или через общий хелпер |
| 2 | важно | src/modules/reports/application/queries/report-export.service.ts:222,338,363 | Часы простоя в CSV/XLSX — десятичные часы (`1,5`), экран и PDF — «1 ч 30 мин» (`src/lib/downtime-hours.ts:119`) | Простой с 10:20 до 10:50 в файле — `0,5`, на экране — «30 мин»; сверка бумаги и экрана «не бьётся» | Либо печатать часы+минуты и в выгрузке, либо явно подписать колонку «Часы простоя, ч» |
| 3 | важно | src/modules/reports/application/queries/report-export.service.ts:74-76,191 | «Свай, м.п.» в CSV — `toFixed(1)` без разрядов и с хвостом: `40311,0`; на экране `40 311 м.п.` | Одна величина, три вида: CSV `40311,0`, XLSX `40311.0000001` (сырое), экран `40 311` | Одно правило округления и разрядов для CSV/XLSX/экрана; хвост «,0» убрать |
| 4 | важно | src/modules/reports/application/queries/report-export.service.ts:333,354 | «Свай, м.п.» в XLSX — сырое число без округления, экран округляет до 1 знака | Сумма `метров = count × длина` даёт плавающие хвосты; Excel покажет число, отличное от экрана и PDF | Округлять до 1 знака перед записью в ячейку (`Math.round(v*10)/10`) |
| 5 | важно | src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:156,174; src/components/piling/to/readiness/settings/dictionaries-section.tsx:169; src/components/piling/to/readiness/screens/readiness-centre.tsx:512,551,803; src/components/piling/admin-equipment/equipment-table.tsx:121; src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:367-368; src/app/api/readiness/export/route.ts:52-56 | Моточасы: 0 знаков / до 1 / до 3 / сырое `String`, и сырое число в CSV готовности | Механик на карточке видит `1 234` (округлили до целого), на экране готовности — `1 234,567`, в выгрузке — `1234,567` без разрядов. По этим числам решают о ТО | Один хелпер для моточасов (напр. `formatFixed(x,1)` или `formatNumber(x,1)`) во всех местах, включая сырой `String` в паспорте |
| 6 | важно | src/components/piling/pile-journal/index.tsx:426-433,497-499; src/components/piling/pile-journal/pile-detail.tsx:89-90,150-152; src/modules/reports/application/queries/pile-journal-export.ts:152,155 | Отказ сваи: строка журнала — `String(value)` (точка, 2 знака: `1.85`), карточка той же сваи — `formatNumber(x,1)` (`1,9`), выгрузка — сырое `1.85` | Мастер сравнивает отказ с проектным в таблице (`1.85`) и в раскрытой карточке (`1,9 мм/уд`) — два разных числа для одной сваи на одном экране | Печатать отказ одним правилом (1 знак, запятая) и в таблице, и в карточке, и в выгрузке |
| 7 | важно | src/services/audit/audit-service.ts:597; src/components/piling/admin-dictionaries.tsx:226-227; src/components/piling/admin-dictionaries/dictionary-table.tsx:41-43; src/components/piling/admin-sites/site-editor/pile-plan-section.tsx:105 | Длина марки сваи: аудит `12.35 м` (точка), справочник `12,00 м` (2 знака), план `12,0 м` (1 знак) | Длина — источник м.п.; её вид в аудите с точкой ломает «русскость» интерфейса и не совпадает со справочником | В аудите использовать `formatFixed(x,2)` (запятая), в справочнике — то же число знаков, что в плане |
| 8 | важно | src/components/piling/report-form/submit-bar.tsx:44; src/components/piling/report-form/downtime-section.tsx:76,89 | В одной форме отчёта простой показан двумя способами: секция — «1 ч 30 мин», «Итого за смену» — `1,5 ч` | Оператор заполняет отчёт и на итоговой полосе видит `1,5 ч` там, где выше было `1 ч 30 мин` — сомнение, то ли посчитано | В submit-bar вызвать `formatDowntimeHours(totalDowntime)` вместо `formatNumber` |
| 9 | важно | src/components/piling/report-form/drilling-section.tsx:48,69; src/components/piling/report-form/submit-bar.tsx:39 | Метры бурения: секция бурения подписывает «м», итоговая полоса — «м.п.» для той же величины | Одно число в двух подписях; «м» и «м.п.» читаются как разные величины (решение владельца 28.09.2026 — единообразие «м.п.») | Единая подпись «м.п.» для бурения (как в `formatCountMeters`) |
| 10 | важно | src/lib/format.ts:8-10; src/components/piling/admin-analytics.tsx:401; src/components/piling/analytics-dashboard/kpi-widgets.tsx:74,114; src/components/piling/equipment-analytics.tsx:387 | Проценты: 0 знаков (Math.round) vs до 1 (`formatPercent`/`toLocaleString`), и пробел перед «%» то есть, то нет: `33%`, `12,5 %`, `12,5`, `+4,2%` | «Доля простоя 12,5» без «%» (`admin-analytics.tsx:401`) рядом с «33%»; разнобой знаков/пробела читается как разные метрики | Один хелпер процента (знаков вида + единый пробел перед «%») для всех метрик |
| 11 | важно | src/components/piling/admin-analytics-bits.tsx:87; src/components/piling/admin-analytics.tsx:510; src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:365; src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:254 | Деньги ₽: плитка ТО — 0 знаков, таблица проблемных — до 3 (`toLocaleString('ru')`), стоимость покупки — 2 знака, стоимость ТО — 0 | Одна сумма по ТО в плитке — целые рубли, в таблице рядом — `1 234,567 ₽` (копейки до 3 знаков от `toLocaleString('ru')` по умолчанию) | Один денежный формат (напр. `formatFixed(x,0)` ₽) и убрать `toLocaleString('ru')` без опций |
| 12 | мелочь | src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:367-368 | Наработка моточасов в паспорте — `String(value)` (сырое, точка при дроби) | Если `engineHoursTotal = 1234.5`, паспорт покажет `1234.5 ч` при `1 234,5 м/ч` в других местах | Заменить `pushInt` на `formatFixed(x,0)`/`formatNumber(x,1)` |
| 13 | мелочь | src/services/analytics/equipment-analytics-service.ts:217; src/components/piling/equipment-analytics.tsx:387 | Процент Парето простоя округляется к целому на сервере (`Math.round`) | Сумма долей может не дать 100% (потеря точности), на экране «33%» | Решать осознанно: целые % (тогда суммы не сходятся) или 1 знак |
| 14 | мелочь | src/components/piling/equipment-analytics.tsx:399-401,403-409 | Локальный `fmtHours` дублирует `formatHours` из `src/lib/format.ts:23-30` один-в-один | Любая будущая правка правил часов в одном месте разойдётся с другим | Импортировать `formatHours` из `@/lib/format` |
| 15 | мелочь | src/components/piling/admin-equipment/equipment-table.tsx:11-12,121; src/components/piling/admin-equipment/equipment-tile.tsx:16; src/components/piling/admin-analytics.tsx:510 | `toLocaleString('ru')` без опций: `maximumFractionDigits` по умолчанию = 3, в отличие от `'ru-RU'` с явными опциями рядом | Моточасы/стоимость печатаются до 3 знаков «по случаю», а не по решению | Использовать `formatNumber`/`formatFixed` из `@/lib/format` |
| 16 | мелочь | src/components/piling/pile-journal/journal-title-block.tsx:19,34-37; src/modules/reports/application/queries/pile-journal-export.ts:90-91 | Титул журнала печатает числа `join` (сырой `String`, точка): «Проектный отказ 1.8» | На том же экране карточка сваи показывает `1,8 мм/уд` — титул с точкой спорит с телом | Форматировать числа титула тем же хелпером |
| 17 | мелочь | src/components/piling/report-history.tsx:327,334; src/components/piling/report-history-detail-dialog.tsx:138; src/components/piling/admin-reports/report-detail-dialog.tsx:118 | История отчётов — `formatFixed(x,1)` с хвостом «,0» (`12,0 м.п.`), тогда как дашборды — `formatCountMeters` без хвоста | Одна величина выглядит по-разному на соседних экранах | Унифицировать с `formatCountMeters` |
| 18 | мелочь | src/components/piling/to/readiness-model.ts:115; src/components/piling/to/readiness/screens/fleet-screen.tsx:213 | Моточасы готовности — `toLocaleString('ru-RU')` (до 3 знаков), рядом справочники — `formatNumber` (до 1) | `1 234,567 м/ч` против `1 234,6 м/ч` на соседних экранах | Один формат моточасов |
| 19 | мелочь | src/lib/pdf-generator/components.ts:274 | Подвал PDF: `new Date().toLocaleString('ru-RU')` без явных опций | Формат даты-времени подвала зависит от среды исполнения, не зафиксирован | Задать опции/пояс явно |
| 20 | мелочь | src/lib/format.ts:33-36; src/components/piling/admin-equipment/equipment-table.tsx:11-12 | Три «общих» хелпера чисел (`formatNumber` до 1, `formatNum` до 2, `formatFixed` фикс.) при этом экраны пишут `toLocaleString` вручную | Правила расползаются: каждый экран выбирает свои знаки | Свести к `formatNumber`/`formatFixed` и удалить ручные `toLocaleString` |
| 21 | мелочь | src/lib/format.ts:1-6,18-20 | `formatNumber` (срезает «,0») и `formatFixed` (дополняет «,0») легко перепутать — на экранах оба применяют к метрам | Метры в PDF-таблице срезают «,0», в PDF-карточке — дополняют; в XLSX/CSV — иначе | Явно задокументировать выбор (какой из двух для метров) и применять единообразно |
| 22 | ГИПОТЕЗА | src/lib/pdf-generator/components.ts:113-131; src/lib/pdf-generator/single-pdf.ts:54-58 | `addMetricStrip` для значения «N шт. / M м.п.» (unit = '') рисует всю строку одним блоком 15pt с `lineBreak:false`+`ellipsis` в колонке шириной CONTENT_WIDTH/3 — длинное «1 234 шт. / 5 678 м.п.» может обрезаться | В PDF итог по сваям/бурению может прийти с многоточием, тогда как на экране виден целиком | Разметить значение на две строки по « / » и в ветке с пустой единицей |

## Не проверено

- **Визуальный вывод PDF** (находка 22): проверено по коду `addMetricStrip`, но байты PDF/рендер не открывались — это ГИПОТЕЗА, нужна проверка на реальном документе.
- **Реальные данные БД**: фактические дроби моточасов, отказа, метров не смотрелись (аудит только по коду; подключения к БД не было). Расхождения знаков показаны на числах из Node-прогона, а не из боевых записей.
- **Отображение CSV/XLSX в русском Excel**: вывод (разделитель «;», запятая как десятичный) следует из комментариев в коде (`report-export.service.ts:68-87`, `csv-export.ts:28-34`) и логики, но сам Excel/LibreOffice не запускался.
- **Разделитель разрядов `Intl`**: в Node это U+00A0; в целевом браузере/ОС для `ru-RU` может быть U+202F (узкий неразрывный пробел) — точный код-поинт в браузере не проверялся.
- **Frozen-зоны** (`src/components/piling/operator*`, `src/modules/operator-mobile/**`, `src/components/piling/operator-mobile/**`, ORION): там есть свои форматы (напр. `operator-mobile/operator-work-overview.tsx:40` — простой `String(h).replace('.',',')`, `operator-v2/sheets.tsx:102` — `toFixed(1)` с точкой, `operator-mobile/domain/pile-passport.ts:41` — округление отказа), но они в замороженных областях и в объём аудита не входили.
- **Команды проверки из AGENTS.md §6** (`tsc`, `lint`, `test:unit`, `playwright --list`, `build`) не запускались: задача read-only, код не менялся — проверять нечего (регрессий внести нечем).
