# Единообразие дат, чисел и единиц измерения

Аудит: показывают ли экраны, PDF-выгрузки и .xlsx-экспорты даты, числа и единицы
так, как требует продукт — `ДД.ММ.ГГГГ`, пробел в разрядах тысяч, десятичная
запятая, часовой пояс тенанта (`src/lib/timezone.ts`), «м/ч» для моточасов и
«шт/м.п.» для пар «количество / метраж» (PRODUCT.md:50-52).

Область: `src/components/piling/**` (без `operator*`), `src/lib/format*.ts`,
`src/lib/pdf-generator/**`, `src/modules/reports/**` (xlsx),
`src/services/reports/event-handlers.ts` (Telegram). Замороженные области
(варианты операторского экрана, ORION) не проверялись.

## Итог

- Всего находок: **44** — критично **3**, важно **24**, мелочь **17**.
- Общая картина двойная. С одной стороны, в проекте есть хорошая общая основа и
  она местами применяется образцово: `src/lib/format.ts` (форматтеры с явным
  `ru-RU`), `getTodayInTimezone`/`formatDateInTimezone`, а экран
  `to/readiness/screens/reports-screen.tsx:29-49` считает границы периода
  календарными днями тенанта осознанно (там даже в комментарии описано, почему
  прежний `new Date('…T00:00:00')` был ошибкой). С другой стороны, ровно те же
  ошибки, от которых этот экран уже вылечен, живут в соседних файлах.
- Два независимых пласта нарушений. Первый — **день считается по UTC или по
  браузеру там, где он должен считаться по поясу тенанта**: из-за этого в .xlsx
  журнал забивки (подшиваемый документ), в период аналитики и в дату отчёта
  попадает соседний день. Второй — **числа и даты форматируются локальными
  однострочниками** (`toFixed(1)`, `toLocaleString('ru')`, `slice(0,10)`), из-за
  чего в PDF точек заместо запятой, а в экспорт дата уходит как `ГГГГ-ММ-ДД`.
- Топ-5:
  1. `modules/reports/application/queries/pile-passport.service.ts:421` (и
     `:299,448,456`) — «Дата забивки» и «Период забивки» в .xlsx берутся как
     UTC-день из ISO-момента: свая, забитая в 00:30 по Москве 26.09, уходит в
     печатный журнал 25.09.
  2. `components/piling/admin-analytics.tsx:44-45` — период «последние 7 дней»
     считается от UTC-сегодня: с 00:00 до 03:00 МСК окно аналитики сдвинуто на
     сутки назад.
  3. `components/piling/admin-reports/report-form-dialog.tsx:57` — дата отчёта по
     умолчанию тоже UTC-день: ночью админ заводит отчёт вчерашним числом.
  4. `lib/pdf-generator/format.ts:6-13` — `toFixed(1)` и `String(int)`: в PDF
     «12.5 шт/м.п.» и «1200 м» вместо «12,5» и «1 200».
  5. `components/piling/report-history.tsx:326,333` — на главном экране оператора
     («Мои отчёты») метры выводятся через `toFixed(1)`.

## Методика

Работа только чтением; изменён один файл — этот отчёт.

1. Контекст правил: `PRODUCT.md:50-52`, `src/lib/timezone.ts`, `src/lib/format.ts`.
2. Поиск анти-паттернов по области (операторские папки исключены фильтром):

```bash
cd /d/PillingR/wt-night
grep -rn "toLocaleString\|Intl\." src/components/piling src/lib/pdf-generator src/modules/reports src/services/reports/event-handlers.ts \
  --include=*.ts --include=*.tsx | grep -v "operator-dashboard\|components/piling/operator/"
grep -rn "toISOString" src/components/piling src/lib/pdf-generator src/modules/reports src/services/reports --include=*.ts --include=*.tsx
grep -rn "toFixed"   src/components/piling src/lib/pdf-generator src/modules/reports src/services/reports --include=*.ts --include=*.tsx
grep -rn "toLocaleDateString\|toLocaleTimeString\|dateStyle\|timeStyle" src/components/piling src/lib/pdf-generator src/modules/reports src/services/reports --include=*.ts --include=*.tsx
grep -rn "getTodayInTimezone\|formatDateInTimezone\|formatDateTimeInTimezone" src --include=*.ts --include=*.tsx | grep -v "lib/timezone.ts"
grep -rn "from '@/lib/format'" src/components/piling src/lib/pdf-generator src/modules/reports --include=*.ts --include=*.tsx
```

