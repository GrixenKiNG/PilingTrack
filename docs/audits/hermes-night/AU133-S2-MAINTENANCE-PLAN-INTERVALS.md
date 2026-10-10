# AU133-S2-MAINTENANCE-PLAN-INTERVALS — Планы ТО: интервалы по моточасам и дням

Версия: git rev-parse HEAD = 474dde1fa88fb134d6277cf7ba1fd4dbdf736fcd (ветка hermes/q4-0926).
Только чтение; код приложения не менялся. Отчёты в docs/audits/, CODEX-REPORT*, docs/strategy не читались.

## Итог

Просрочка ТО считается ДВУМЯ независимыми движками: по регламенту (`evaluatePlanDue`,
`src/lib/pm-due.ts`) и по денормализованному порогу в карточке техники
(`checkMaintenanceDue`, `src/lib/maintenance-due.ts`). Порог карточки — это проекция
регламентов (`projectNextMaintenance`), и пересчитывается она ТОЛЬКО при закрытии наряда.
Правка регламента (интервал/точка отсчёта), создание нового регламента и замена счётчика
эту проекцию не пересчитывают — экраны расходятся, а готовность (допуск к работе) читает
именно протухшую проекцию. Регламент без точки отсчёта молча считается «ok» (пропуск
просрочки). Итог: критично — 1, важно — 4, мелочь — 9 (всего 14 находок). Топ-5 ниже.

Топ-5:
1. КРИТИЧНО. Два расчёта просрочки и единственная точка синхронизации — закрытие наряда;
   правка регламента порог техники не трогает → готовность может показать «допуск разрешён»
   при фактически просроченном регламенте (F1, F2).
2. ВАЖНО. Регламент без `lastDoneHours`/`lastDoneAt` (в т.ч. заведённый seed-скриптом без
   истории) всегда «ok» — просрочка не поднимется (F3).
3. ВАЖНО. Замена счётчика (снижение моточасов) не переякоривает регламенты → после замены
   «ТО просрочено» гаснет надолго (F4).
4. ВАЖНО. Ручная правка `nextMaintenanceAtHours`/`nextMaintenanceDate` в карточке молча
   перетирается ближайшим закрытием наряда (F5).
5. МЕЛОЧЬ. Границы «скоро/просрочено» не совпадают между блокером готовности (>50 м/ч) и
   критерием «скоро» (≤50 м/ч); HOURS-регламенты игнорируют `leadTimeDays` (F6, F7).

## Методика

Что искалось (чтобы можно было повторить):
- `rg -n "evaluatePlanDue|checkMaintenanceDue|projectNextMaintenance|nextMaintenanceAtHours" src` —
  все места расчёта и потребители порога.
- `rg -n "TO1|TO2|TO3|SEASONAL|MaintenanceType"` — где заданы типы ТО и интервалы.
- Прочитаны целиком: `src/lib/pm-due.ts`, `src/lib/maintenance-due.ts`,
  `src/modules/equipment/application/commands/{pm-scheduler,maintenance-plan,maintenance-regulation,meter-reading,equipment-maintenance,equipment-metadata}.ts`,
  потребители `src/components/piling/to/{to-stats,readiness-model}.ts`,
  `src/components/piling/admin-equipment/equipment-maintenance-flag.ts`,
  `src/modules/readiness/application/readiness-facts.ts`, `.../domain/readiness-score.ts`.
- Тесты: `src/lib/__tests__/pm-due.test.ts`, `.../commands/__tests__/{pm-scheduler,maintenance-plan,equipment-maintenance}.test.ts`.
- Скрипты: `scripts/{seed-maintenance-plans,backfill-maintenance-regulation}.ts`.
- Схема: `prisma/schema.prisma` (MaintenancePlan, Equipment).
Команды не запускались (read-only, без изменений кода) — числа взяты из чтения файлов и
существующих тестов, фактические прогоны помечены как не выполненные там, где это важно.

