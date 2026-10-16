# AU254-S6-ANALYTICS-EMPTY-PERIODS: Аналитика — пустые периоды

**Версия кода:** `d807db6c57e0dbefab0d290e7da26ce45cec0398` (HEAD)  
**Дата аудита:** 2026-10-11  
**Методика:** только чтение кода (rg + read_file), без запуска приложения и БД.

---

## Итог

Всего находок: **14** (критично: 1, важно: 6, мелочь: 7).

**Топ-5 по риску:**
1. **КРИТИЧНО** — `src/app/api/admin/analytics/overview/route.ts:188-194` — дневной ряд `daily` всегда возвращает нули для дней без отчётов; нет различия «нет данных» vs «ноль м.п.». График показывает ложную активность.
2. **ВАЖНО** — `src/components/piling/admin-analytics.tsx:228-232` — `periodEmpty` считается только когда *все* три условия пусты (операторы, объекты, дневной ряд нулевой). День с `meters: 0` в ряду маскирует отсутствие отчётов.
3. **ВАЖНО** — `src/components/piling/admin-analytics.tsx:430-431` — вкладка «Тренды» (`SiteWeeklyTrend`) показывает `EmptyState` только когда `trendChartData.length === 0`. Если проекция отстала/пуста, а живые отчёты есть — пользователь видит «Нет данных за недели», хотя данные есть.
4. **ВАЖНО** — `src/services/analytics/site-analytics-service.ts:87-95` — `getSiteAnalytics` возвращает `actualPiles: 0` и `actualPileMeters: 0` для объектов без отчётов в периоде. Нет флага «период пуст для этого объекта».
5. **ВАЖНО** — `src/components/piling/equipment-analytics.tsx:178-183` — KPI плитки («Сваи», «Бурение», «Топливо») показывают `0` / `—` без индикатора «нет отчётов за период». Пользователь не отличает «работали, выработали 0» от «не работали».

---

## Методика

Поиск проводился по ключевым путям аналитики:
- `src/app/api/admin/analytics/**` — API обзора, недельных трендов
- `src/app/api/analytics/sites/route.ts` — сводка по объектам
- `src/app/api/admin/equipment-analytics/route.ts` — аналитика по установкам
- `src/app/api/maintenance/kpi/route.ts` — KPI ТО
- `src/services/analytics/**` — сервисы агрегации (site-analytics-service, equipment-analytics-service)
- `src/modules/reports/application/projections/**` — проекции `SiteDailySummary`, `SiteWeeklyTrend`
- `src/components/piling/admin-analytics.tsx` — главный экран аналитики (recharts)
- `src/components/piling/equipment-analytics.tsx` — экран аналитики парка
- `src/components/piling/admin-analytics-bits.tsx` — `EmptyState`
- `src/components/piling/analytics-dashboard/kpi-widgets.tsx` — KPI плитки с дельтами

Исключены замороженные зоны (operator screen variants, ORION site) по AGENTS.md.

---

## Находки

