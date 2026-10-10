# AU37-S6-KPI-DEFINITIONS — откуда берутся показатели выработки и что такое «отправленный отчёт»

Версия кода: `git rev-parse HEAD` рабочей папки `D:\PillingR\wt-night` (ветка `hermes/q4-0926`).

```
629f6afa612db1a83c0b4f7b18f86182fc8d6bf2
```

Независимый первый проход: существующие отчёты в `docs/audits/`, `CODEX-REPORT*` и
`docs/strategy` не читались.

## Итог

Найдено 19 находок: 1 критичная, 7 важных, 11 мелочей (см. «Находки»). Канон
«в показатели идут только отправленные отчёты» (`SUBMITTED_REPORT_STATUS = 'submitted'`,
`src/lib/report-status.ts:2`) выдержан во **всех агрегатных KPI** (дашборд, аналитика,
парк, тренды, дневная сводка, 30-дневный KPI карточки). Расхождения — на периферии:

1. **PDF за период**: строки таблицы печатают черновики, а итоги — только по сданным
   (`src/lib/pdf-data.ts:128-140` против `:170-182`). Подшитый документ не сходится сам с собой.
2. **CSV-выгрузка** не отделяет черновики от сданных (только текстовая колонка «Статус»),
   тогда как XLSX кладёт их на отдельный лист (`src/modules/reports/application/queries/report-export.service.ts:120-158`, `:319-342`, `:364`).
3. **«Сегодня» у парка** считается по жёстко заданному `Europe/Moscow`, а все прочие KPI —
   по поясу тенанта из настроек (`fleet-monitoring.service.ts:29,115` против `equipment-analytics-service.ts:146-149`).
4. **Парк предпочитает проекцию `ReportAnalytics`** сырым строкам отчёта — при отставании проекции
   карточка может показать устаревшее число (`fleet-monitoring.service.ts:277-287`).
5. **Плитка «Сваи» на дашборде**: числитель — факт за период, а прогресс — накопительный
   (`admin-dashboard.tsx:351`, `dashboard-kpis.ts:122-124`, `site-analytics-service.ts:191-196`).

## Методика

Работа только чтением. Команды (Git Bash, из корня рабочей папки):

```bash
git rev-parse HEAD
git status --short
grep -rn "SUBMITTED_REPORT_STATUS" src --include=*.ts          # 26 совпадений, 10 файлов
grep -rn "status: SUBMITTED_REPORT_STATUS" src --include=*.ts  # 6 фильтров
grep -rn "isSubmittedReport" src --include=*.ts --include=*.tsx # 12 использований
grep -rn "getSiteAnalytics\|/api/analytics/sites" src --include=*.ts --include=*.tsx
grep -rn "reportAnalytics|ReportAnalytics" src --include=*.ts
grep -rn "siteDailySummary|SiteDailySummary" src --include=*.ts
grep -rn "OperatorPerformance|SiteWeeklyTrend" src
```

Затем прочитаны (read_file) все найденные агрегаторы и их потребители:
`src/lib/report-status.ts`, `src/services/analytics/{site,equipment}-analytics-service.ts`,
`src/modules/reports/application/queries/{report-query.service,pile-journal-totals,pile-journal-export,report-export.service}.ts`,
`src/modules/reports/domain/period-summary.ts`, `src/modules/reports/application/projections/{rebuild,projection-handlers}.ts`,
`src/services/reports/event-handlers.ts`, `src/lib/pdf-data.ts`, `src/core/infrastructure/raw-queries.ts`,
маршруты `/api/reports/{pdf,period,all,export,my}`, `/api/analytics/sites`,
`/api/admin/analytics/{overview,site-weekly-trend}`, `/api/admin/equipment-analytics`, `/api/monitoring/fleet`
(`src/app/api/...`), `src/core/observability/lag-monitor.ts`,
`src/modules/{monitoring,equipment}/application/queries/*.ts`,
компоненты `src/components/piling/{admin-dashboard.tsx,dashboard-kpis.ts,admin-analytics.tsx,equipment-analytics.tsx,admin-reports/*,admin-sites/*}`,
`src/modules/operator-mobile/application/commands/shift-close.ts`.