## Как считаются сроки ТО (по коду)

Модель. Поля регламента `MaintenancePlan` (`prisma/schema.prisma:789-810`): `type`
(MaintenanceType, default TO1), `triggerType` (HOURS|CALENDAR, `schema.prisma:812-815`),
`intervalHours Int?`, `intervalDays Int?`, `leadTimeDays Int @default(7)`,
`lastDoneHours Int?`, `lastDoneAt DateTime?`, `isActive`. Поля техники
(`schema.prisma:440,489-492`): `engineHoursTotal Int?` (кэш = последнее показание),
`nextMaintenanceAtHours Int?`, `nextMaintenanceDate DateTime?`.
Типы ТО (`src/modules/equipment/application/commands/equipment-maintenance.ts:17`):
EO, TO1, TO2, TO3, SEASONAL, REPAIR, FAULT, SCHEDULED, INSPECTION. Специальной логики для
TO2/TO3/SEASONAL в расчёте НЕТ — они различаются только полем `type` и настройками регламента.

Таблица «правило | файл:строка | пример расчёта | тест | риск»:

HOURS-интервал (по моточасам):
- Цель: `targetHours = lastDoneHours + intervalHours` | src/lib/pm-due.ts:61 |
  lastDone 5000 + 250 = 5250 | pm-due.test.ts:9-14 (target 5250) | нет
- Остаток: `hoursRemaining = targetHours − latestHours` | pm-due.ts:62 |
  5250 − 5100 = 150 | pm-due.test.ts:13 | нет
- Статус: `≤0` → overdue; `≤50` → due_soon; иначе ok | pm-due.ts:63-64 |
  at 5250 → overdue; 5210 → due_soon | pm-due.test.ts:16-26 | порог «скоро» жёстко 50 ч (F7)
- Нет данных (`intervalHours`/`latestHours`/`lastDoneHours` = null) → ok | pm-due.ts:58-59 |
  lastDoneHours=null при 9999 м/ч → ok | pm-due.test.ts:28-31 | ложное «ok» = пропуск (F3)
- latestHours = последнее показание, иначе кэш | pm-scheduler.ts:83 |
  meterReadings[0] ?? engineHoursTotal | — | синхронизация с кэшем (F9)

CALENDAR-интервал (по дням):
- Срок: `dueDate = lastDoneAt + intervalDays*86400000` | pm-due.ts:71 |
  2026-03-31 + 90 дн = 2026-06-29 | pm-due.test.ts:44-49 | границы по сырым мс (F8)
- Остаток: `daysRemaining = floor((dueDate − now)/86400000)` | pm-due.ts:72 | — | idem | —
- Статус: `<0` → overdue; `≤leadTimeDays` → due_soon; иначе ok | pm-due.ts:73-74 |
  leadTimeDays=7 | pm-due.test.ts:37-57 | leadTimeDays только для CALENDAR (F7)
- Нет данных (`intervalDays`/`lastDoneAt` = null) → ok | pm-due.ts:70 | — | pm-due.test.ts:56-57 | F3

Граница просрочки (техника, движок B):
- По дате: `daysUntil(nextMaintenanceDate, now) < 0` (московские сутки) | maintenance-due.ts:36-37 | — | equipment-maintenance-flag.test.ts:49 | —
- По моточасам: `engineHoursTotal >= nextMaintenanceAtHours` | maintenance-due.ts:38-41 | 9000≥9000 → overdue | flag.test.ts:41-43 | равенство = просрочка
- «Скоро»: `daysLeft ≤ 7` или `0 ≤ (порог − наработка) ≤ 50` | maintenance-due.ts:44-51 | 8950 при 9000 → soon | flag.test.ts:53-55 | 7 и 50 — константы, не из регламента

