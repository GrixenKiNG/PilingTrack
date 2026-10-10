# AU66-S8-DISPATCHER-DASHBOARD — Дашборд диспетчера и мониторинг парка: источники и свежесть

Версия кода: `git rev-parse HEAD` = `143f10b7a8705e31a2bc3d967f2d9b075a2bbbba` (worktree `D:\PillingR\wt-night`, ветка `hermes/q4-0926`).
Аудит только для чтения: код приложения не изменялся. Замороженные зоны (варианты экрана оператора, сайт ORION) не затрагивались.

## Итог

- Найдена 21 находка: **критично 0, важно 8, мелочь 5** в основной таблице, плюс 8 позиций-подтверждений в приложении (итого 13 независимых выводов + 8 источников из таблиц).
- **Топ-5:**
  1. Плитки мониторинга подписаны «включая несданные смены», но снимок парка фильтрует `status='submitted'` — черновики исключены; подпись врёт с 02.10.2026 (регрессия между коммитами `57dfb7c1` и `276d777b`), страдают оба экрана: `/monitoring` и `/admin/analytics`.
  2. Оперативные числа дашборда `/admin` (парк, ТО, отчёты) грузятся один раз при открытии и не обновляются сами; единственная метка времени «Обновлено в ЧЧ:ММ» описывает только аналитику — открытый часами дашборд показывает «сейчас»-данные как свежие.
  3. Плитка «Отчёты» на `/admin` при сбое загрузки парка показывает «0 / 0», тогда как соседние плитки — «—»: отсутствие данных подано нулём (проверка `noFleet` пропущена).
  4. Заголовок мониторинга «N из M в работе» считает `activeToday` (сдан отчёт за сегодня), а не открытую смену (`equipmentStatus`/`workingNow`) — то самое расхождение, ради которого заведён единый `resolveEquipmentOperationalStates`.
  5. В карточке установки итоги «Сваи» берутся из проекции `ReportAnalytics`, а «м.п.» — всегда из сырых строк; при устаревшей проекции штуки и метры одной карточки расходятся молча.

## Методика

Что искал и как (команды приводимы, выполнялись из корня worktree):

- Точка входа: `AGENTS.md` (модель доверия, замороженные зоны, «мертво, но оставить»), скиллы `pilingtrack-architecture-contract`, `pilingtrack-debugging-playbook`.
- Содержимое точек данных диспетчера: `grep -rn "getFleetSnapshot|fleetSnapshot" src`, `grep -rn "analytics/sites" src`, `grep -rn "dispatcher|Диспетчер|dashboard" src`.
- Полностью прочитаны файлы-источники: `src/modules/monitoring/application/queries/fleet-monitoring.service.ts`, `src/components/piling/monitoring/fleet-dashboard.tsx`, `src/components/piling/dashboard-kpis.ts`, `src/components/piling/admin-dashboard.tsx`, `src/services/analytics/site-analytics-service.ts`, `src/services/analytics/equipment-analytics-service.ts`, `src/components/piling/equipment-analytics.tsx`, `src/components/piling/monitoring/equipment-tile-block.tsx`, `src/components/piling/analytics-dashboard/kpi-widgets.tsx`, `src/core/api-wrapper.ts`, `src/modules/equipment/application/queries/operational-state.ts`, `src/modules/reports/application/queries/report-query.service.ts`.
- Маршруты: `src/app/api/monitoring/fleet/route.ts`, `src/app/api/analytics/sites/route.ts`, `src/app/api/reports/recent/route.ts`, `src/app/api/maintenance/route.ts`, `src/app/api/admin/equipment-analytics/route.ts`, `src/app/(app)/monitoring/page.tsx`.
- Черновики: `grep -rn "'draft'|черновик|включая несданные смены" src`, `grep -n "SUBMITTED_REPORT_STATUS" ...`.
- История регрессии: `git log -1 -S "status: SUBMITTED_REPORT_STATUS" -- src/modules/monitoring/.../fleet-monitoring.service.ts` и то же для строки «включая несданные смены» в `fleet-dashboard.tsx`; `git blame -L 199,201 ...`.
- Тесты, фиксирующие инварианты: `src/modules/monitoring/__tests__/fleet-freshness.test.ts`, `src/modules/monitoring/application/queries/__tests__/fleet-monitoring.service.test.ts`.
- Числа: `grep -c "включая несданные смены" src/components/piling/monitoring/fleet-dashboard.tsx` = **6**; `grep -n "включая несданные смены" src/components/piling/analytics-dashboard/kpi-widgets.tsx` = 5 строк (109, 112, 115, 118, 119).
- Существующие отчёты `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` не читались (независимость первого прохода). `docs/DATA-SOURCES.md` использован как карта источников (не отчёт-аудит).