Все приведённые `path:line` открыты и проверены на существование.

## Карта показателей (показатель → формула → источник → черновики → правка/удаление → период)

Легенда: Д — учитываются ли черновики; Δ — учитываются ли исправления (коррекции версии); Уд — удаление.

| Показатель | Формула | Источник | Д | Δ / Уд | Границы периода | Где |
|---|---|---|---|---|---|---|
| Сваи (факт) | Σ PileWork.count | Report+PileWork (live) | нет (status=submitted) | live-запрос, удаление отражается сразу | Report.date, сентинелы `0000-01-01`/`9999-12-31` = всё время | `site-analytics-service.ts:87,119-134` |
| Сваи, м.п. | Σ count × PileGrade.lengthMm/1000 | PileGrade | нет | live | Report.date | `site-analytics-service.ts:126,180`; длина только через `src/lib/pile-length.ts` |
| % свай (pileProgress) | min(100, Σcount_alltime / plannedPiles) | PileWork (всё время) + SitePilePlan | нет | live | **план и факт — накопительно, не режутся периодом** | `site-analytics-service.ts:127,191-196` |
| Бурение (факт) | Σ LeaderDrilling.meters / count | Report+LeaderDrilling | нет | live | Report.date | `site-analytics-service.ts:89-90,138-144` |
| Простой (часы) | Σ ReportDowntime.duration | Report+ReportDowntime | нет | live | Report.date | `site-analytics-service.ts:91,146-151` |
| Отчётов (в периоде) | COUNT(Report submitted) | Report | нет | live | Report.date | `site-analytics-service.ts:117-121` |
| KPI аналитики (метры/сваи/бурение) + Δ к пред. периоду | Σ по отчётам, границы [from,to] | Report (live, node) | нет (status=submitted) | live | Report.date, MAX 366 дней, пред. период равной длины | `admin/analytics/overview/route.ts:51-88,164-186` |
| Доля простоя, % | (часы×60 ÷ минуты смены)×100, обрезка 100% | Report со shiftStart/End | нет | live | Report.date | `admin/analytics/overview/route.ts:110-140` |
| Парк: сваи/бурение/простой «за сегодня» | Σ по отчётам сегодня | Report + (проекция `ReportAnalytics` как приоритет) | нет | проекция может отставать | «сегодня»/последние 7 дней, пояс `Europe/Moscow` (жёстко) | `fleet-monitoring.service.ts:195-201,266-302,29` |
| Парк: сваи/метры/бурение/простой (по установкам) | Σ по отчётам за [from,to] | Report (live) | нет | live | Report.date | `equipment-analytics-service.ts:70-124` |
| Сводка дня (SiteDailySummary) | Σ piles/drillings/downtimes по (site,date) | Report (live) | нет (status=submitted) | пересчёт при update/delete | Report.date | `event-handlers.ts:212-244`; `rebuild.ts:41-85` |
| Тренд недель (SiteWeeklyTrend) | Σ SiteDailySummary по ISO-неделе | SiteDailySummary | нет (наследует) | — | неделя Пн–Вс (UTC-арифметика) | `rebuild.ts:91-169`, `projection-handlers.ts:37-160` |
| Журнал отчётов (admin): суммы отбора | Σ по сданным | Report | нет (клиент/сервер фильтруют) | live | Report.date | `report-query.service.ts:92-122,153`; `admin-reports.tsx:287-289` |
| Период-экран `/api/reports/period` summary | Σ по сданным | Report (live) | **нет для summary, но отчёт: строки включают черновики** | live | Report.date | `period-summary.ts:31-53`; `period/route.ts:52-57` |
| PDF за период — итоги | Σ по сданным | Report (live) | нет | live | Report.date | `pdf-data.ts:128-140` |
| PDF за период — строки таблицы | все отчёты периода | Report | **да (в таблице)** | live | Report.date | `pdf-data.ts:162-182` |
| Выгрузка CSV/XLSX | все отчёты (строка = свая/бурение/простой) | Report | **да** (XLSX — лист «Черновики»; CSV — все строки) | live | Report.date | `report-export.service.ts:120-158,319-342,364` |
| Журнал забивки — «Свай всего» | Σ PileWork.count, включая черновики | PileWork+Report+PilePassport | **да** (отдельный счётчик «из них в черновиках») | live | occurredAt/receivedAt (timestamptz, пояс тенанта) | `pile-journal-totals.ts:58-82,147-148` |
| Карточка установки, KPI 30 дней | Σ по сданным | Report | нет | live | Report.date, cutoff = tenant «сегодня»−30 дней | `equipment-query.service.ts:98-100,117-120,146-160` |
| Карточка установки, timeline | все отчёты (до 1000) | Report | **да** | live | нет (вся история) | `equipment-query.service.ts:110-115,162-172` |
| История оператора `/api/reports/my` | per-report итоги | Report (live) | **да** | live | нет | `report-query.service.ts:306-325`; `my/route.ts:22-24` |
| Telegram: PDF сданного отчёта | Σ по строкам отчёта | Report (live) | нет (событие только ReportSubmitted) | коррекция помечается «ред. №v» | — | `event-handlers.ts:537-649` |
| Дрейф проекции (метрика) | status Report ≠ status ReportAnalytics | Report ⋈ ReportAnalytics | — | — | всё время | `lag-monitor.ts:161-181` |