| # | Серьезность | График / API | Файл:строка | Пустой период | Текст / поведение | Риск / сценарий | Предлагаемый фикс |
|---|-------------|--------------|-------------|---------------|-------------------|-----------------|-------------------|
| 1 | **КРИТИЧНО** | Динамика погонных метров (LineChart) | `src/app/api/admin/analytics/overview/route.ts:188-194` | Все дни периода возвращаются, дни без отчётов → `meters: 0` | `daily` массив всегда длиной `days`, пропуски заполнены нулями. `byDay.get(date) ?? 0` | График показывает «плоскую линию в нуле» вместо пропусков. Пользователь не видит, какие дни рабочие, а какие нет отчётов. | Вернуть `meters: null` для дней без отчётов; на клиенте `LineChart` с `connectNulls={false}` покажет разрывы. |
| 2 | **ВАЖНО** | Общий экран «Аналитика» — определение пустого периода | `src/components/piling/admin-analytics.tsx:228-232` | `periodEmpty = operators.length===0 && siteRating.length===0 && daily.every(d=>d.meters===0)` | Требует одновременной пустоты во всех трёх источниках. Если есть хоть один оператор или объект — период не считается пустым. | Период с 1 отчётом (meters=0) не помечается пустым, но график показывает нули. `EmptyState` не появляется. | Разделить понятия: «нет отчётов вовсе» vs «есть отчёты, но метры=0». Добавить флаг `hasAnyReport` в API. |
| 3 | **ВАЖНО** | Вкладка «Тренды» (SiteWeeklyTrend) | `src/components/piling/admin-analytics.tsx:430-431` | `trendChartData.length === 0` → `EmptyState: "Нет данных за недели. Числа появятся, когда поступят отчёты."` | Проекция `SiteWeeklyTrend` обновляется воркере (интервал 1 ч) и ночной пересборкой. Есть лаг до ~1 ч. | Живые отчёты уже есть, а тренд пуст — пользователь видит ложное «нет данных». Наоборот: тренд есть, но отчёты удалены — тренд показывает старые числа. | В API `/site-weekly-trend` возвращать `staleAt` / `source: 'projection'`. На клиенте подпись «Данные тренда на <время>». |
| 4 | **ВАЖНО** | Сводка по объектам `/api/analytics/sites` | `src/services/analytics/site-analytics-service.ts:87-95` | `COALESCE(p.total_piles, 0)::int AS "actualPiles"` — всегда 0, если нет отчётов | Нет поля `hasReportsInPeriod` или `reportCount` в периоде (есть только `totalReports` — all-time). | UI не может отличить «объект простаивал (0 свай)» от «объект не работал (нет отчётов)». | Добавить в выборку `periodReportCount` (аналог `rc.report_count` но уже есть — возвратить его). |
| 5 | **ВАЖНО** | Аналитика по установкам — KPI плитки | `src/components/piling/equipment-analytics.tsx:178-183` + `kpi-widgets.tsx:86-92` | `fleet.piles=0`, `fleet.pileMeters=0`, `fleet.fuelLiters=0` → плитки показывают `0` / `—` | `periodHint` в `kpi-widgets.tsx:91-92` пишет «нет данных для сравнения» только для дельты, не для базового значения. | Пользователь видит «Сваи 0 шт. / 0 м.п.» и не знает: это за период выработали 0 или отчётов нет. | В `getEquipmentAnalytics` вернуть `periodReportCount`; на клиенте если 0 — подпись «нет отчётов за период». |
| 6 | **ВАЖНО** | Рейтинг объектов (siteRating) | `src/app/api/admin/analytics/overview/route.ts:211-220` | Объекты без отчётов в периоде **не попадают** в `siteRating` | `bySite` заполняется только из `rows` (отчётов). Пустые объекты отсутствуют. | Рейтинг показывает только активные объекты. Закрытые/простаивающие без отчётов исчезают из списка. | LEFT JOIN к Equipment/Site в SQL или пост-обработка: добавить объекты с `meters: null`. |
| 7 | **ВАЖНО** | Операторы — таблица топ-10 | `src/components/piling/admin-analytics.tsx:362-368` | `overview?.operators.length === 0` → `EmptyState: "За выбранный период нет данных по операторам"` | Правильно: пусто = нет отчётов. Но если есть отчёты с `piles=0` — оператор в таблице с нулями. | Непоследовательно с графиком: график показывает нули как данные, таблица — как пусто. | Унифицировать: везде `hasReports` флаг. |
| 8 | **МЕЛОЧЬ** | Использование установок (equipmentUsage) | `src/app/api/admin/analytics/overview/route.ts:196-209` | `activeDays = 0` → `usagePct = 0%` для всех установок | Установки без отчётов в периоде получают `0%`. Нет различия «не работала» / «нет отчётов». | Та же проблема: 0% читается как «работала 0 дней», а не «нет данных». | Добавить `hasReports` или `reportCount` в объект `equipmentUsage`. |
| 9 | **МЕЛОЧЬ** | Простои по причинам (Pareto) | `src/components/piling/equipment-analytics.tsx:369-377` | `rows.length === 0` → `"Простоев за период нет."` | Правильно отличает пусто от нуля (причина с 0 часов не попадает в массив). | Хороший пример — оставить как есть. | — |
| 10 | **МЕЛОЧЬ** | ТО проблемные установки | `src/components/piling/admin-analytics.tsx:494-496` | `kpi.topProblemRigs.length === 0` → `"Отказов за период не зафиксировано."` | Текст явно говорит «не зафиксировано», а не «0». | Хороший пример — оставить как есть. | — |
| 11 | **МЕЛОЧЬ** | KPI плитки «Сваи»/«Бурение» в дашборде | `src/components/piling/analytics-dashboard/kpi-widgets.tsx:107-112` | `periodHint` возвращает «нет данных для сравнения» когда `deltaPct == null` | Только для дельты сравнения с прошлым периодом. Базовое значение `0` не помечается. | Пользователь видит «Сваи 0 шт. / 0 м.п. за сегодня» и не знает, есть ли отчёты. | Добавить `periodReportCount` в `AnalyticsKpiData` и показывать «нет отчётов» при 0. |
| 12 | **МЕЛОЧЬ** | Дневная сводка `SiteDailySummary` | `src/services/reports/event-handlers.ts:232-237` | `reportCount === 0` → `deleteMany({ siteId, date })` — строка удаляется | При удалении последнего отчёта за день строка стирается. Проекция не хранит «день был, отчётов 0». | График по `SiteDailySummary` будет иметь дыры (нет строки) — recharts может соединить соседние дни. | Не удалять, а писать `reportCount: 0, totalPiles: 0...` — тогда клиент видит «день есть, отчётов 0». |
| 13 | **МЕЛОЧЬ** | Недельный тренд `SiteWeeklyTrend` пересборка | `src/modules/reports/application/projections/rebuild.ts:158` | `pilesTrend: null, drillingTrend: null, downtimeTrend: null` при полной пересборке | Живой обработчик (`projection-handlers.ts:106-132`) считает тренд при `dailySummaries.length >= 2`. Пересборка пишет `null`. | После ночной пересборки стрелки тренда исчезают до следующего часового прохода (~1 ч). | В `rebuild.ts` тоже считать тренд по `dailyMetrics` (как в `projectWeeklyTrend`). |
| 14 | **МЕЛОЧЬ** | `deltaPct` в обзоре | `src/app/api/admin/analytics/overview/route.ts:143-146` | `previous <= 0` → `deltaPct: null` | «нет базы — показываем ничего, а не фейковый %». | Правильно для дельты. Но базовое значение `current` может быть 0 при наличии отчётов — нет отличия. | См. №1, №2 — нужен флаг `hasReports` в периоде. |

