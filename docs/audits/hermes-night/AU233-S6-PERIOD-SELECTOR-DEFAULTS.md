# AU233-S6-PERIOD-SELECTOR-DEFAULTS — Выбор периода: значения по умолчанию

Версия (git rev-parse HEAD): `af1c8f0c008729804728fa51db0cc5ef942487d4`
Ветка: `hermes/q4-0926`. Только чтение, код не менялся.

## Итог

Резюме для владельца:

1. Период по умолчанию на каждом экране свой: Аналитика — 7 дней, Дашборд — «весь период», Аналитика по технике — 30 дней, Журнал отчётов — без периода, Журнал инструктажей — текущий месяц, Отчёты — 30 дней, Телеметрия техники — 7 дней.
2. Часовой пояс по умолчанию расходится: часть экранов берёт пояс организации, часть — жёстко «Москва», один (Аналитика по технике) — часы браузера. Прод однотенантный и на МСК, поэтому сегодня это не ломается, но при втором тенанте или смене пояса в настройках цифры разъедутся.
3. «Сегодня» не пересчитывается после полуночи на экранах, где период закреплён в `useState`/`useMemo` (Дашборд, Аналитика по технике, Телеметрия, Журнал инструктажей) — открытая на ночь вкладка утром показывает вчерашний день.
4. Недельные «Тренды» строят бакет недели по UTC-«сейчас», а не по поясу организации: в первые 3 часа после местной полуночи в понедельник обновляется прошлая неделя.
5. Найденных критичных дефектов нет; 5 «важно» и 6 «мелочь». Серверные границы суток (KPI, топливо, фильтры допуска, отчёты) в основном считают по поясу организации — это правильно.

Счёт по важности: критично — 0, важно — 5, мелочь — 6, гипотеза — 1.

## Методика

- `git rev-parse HEAD`, `git status` — зафиксирована версия.
- Поиск по `src` (`rg`) по шаблонам: `dateFrom|dateTo|Period|Период|period=`, `getTodayInTimezone|todayYmd|shiftYmd|currentMonthRange|dayRangeToInstants`, `new Date().toISOString().slice(0,10)|toLocaleDateString('en-CA')`, `'Europe/Moscow'`, `FLEET_TZ`, `zonedDayStartUtc`.
- Прочитаны целиком/по диапазонам: `src/lib/timezone.ts`, `src/app/api/admin/analytics/overview/route.ts`, `src/app/api/maintenance/kpi/route.ts`, `src/services/analytics/{site,equipment}-analytics-service.ts`, `src/modules/monitoring/application/queries/fleet-monitoring.service.ts`, `src/modules/reports/application/projections/{projection-handlers,projection-worker}.ts`, `src/modules/operator-mobile/domain/briefing-journal-view.ts`, `src/components/piling/{admin-analytics,admin-dashboard,equipment-analytics}.tsx`, `src/components/piling/admin-reports/*`, `src/components/piling/admin-equipment/detail/{equipment-monitoring,equipment-report-export}.tsx`, `src/components/piling/to/readiness/screens/{reports,briefings,shifts}-screen.tsx`.
- `src/modules/operator-mobile/**` (включая `mobile-shift-query.ts`) — замороженная зона по AGENTS.md §1, в выводы не включён.
- Проверка тестами (числа из команды): `node node_modules/vitest/vitest.mjs run src/lib/__tests__/format.test.ts src/modules/readiness/application/__tests__/read-filters.test.ts src/modules/operator-mobile/domain/__tests__/operator-mobile-rules.test.ts src/modules/settings/__tests__/settings.test.ts` → Test Files 4 passed (4), Tests 90 passed (90), skipped 0, exit code 0.

## Находки

