# AU53-S6-FUEL-METERS — топливо и моточасы: ввод, замена счётчика, расчёты

Ревизия (git rev-parse HEAD): **24825075f2e85415b2b16316f61776d550103c34**
Ветка рабочей папки: hermes/q4-0926 (worktree). Только чтение, код не менялся.
Файл отчёта: docs/audits/hermes-night/AU53-S6-FUEL-METERS.md

## Итог

- Найдено 13 позиций: **0 критично, 4 важно, 9 мелочь**, плюс 1 гипотеза.
- Модель здоровая: наработка — журнал `MeterReading` (истина), `Equipment.engineHoursTotal` — кэш «последнего показания» (уже без `GREATEST`, решение владельца 07.10.2026); топливо — журнал `FuelLog`, расход выводится, не хранится.
- Замена счётчика оформлена явно: `canDecreaseMeter` (ADMIN/MECHANIC) + `allowDecrease`, снижение уходит с предупреждением, кэш пересчитывается базой под `FOR UPDATE`.
- Главный риск — **рассинхрон «источник → кэш → план ТО»**: обнуление наработки в карточке пишет NULL мимо журнала; наряд, созданный сразу `DONE`, не пишет показание и не двигает регламент; замена счётчика не сбрасывает план ТО, и «ТО просрочено» не загорится.
- Ввод показания с **будущей даты** не ограничен — одна такая запись блокирует оператору ввод реальных моточасов (422 «Счётчик назад не идёт») до наступления этой даты.
- Тесты команд моточасов/топлива/планировщика проходят: 5 файлов / 72 теста (exit 0); запросы+готовность: 2 файла / 52 теста (exit 0).

## Резюме для владельца (5 строк)

1. Механика учёта наработки и топлива в порядке: журнал — истина, поле установки — кэш, топливо считается из долива и остатка, «л/моточас» берёт моточасы из того же журнала.
2. Порядок проверок единый: целое ≥ 0 → «назад не идёт» (отказ оператору, предупреждение админу/механику) → предупреждение о скачке > 20 м/ч; покрыто тестами.
3. Три места могут разойтись по числам: очистка наработки в карточке (обнуляет кэш мимо журнала), создание наряда сразу закрытым (показание не попадает в журнал), замена счётчика (план ТО остаётся на старых моточасах).
4. Ввод показания будущей датой не запрещён — это способ случайно «застопорить» ввод моточасов на машине.
5. Топливо: расход и «л/моточас» считаются честно (null вместо нуля), но возможен отрицательный расход в сводке и дубль записи при двойном нажатии.

## Методика (как повторить)

Команды:
- `git rev-parse HEAD` → 24825075f2e85415b2b16316f61776d550103c34
- `node node_modules/vitest/vitest.mjs run src/modules/equipment/application/commands/__tests__/meter-reading.test.ts .../fuel-log.test.ts .../equipment-maintenance.test.ts .../pm-scheduler.test.ts .../equipment-metadata.test.ts` → 5 passed, 72 tests passed, exit 0
- `node node_modules/vitest/vitest.mjs run src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts src/components/piling/to/__tests__/readiness-score.test.ts` → 2 passed, 52 tests passed, exit 0

Поиск (search_files): `моточас|motoHour|engineHour`, `fuel|топлив|Fuel`, `engineHoursTotal|engineHoursDelta|fuelTankLiters`, `recordMeter|MeterReading`, `GREATEST|nextMaintenanceAtHours|lastDoneHours|MaintenanceRule`, `allowDecrease|canDecreaseMeter|dedupeByNote`, `MAINTENANCE_OVERDUE`.

Прочитаны (полностью или фрагментами): meter-reading.ts, fuel-log.ts, maintenance-regulation.ts, maintenance-plan.ts, pm-scheduler.ts, equipment-maintenance.ts, equipment-metadata.ts, equipment-query.service.ts (сводка топлива), inspection-commands.ts (хвост), lib/pm-due.ts, lib/maintenance-due.ts, readiness-score.ts (application + domain), readiness-rules.ts, api-роуты meter-readings, fuel, maintenance, equipment/[id], reports/upsert; UI: meter-readings-panel.tsx, operator/meter-reading-dialog.tsx, to/fuel-panel.tsx, equipment-maintenance-flag.ts, equipment-form.tsx, work-order-form-dialog.tsx, report-form/use-report-form.ts; prisma/schema.prisma (модели MeterReading/FuelLog/MaintenancePlan) и миграции (meter_reading_journal, fuel_log). Существующие отчёты в docs/audits/ (кроме своего) не читались.

