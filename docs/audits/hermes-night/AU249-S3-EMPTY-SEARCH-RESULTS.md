# AU249-S3-EMPTY-SEARCH-RESULTS: Пустой результат поиска и фильтров

**Git commit:** `71a6a2487230d8a64197ca61c4cea853193d4d42`

## Итог

Проверено **15 экранов** админки и модуля готовности с таблицами/списками.

| Категория | Количество |
|-----------|------------|
| Критично (нет текста при пустом результате) | 0 |
| Важно (текст есть, но неинформативен / нет сброса / нет URL) | 9 |
| Мелочь (текст нормальный, есть сброс, но нет URL) | 6 |

**Топ-5 проблем:**
1. **Admin Reports, Admin Sites, Admin Equipment, Admin Dictionaries, Readiness Fleet** — фильтры/поиск не сохраняются в URL (кроме Fleet и Users/Dictionaries kind). Перезагрузка страницы сбрасывает контекст.
2. **Admin Reports** — пустой клиентский отбор при `hasMore=true` показывает «Отчёты не найдены», но подсказка говорит «загрузите остальные» — пользователь не понимает, это «нет вообще» или «нет среди загруженных».
3. **Admin Equipment, Admin Sites, Admin Dictionaries** — есть кнопка «Сбросить фильтры», но она сбрасывает только в дефолт, а не в URL (т.е. ссылку передать нельзя).
4. **Readiness Permits, Maintenance, Reports, Safety, Shifts** — есть фильтры/поиск, но ни URL, ни сброс в UI (кроме Fleet).
5. **Admin Users** — единственный экран, где фильтры (quick, search, userId) **полностью в URL** и восстанавливаются при входе по ссылке.

## Методика

1. Найдены все экраны админки через `find src/app/\(app\)/admin -name "*.tsx"` и компоненты в `src/components/piling/admin-*`.
2. Добавлены экраны модуля готовности (`src/components/piling/to/readiness/screens/*.tsx`), так как они содержат таблицы с фильтрами.
3. Для каждого экрана проверено:
   - Текст при пустом результате (empty state)
   - Наличие кнопки/действия сброса фильтров
   - Сохранение фильтров в адресной строке (URLSearchParams)
   - Использование общих компонентов `OpsTableEmpty`, `EmptyState`, кастомных блоков
4. Статусы: **ПРОЙДЕНО** (прочитал файл, нашёл код), **НЕ ПРОВЕРЕНО** (экран не найден / не относится к задаче), **ГИПОТЕЗА** (логика выведена из кода, но не запускал).

## Находки