Важность: критично / важно / мелочь. Статус: ПРОЙДЕНО — проверено по коду; ГИПОТЕЗА — прямо не подтверждено.

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое решение |
|---|---|---|---|---|---|
| 1 | важно | src/components/piling/admin-dashboard.tsx:123 (и 177-179) | `range` (режимы «Сегодня»/«7 дней») считается в `useMemo` с зависимостями `[periodMode, customFrom, customTo]` — без текущей даты; авто-обновления нет (`setInterval`/`visibilitychange` в файле отсутствуют, интервал не найден: `rg setInterval` по файлу — пусто) | Диспетчер оставил дашборд на ночь в режиме «Сегодня». После полуночи карточка «за сегодня» продолжает показывать вчерашний день, пока он вручную не сменит фильтр или не обновит страницу. | Пересчитывать `range` по таймеру/на `visibilitychange` либо добавить текущий день тенанта в зависимости мемо. |
| 2 | важно | src/components/piling/admin-analytics.tsx:65 (импорт :27) | Период по умолчанию — последние 7 дней; «сегодня» берётся `getTodayInTimezone()` без аргумента, т.е. жёстко `Europe/Moscow` (src/lib/timezone.ts:21), а не `tenant.timezone` | У организации с поясом ≠ МСК (или при втором тенанте) границы периода разъедутся с серверным KPI: `/api/maintenance/kpi` считает сутки по поясу тенанта (src/app/api/maintenance/kpi/route.ts:53-55), а клиент присылает даты по Москве. | Передавать пояс тенанта (как в `reports-screen.tsx:115`) в `getTodayInTimezone`. |
| 3 | важно | src/components/piling/equipment-analytics.tsx:70-72, 84-85 | Период по умолчанию 30 дней; `todayYmd()`/`shiftYmd()` считают по локальным часам браузера (`getFullYear/getMonth/getDate`), границы зафиксированы в `useState` на монтировании | Браузер не в поясе тенанта → даты `dateFrom/dateTo` не совпадают с производственным днём сервера; открытая на ночь вкладка не сдвинет «сегодня». | Брать пояс тенанта (bootstrap `tenant.timezone`) и пересчитывать границы при смене дня. |
| 4 | важно | src/modules/reports/application/projections/projection-handlers.ts:41-52 (+ вызов src/modules/reports/application/projections/projection-worker.ts:190) | Бакет недели при часовом пересчёте строится от `new Date()` в UTC: `reference.getUTCDay()`, а не по поясу организации (`projectWeeklyTrend(site.id, null, tenantId)` передаёт `refDate = null`) | В 00:00–02:59 МСК понедельника UTC ещё воскресенье → пересчитывается прошлая неделя, а новый бакет появляется только с первым отчётом недели. Вкладка «Тренды» первые часы показывает прошлую неделю как последнюю. | Считать опорную дату по поясу тенанта (или передавать дату производственного дня вместо `null`). |
| 5 | важно | src/components/piling/to/readiness/screens/briefings-screen.tsx:115 (+ функция src/modules/operator-mobile/domain/briefing-journal-view.ts:98-110) | Период по умолчанию — текущий месяц; `currentMonthRange()` считает месяц по локальному времени (`getFullYear/getMonth/getDate`) и мемоизирован на монтировании `useMemo(..., [])` | Тот же экран в статистике (:206) уже берёт пояс тенанта, а границы периода — по браузеру: у пользователя не в МСК «последний день месяца» разойдётся с данными. После полуночи месяц не сменится без перезагрузки. | Использовать `tenant.timezone` и не мемоизировать `[]`. |
| 6 | мелочь | src/components/piling/admin-reports/report-list-format.ts:14-16 (+ admin-reports.tsx:236-257) | Фильтр «Сегодня» — `todayYmd()` через `getTodayInTimezone()` (жёстко МСК); `filteredReports` — `useMemo` без зависимости от даты | Открытая ночью вкладка «Сегодня» не сдвинется; пояс жёстко МСК. | Пояс тенанта + пересчёт по смене дня. |
| 7 | мелочь | src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:139, 151-152 | Период по умолчанию 7 дней; «сегодня» — `getTodayInTimezone()` (МСК), значения в `useState` на монтировании | Ночью открытая карточка техники не сдвинет окно; пояс жёстко МСК. | Пояс тенанта + пересчёт границ. |
| 8 | мелочь | src/modules/monitoring/application/queries/fleet-monitoring.service.ts:29, 114-116 | «today» и «активна сегодня» считает жёстко `FLEET_TZ = 'Europe/Moscow'` (комментарий «single-tenant prod runs on MSK time»), а не `settings.timezone` | При втором тенанте другой пояс → статусы техники «активна/ожидаем/простой» считаются по чужому дню → ложные «простой». | Прокинуть пояс тенанта в `getFleetSnapshot`/`ymd`. |
| 9 | мелочь | src/lib/format.ts:86-92 (`daysUntil`/`dueText`) | «Сегодня» считается жёстко `timeZone: 'Europe/Moscow'` | Сроки ТО («просрочено»/«через N дн.») на дашборде (admin-dashboard.tsx:216) привязаны к МСК, а не к поясу тенанта. | Принимать пояс параметром. |
| 10 | мелочь | src/modules/safety/application/clearance-overview-query.ts:164 | «Сутки — московские» жёстко `timeZone: 'Europe/Moscow'` для «сегодня» в сводке допуска | Для тенанта не в МСК сводка «за сегодня/30/60 дней» смещена. | Брать `settings.timezone`. |
| 11 | мелочь | src/components/piling/to/readiness/screens/reports-screen.tsx:57-60, 116 | Период по умолчанию 30 дней считается в рендере по поясу тенанта (это верно), но ничем не пересчитывается после полуночи | Ночью/на следующий день открытая вкладка держит то же окно «до вчера». | Пересчёт по смене дня (таймер/visibilitychange). |
| 12 | ГИПОТЕЗА | src/components/piling/to/readiness-design-views.tsx:284 | «Сегодня · {new Date().toLocaleDateString('ru-RU')}» — день по часам браузера | Не проверено, подключён ли этот файл к навигации (возможно, дизайн-вариант). Если подключён — дата «Сегодня» на экране READY расходится с производственным днём тенанта. | Проверить использование и, если живой, брать пояс тенанта. |

## Таблица экранов: период по умолчанию