## Ввод и расчёт: правила, где проверяются, тест

Обозначения: ПРОЙДЕНО — проверено командой/тестом; НЕ ПРОВЕРЕНО — проверки в коде нет либо теста нет; ГИПОТЕЗА — вывод по чтению кода без прогона.

| Правило | Где проверяется (файл:строка) | Что при нарушении | Тест | Статус |
|---|---|---|---|---|
| Показание — целое ≥ 0 | `src/modules/equipment/application/commands/meter-reading.ts:252-254`; схема `src/app/api/equipment/[id]/meter-readings/route.ts:36` | 400 | meter-reading.test.ts:75-78 | ПРОЙДЕНО |
| Счётчик назад не идёт (оператор) | `meter-reading.ts:155-159`; вызов `.../meter-readings/route.ts:103`; кто вправе `meter-reading.ts:74-75` | 422 «Счётчик назад не идёт» | meter-reading.test.ts:109-118, 236-246 | ПРОЙДЕНО |
| Снижение при замене счётчика (ADMIN/MECHANIC) | `meter-reading.ts:155-159` (allowDecrease) | предупреждение, запись принята | meter-reading.test.ts:120-127, 230-232 | ПРОЙДЕНО |
| Скачок вверх > 20 м/ч (METER_JUMP_WARN_HOURS) | `meter-reading.ts:33, 162-168` | предупреждение, запись принята | meter-reading.test.ts:129-140, 218-224 | ПРОЙДЕНО |
| Дедуп повторной отправки отчёта по пометке | `meter-reading.ts:197-203`; вызов `reports/upsert/route.ts:112` | вторая запись не создаётся | meter-reading.test.ts:142-168 | ПРОЙДЕНО |
| Кэш наработки = последнее показание (без GREATEST) | `meter-reading.ts:118-133`; при удалении `:283` | кэш = последнее по recordedAt/createdAt/id | meter-reading.test.ts:80-107, 189-199 | ПРОЙДЕНО |
| Блокировка строки установки на запись показания | `meter-reading.ts:103-109, 191` | сериализация двух записей | meter-reading.test.ts:80-95 | ПРОЙДЕНО |
| Хотя бы одно из «долив/остаток»; долив ≥ 0; остаток 0–100 | `fuel-log.ts:101-109`; схема `fuel/route.ts:34-35, 40-42` | 400 | прямой юнит-тест ветки отсутствует | НЕ ПРОВЕРЕНО |
| Расход = долив + (бак·(старт%−конец%)/100); иначе null | `fuel-log.ts:72-88` | `consumedLiters/perEngineHour = null` | fuel-log.test.ts:23-114 | ПРОЙДЕНО |
| Перебег по моточасам в готовности и блокер > 50 м/ч | `readiness-score.ts` (application):145-146,183; domain readiness-score.ts:151-155,178-179 | балл «Обслуживание» падает; MAINTENANCE_OVERDUE_50H = WARN_ONLY | to/__tests__/readiness-score.test.ts | ПРОЙДЕНО |
| Сдвиг регламента ТО при закрытии наряда | `maintenance-regulation.ts:97-117` | lastDoneHours/lastDoneAt + проекция в Equipment | equipment-maintenance.test.ts | ПРОЙДЕНО |
| Дедуп нарядов планировщика (advisory lock) | `pm-scheduler.ts:105-119` | второй PLANNED не создаётся | pm-scheduler.test.ts | ПРОЙДЕНО |
| Замена счётчика: кэш пересчитывается, но план ТО — нет | `meter-reading.ts:155-159` vs `maintenance-regulation.ts:101-109` | «ТО просрочено» не загорится (перебег < 0) | — | ГИПОТЕЗА |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как исправить |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/equipment/application/commands/meter-reading.ts:186`; `src/app/api/equipment/[id]/meter-readings/route.ts:35-40` | `recordedAt` не ограничен сверху (нет «не позже сейчас») | Панель /admin/to и API принимают показание с будущей датой (`type=date` без `max`, `toDate` без проверки). Оно становится «последним показанием» (`orderBy recordedAt desc`). Оператор вводит реальные мточасы < будущего числа → 422 «Счётчик назад не идёт», ввод на машине стоит до наступления этой даты | Валидировать `recordedAt <= now + допуск`; либо сравнивать новое показание с хронологически предыдущим к его дате, а не с глобально последним |
| 2 | важно | `src/modules/equipment/application/commands/equipment-metadata.ts:93-97` | Очистка наработки в карточке пишет NULL напрямую, минуя журнал | В журнале есть показания, админ очищает поле → `engineHoursTotal = NULL`. Кэш расходится с источником истины: готовность видит «нет показания» (`readiness-score.ts:183`), дашборд — «Нет данных», а планировщик берёт наработку из журнала (`pm-scheduler.ts:83`) — два механизма читают разные числа | Обнуление проводить через журнал/пересчёт, либо запрещать при непустом `MeterReading` |
| 3 | важно | `src/modules/equipment/application/commands/equipment-maintenance.ts:58-100` (create) vs `:257-267` (update DONE) | Наряд, созданный сразу со статусом DONE и `engineHoursAtService`, не пишет показание и не двигает регламент | `createMaintenance` не вызывает ни `recordServiceHours`, ни `advanceMaintenanceRegulation`. Роут принимает `status: 'DONE'` (`maintenance/route.ts:21-22`), форма шлёт `form.status` на создание (`work-order-form-dialog.tsx:229`) → путь достижим. Наработка и срок ТО молча теряются | В `createMaintenance` при `status==='DONE'` вызывать те же `recordServiceHours`/`advanceMaintenanceRegulation`, что в `updateMaintenance` |
| 4 | важно | `src/modules/equipment/application/commands/meter-reading.ts:155-159` + `maintenance-regulation.ts:101-109`, `readiness-score.ts` (application):145-146 | Замена счётчика не сбрасывает план ТО | 3000 → 99 м/ч (замена) проходит с warning, но `MaintenancePlan.lastDoneHours` и `Equipment.nextMaintenanceAtHours` остаются на старых больших числах. Перебег `99 − 3250 < 0` → «ТО просрочено» не загорится, пока заново не наберётся прежний порог. ГИПОТЕЗА по эффекту, факт по коду | При снижении с заменой сдвигать `lastDoneHours`/`nextMaintenanceAtHours` на новое показание (или явное действие «счётчик заменён» с новым базисом плана) |
| 5 | важно (в паре с 3) | `equipment-maintenance.ts:319-321` | Приёмка уже закрытого наряда не пишет показание | Если наряд закрыт через create-с-`DONE` (находка 3), то приёмка тоже пропускает запись (`existing.status === 'DONE'`) — `engineHoursAtService` не попадает в журнал никогда | Закрывать путь создания сразу-DONE (одно место вместо двух) |
| 6 | мелочь | `meter-reading.ts:88-92` (latestReading) vs `:118-133` (syncEngineHoursTotal) | Разный набор ключей сортировки «последнего показания»: чтение — `recordedAt, createdAt`; кэш — `recordedAt, createdAt, id` | При двух показаниях в одну миллисекунду проверка монотонности и кэш могут смотреть на разные строки | Привести `orderBy`/`ORDER BY` к одному виду (добавить `createdAt`, `id`) везде, включая `pm-scheduler.ts:69` |
| 7 | мелочь | `fuel-log.ts:72-88`; `src/components/piling/to/fuel-panel.tsx:156-158` | Отрицательный `consumedLiters` отображается как есть | Тест fuel-log.test.ts:44-53 фиксирует `consumedLiters = −20`. Плашка «Расход, 30 дн.» покажет «-20 л» — ложное впечатление | Клампить к 0 либо показывать прочерк при `consumedLiters < 0` с пояснением |
| 8 | мелочь | `fuel-log.ts:101-109`; `src/app/api/equipment/[id]/fuel/route.ts:32-42` | Долив не проверяется против объёма бака `fuelTankLiters` | 5000 л в бак 400 л принимается; сводка расхода поедет | Предупреждать, если `litersAdded > fuelTankLiters` (бака-то больше нет) |
| 9 | мелочь | `fuel-log.ts` (addFuelEntry, 90-132) | Нет дедупликации повтора, в отличие от моточасов | Двойное нажатие «Сохранить» в FuelPanel (`fuel-panel.tsx:101-131`) создаёт две одинаковые записи; «Долив, 30 дн.» удваивается | Тот же приём, что `dedupeByNote` у моточасов (`meter-reading.ts:197-203`) |
| 10 | мелочь | `src/modules/equipment/application/queries/equipment-query.service.ts:302` | Остаток на начало при отсутствии замера до периода берётся от первого замера ВНУТРИ периода, а его долив уже входит в `litersAdded` (`:288`) | Короткий журнал → расход завышен. ГИПОТЕЗА | Не включать долив первого замера-«заменителя старта» в сумму, либо помечать приблизительность |
| 11 | мелочь | `maintenance-regulation.ts:110-117`; `src/components/piling/admin-equipment/equipment-form.tsx:295` | Проекция срока молча перезаписывает ручной порог в карточке | Админ ставит `След. ТО по моточасам` вручную; при активных регламентах закрытие наряда перезапишет поле проекцией | Показывать в карточке, что значение управляется регламентом; либо не писать проекцию поверх ручного значения |
| 12 | мелочь | `src/app/api/reports/upsert/route.ts:102-112` | Показание из сменного отчёта пишется с `recordedAt = «сейчас»`, а не `validatedDto.date` | Отчёт задним числом ставит показание в журнал сегодняшней датой; при корректировке порядка показаний это создаёт путаницу | Передавать дату отчёта как `recordedAt` (как уже делают осмотр и закрытие наряда) |
| 13 | мелочь | `equipment-maintenance.ts:265-266` + `meter-reading.ts:197-203` | Повторное закрытие того же наряда (DONE→IN_PROGRESS→DONE) даёт второе показание | `statusChanged && DONE` срабатывает каждый раз, а `recordedAt = completedAt` (не меняется) и дедупа нет — в журнале две одинаковые записи с одной датой | Дедуп по `note`+значению либо запись только при первом переходе в DONE |
| 14 | мелочь (ГИПОТЕЗА) | `pm-scheduler.ts:83` vs `readiness-score.ts` (application):183 | Планировщик судит о сроке ТО по журналу, готовность — по кэшу | При рассинхроне (находка 2) два механизма считают разные «текущие моточасы» | Единый геттер наработки (журнал → фолбэк на кэш) для всех потребителей |

## Возможные рассинхроны: показания ↔ кэш ↔ планы ТО

1. **Кэш ↔ журнал (находка 2).** `Equipment.engineHoursTotal` обнуляется в карточке напрямую; журнал `MeterReading` при этом не пуст. Готовность и дашборд читают кэш, планировщик — журнал (`pm-scheduler.ts:83`). Пока новое показание не введено, источник и кэш разойдутся.
2. **Создание-сразу-DONE (находка 3/5).** Показание не попадает в журнал, регламент не сдвигается. Кэш наработки и `MaintenancePlan.lastDoneHours` остаются прежними.
3. **Замена счётчика (находка 4).** Кэш снижается (это правильно), но план ТО и `Equipment.nextMaintenanceAtHours` остаются на старых моточасах → перебег уходит в минус, тревога ТО не срабатывает.
4. **Порядок полей (находка 6).** Чтение «предыдущего» и запись кэша используют разный набор ключей сортировки — при равных `recordedAt/createdAt` возможны разные строки.
5. **Ручной порог ↔ проекция (находка 11).** Поле `nextMaintenanceAtHours` живёт двойной жизнью: ручное значение админа и результат проекции из регламентов.
6. **Отчёт задним числом (находка 12).** Показание получает дату ввода, а не дату отчёта, — влияет и на кэш (последнее по `recordedAt`), и на `engineHoursAt` сводки топлива (`equipment-query.service.ts:251-258`).

## Не проверено

- **Готовность и планировщик на живых данных** не запускались: интеграционные спеки vitest не читают `.env` и молча пропускаются (память проекта), БД не поднималась. Отсюда статусы ГИПОТЕЗА у находок 4 и 10 и у «рассинхрона 3».
- **Ветка валидации `addFuelEntry` (долив/остаток, 400)** не покрыта прямым юнит-тестом — проверил только чтением `fuel-log.ts:101-109` и схемы роута.
- **Реальный эффект `allowDecrease` через приёмку/осмотр на стенде** — не проверял (нет живой БД и стенда).
- **`requestReadinessSnapshot` с `occurredAt` в прошлом** (для задним числом показания) — поведение воркера не разбирал, вне scope.
- **Экспорт/PDF и аналитика (`equipment-analytics-service.ts`) как потребители топлива/моточасов** — беглый просмотр, в таблицу не выносил.
- Проверка «строка существует» для всех `path:line`: строки взяты из прочитанных файлов; отдельного скрипта сверки номеров не запускал.