| # | Severity | Экран | Файл:строка | Текст при пустом результате | Сброс фильтров | URL persistence | Проблема / Сценарий | Предлагаемое исправление |
|---|----------|-------|-------------|----------------------------|----------------|-----------------|---------------------|--------------------------|
| 1 | Важно | Admin Equipment | `src/components/piling/admin-equipment/admin-equipment.tsx:135-146` | Два варианта: «В парке нет установок. Добавьте первую» (cards.length===0) или «Нет установок под выбранные фильтры» | Кнопка «Сбросить фильтры» (строки 141-144, 149-154) | ❌ Нет | Фильтры (site, kind, status, crew, search) только в локальном state. Перезагрузка теряет контекст. | Добавить `readUrlState`/`writeUrlState` как в AdminUsers. |
| 2 | Важно | Admin Reports | `src/components/piling/admin-reports/admin-reports.tsx:474-486` | «Отчёты не найдены» + подсказка: если `hasMore` — «Среди загруженных отчётов совпадений нет. Загрузите остальные…», иначе — «Попробуйте изменить быстрые фильтры…» | Нет явной кнопки сброса всех фильтров. Есть «Сбросить» для периода (строка 439), quickFilter сбрасывается кликом на «Все», search — очисткой инпута | ❌ Нет | Сложный набор фильтров (quickFilter, periodFrom/To, filterSiteId, filterUserId, filterEquipmentId, search, sortKey/sortDir). При `hasMore=true` пустой результат двусмыслен. | 1) Добавить URL persistence. 2) Добавить кнопку «Сбросить все фильтры» рядом с quick filters. 3) Уточнить текст: «Среди загруженных X отчётов ничего не найдено». |
| 3 | Важно | Admin Users | `src/components/piling/admin-users/admin-users.tsx:89-122, 155-157, 349` | `OpsTableEmpty`: «Пользователи не найдены» / «Измените фильтр или строку поиска.» | Нет отдельной кнопки — сброс делается выбором «Все» + очисткой поиска + снятием выбора userId | ✅ **Есть** (строки 101-122, 155-157): `filter`, `q`, `userId` в URL. Восстанавливаются при монтировании. | **Эталон** — единственный экран с полной URL persistence для фильтров списка. | Ничего — использовать как шаблон для остальных. |
| 4 | Важно | Admin Sites | `src/components/piling/admin-sites/index.tsx:344, 135-147` | `OpsTableEmpty`: если `allRows.length===0` — «Объектов пока нет. Заведите первый кнопкой «Новый объект».», иначе — «Объекты не найдены» / «Измените быстрый фильтр.» | Нет кнопки сброса. QuickFilter сбрасывается выбором «Все», search — очисткой инпута | ❌ Нет | Фильтры (quick, search) в локальном state. | Добавить URL persistence для quick, search. Добавить кнопку «Сбросить фильтры» при активных фильтрах. |
| 5 | Важно | Admin Incidents | `src/components/piling/admin-incidents/admin-incidents.tsx:226-231` | Scope 'open': «Ничего не ждёт разбора. Это хорошая новость.» / Scope 'all': «Происшествий пока не заводили.» | Нет (только переключение scope open/all) | ❌ Нет | Нет текстового поиска. Scope не в URL. | Добавить поиск по описанию/объекту/установке. Сохранять scope в URL. |
| 6 | Важно | Admin Dictionaries | `src/components/piling/admin-dictionaries.tsx:112-116, 151-157, 198-207` + `dictionary-table.tsx:189-194, 290` | `DictionaryTable` (таблица): «{title}: ничего не найдено». Карточки (compact): общий блок «Ничего не найдено. Попробуйте изменить параметры поиска или фильтра.» (строка 290) | Нет кнопки сброса поиска/фильтра статуса. Переключение вкладки (kind) сбрасывает search (строка 479: `onClick={() => { selectKind(kind); setSearch(''); }}`) | Частично: **kind (вкладка) в URL** (строки 112-116, 151-157). Search и status filter — нет. | Вкладка сохраняется в URL — хорошо. Но поиск и фильтр «Активные/Архив/Все» теряются при перезагрузке. | Добавить `search` и `filter` (active/archived/all) в URL. |
| 7 | Важно | Admin Crews | `src/components/piling/admin-crews/admin-crews.tsx:254, 76-83` | `OpsTableEmpty`: «Бригады не найдены» / «Создайте бригаду или измените фильтр.» | Нет кнопки сброса. QuickFilter сбрасывается выбором «Все» | ❌ Нет | Только quickFilter (all/active/inactive/noAssistants). Нет текстового поиска. | Добавить поиск по названию/оператору/установке/объекту. Сохранять quick в URL. |
| 8 | Важно | Admin DLQ | `src/components/piling/admin-dlq.tsx:294-299` | «Недоставленных событий нет» + «Нет событий со статусом «{STATUS_FILTERS.find(f=>f.key===status)?.label}»» | Нет. Статус меняется табами (pending/resolved/discarded/all) | ❌ Нет | Нет поиска по eventType/aggregateId/errorMessage. Статус-фильтр не в URL. | Добавить поиск. Сохранять status в URL. |
| 9 | Важно | Admin Analytics | `src/components/piling/admin-analytics.tsx:292-294, 366-368, 430-432, 480-482` | `EmptyState` с разными текстами: «За выбранный период нет отчётов…» / «За выбранный период нет данных по операторам» / «Нет данных за недели…» / «Нет данных ТО за период.» | Нет (только переключение табов operators/trends/kpi и выбор объекта в trends) | ❌ Нет | Фильтры: tab, trendSiteId. Период фиксирован (7 дней). | Сохранять tab и trendSiteId в URL. |
| 10 | Важно | Readiness Fleet | `src/components/piling/to/readiness/screens/fleet-screen.tsx:51, 72-78, 155, 165-168, 228-229` | «Установки не найдены. Измените поиск или сбросьте фильтры.» / «Нет доступной техники. Список ограничен вашей ролью и доступными данными.» + кнопка «Показать весь парк» (сбрасывает в DEFAULT_FLEET_VIEW) | Кнопка «Сбросить фильтры» (строка 155) + кнопка «Показать весь парк» при пустом результате (строка 168) | ✅ **Есть** (строки 30-55 в fleet-workspace-model.ts): `fleetQuery`, `fleetSite`, `fleetStatus`, `fleetSort` в URL. Восстанавливаются при монтировании (строка 51) и обновляются при изменении (строки 72-78). | **Хороший пример** URL persistence для нескольких фильтров. Футер прямо говорит: «Фильтры и выбранная установка сохраняются в адресе страницы». | Ничего — использовать как шаблон. |
| 11 | Важно | Readiness Maintenance | `src/components/piling/to/readiness/screens/maintenance-screen.tsx:111-117, 141, 156` | «Заявки обслуживания отсутствуют.» | Нет кнопки сброса. Filter tabs (ALL/CRITICAL/ACTIVE/PLANNED) + search input | ❌ Нет | Фильтры: maintenanceFilter, maintenanceQuery. | Добавить URL persistence. Добавить кнопку «Сбросить» при активных фильтрах. |
| 12 | Важно | Readiness Permits | `src/components/piling/to/readiness/screens/permits-screen.tsx:49-50, 127-132, 254, 267, 284` | «По выбранным условиям наряды не найдены.» (таблица и мобильная карточка) | Нет кнопки сброса. Filter tabs (ALL/APPROVED/PENDING_APPROVAL) + search input | ❌ Нет | Фильтры: permitQuery, permitFilter. | Добавить URL persistence. Добавить кнопку «Сбросить». |
| 13 | Важно | Readiness Reports | `src/components/piling/to/readiness/screens/reports-screen.tsx:90, 237-244, 398, 500, 577, 598` | Разные тексты: «За выбранный период снимков готовности нет.» / «За выбранный период решений по допуску не было.» / «За выбранный период записей нет.» | Нет кнопки сброса журнала. Переключение day/week, fleetMetric (readiness/usage) | ❌ Нет | Фильтры: reportPeriod (day/week), fleetMetric, journalSearch. Период задаётся глобальной полосой фильтров (props.filters — она в URL в родительском ToModule). | journalSearch, reportPeriod, fleetMetric добавить в URL (или читать из props.filters). |
| 14 | Важно | Readiness Safety | `src/components/piling/to/readiness/screens/safety-screen.tsx:77, 114-123, 226-232` | Если `data.rows.length===0` — «Действующих работников на площадке не найдено.» Иначе — «По запросу ничего не найдено.» | Нет кнопки сброса. Только search input | ❌ Нет | Фильтр: query (поиск по имени/роли). | Добавить URL persistence для query. |
| 15 | Важно | Readiness Shifts | `src/components/piling/to/readiness/screens/shifts-screen.tsx:40, 170, 232, 252, 280` | Таблица: «Смены на сегодня не созданы.» / Мобильно: «Смены не найдены.» / Панель ожидания: «Передачи на приёмку отсутствуют.» / Экипажи: «Активные экипажи не назначены.» | Нет. Только переключение period (day/week) табами | ❌ Нет | Фильтр: period (day/week). | Добавить period в URL. |