Движение срока при закрытии наряда (в транзакции):
- `plan.lastDoneHours = engineHoursAtService ?? engineHoursTotal ?? null`, `lastDoneAt = completedAt ?? now` | maintenance-regulation.ts:94,101-106 | наряд TO1 при 1250 → lastDone 1250 | equipment-maintenance.test.ts:350-355 | F9
- Проекция: ближайшие `min(targetHours)` и `min(dueDate)` по ВСЕМ активным регламентам → в Equipment | maintenance-regulation.ts:53-63,109-117 | 1350/1500 → порог 1350 | equipment-maintenance.test.ts:398-412 | перезапись ручных порогов (F5)
- Пустую проекцию не пишем | maintenance-regulation.ts:110-115 | — | — | —
- Запускается на каждый DONE; идемпотентно (не приращение) | equipment-maintenance.ts:257-261 | двойная приёмка → один порог | equipment-maintenance.test.ts:389-396 | REPAIR/FAULT тоже триггерят (F9/F11)

Что при замене счётчика: снижение моточасов разрешено ADMIN/MECHANIC
(meter-reading.ts:74-75, allowDecrease) → engineHoursTotal = последнее показание
(syncEngineHoursTotal, meter-reading.ts:118-133). Регламенты НЕ переякориваются (F4).
Что при ручной правке карточки: `nextMaintenanceAtHours`/`nextMaintenanceDate` пишутся
напрямую (equipment-metadata.ts:56-57,111-117) и перетираются проекцией при закрытии (F5);
правка `engineHoursTotal` заводит показание в журнал (equipment-metadata.ts:95-108).

## Находки

Таблица: # | severity | path:line | проблема | сценарий / почему важно | фикс.
Все выводы — со статусом ПРОЙДЕНО (подтверждено чтением кода/теста) или ГИПОТЕЗА.