## Источники и свежесть по показателям

### A. Дашборд диспетчера `/admin` (`src/components/piling/admin-dashboard.tsx`)

| # | Показатель | Источник (проекция / запрос / телеметрия) | Как часто обновляется | Что при устаревшей проекции (видит ли пользователь) | Учёт черновиков | файл:строка |
|---|---|---|---|---|---|---|
| A1 | Сваи (шт / м.п.), «за период» | Живой SQL `getSiteAnalytics` по `Report`/`PileWork`, **не проекция** | При монтировании, при смене периода/объекта и по кнопке «Обновить»; Redis-кэш ответа 5 мин с инвалидацией по событию | Проекция не используется. При устаревшем Redis-кэше отдаётся прошлый ответ; индикатора нет | Исключены (`status='submitted'`) | `src/app/api/analytics/sites/route.ts:28-33`, `src/services/analytics/site-analytics-service.ts:122-134` |
| A2 | Бурение (шт / м.п.), «за период» | Тот же SQL по `LeaderDrilling` | То же | То же | Исключены | `src/services/analytics/site-analytics-service.ts:135-144` |
| A3 | Простой, «за период» | Тот же SQL по `ReportDowntime` | То же | То же | Исключены | `src/services/analytics/site-analytics-service.ts:145-151` |
| A4 | План-факт и % выполнения свай/бурения | Планы `SitePilePlan`/`SiteDrillingPlan` (SQL), фактическое — накопительно (AllTime) | То же | То же | Исключены | `src/services/analytics/site-analytics-service.ts:97-115,191-196`; `src/components/piling/admin-dashboard.tsx:313-314` |
| A5 | «Отчёты» (сдано / ожидается) | Снимок парка: `totals.activeToday` / `expected` из `Report` | При монтировании; **автообновления нет** (только кнопка) | Данные «сейчас», проекция не читается | Черновики исключены | `src/components/piling/dashboard-kpis.ts:106-107,119-120`; `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:199,355-362` |
| A6 | «Установки» (N в работе / из M) | `totals.workingNow` — открытая смена (`Shift` state STARTED/HANDOVER_PENDING), минус ремонт | При монтировании; **автообновления нет** | — | Черновики не влияют | `src/components/piling/dashboard-kpis.ts:138-139`; `src/modules/equipment/application/queries/operational-state.ts:33-56` |
| A7 | «ТО» (N риска) | `/api/maintenance` → `listAllMaintenance` (живой запрос) + `Engine.engineHoursTotal` | При монтировании; **автообновления нет** | При сбое загрузки `toRisk = null` → плитка показывает «—» | — | `src/app/api/maintenance/route.ts:26`; `src/components/piling/dashboard-kpis.ts:117`; `src/components/piling/admin-dashboard.tsx:355` |
| A8 | «Бригады» (на смене) | Снимок парка: `crewsOnShiftToday` — число отчётов за сегодня | При монтировании; **автообновления нет** | — | Черновики исключены | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:346-348`; `src/components/piling/dashboard-kpis.ts:141` |
| A9 | Риск «отчёт без фото» | `/api/reports/recent` → `listRecentReportsForDashboard` | При монтировании; **автообновления нет** | — | Черновики **ВКЛЮЧЕНЫ** (нет фильтра статуса) | `src/modules/reports/application/queries/report-query.service.ts:228-239`; `src/components/piling/admin-dashboard.tsx:285-288` |

### B. Мониторинг парка `/monitoring` (`src/components/piling/monitoring/**`)

| # | Показатель | Источник | Как часто обновляется | Что при устаревшей проекции | Учёт черновиков | файл:строка |
|---|---|---|---|---|---|---|
| B1 | Заголовок «N из M в работе», «включая несданные смены» | `totals.activeToday` (сдан отчёт за сегодня) | Опрос каждые 30 с + `online`/`visibilitychange` + ручное обновление; WS удалён 26.09.2026 | Проекция не читается для этого числа | Черновики исключены (но подпись утверждает обратное) | `src/components/piling/monitoring/fleet-dashboard.tsx:152-158,314-318,329` |
| B2 | Сваи / Бурение / Простой «сегодня» | `totals` карточек: `piles`/`drillingMeters`/`downtimeHours` — проекция `ReportAnalytics` с фолбэком на сырые строки; `pileMeters` — **всегда** сырые строки | 30 с | Нет строки проекции → фолбэк на сырые (число верное); строка есть, но устарела → молча берётся проекция | Черновики исключены | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:277-287,363-367` |
| B3 | «Ожидаются отчёты» | `totals.expected` — машины без отчёта сегодня, но с отчётом за 1–2 дня | 30 с | — | Черновики исключены | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:259-264,361` |
| B4 | «Бригад / Операторов на смене» | Число отчётов за сегодня (`crewId`/`userId`) | 30 с | — | Черновики исключены | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:346-353` |
| B5 | Карточка: Сваи / Бурение / Простой | `card.todayTotals` (те же источники, что B2) | 30 с | Как B2 | Черновики исключены | `src/components/piling/monitoring/equipment-tile-block.tsx:188-193` |
| B6 | Карточка: Моточасы / Ближайшее ТО | `Equipment.engineHoursTotal` / `nextMaintenanceAtHours` (ручной ввод; телеметрия дремлет) | 30 с | — | — | `src/components/piling/monitoring/equipment-tile-block.tsx:184-187,194-203` |
| B7 | «Аналитика по установкам» (низ страницы) | `equipment-analytics-service` — живой SQL по `Report`/`PileWork`/`LeaderDrilling`/`ReportDowntime` + телеметрия `fuel_total` (дремлет) | При монтировании и смене периода; **автообновления и метки времени нет** | Проекция не используется; расход топлива = 0, UI заменяет на «—» | Черновики исключены | `src/services/analytics/equipment-analytics-service.ts:70-124`; `src/components/piling/equipment-analytics.tsx:94-116,195` |
| B8 | `/admin/analytics` — плитки «Парк» | Тот же снимок парка (`/api/monitoring/fleet`) | **Один раз при монтировании**, без автоповтора | — | Черновики исключены | `src/components/piling/admin-analytics.tsx:104-118` |

## Находки

Статус: **ПРОЙДЕНО** — факт подтверждён чтением кода/теста; **ГИПОТЕЗА** — вывод о поведении пользователя, не воспроизведён в UI.

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление | статус |
|---|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/monitoring/fleet-dashboard.tsx:318,334-349` против `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:199` | Шесть подписей плиток мониторинга (6 вхождений) и комментарий 334-337 утверждают «включая несданные смены (черновики)», но запрос фильтрует `status = 'submitted'` — черновики **исключены** | Диспетчер во время смены до сдачи отчётов читает «Сваи ... включая несданные смены» как полный итог дня, хотя идущие смены не учтены; расхождение с журналом выглядит потерей данных. Регрессия: подписи добавлены `57dfb7c1` (26.09), фильтр — `276d777b` (02.10), подписи не поправили | Либо вернуть черновики в снимок, либо удалить подписи «включая несданные смены» и обновить комментарий | ПРОЙДЕНО |
| 2 | важно | `src/components/piling/analytics-dashboard/kpi-widgets.tsx:103-106,109,112,115,118-119` | Тот же снимок парка подписан «за сегодня, включая несданные смены» / «на смене сегодня, включая несданные смены»; комментарий 103-106 прямо неверен после `276d777b` | На `/admin/analytics` диспетчер видит то же обещание, что и на мониторинге, при том же исключении черновиков. Тест `kpi-widgets.test.tsx:129` сторожит текст подписи, а не фактическое включение черновиков | Убрать/переписать подписи; при желании — добавить тест на фактический состав | ПРОЙДЕНО |
| 3 | важно | `src/components/piling/admin-dashboard.tsx:154-179,372-374`; `src/components/piling/dashboard-kpis.ts:108,145` (analyticsUpdatedAt) | Оперативные источники (`/api/monitoring/fleet`, `/api/maintenance`, `/api/reports/recent`) читаются один раз при монтировании; автообновления нет. Единственная метка «Обновлено в ЧЧ:ММ` ставится только в `loadAnalytics` и описывает лишь аналитику | Дашборд держат открытым часами; числа «сейчас» (парк, ТО, отчёты) не меняются, а метка времени выглядит свежей и относится к другому блоку — диспетчер принимает устаревший парк за живой | Добавить автоповтор для `loadOps` (как на `/monitoring`, 30 с) или отдельные метки времени у блоков «парк»/«ТО»/«отчёты» | ПРОЙДЕНО |
| 4 | важно | `src/components/piling/admin-dashboard.tsx:328,350` | Плитка «Отчёты»: `value={noFleet ? '—' : ...}`, `noFleet = kpis.rigsTotal === 0`. При сбое загрузки парка `rigsTotal === null`, `noFleet === false` → плитка показывает «0 / 0» с подписью «машин с отчётом сегодня» | Отсутствие данных подано нулём: сбой парка читается как измеренный факт «ноль отчётов», хотя соседние плитки в той же полосе показывают «—» (`dashboard-kpis.ts:138-141` возвращают `null`) | `noFleet` считать как «нет данных ИЛИ пусто»: `rigsTotal == null || rigsTotal === 0` (как в `dk-rigs`/`dk-maintenance`) | ПРОЙДЕНО |
| 5 | важно | `src/components/piling/monitoring/fleet-dashboard.tsx:314-318`; доступно `totals.workingNow` (`fleet-monitoring.service.ts:360`) | Заголовок «N из M в работе» считает `totals.activeToday` (сдан отчёт за сегодня) вместо `workingNow`/`equipmentStatus` (открытая смена) | Ровно то расхождение, ради устранения которого заведён единый `resolveEquipmentOperationalStates` (`operational-state.ts:6-14`): утром/днём заголовок показывает «0 ... в работе», хотя смены идут. Дашборд уже использует `workingNow` (`dashboard-kpis.ts:138`), мониторинг — нет | В заголовке использовать `snap.totals.workingNow` | ПРОЙДЕНО |
| 6 | важно | `src/components/piling/monitoring/equipment-tile-block.tsx:110-114,177` | Бейдж и блок статуса карточки показывают «В работе» по `card.status` (отчёт сдан за сегодня), а не по `card.equipmentStatus` (открытая смена). Обрабатывается только `equipmentStatus === 'repair'` | Машина с открытой сменой, но без сданного отчёта, показывается как «Нет отчёта» — карточка парка противоречит правилу продукта и экрану «в работе» | Статус карточки строить по `card.equipmentStatus` (`working`/`repair`/`idle`), оставив отчётный статус отдельной подписью | ПРОЙДЕНО |
| 7 | важно | `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:277-287` | На одной карточке `piles` берутся из проекции `ReportAnalytics` (`a?.totalPiles`), а `pileMeters` — всегда из сырых строк; `drillingMeters`/`downtimeHours` — из проекции с фолбэком | При устаревшей (присутствующей) строке проекции «Сваи, шт» и «Сваи, м.п.» считаются по разным снимкам данных → на одной карточке штуки отстают от метров молча, без индикатора | Считать все итоги из одного источника за итерацию (либо весь проекционный, либо весь сырой) — не смешивать на один показатель | ПРОЙДЕНО |
| 8 | важно | `src/components/piling/admin-dashboard.tsx:373`; `src/app/api/analytics/sites/route.ts:28-33` | Метка «Обновлено в ЧЧ:ММ» = время клиент-запроса (`new Date()` в `loadAnalytics`, стр. 145), а не время расчёта данных; ответ аналитики приходит из Redis-кэша с TTL 5 мин | Только что открытый дашборд покажет чужие/старые числа под меткой «Обновлено сейчас» (до 5 мин расхождения, при не сработавшей инвалидации), т.е. метка завышает свежесть | Возвращать в ответе `asOf` (время расчёта) и показывать его; либо помечать «кэш» | ГИПОТЕЗА |
| 9 | мелочь | `src/modules/reports/application/queries/report-query.service.ts:228-239` | `listRecentReportsForDashboard` выбирает последние отчёты без фильтра статуса → черновики попадают в список «свежих отчётов» | На `/admin` черновик без фото порождает риск «отчёт без фото» (`admin-dashboard.tsx:285-288`) до сдачи смены; в этом же дашборде аналитика черновики исключает — несогласованный учёт черновиков на одном экране | Фильтровать `status='submitted'` либо помечать черновики и не выдавать по ним риск | ПРОЙДЕНО |
| 10 | мелочь | `src/components/piling/monitoring/equipment-tile-block.tsx:193` | Блок «Простой»: `todayTotals && todayTotals.downtimeHours > 0 ? ... : '—'` — реальный ноль простоя и отсутствие данных выглядят одинаково («—») | Машина, отработавшая смену без простоя, показывает «—» рядом с «Сваи/Бурение» с числами — читается как неполные данные, а не как «простоя не было» | Различать «нет итогов» (`todayTotals == null`) и «ноль простоя» (показывать «0 ч») | ПРОЙДЕНО |
| 11 | мелочь | `src/components/piling/equipment-analytics.tsx:94-116` | Блок «Аналитика по установкам» на мониторинге не имеет метки «на момент»/времени и не обновляется автоматически | Периодные данные (по умолчанию 30 дней) выглядят статичными, но пользователь не знает, когда они посчитаны | Добавить `asOf` сервера в ответ и подпись под заголовком | ПРОЙДЕНО |
| 12 | мелочь | `src/services/reports/event-handlers.ts:47-52`; `src/app/api/analytics/sites/route.ts:29-33` | Инвалидация Redis-кэша аналитики выполняется обработчиками событий (асинхронно через outbox → worker), а не в транзакции записи отчёта | Только что сданная смена может не сразу сбросить кэш дашборда: до обработки события (лаг воркера) `/admin` отдаёт прежнюю выработку, хотя журнал уже новый — окно расхождения, знакомое по F-R35-2 | Инвалидировать кэш синхронно в пути мутации либо сократить TTL/показывать `asOf` | ГИПОТЕЗА |
| 13 | мелочь | `src/modules/equipment/application/queries/operational-state.ts:42-49` | Запрос `maintenanceRecord.findMany` для состояния машин не содержит фильтра `tenantId` (только `equipmentId IN (...)`) | Утечки нет: `equipmentIds` уже отобраны тенантно (`fleet-monitoring.service.ts:120-133`), но нарушено правило «тенантность закрывается явно»; при будущем переиспользовании функции риск неверной изоляции | Добавить `tenantId` в `where` для симметрии с `shift.findMany` (стр. 34-36) | ГИПОТЕЗА |

Дополнение к таблице источников (не отдельные дефекты, а подтверждённые факты «свежести», на которых стоят выводы): A5–A9 и B8 указывают на отсутствие автообновления; B2 фиксирует асимметрию источников внутри карточки (пункт 7); A9/B4 показывают разный учёт черновиков на одном экране (пункт 9).

## Показатели без метки времени «на момент»

- `/admin`: парк (`workingNow`/`totalEquipment`), ТО, «Отчёты», «Бригады» — метки времени нет; единственная отметка «Обновлено в ЧЧ:ММ» относится к аналитике (`admin-dashboard.tsx:373`, ставится в `loadAnalytics`, стр. 145).
- `/monitoring`: заголовок и плитки имеют общую серверную `asOf` (`fleet-dashboard.tsx:329`), но карточки (Сваи/Бурение/Простой за сегодня, моточасы) — без собственной отметки; блок «Аналитика по установкам» — без отметки вовсе.
- `/admin/analytics`: блок парка использует снимок без отображения `asOf` (`admin-analytics.tsx:104-118`).
- `/monitoring` «Аналитика по установкам» (`equipment-analytics.tsx`) — ни `asOf`, ни времени генерации (периодные данные).

## Места, где нулём показывается отсутствие данных

- `/admin`, плитка «Отчёты» (`admin-dashboard.tsx:350`): сбой загрузки парка → «0 / 0» вместо «—» (находка 4).
- Смежное: карточка парка, блок «Простой» (`equipment-tile-block.tsx:193`): реальный ноль простоя показан как «—» — обратный случай, «данные → пусто» (находка 10).
- Снимок парка на пустом парке отдаёт все нули (`fleet-monitoring.service.ts:159-165`) — корректно перекрыт сообщением «Нет установок для отображения» (`fleet-dashboard.tsx:280-286`), проверено тестом `fleet-freshness.test.ts:122-134`.
- `/monitoring` топливо: отсутствие телеметрии = 0 (`equipment-analytics-service.ts:166-168,188`), UI корректно подменяет на «—» + «нужна телеметрия» (`equipment-analytics.tsx:195`) — не дефект.

## Не проверено

- **Реальное поведение в браузере не воспроизводилось** (модель доверия, лаг проекции, состояние «парк не загрузился»): аудит по коду и тестам; выводы 3, 4, 5, 6, 7 о видимом эффекте помечены как рассуждение по данным/коду (ГИПОТЕЗА там, где это не следует напрямую из теста).
- **Прод-состояние проекций `ReportAnalytics` не измерялось** (нет подключения к производственной БД — запрещено правилами). Наличие/устаревание строк проекций оценено только по коду.
- **Как часто реально срабатывает инвалидация кэша** (находка 12) — не проверялось запуском воркера; лаг outbox-обработки не измерен.
- **Ход записи отчёта `draft→submitted`** (какое именно событие эмитится) прочитан косвенно по обработчикам (`event-handlers.ts:31,37,50-52`); полный путь команды не трассировался.
- **Права роли** (что `DISPATCHER` имеет `sites.read_all`, `reports.read_all`, `maintenance.manage`, `analytics.read`) приняты по модели доверия из `AGENTS.md`; `authorization-service.ts` детально не разбирался.
- **Тесты не запускались** (аудит read-only, задача не требует). Проверенные ключи: `tsc`, `lint`, `test:unit`, `playwright` — не выполнялись.
- **Существующие отчёты по теме** (`docs/audits/**`, включая аудит по KPI-определениям, `CODEX-REPORT*`, `docs/strategy`) намеренно не читались — возможны пересечения, не подтверждённые независимо здесь.