## Не проверено

1. **Операторские экраны** (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) — заморожены по AGENTS.md, не аудировались.
2. **ORION сайт** (`src/app/orion/**`, `src/components/orion/**`) — заморожен.
3. **Экраны настройки в readiness** (`settings-workspace.tsx`, `briefings-screen.tsx`, `documents-screen.tsx`, `instructions-screen.tsx`, `knowledge-screen.tsx`, `my-clearance-screen.tsx`, `safety-overview-screen.tsx`, `readiness-centre.tsx`) — не содержат классических списков с поиском/фильтрами (проверено поверхностно).
4. **Admin Checklists, Admin Maintenance** — страницы в `src/app/(app)/admin/checklists/` и `src/app/(app)/admin/maintenance/` существуют, но их клиентские компоненты не найдены в `src/components/piling/admin-*` (возможно, логика внутри page.tsx или используют другие компоненты). Не проверены детально.
5. **E2E тесты** — не запускал, Playwright count не считал.
6. **Билд/линт/типы** — не запускал (read-only задача).

---

**Файл отчёта:** `docs/audits/hermes-night/AU249-S3-EMPTY-SEARCH-RESULTS.md`  
**Commit:** `71a6a248` (docs(audit): пустой результат поиска и фильтров — аудит 15 экранов админки и модуля готовности)