## Находки

Severity: критично / важно / мелочь.

| # | severity | path:line | проблема | сценарий / чем плохо | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | `src/lib/pdf-data.ts:128-140` (итоги только сданные) и `:170-182` (в таблицу идут все отчёты из `getReportsByPeriod`); `src/core/infrastructure/raw-queries.ts:76-95` (нет фильтра status) | PDF за период печатает строки черновиков, а в шапке-итогах — только сданные | Сумма строк таблицы ≠ итог в шапке; подшитый документ противоречит сам себе, подрядчик не сходится в цифрах | Отфильтровать `reports` до `isSubmittedReport` перед печатью (или пометить строки-черновики и не включать их в видимую таблицу), либо считать итоги по тем же строкам |
| 2 | важно | `src/modules/reports/application/queries/report-export.service.ts:120-158` (нет фильтра status), `:319-342`, `:364` | CSV-выгрузка кладёт черновики и сданные в один поток; разделения итогов нет (XLSX — кладёт на отдельный лист) | Распечатанный CSV читается как «сделано», хотя часть смен не сдана → расходится с аналитикой | Добавить в CSV отдельный блок/колонку-итог по сданным, либо по умолчанию выгружать только сданные (как в KPI) с флагом «включить черновики» |
| 3 | важно | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:29,115,383-387` (`FLEET_TZ='Europe/Moscow'`) против `src/services/analytics/equipment-analytics-service.ts:146-149` (`zonedDayStartUtc(timezone)` из настроек) | «Сегодня» у парка считает границу суток по жёстко зашитой Москве; остальные KPI — по поясу тенанта | При тенанте в другом поясе парк и аналитика относят одну смену к разным дням → «сегодня» не совпадает | Брать TZ из `getSettings(tenantId)` (как везде), либо явно зафиксировать единый пояс тенанта в одном месте |
| 4 | важно | `fleet-monitoring.service.ts:277-287` | Для итогов дня парк предпочитает проекцию `ReportAnalytics`, а к сырым строкам падает только при её отсутствии | Проекция может отстать (`lag-monitor.ts:161-181` ловит status-mismatch) → карточка показывает устаревшие числа, хотя рядом посчитан живой отчёт | Считать из источника всегда (как `equipment-query.service.ts:135-145`), проекцию оставить как быстрый путь только при совпадении |
| 5 | важно | `src/components/piling/admin-dashboard.tsx:351`; `src/components/piling/dashboard-kpis.ts:122-124,313-314`; `src/services/analytics/site-analytics-service.ts:191-196` | Плитка «Сваи»/«Бурение»: числитель-«факт» берётся за период, а прогресс-полоса — накопительный (all-time против всего плана) | В режиме «7 дней» плитка показывает «факт за 7 дней» рядом с 90% выполнения по всему объекту — несоответствие в одной плитке | Подписать обе половины одного периода, либо показывать прогресс от явно названного «с начала объекта» |
| 6 | важно | `src/modules/reports/application/queries/pile-journal-totals.ts:58-61,147-148`; `pile-journal-export.ts:94-95` | «Свай (всего)» в журнале забивки включает сваи черновиков (черновики вынесены отдельным счётчиком) | Нормативный документ (СП 45.13330) печатает черновые сваи в общем итоге — расходится с KPI по объекту | Оставить как есть осознанно (это документ работ, а не KPI), но зафиксировать решение: либо «Свай (всего)» = только сданные, либо явно печатать «в т.ч. черновики» |
| 7 | важно | `pile-journal-totals.ts:74-81` (период по `occurredAt`/`receivedAt`) против `site-analytics-service.ts:119,125` (период по `Report.date`) | Журнал забивки режет период по моментам времени (пояс тенанта), а KPI — по дню-строке отчёта | Свая, забитая в 00:30 МСК, попадает в разные дни у журнала и у аналитики → сумма журнала за период ≠ аналитике за тот же период | Документировать/унифицировать определение дня; либо считать журнал по тому же `Report.date` |
| 8 | важно | `src/services/reports/event-handlers.ts:140-148`; `fleet-monitoring.service.ts:277-287` | Правка отчёта обновляет `ReportAnalytics` из `event.data` totals; если событие без totals — старые числа остаются, и парк их покажет | Коррекция (удаление строки свай) не пробьётся в проектную витрину → парк покажет прежнюю выработку | В обработчике всегда перечитывать суммы из строк Report (источник истины), а не брать из payload |
| 9 | мелочь | `src/modules/reports/application/projections/rebuild.ts:187-196` (rebuild всех статусов) против `:45-46` (SiteDailySummary — только сданные) | `ReportAnalytics` пересобирается по всем отчётам, читатели обязаны фильтровать `status` | Если читатель забудет фильтр — черновик попадёт в агрегат; лаг-монитор это лишь фиксирует | Оставить (проекция зеркалит статус-источник), но все чтения обязаны фильтровать; добавить тест на фильтр |
| 10 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:118` (KPI 30 дней — сданные) против `:110-115,162-172` (timeline — все) | На карточке установки 30-дневный KPI считает сданные, а «история» рисует черновики как обычные строки без пометки | Админ видит в истории сваи, которых нет в KPI → «данные потерялись» | Помечать строку-черновик в timeline (как в admin-reports/журнале) |
| 11 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:306-325`; `src/app/api/reports/my/route.ts:22-24` | «Мои отчёты» отдают per-report итоги без фильтра статуса и без разделения | Оператор видит свои черновики наравне со сданными (статус в строке есть, но агрегата нет) | Не критично (per-report), но держать в уме при добавлении итогов |
| 12 | мелочь | `fleet-monitoring.service.ts:287` против `admin/analytics/overview/route.ts:110-140` | «Простой» в парке — сумма часов; «доля простоя» в аналитике — только по отчётам с известным временем смены | Разные знаменатели у одной темы «простой» → числа не сводятся | Подписать/унифицировать: либо доля по всем отчётам, либо сумма часов рядом |
| 13 | мелочь | `src/app/api/analytics/sites/route.ts:26-33`; `src/services/reports/event-handlers.ts:50-52` | Redis-кэш `/api/analytics/sites` (5 мин) сбрасывается только событиями submit/update/delete | Правка данных вне событий (ручной rebuild/миграция) до 5 мин не видна на дашборде | Сбрасывать кэш и в `POST /api/admin/projections/rebuild` |
| 14 | мелочь | `src/app/api/reports/delete/route.ts:164-166` | Удаление отчёта чистит `ReportAnalytics`, но `SiteDailySummary` пересчитывается отдельным вызовом; при сбое проекция держит удалённый день | Фантомный день в дневной/недельной проекции до следующего rebuild | Пересчёт в одной транзакции с удалением либо пометка о необходимости rebuild |
| 15 | мелочь | `src/services/analytics/equipment-analytics-service.ts:150-168` | Топливо берётся из телеметрии (dormant): без бокса `fuelLiters=0` входит в суммы парка | На экране «Топливо» = «—», но fleet.fuelLiters=0 всё равно суммируется | Показывать «—»/не суммировать отсутствующий источник (уже так на плитке, но сумма иная) |
| 16 | мелочь | `src/services/analytics/site-analytics-service.ts:44-50,85-88` | Планы не режутся периодом (это цель объекта), факт — режется; на дашборде «факт (период)» стоит рядом с «план (весь объект)» | Периодное сравнение факта с планом объекта вводит в заблуждение | Подписывать план как «цель объекта, весь срок» рядом с периодным фактом (частично сделано в docs меню) |
| 17 | мелочь | `src/services/reports/event-handlers.ts:30-52` | `ReportCreated` (draft) тоже пишет `ReportAnalytics` | Проекция создаётся для черновика сразу; риск, что читатель без фильтра учтёт её | Оставлять, но гарантировать фильтр в чтениях |
| 18 | мелочь | `src/modules/operator-mobile/application/commands/shift-close.ts:333-335` | Totals события `ReportSubmitted` считаются из строк на момент закрытия смены | Правка отчёта позже эмитит `ReportUpdated`; если тот потерян — проекция держит устаревшие totals | (совпадает с #8) — считать из источника в обработчике |
| 19 | мелочь | `src/core/observability/lag-monitor.ts:161-181,368-374` | Метрика status-mismatch считает расхождение, но `tenantId` только из контекста; при отсутствии контекста RLS вернёт 0 строк | Ложный «ноль расхождений» там, где контекст не выставлен | Не полагаться на метрику как на доказательство отсутствия дрейфа (уже есть `forEachTenant`) |

## Не проверено

- **Числовые значения на прод-данных не проверялись** — нет доступа к БД (запрещено правилами и
  отсутствует окружение). Все выводы о формулах и фильтрах статические, по коду; реальные
  расхождения чисел подрядчик должен подтвердить на боевой базе.
- **Не запускались** `npx tsc --noEmit`, `npm run test:unit`, `npx playwright test`, `npm run build` —
  задача read-only, приложение не менялось; сборку/тесты не гонял.
- **`docs/audits/**` (все прежние отчёты), `CODEX-REPORT*`, `docs/strategy` не читались** — по условию
  независимости первого прохода; возможны пересечения с уже известными находками, я их не сверял.
- **Клиентские отрисовки чисел** (форматирование `formatCountMeters`, округления `toFixed(1)`/`round1`)
  прочитаны лишь в агрегаторах; визуальная сверка «одно число на двух экранах» в браузере не делалась.
- **`/api/reports/[id]/history`** (история версий отчёта) и `src/lib/pdf-generator/*` как рендер
  не читались построчно — в карту не попали их внутренние суммы; если они считают свои totals,
  это отдельная непроверенная точка.
- **Readiness/смена (`src/modules/*` readiness, operator-mobile)**: искал `выработк/КПД/производительн`,
  агрегата выработки там не нашёл своей формулой — но полноту не гарантирую (не проверено).
- **Телеметрия топлива**: реальный расход не проверялся (боксы не подключены, `TelemetryRecord` пуст —
  взято из комментариев кода, не из данных).
- **Кэш-projectora**: фактическое поведение Redis-кэша `analytics:sites` и его сброса в рантайме
  не воспроизводилось (нет запущенного Redis/приложения).