3. Отдельно проверялись форматы выгрузок: `src/lib/xlsx-writer.ts:75-80,150`
   (строки пишутся как `t="inlineStr"`, числа — как `<v>` с `numFmtId="0"`),
   `modules/reports/application/queries/report-query.service.ts` (CSV/Excel),
   `modules/reports/application/queries/pile-passport.service.ts` (журнал забивки),
   `src/services/reports/event-handlers.ts:356` (подпись Telegram).
4. Единицы измерения: сплошной поиск по всему скоупу:

```bash
grep -rn "шт/м.п.\|м/ч\|шт / м" src/components/piling src/lib/pdf-generator src/modules/reports src/services/reports --include=*.ts --include=*.tsx
grep -rn "engineHours\|engineHoursTotal\|nextMaintenanceAtHours" src/components/piling --include=*.tsx | grep -v operator
```

5. Дубли форматтеров искались сравнением тел функций с `src/lib/format.ts`
   (`formatNumber`, `formatPercent`, `formatFixed`, `formatHours`, `formatRuDate`).
6. Проверялись только те файлы, что открыты глазами (номера строк в таблице — из
   вывода этих команд; файлы с валидацией форматов вне области не читались).

## Находки

| # | severity | path:line | проблема | сценарий / почему это важно | предлагаемое исправление |
|---|----------|-----------|----------|------------------------------|--------------------------|
| 1 | критично | `src/modules/reports/application/queries/pile-passport.service.ts:421` (то же `:299,448,456`) | «Дата забивки» в .xlsx журнала забивки = `row.drivenAt.slice(0,10)`, а `drivenAt` — ISO-момент (`:233 toISOString()`), то есть UTC-день | Сваю забили в 00:30 МСК 26.09 → в UTC это 21:30 25.09 → в печатном и подшиваемом журнале стоит 25.09. Документ нормативной формы расходится с фактической датой | Считать день в поясе тенанта (`Intl.DateTimeFormat('en-CA', {timeZone})` либо `formatDateInTimezone`) до записи в ячейку |
| 2 | критично | `src/components/piling/admin-analytics.tsx:44-45` | Период «последние 7 дней» строится из `new Date().toISOString().slice(0,10)` — UTC-сегодня; `dateTo`/`dateFrom` уходят в `/api/admin/analytics/overview` | С 00:00 до 03:00 МСК UTC-день ещё вчерашний: диспетчер открывает аналитику ночью и последние сутки (включая закрытие смены) в период не попадают | `getTodayInTimezone(tenant.timezone)` + арифметика по календарному дню, как в `to/readiness/screens/reports-screen.tsx:38-45` |
| 3 | критично | `src/components/piling/admin-reports/report-form-dialog.tsx:57` | Дата отчёта по умолчанию: `new Date().toISOString().split('T')[0]` — UTC-день | Ночная смена 00:00-03:00 МСК: админ открывает форму создания отчёта и получает вчерашнюю дату в поле «Дата»; при сохранении отчёт ложится на неверный производственный день | `useState(editReport?.date || getTodayInTimezone(timezone))` |
| 4 | важно | `src/lib/pdf-generator/format.ts:6-13` | `formatNumber` = `String(int)` / `toFixed(1)`, `formatMeters` = `toFixed(1)`: точка вместо запятой и отсутствие пробела в разрядах | Через эти функции собраны все числа PDF (`single-pdf.ts:50-52,64-66,80-82,95`, `period-pdf.ts:35-37`): в подшитом отчёте «12.5 м.п.», «1200 м» — нарушение PRODUCT.md:51 | Заменить на `formatNumber`/`formatFixed` из `src/lib/format.ts` |
| 5 | важно | `src/modules/reports/application/queries/report-query.service.ts:458,490` (CSV — `:370`) | В экспорт отчётов дата пишется как строка из БД (`report.date` = `2026-09-25`, Prisma `String`), в .xlsx — как текст (`xlsx-writer.ts:80 t="inlineStr"`), а числа попадают в формат General (`xlsx-writer.ts:150 numFmtId="0"`) | Админ открывает выгрузку и видит даты в формате `ГГГГ-ММ-ДД`, а разделитель дробной части в числах зависит от настроек его Excel, а не от правил продукта | Писать дату строкой `ДД.ММ.ГГГГ` (или числом с явным `numFmtId` даты) и задать числовой формат с запятой |
| 6 | важно | `src/services/reports/event-handlers.ts:356` | В подписи Telegram `📅 Дата: <b>${escapeHtml(d.date)}</b>` — сырая строка `ГГГГ-ММ-ДД` (`d.date` из `src/lib/pdf-data.ts:148` = `Report.date`) | Диспетчер получает в чат «Дата: 2026-09-25» — единственная дата в уведомлении и та в машинном формате | `formatRuDate(d.date)` |
| 7 | важно | `src/components/piling/report-history.tsx:326,333,341` | Главный экран оператора: `{totalPileMeters.toFixed(1)}`, `{totalDrilling.toFixed(1)}`, `{report.totalDowntime}` | Точечная запятая на главном экране полевого пользователя: «12/12.5 шт/м.п.» и «2.5 ч» | `formatFixed(x, 1)` / `formatNumber` из `@/lib/format` |
| 8 | важно | `src/components/piling/report-history-detail-dialog.tsx:137,167` | `{drilling.meters} м.п.` и `{downtime.duration} ч` — сырые числа из DTO | Диалог деталей отчёта у оператора: «12.5 м.п.», «2.5 ч» | Обернуть в `formatFixed`/`formatNumber` |
| 9 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:260,310,396,397` (то же `:275,285,291`) | Итоги формы отчёта через `toFixed(1)`; пары записаны как «шт. / … м.п. сваи» и «шт. / … м» (бурение) | Админ сворачивает отчёт: числа с точкой, а единица пары не по правилу PRODUCT.md:52 («шт/м.п.») | `formatFixed`; подписи свести к «шт/м.п.» |
| 10 | важно | `src/components/piling/admin-reports/report-detail-dialog.tsx:76,83` | `pileLengthMeters(...).toFixed(1)} м × {count} шт. = {(…).toFixed(1)} м.п.` | Детализация отчёта у админа — все метражи с точкой | `formatFixed(x, 1)` |
| 11 | важно | `src/components/piling/admin-analytics-bits.tsx:68-69,78,81` | Локальный `fmtHours` на `toFixed(1)` («36.0 ч» / «2.5 дн.») и проценты через `toFixed` | Плитка «Надёжность ТО» на аналитике админа: «MTBF 36.0 ч», «Готовность парка 87.5%» — и точка, и лишний нуль | `formatHours` из `@/lib/format` (он же даёт «1 ч 30 мин») и `formatPercent` |
| 12 | важно | `src/components/piling/admin-reports/report-evidence-preview.tsx:95` | `<HeaderFact label="Смена" … sub={report.date} />` — ISO-дата выводится на экран как есть, при том что строкой выше (`:75`) та же дата показана через `formatDate` | В одной панели две даты в двух форматах: «25 сент. 2026 г.» и «2026-09-25» | `shortDate(report.date)` или `formatRuDate` |
| 13 | важно | `src/lib/pdf-generator/components.ts:243` | Футер PDF: `сформировано ${new Date().toLocaleString('ru-RU')}` — пояс процесса-генератора, а не тенанта | PDF, собранный сервером для Telegram (`event-handlers.ts:367`), подписывается временем сервера (обычно UTC), а не временем тенанта. Пояс процесса не проверялся (см. «Не проверено») | Передавать в генератор пояс/момент тенанта либо использовать `formatDateTimeInTimezone` |
| 14 | важно | `src/lib/timezone.ts:31-33` + вызовы | `formatDateInTimezone` по умолчанию `dateStyle: 'long'` → «25 сентября 2026 г.», что расходится с PRODUCT.md:50 (ДД.ММ.ГГГГ). Вызовы без своих опций: `to/readiness/screens/fleet-evidence-panel.tsx:54`, `maintenance-screen.tsx:131`, `readiness-centre.tsx:708,973`, `settings-workspace.tsx:477`, `settings/audit-section.tsx:104`, `permits-screen.tsx:259`, `defects-panel.tsx:204`, `reports-screen.tsx:513,549`, `shifts-screen.tsx:163` | Даты в ТО-контуре тенанта показаны длинным стилем — единый формат в продукте отсутствует | Либо привести PRODUCT.md к двум форматам (краткий/полный), либо задать в вызовах `day:'2-digit', month:'2-digit', year:'numeric'` |
| 15 | важно | `src/components/piling/monitoring/equipment-tile-block.tsx:156` | Моточасы: `${card.engineHoursTotal.toLocaleString('ru')} ч` — единица «ч» и локальный формат, хотя файл уже импортирует `formatFixed` и `formatHours` (`:8`) | Плитка мониторинга парка: «Моточасы 5701 ч» вместо «5 701 м/ч» (PRODUCT.md: единица моточасов «м/ч») | `formatFixed(hours, 0) + ' м/ч'` |
| 16 | важно | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:131,172,173` | Моточасы подписаны «ч» (`… ?? 'не получена'} ч`) | Оценка готовности: «Наработка: 5701 ч» вместо «м/ч» — расходится с `readiness-centre.tsx:284` в том же модуле | Единица «м/ч» |
| 17 | важно | `src/components/piling/to/readiness/screens/fleet-screen.tsx:187` | Моточасы «ч» | Экран парка ТО — та же непоследовательность единиц | «м/ч» |
| 18 | важно | `src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:156,174` | «Моточасы» и «Моточасы ТО» через `formatFixed(...) + ' ч'` | Карточка установки: подпись «Моточасы 5701 ч», хотя на соседнем экране `equipment-maintenance.tsx:162` та же величина — «м/ч» | «м/ч» |
| 19 | важно | `src/components/piling/admin-equipment/equipment-tile.tsx:109` | `{num(card.engineHoursTotal)} ч` | Плитка установки в списке — «ч» вместо «м/ч» | «м/ч» |
| 20 | важно | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:363-364` | `pushInt('Наработка моточасов', eq.engineHoursTotal, 'ч')` | Экспортная строка карточки установки: «Наработка моточасов: 5701 ч» | «м/ч» |
| 21 | важно | `src/components/piling/admin-reports/report-list-format.ts:8-23` (использование `admin-reports.tsx:70-73,153-160`) | `todayYmd`/`shiftYmd` считают день по браузеру (`getFullYear/getMonth/getDate`), а `report.date` — производственный день тенанта | Кнопки «Сегодня / Вчера / 7 дней» и период выгрузки фильтруют журнал отчётов по дню браузера: у пользователя с поясом, отличным от пояса тенанта, граница суток уезжает на сутки, а выгрузка (`report-query.service.ts:327-331`) уходит с другим диапазоном | Считать день в поясе тенанта (`getTodayInTimezone`/`tenantDay`) и не переиспользовать один набор дат для двух поясов |
| 22 | важно | `src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:137-144,152-153,162-163` | Границы телеметрии: `todayYmd`/`shiftYmd` по браузеру, а затем `new Date(`${from}T00:00:00`).toISOString()` — момент в поясе браузера | Диспетчер в другом поясе видит окно «7 дней», сдвинутое на часы относительно производственного дня тенанта; телеметрия за края смены теряется | Строить моменты от дня тенанта (как `instantInTimezone` в `to/readiness/shift-create-form.tsx:76-83`) |
| 23 | важно | `src/components/piling/to/readiness/screens/equipment-permit-matrix.tsx:105` | `validUntil: new Date(`${validUntil}T23:59:59`).toISOString()` — конец дня в поясе браузера | Допуск «действует до 15.12» получает момент окончания по часам того, кто его заводит, а не по поясу тенанта: для пояса +3/+7 срок истекает на часы раньше или позже заявленной даты. В остальном модуле для этого есть `instantInTimezone` | Использовать `instantInTimezone(validUntil, '23:59', tenant.timezone)` |
| 24 | важно | `src/components/piling/inspections/start-inspection-form.tsx:51,65` | `const today = () => new Date().toISOString().slice(0, 10)` как дата ЕО/ТО по умолчанию | Инженер ОТ заводит осмотр ночью (00:00-03:00 МСК) — запись ТО получает вчерашнюю дату; в журнале ТО день расходится с фактическим | `getTodayInTimezone(tenant tz)` |
| 25 | важно | `src/components/piling/admin-dashboard.tsx:62,66,239` | `getTodayInTimezone()` вызывается без пояса, то есть с умолчанием `Europe/Moscow` (`src/lib/timezone.ts:21`), хотя пояс тенанта доступен в приложении; в `rangeFor` (`:61-70`) день тенанта смешивается с браузерной арифметикой `setDate`/`toISOString` | Для тенанта не в Москве фильтр «Сегодня»/«7 дней» и признак «отчёт без фото за сегодня» (`:241`) считают чужие сутки. Сегодня продакшн — один тенант, поэтому «до второго тенанта» (AGENTS.md, trust model) | Прокидывать пояс тенанта в `getTodayInTimezone(tz)` и считать диапазон по календарным дням, не через `setDate`+`toISOString` |
| 26 | важно | `src/components/piling/report-form/use-report-form.ts:240` | `setDate(getTodayInTimezone())` — тоже без пояса тенанта (умолчание Москва) | Дата отчёта оператора по умолчанию верна только для московского тенанта: у восточного/западного тенанта по умолчанию подставляется вчера/завтра | Передавать пояс тенанта в форму отчёта |
| 27 | важно | `src/components/piling/briefings/briefing-journal-print.tsx:202` | «Дата составления» = `formatJournalDay(new Date().toISOString())`; сам `formatJournalDay` (`src/modules/operator-mobile/domain/briefing-journal-view.ts:91-95`) форматирует в поясе зрителя | Печатная форма журнала инструктажей (документ для проверяющего) получает дату составителя по часам его браузера, а не по производственному дню тенанта | Считать дату в поясе тенанта (или хотя бы тем же помощником, что и остальные даты документа) |
| 28 | мелочь | `admin-analytics-bits.tsx:84`, `admin-analytics.tsx:474`, `admin-equipment/equipment-table.tsx:12,104`, `admin-equipment/equipment-tile.tsx:15,17`, `monitoring/equipment-tile-block.tsx:156`, `to/meter-readings-panel.tsx:211` | Локаль `'ru'` вместо `'ru-RU'` (`toLocaleString('ru')`) | Сегодня `ru` разрешается в `ru-RU`, поэтому формат совпадает; но локалей в файлах две, и при смене дефолтов ICU поведение разъедется | Везде `'ru-RU'` или общий форматтер |
| 29 | мелочь | `src/components/piling/equipment-analytics.tsx:396-403` | `fmtHours` — побайтовый дубль `formatHours` из `src/lib/format.ts:23-30` | Два одинаковых правила «Ч ч М мин» разъезжаются при первой правке одного из них | Удалить локальный, импортировать `formatHours` |
| 30 | мелочь | `to/fuel-panel.tsx:41-45`, `to/meter-readings-panel.tsx:26-30`, `to/to-module-bits.tsx:92-97` | Три одинаковых `fmtDate` с `toLocaleDateString('ru-RU', {day,month,year})` | Три копии одного формата на трёх экранах ТО; на `Date`-моментах они показывают пояс браузера | Оставить одну (например, `formatRuDate` + разбор момента в поясе тенанта) |
| 31 | мелочь | `src/components/piling/admin-reports/report-list-format.ts:19-23,30-39,48-50` | Локальные `shortDate`, `formatIsoDateTime`, `formatPercentValue` дублируют правила `src/lib/format.ts` (дата/число/процент) | Журнал отчётов и панель доказательств не переиспользуют общие правила: правка формата в `lib/format` их не затронет | Оставить в этом файле только специфичное (`shiftLabel`), остальное — из `@/lib/format` |
| 32 | мелочь | `src/lib/pdf-generator/format.ts:15-20` | `formatRuDate` PDF-генератора — вторая реализация того же формата, что `src/lib/format.ts:56` | Даты PDF и экранов форматируются разным кодом (разное поведение на пустом/битом значении) | Импортировать `formatRuDate` из `@/lib/format` |
| 33 | мелочь | `src/components/piling/report-history.tsx:149-155` | `new Date(dateStr).toLocaleDateString('ru-RU', …)` для строки вида `YYYY-MM-DD` — разбор как UTC-полуночи с отображением в поясе браузера | Для поясов западнее UTC это вчерашний день; в проекте для таких строк уже есть `formatRuDate`, который режет дату без `new Date` (`src/lib/format.ts:50-60`) | `formatRuDate(report.date)` |
| 34 | мелочь | `src/components/piling/admin-reports/admin-reports.tsx:191` (использование `:433`) | `new Date(d).toLocaleDateString('ru-RU', { day:'numeric', month:'short', year:'numeric' })` → «25 сент. 2026 г.» | Дата в диалоге подтверждения удаления отчёта — не по правилу продукта | `formatRuDate` |
| 35 | мелочь | `src/components/piling/admin-reports/report-list-format.ts:19-23` (`report-evidence-row.tsx:192`, `report-evidence-preview.tsx:166`) | `shortDate` показывает «25.09» — без года | В журнале отчётов за разные годы две записи от 25.09 неразличимы | Добавлять год, когда запись не текущего года, либо показывать `ДД.ММ.ГГГГ` |
| 36 | мелочь | `src/components/piling/admin-analytics.tsx:188` | Подпись недели тренда: `w.weekStart.slice(5)` → «09-01» | Ось/таблица трендов показывает дату в формате `ММ-ДД` (плюс `LineChart` в `:270` собирает `день` из `d.date.slice(8)+'.'+slice(5,7)`) | Задать единый формат подписи (`ДД.ММ`) через общий помощник |
| 37 | мелочь | `src/components/piling/pile-journal/index.tsx:178` | Имя файла выгрузки: `new Date().toISOString().slice(0,10)` — UTC-день | Имя файла `zhurnal-zabivki-svay-2026-09-25.xlsx` не совпадает с производственной датой тенанта | День в поясе тенанта |
| 38 | мелочь | `src/components/piling/pile-journal/index.tsx:325`, `pile-journal/pile-detail.tsx:46,81` | `new Date(row.drivenAt).toLocaleDateString('ru-RU')` — пояс браузера | Журнал забивки на экране и в карточке сваи датируется по часам зрителя (в отличие от выгрузки, где ошибка иного рода — см. №1) | Разбирать момент в поясе тенанта / использовать общий помощник |
| 39 | мелочь | `src/components/piling/to/readiness-design-views.tsx:283,481` | «Сегодня · {new Date().toLocaleDateString('ru-RU')}» и «Срез · {new Date().toLocaleString('ru-RU')}» | Две метки времени в интерфейсе готовности — по часам браузера, а не тенанта | Общий помощник с поясом тенанта |
| 40 | мелочь | `admin-incidents/admin-incidents.tsx:49-51`, `feedback-center.tsx:57-65`, `admin-dlq.tsx:111-114` | Три одинаковых однострочника «ISO → `ДД.ММ.ГГГГ, ЧЧ:ММ`» | Три копии одного правила в трёх контурах | Один помощник (расширить `src/lib/format.ts` или `formatDateTimeInTimezone`) |
| 41 | мелочь | `admin-equipment/detail/equipment-to-tab.tsx:34`, `admin-dictionaries/dictionary-table.tsx:118,228`, `admin-users/admin-users.tsx:65`, `admin-users/user-detail.tsx:29` | Ещё пять локальных форматтеров даты/даты-времени (часть — `Intl.DateTimeFormat` с явным `ru-RU`, часть — `toLocaleDateString`) | Правило формата размножено; при смене стиля часть экранов отстанет | Свести к общим помощникам |
| 42 | мелочь | `src/components/piling/inspections/run-inspection.tsx:345` | Моточасы подписаны «мч» (без слэша) | В карточке осмотра единица отличается и от «м/ч», и от «ч» | «м/ч» |
| 43 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:164-165` | «Сваи» — «шт. / … м.п.», «Бурение» — «шт. / … м»: у одинаковых по смыслу пар разные единицы | В одной плитке две пары «количество / метраж» подписаны по-разному (PRODUCT.md:52 — «шт/м.п.») | Единая подпись «шт/м.п.» для обеих пар (метраж бурения тоже пишется в м.п.) |
| 44 | мелочь | `src/components/piling/admin-users/user-documents.tsx:160` | `new Date(issuedAt)` (строка `YYYY-MM-DD` → UTC-полночь) + `setMonth` + `toISOString().slice(0,10)` | Автоподстановка срока действия документа: результат верен при текущих поясах (проверено рассуждением для UTC+3 и UTC-5), но смешивает UTC-полночь и календарную арифметику | Считать месяцы строкой даты или по UTC-полудню |