---

## Не проверено

| Область | Причина |
|---------|---------|
| Поведение `recharts LineChart` при `null`/`undefined` в `dataKey` | Не запускал UI; документация recharts говорит про `connectNulls`, но реальный рендер не проверен. |
| Фактическое отставание `SiteWeeklyTrend` на проде (лаг проекции) | Нет доступа к прод-БД; в коде интервалы: event-driven (1-5 с) + hourly cron, но лаг не измерялся. |
| Кэширование `/api/analytics/sites` (Redis 5 мин) при пустом периоде | Код видно (`cache.ts:300`), но не проверял, как кэш ведёт себя при переходе «были отчёты → нет отчётов». |
| Экран `/admin/analytics` с правами non-admin (мастер/инженер ОТ) | Роли существуют в БД, но пользователей нет (админ выступает за них); поведение не проверялось. |
| Печать/экспорт аналитики при пустых периодах | `EquipmentAnalytics` имеет кнопку Print; что попадает в PDF при `data.fleet.piles=0` — не проверял. |
| Мобильные версии графиков (адаптив recharts) | Только десктопный код прочитан. |

---

## Приложение: остальные файлы (path:line only)

- `src/app/api/analytics/sites/route.ts:28-35` — кэш ключ включает период, но инвалидация только на событиях отчёта
- `src/services/analytics/equipment-analytics-service.ts:198-210` — `periodDays` считается, но `fleet` агрегаты не несут флага «есть отчёты»
- `src/lib/fleet-kpi.ts:108-110` — `availability = null` когда `fleetHours === 0` (правильно: null ≠ 0)
- `src/components/piling/admin-analytics.tsx:292-294` — `EmptyState` для общего обзора: «За выбранный период нет отчётов...»
- `src/components/piling/admin-analytics.tsx:480-481` — `EmptyState` для KPI ТО: «Нет данных ТО за период.»
- `src/components/piling/equipment-analytics.tsx:251-253` — FleetTable: «Нет установок за выбранный период.»