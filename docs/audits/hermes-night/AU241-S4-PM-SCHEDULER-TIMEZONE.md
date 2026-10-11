# AU241-S4-PM-SCHEDULER-TIMEZONE — Планировщик ТО и часовой пояс

Версия кода: `git rev-parse HEAD` = **edfee4c99596b4916abb6bde4071140119b48430** (ветка `hermes/q4-0926`).
Аудит только для чтения; ни один файл приложения не изменён. Отчёт — единственный созданный файл.

## Итог

- Всего находок: **11** — критично 1, важно 5, мелочь 5.
- Главное: расчёт просрочки ТО в `src/lib/pm-due.ts` **вообще не знает о поясе тенанта** — он арифметикой `lastDoneAt + intervalDays × 86 400 000` считает срок от момента создания регламента (с точностью до секунды). Из-за этого «Просрочено» включается не на границе суток тенанта, а в произвольное время суток, а панель регламентов и дашборд могут показывать разный вердикт по одному и тому же плану.
- Второй расчётчик — `daysUntil` в `src/lib/format.ts:88` — наоборот, **жёстко зашивает `Europe/Moscow`** и игнорирует поле `Tenant.timezone`.
- В проекте сосуществуют **четыре** разные формулы «сколько дней до срока» (`pm-due` floor, `daysUntil` round по московским суткам, `equipment-detail-parts` round по UTC-инстанту, `document-expiry` ceil) — один план описывается по-разному на разных экранах.
- Перехода на летнее время в поддерживаемых зонах (все — российские, фиксированное смещение с 2014 г.) сегодня **нет**; риск DST латентный — он реализуется только если тенанту задать зону с переходом (валидатор допускает любую IANA-зону).

## Методика

- Точка входа: `rg -n "pm-scheduler|evaluatePlanDue|pm-due" src` — найдены модуль команды, воркер и чистый расчётчик.
- Прочитаны полностью: `src/lib/pm-due.ts`, `src/modules/equipment/application/commands/pm-scheduler.ts`, `src/workers/unified-worker/pm-scheduler.ts`, `src/modules/equipment/application/commands/maintenance-plan.ts`, `src/modules/equipment/application/commands/maintenance-regulation.ts`, `src/lib/timezone.ts`, `src/modules/readiness/domain/shifts/tenant-production-date.ts`, `src/lib/format.ts` (фрагмент), `src/lib/document-expiry.ts`, `src/lib/maintenance-due.ts`.
- Поиск по поясу: `rg -n "Europe/Moscow|timeZone|timezone|getTimezoneOffset|UTC\+3" src` — выявлены все места, где пояс задаётся или потребляется.
- Поиск по границам суток: `rg -n "startOfDay|DAY_MS|86_400_000|86400000|setHours\(0" src`.
- Схема и инфраструктура: `rg -n "timezone|scheduledAt|lastDoneAt|nextMaintenanceDate|intervalDays|leadTimeDays" prisma/schema.prisma`; `rg -n "TZ=|timezone" Dockerfile* docker-compose* .env.example` (пусто — `TZ` не задан).
- Места показа дат: `rg -n "scheduledAt|nextMaintenanceDate|daysUntil|formatRuDate" src/components`.
- Повторить: те же команды из корня `D:\PillingR\wt-night`; проверка не требует БД.

## Таблица: где какой пояс

| Место | Файл:строка | Пояс | Риск |
|---|---|---|---|
| Расчёт срока CALENDAR-регламента | `src/lib/pm-due.ts:71-72` | нет пояса — абсолютные миллисекунды от `lastDoneAt` | важно: граница просрочки = мгновение, а не сутки тенанта |
| Вердикт ok/due_soon/overdue | `src/lib/pm-due.ts:74` | нет пояса | важно: «просрочено» включается в любое время суток |
| Анкер первого интервала (создание регламента) | `src/modules/equipment/application/commands/maintenance-plan.ts:53-54` | `new Date()` — серверный инстант (в контейнере UTC) | важно: срок наследует случайное время суток |
| Вызов расчёта планировщиком | `src/modules/equipment/application/commands/pm-scheduler.ts:84` | `now` = `new Date()` (UTC-инстант) | мелочь: сам инстант пояса не имеет, но и не приводится к суткам тенанта |
| Запуск суточного прохода | `src/workers/unified-worker/pm-scheduler.ts:16,99-100` | интервал 24 ч от старта процесса | мелочь: не привязан к локальной полуночи тенанта |
| Проекция ближайшего ТО в `Equipment` | `src/modules/equipment/application/commands/maintenance-regulation.ts:58-59,117` | без пояса (пишет инстант) | важно: дата «Ближайшее ТО» наследует время суток |
| Флаг «просрочено» на дашборде / в журнале ТО | `src/lib/format.ts:88-92` (`daysUntil`) | **жёстко `Europe/Moscow`**, `Tenant.timezone` игнорируется | критично: неверно для тенанта вне МСК (Владивосток и т.п.) |
| Показатель дней в карточке ТО | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:271` | UTC-инстант, `Date.now()` | мелочь: третий независимый расчёт |
| Дата плана наряда в журнале | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:179` | UTC-дата (`.slice(0,10)` от ISO-инстанта) | мелочь: вечерние инстанты дают дату на день раньше |
| «Ближайшее ТО» в обзоре карточки | `src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:173` | UTC-дата через `formatRuDate` | мелочь |
| Суточный проход по тенантам | `src/workers/unified-worker/pm-scheduler.ts:78-84` | пояс не читается (`getSettings` не вызывается) | важно: сутки тенанта не учитываются |