Приложение (прочие адреса из тех же серий, без описания):
`report-form-dialog.tsx:102,275,285,291` (остальные `toFixed` того же файла),
`report-query.service.ts:370` (CSV-дата),
`components/piling/to/readiness/screens/reports-screen.tsx:39,42,45,49` (RU-даты
через `dayToUtc` — корректно, приведено как образец),
`components/piling/admin-equipment/detail/equipment-monitoring.tsx:314`
(`${x.toFixed(1)},${y.toFixed(1)}` — координаты графика, пользователю не
показываются: находкой не считаю).

## Не проверено

- **Пояс времени процесса-генератора PDF.** Находка №13 предполагает, что
  серверный процесс идёт в UTC. Проверить не смог: `Dockerfile*` и
  `docker-compose*` для агента закрыты (AGENTS.md §1), `.env*` читать нельзя.
  Если в контейнере задан `TZ=Europe/Moscow`, находка №13 схлопывается до
  «подпись PDF не в поясе тенанта для не-московского тенанта».
- **Реальный рендер PDF/Excel.** Форматы проверены по коду, а не по открытому
  файлу: PDF не генерировал (нужны БД и запущенный сервер), .xlsx не открывал.
  Разделитель дробной части в Excel для ячеек с `numFmtId="0"` зависит от
  настроек зрителя — это утверждение об Excel, а не проверенный факт.
- **Отображение `Intl`-результатов в браузере.** Утверждения о виде строк
  («12,5», «1 200», «25 сентября 2026 г.») получены из параметров функций
  (`ru-RU`, `dateStyle: 'long'`), а не прогоном в браузере.
- **Пояса западнее UTC и переход на летнее время.** Оценка сценариев велась для
  поясов тенантов России (UTC+3…+12); поведение при DST/для западных поясов не
  проверял.
- **Операторские варианты экрана и ORION** — вне области по заданию (в
  найденных `operator-mobile/**` совпадения не разбирал, кроме одного файла,
  который понадобился как источник `formatJournalDay`).
- **Телеграм-уведомления помимо отчётов** (`src/core/notifications/**`) и
  API-роуты экспорта (`src/app/api/reports/export/**`) не читал: вне
  перечисленной области, поэтому формат заголовка CSV на сервере мог добавить
  находок к №5.
- **Полнота охвата файлов.** Проверялись адреса из перечисленных в «Методике»
  поисков; файлы, в которых не встретился ни один шаблон, глазами не открывал,
  — «нет находок» там означает «нет совпадений с шаблонами», а не «формат верен».