| Экран | Файл:строка | Период по умолчанию | Часовой пояс «сегодня» | Риск |
|---|---|---|---|---|
| Аналитика | src/components/piling/admin-analytics.tsx:64-70 | Последние 7 дней (сегодня−6 … сегодня) | Жёстко МСК (getTodayInTimezone без аргумента, :65) | важно (#2) |
| Дашборд | src/components/piling/admin-dashboard.tsx:82-86, 117, 123 | «Весь период» (`all`); «Сегодня»/«7 дней» — по выбору | Жёстко МСК (:82) | важно (#1) |
| Аналитика по технике | src/components/piling/equipment-analytics.tsx:70-77, 84-85 | Последние 30 дней | Браузер (локальные часы) | важно (#3) |
| Журнал отчётов | src/components/piling/admin-reports/admin-reports.tsx:111 (+ report-list-format.ts:14) | `all`; фильтры Сегодня/Вчера/7 дней — по выбору | Жёстко МСК | мелочь (#6) |
| Журнал инструктажей | src/components/piling/to/readiness/screens/briefings-screen.tsx:115 | Текущий месяц (1-е число … сегодня) | Браузер (currentMonthRange) | важно (#5) |
| Отчёты (готовность) | src/components/piling/to/readiness/screens/reports-screen.tsx:23, 57-60, 115-116 | Последние 30 дней (REPORT_DEFAULT_DAYS) | Пояс тенанта (tenant.timezone) | мелочь (#11) |
| Телеметрия техники | src/components/piling/admin-equipment/detail/equipment-monitoring.tsx:139, 151-152 | Последние 7 дней | Жёстко МСК | мелочь (#7) |
| Экспорт отчёта по технике | src/components/piling/admin-equipment/detail/equipment-report-export.tsx:57-58, 71-73 | Сегодня | Пояс тенанта (корректируется после загрузки настроек) | ПРОЙДЕНО |
| Тренды по объектам | src/components/piling/admin-analytics.tsx:147 (weeks=4) + src/app/api/admin/analytics/site-weekly-trend/route.ts:19 | 4 недели (по умолчанию сервера — 8) | Бакет недели по UTC, не по поясу тенанта | важно (#4) |
| Журнал забивки | src/components/piling/pile-journal/index.tsx:91-98 | Без периода (все строки) | — | ПРОЙДЕНО |

## Что проверено и работает верно (ПРОЙДЕНО)

- Границы суток KPI — по поясу тенанта: `src/app/api/maintenance/kpi/route.ts:33-38, 53-55` (`zonedDayStartUtc`).
- Фильтры допуска трактуют дату без времени в поясе организации: `src/modules/readiness/application/read-filters.ts:42-55`; подтверждено тестом `src/modules/readiness/application/__tests__/read-filters.test.ts:6-9` (from 2026-08-02 → 2026-08-01T21:00:00Z).
- Экспорт отчёта по технике пересчитывает нетронутый период на пояс тенанта после загрузки настроек: `src/components/piling/admin-equipment/detail/equipment-report-export.tsx:71-73`.
- Карточка техники за 30 дней — по поясу тенанта: `src/modules/equipment/application/queries/equipment-query.service.ts:98`.
- Топливо за период — через `zonedDayStartUtc`: `src/services/analytics/equipment-analytics-service.ts:146-149`.
- `getTodayInTimezone` по умолчанию `Europe/Moscow` (src/lib/timezone.ts:21-23) и дефолт настроек `timezone: 'Europe/Moscow'` (src/modules/settings/domain/settings.ts:90) — осознанное значение для однотенантного прода.
- Границы периода `/api/admin/analytics/overview` сравнивают `report.date` (строка-день тенанта) со строковыми границами и ограничены 366 днями: `src/app/api/admin/analytics/overview/route.ts:164-177`.
- Считают по поясу тенанта клиентские экраны готовности: `shifts-screen.tsx:48`, `reports-screen.tsx:115`, `briefings-screen.tsx:206` (статистика).

## Не проверено

- Реальное значение `TZ` контейнеров/сервера и фактический `timezone` настроек прода — не читал `.env*` и не подключался к прод-БД (AGENTS.md §1). Выводы о «MSK по умолчанию» сделаны по коду, не по конфигурации.
- Подключён ли `src/components/piling/to/readiness-design-views.tsx` к живому экрану (находка #12) — использование не подтверждено (грep по `ReportsScreen`/навигации этого файла не дал).
- DST-устойчивость хелперов `shiftDay` (арифметика `T12:00Z + 86_400_000`) для поясов с переходом на летнее время: все `COMMON_TIMEZONES` (src/lib/timezone.ts:89-100) — российские пояса без DST, поведение для DST-зон не проверялось.
- Точный момент появления нового недельного бакета в проде (находка #4) — логика прочитана, но поведение на живой базе не наблюдалось.
- Прогон `npx tsc --noEmit`, `npm run lint`, `npm run build` не делался: аудит только на чтение, код не менялся; кроме того `build` требует env/БД, которых в этой сессии нет.