## Находки

| # | severity | path:line | Проблема | Сценарий / чем важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/lib/format.ts:88` | `daysUntil` жёстко форматирует и «сегодня», и цель в `Europe/Moscow`, игнорируя `Tenant.timezone` (поле есть: `prisma/schema.prisma:109`). | Тенант во Владивостоке (UTC+10, есть в `COMMON_TIMEZONES`, `src/lib/timezone.ts:97`): в 08:00 местного дашборд ещё считает «вчера» по московским суткам → флаг «просрочено» и `dueText` смещаются на день. Сейчас боевой тенант `orion` — МСК, поэтому дефект скрыт. | Передавать `tenant.timezone` в `daysUntil`/`dueText` (как уже делает `equipment-query.service.ts:97-98` через `getTodayInTimezone(timezone)`), убрать литерал. |
| 2 | важно | `src/lib/pm-due.ts:71-72` | `dueDate = lastDoneAt + intervalDays*86_400_000`; срок — абсолютный инстант, сохраняющий время суток `lastDoneAt`. | Регламент «CALENDAR, каждые 90 дней» создан в 15:40 → срок наступает в 15:40, а не «в конце 90-го дня». Просрочка включается в середине рабочего дня. | Считать срок как календарную дату тенанта: `zonedDayStartUtc(addDays(lastDate, intervalDays), tz)` или сравнивать по локальной дате, а не по миллисекундам. |
| 3 | важно | `src/lib/pm-due.ts:72,74` vs `src/lib/format.ts:84-93` | Два разных определения «просрочено» для одного плана: `pm-due` — по инстанту (`Math.floor` мс/24 ч), `format.ts` — по московской календарной дате (`Math.round`). | Панель «Регламенты ТО» (`maintenance-plans-panel.tsx:53`, сервер — `api/maintenance-plans/route.ts:45`) покажет «просрочка 1 дн.», а плитка/журнал на том же плане — «не просрочено» (или наоборот), весь день до/после момента срока. Владелец видит противоречивые числа. | Свести обе стороны к одной функции с одинаковой гранулярностью (календарный день тенанта) — например, отдавать из `pm-due` `dueDate` и считать дни через общий `daysUntil`. |
| 4 | важно | `src/lib/pm-due.ts:7,64` | Порог «скоро» для HOURS жёстко `SOON_HOURS = 50`, а `leadTimeDays` для календаря (по умолчанию 7) нигде не пересчитывается. | Для CALENDAR порог берётся из плана (`leadTimeDays`), для HOURS — константа. Разная логика настройки «предупреждать заранее». | Либо вынести 50 м/ч в настройку регламента, либо явно задокументировать, что порог HOURS фиксирован. |
| 5 | важно | `src/modules/equipment/application/commands/maintenance-plan.ts:53-54` | Первый `lastDoneAt` CALENDAR-плана = `new Date()` (момент сохранения), а не дата начала местных суток. | Админ заводит регламент вечером → последующие «просрочено» привязаны к вечернему времени; при переносе/повторном создании время меняется. | Использовать начало производственных суток тенанта (`tenantProductionDate`/`zonedDayStartUtc`). |
| 6 | важно | `src/workers/unified-worker/pm-scheduler.ts:16,99-100` | `setInterval(..., PM_INTERVAL=24 ч)` отсчитывается от старта процесса + `PM_STARTUP_DELAY_MS` (60 с), а не от локальной полуночи тенанта. | При частых рестартах воркера проход выполняется несколько раз в сутки (идемпотентно, но нагрузка и время оповещения «плавают»); окно отправки Telegram-алерта о просрочке зависит от времени деплоя. | Планировать следующий тик на ближайшую локальную полночь тенанта (сдвиг `setTimeout`), либо привязать к cron с явной зоной. |
| 7 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail-parts.tsx:271` | Третья формула: `Math.round((new Date(nextDateStr) - Date.now())/86_400_000)` — UTC-инстант, `round`. | Даёт число дней, отличное от `daysUntil` (московские сутки) в пограничные часы. | Использовать общий `daysUntil`. |
| 8 | мелочь | `src/components/piling/admin-equipment/detail/equipment-maintenance.tsx:179` | `formatRuDate(r.scheduledAt.slice(0, 10))` берёт UTC-дату из инстанта; `formatRuDate` («timezone-safe», `src/lib/format.ts:50-60`) безопасен только для date-only, но `scheduledAt` — Timestamptz (`prisma/schema.prisma:588`). | Срок, записанный в 22:00 МСК, отобразится датой на день раньше (UTC уже следующие сутки). | Форматировать инстант через `formatDateInTimezone(scheduledAt, tz)`. |
| 9 | мелочь | `src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:173` | `formatRuDate(eq.nextMaintenanceDate)` — то же: `nextMaintenanceDate` пишется как инстант (`maintenance-regulation.ts:117`, `prisma/schema.prisma:492` Timestamptz). | Та же ошибка на день у вечерних дат в блоке «Ближайшее ТО». | То же: форматировать с поясом тенанта. |
| 10 | мелочь | `src/lib/pm-due.ts:72` (`Math.floor`) vs `src/lib/document-expiry.ts:37` (`Math.ceil`) | Соседние «чистые» расчётчики срока расходятся в округлении: `pm-due` усекает вниз, `document-expiry` вверх. | План со сроком сегодня в 14:00 показывает «через 0 дн.» (вместо «сегодня»), документ со сроком сегодня в 23:59 — «остался 1 день». Разночтение в терминологии «сколько осталось». | Договориться об одной политике округления (вверх, как у документов, — безопаснее для предупреждений) и вынести в общий хелпер. |
| 11 | мелочь | `src/modules/equipment/application/commands/maintenance-regulation.ts:58-59` | `nextMaintenanceDate` проецируется как минимум из `due.dueDate` — инстант из `pm-due`, без приведения к суткам тенанта. | Поле `Equipment.nextMaintenanceDate` смешивает семантику «date-only из формы» (`equipment-form.tsx:297`, тип `date`) и «инстант из проекции» — потребители трактуют по-разному. | Проецировать дату начала производственных суток тенанта либо хранить date-only. |

## Не проверено

- **НЕ ПРОВЕРЕНО**: переход на летнее время на практике. Все зоны в `COMMON_TIMEZONES` (`src/lib/timezone.ts:89-100`) — российские, фиксированное смещение (переходы отменены с 2014 г.), поэтому DST для поддерживаемых зон сейчас не наступает. Проверено только по коду: арифметика `intervalDays × 86 400 000` (`src/lib/pm-due.ts:71`) не учитывает переход, т.к. сутки всегда 24 ч.
- **ГИПОТЕЗА**: если тенанту задать зону с переходом (валидатор `src/modules/settings/domain/settings.ts:109-112` принимает любую IANA-зону), то «N календарных дней» превратятся в «N × 24 ч»: после перехода весной срок сдвинется на час раньше по местным стенным часам, осенью — на час позже. Проверить на живой зоне с DST возможности не было (в проекте таких зон нет и БД без данных тенанта с такой зоной).
- **НЕ ПРОВЕРЕНО**: реальное поведение `Tenant.timezone` для боевого тенанта. Читал только схему (`prisma/schema.prisma:109`, default `Europe/Moscow`) и код настроек; подключения к базе не делал (запрещено).
- **НЕ ПРОВЕРЕНО**: часовой пояс серверного процесса в проде. В `Dockerfile*`/`docker-compose*`/`.env.example` переменной `TZ` нет (поиск пуст) → по умолчанию контейнер в UTC, но фактическое окружение рантайма не проверял.
- **НЕ ПРОВЕРЕНО**: тесты на границу суток/DST. В `src/lib/__tests__/pm-due.test.ts` (59 строк) есть только CALENDAR-кейсы с фиксированным `NOW`; кейсов на смену суток тенанта или DST нет.
- **СТАТУС ПРОЙДЕНО**: проверено по коду, что ни `runPmScheduler` (`src/modules/equipment/application/commands/pm-scheduler.ts:46`), ни `evaluatePlanDue` (`src/lib/pm-due.ts:44`) не принимают и не читают пояс — `getSettings` в модуле `equipment` вызывается только в запросе (`src/modules/equipment/application/queries/equipment-query.service.ts:97`).