F1 | КРИТИЧНО | src/lib/pm-due.ts:44-75 + src/lib/maintenance-due.ts:31-42 + src/app/api/maintenance-plans/route.ts:43-46 + src/components/piling/to/readiness-model.ts:90,183-196 | Два независимых расчёта просрочки. Экран «Регламенты» считает по плану (`evaluatePlanDue`), а готовность/карточка/журнал — по порогу техники (`checkMaintenanceDue`). | План TO1 (250 м/ч) отредактировали на 100 м/ч, но порог `Equipment.nextMaintenanceAtHours` не пересчитан. Регламент просрочен, а `deriveEquipmentReadiness` (readiness-model.ts:183) вернёт не OVERDUE, status=READY, `canOperate=true` → оператора допускают к технике с просроченным ТО. Противоположно — тоже: ложная блокировка. ПРОЙДЕНО (чтение кода). | Единый источник: готовность считать по регламентам (`evaluatePlanDue`), либо пересчитывать проекцию при любом изменении плана.
F2 | ВАЖНО | src/modules/equipment/application/commands/maintenance-plan.ts:73-123 (нет обращения к Equipment) | `updateMaintenancePlan`/`createMaintenancePlan` меняют только строку регламента; `Equipment.nextMaintenanceAtHours/Date` не пересчитывается. Единственная точка синхронизации — закрытие наряда (`maintenance-regulation.ts:109-117`) и ручной скрипт backfill. | Завели/поправили регламент — бейдж «ТО» и готовность живут на старом пороге до следующего закрытия наряда или запуска backfill-скрипта вручную. ПРОЙДЕНО. | Вызывать `projectNextMaintenance` (как в maintenance-regulation.ts:109) после create/update/delete плана, в той же транзакции.
F3 | ВАЖНО | src/lib/pm-due.ts:58-59,70 + scripts/seed-maintenance-plans.ts:74-78 | Регламент без точки отсчёта (`lastDoneHours`/`lastDoneAt` = null) всегда возвращает status='ok' («нет данных — не тревожим»). | Seed по умолчанию (`--start=last-service`) при отсутствии закрытых нарядов заводит регламент с `lastDoneHours=null`. По факту техника может быть сильно перепробежана, но ни регламент, ни планировщик просрочку не поднимут. Неразличимы «данных нет» и «норма». ПРОЙДЕНО (комментарий seed:15-19 это подтверждает). | Отдельный статус «нет данных» вместо 'ok'; показывать в списке регламентов и требовать точку отсчёта.
F4 | ВАЖНО | src/modules/equipment/application/commands/meter-reading.ts:74-75,118-133 (снижение разрешено ADMIN/MECHANIC) | Замена счётчика (моточасы вниз) обновляет только `engineHoursTotal`; `MaintenancePlan.lastDoneHours` и `Equipment.nextMaintenanceAtHours` не переякориваются. | Счётчик заменили, наработка стала ≈0. Порог ТО остался на старом (большом) значении, цель регламента = старый lastDone + интервал. «ТО просрочено» гаснет на длительный срок — реальный пробег нового счётчика не учитывается. ГИПОТЕЗА (нет кода, реагирующего на снижение; подтверждено отсутствием обработчика). | При снижении показания (событие замены) сбрасывать/пересчитывать точки отсчёта регламентов техники.
F5 | ВАЖНО | src/components/piling/admin-equipment/equipment-metadata.ts:56-57,111-117 (прямая запись порога) + src/modules/equipment/application/commands/maintenance-regulation.ts:97-117 | Ручная правка `nextMaintenanceAtHours`/`nextMaintenanceDate` в карточке техники молча перетирается проекцией при следующем закрытии ЛЮБОГО наряда (REPAIR/FAULT тоже, если есть ≥1 активный регламент). | Админ вручную двигает порог, чтобы срочно погасить/поднять «ТО». Через день закрывают любой наряд — порог возвращается к расчётному. ПРОЙДЕНО (maintenance-regulation.ts:113-114 пишет проекцию, если она непуста). | Показывать в карточке, что поле управляется регламентом, либо запретить ручную правку при активных регламентах.
F6 | МЕЛОЧЬ | src/modules/readiness/domain/readiness-score.ts:178-179 (`> 50`) vs src/lib/maintenance-due.ts:49 (`left <= 50`) | Блокер `MAINTENANCE_OVERDUE_50H` срабатывает строго при перепробеге >50 м/ч, а «скоро» по моточасам — при остатке ≤50. Границы соседние, но не согласованы. | При перепробеге ровно 50 м/ч статус уже не «скоро», но ещё и не блокер — «серая зона», где сигнал пропадает. ПРОЙДЕНО. | Согласовать константу (>=) или вынести в правило готовности.
F7 | МЕЛОЧЬ | src/lib/pm-due.ts:64 (HOURS: фикс. 50 ч) vs :74 (CALENDAR: leadTimeDays) | Для HOURS-регламентов `leadTimeDays` (default 7) не используется вовсе; окно предупреждения всегда 50 м/ч. | Админ ставит leadTimeDays=14 — для календарного работает, для моточасового нет. Несогласованное поведение настроек. ПРОЙДЕНО. | Либо применять leadTimeDays и к HOURS (пересчётом в часы), либо явно подписать в UI, что для HOURS порог фиксирован.
F8 | МЕЛОЧЬ | src/lib/pm-due.ts:71-72 (floor по сырым мс) vs src/lib/format.ts:84-93 (московские сутки) | CALENDAR-остаток считается делением ms без часового пояса; движок B — по календарным суткам Europe/Moscow. | На границе суток два экрана могут разойтись на ±1 день. ПРОЙДЕНО (чтение обеих функций). | Считать CALENDAR тем же хелпером `daysUntil`.
F9 | МЕЛОЧЬ | src/modules/equipment/application/commands/maintenance-regulation.ts:94,101-105 | При закрытии HOURS-наряда без наработки (`engineHoursAtService` и `engineHoursTotal` = null) `lastDoneAt` обновится, а `lastDoneHours` — нет. | Цель не сдвинется, но дата «последнего выполнения» станет свежей → визуально «ТО недавно делали», хотя прогресс не изменился. ПРОЙДЕНО. | Не обновлять `lastDoneAt`, если факт выполнения не подтверждён наработкой.
F10 | МЕЛОЧЬ | src/app/api/maintenance-plans/route.ts:21-23 | Валидация: положительные int для интервалов, min(0) для leadTimeDays; верхней границы нет. | Можно задать абсурдный интервал (1 или 10 000 000 м/ч) — расчёт не защищён разумными рамками. ПРОЙДЕНО (zod-схема). | Добавить разумный `.max(...)` и предупреждение в UI.
F11 | МЕЛОЧЬ | src/modules/equipment/application/commands/maintenance-regulation.ts:53-63 | Одна пара полей `Equipment` вмещает минимум по всем регламентам; несколько планов разных типов/баз сводятся к одному числу. | После закрытия наряда одного типа порог техники определяется «отставшим» регламентом другого типа (его база не двигалась). Возможны скачки порога между прогонами. ГИПОТЕЗА (математика projectNextMaintenance, эффект зависит от данных). | Хранить/показывать порог по каждому регламенту, а не один на технику.
F12 | МЕЛОЧЬ | src/workers/unified-worker/pm-scheduler.ts:16 (24ч), :110-119 (дедуп) | Авто-создание наряда ТО раз в сутки с идемпотентным дедупом по открытому наряду. | Если между прогонами статус оказался «открыт» — новый наряд не создаётся; просрочка может «залипнуть» в списке уведомлений до следующего дня. Информационно. ПРОЙДЕНО. | —
F13 | МЕЛОЧЬ | scripts/seed-maintenance-plans.ts:33-36 (только TO1/TO2) + src/lib/pm-due.ts (нет ветвлений по type) | SEASONAL/TO3 не имеют ни встроенной интервальной логики, ни seed-регламента; сезонный регламент заводится вручную как CALENDAR-план. | Владелец может ожидать «сезонное ТО раз в год» из коробки, но таких регламентов в seed нет. ПРОЙДЕНО. | Отразить в документации/UI, что сезонное — обычный CALENDAR-регламент.
F14 | МЕЛОЧЬ | src/modules/equipment/application/commands/equipment-maintenance.ts:257-261 + maintenance-regulation.ts:22-23,97-98 | `advanceMaintenanceRegulation` запускается на закрытие наряда ЛЮБОГО типа (в т.ч. REPAIR/FAULT) и пересчитывает проекцию по всем планам. | Закрытие ремонта может изменить пороги ТО (пересчёт), хотя ремонт ТО не является. Обычно безвредно, но неочевидно. ГИПОТЕЗА. | Ограничить пересчёт проекции нарядами типов, привязанными к регламенту, либо задокументировать.

Категории: расхождение источников — 2 (F1,F2); пропуск/ложный «ok» — 2 (F3,F4);
перезапись ручных данных — 1 (F5); границы/константы — 3 (F6,F7,F8); прочее — 6 (F9-F14).

## Не проверено

- Фактические прогоны тестов НЕ выполнялись (задача read-only, изменения кода запрещены;
  линт/tsc/playwright не запускались). Сошлюсь на существующие спеки, но их текущий
  pass/skip не подтверждён.
- Реальные данные БД (сколько регламентов без точки отсчёта, сколько техники с расхождением
  порогов) не читались — только код. Масштаб F3/F4/F11 на парке НЕ ПРОВЕРЕНО.
- Наличие/поведение сезонных регламентов в проде (есть ли они вообще) — НЕ ПРОВЕРЕНО.
- Влияние на мультитенантность/RLS расчётов ТО отдельно не аудировалось (вне фокуса).
- Точная семантика `daysRemaining` на границе суток для CALENDAR при ненулевом времени
  `lastDoneAt` — выведена из чтения кода, не воспроизведена прогоном.
- Поведение при одновременных закрытиях/правках (конкурентность) за пределами
  advisory-замка планировщика — НЕ ПРОВЕРЕНО.


