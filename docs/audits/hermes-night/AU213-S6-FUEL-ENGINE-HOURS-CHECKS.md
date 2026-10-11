# AU213-S6-FUEL-ENGINE-HOURS-CHECKS — проверки моточасов и топлива при вводе

Версия (git rev-parse HEAD): `01e958b969c0050f9963129467b6aa4a3143bcb1`
Ветка: `hermes/q4-0926`. Только чтение, код приложения не менялся.

## Итог

Проверки ввода моточасов и топлива в проекте есть и работают: правило «счётчик назад не идёт» (отказ 422 оператору, предупреждение администратору/механику), предупреждение о скачке больше 20 м/ч, запрет отрицательного долива и остатка вне 0–100 %. Всё это покрыто тестами — прогон ниже: 30 тестов пройдено, 0 пропущено.

Найдено 15 замечаний: критичных 0, важных 6, мелких 9. Разрушения данных и дыр в доступе не найдено; все замечания — про границы ввода, тупиковые состояния и текст отказа.

Топ-5:
1. У показания моточасов нет верхней границы (`meter-readings/route.ts:36`), а исправить вниз оператор не может — опечатка лишним нулём уходит в наработку, ТО и готовность, разбирает её только админ.
2. Будущая дата показания не ограничена (`meter-readings/route.ts:37`) и становится «последней» — все честные последующие показания получают 422.
3. Первое показание не проверяется вовсе (`meter-reading.ts:153`): ни скачок, ни ноль.
4. Моточасы, введённые при старте осмотра, не проверяются, а при завершении отказ 422 блокирует осмотр навсегда — исправить число в осмотре из UI нельзя (`inspections/route.ts:18,26` → `inspection-commands.ts:445-451` → `inspections/[id]/route.ts:56`).
5. Текст отказа в формах топлива и моточасов теряется: человек видит «Некорректные данные» без причины, хотя в проекте есть готовый `apiErrorMessage` (`fuel/route.ts:90-95`, `fuel-panel.tsx:119`, `meter-readings-panel.tsx:110`).

Все находки — по не-замороженным областям. Экраны оператора (operator-v2/v5/v7, operator-mobile) и сайт ORION не проверялись.

## Методика

Поиск и чтение:
- `rg` по полям: `engineHours`, `engineHoursTotal`, `engineHoursAtService`, `MeterReading`, `fuelLiters`/`litersAdded`/`tankPercent`/`FuelLog`, а также по русским словам «моточас», «м/ч», «топлив», «долив», «остаток».
- Отдельно искались все точки ВВОДА (маршруты POST/PUT и формы), а не только чтение: `src/app/api/equipment/[id]/meter-readings/route.ts`, `.../meter-readings/[readingId]/route.ts`, `.../fuel/route.ts`, `.../fuel/[entryId]/route.ts`, `.../maintenance/route.ts`, `.../[recordId]/route.ts`, `src/app/api/inspections/route.ts`, `src/app/api/inspections/[id]/complete/route.ts`, `src/app/api/reports/upsert/route.ts`, `src/app/api/maintenance-plans/route.ts`, `src/app/api/equipment/route.ts`, `src/app/api/equipment/[id]/route.ts`.
- Домен: `src/modules/equipment/application/commands/meter-reading.ts`, `fuel-log.ts`, `equipment-metadata.ts`, `equipment-maintenance.ts`, `src/modules/inspections/application/commands/inspection-commands.ts`, запросы `src/modules/equipment/application/queries/equipment-query.service.ts`.
- Схемы входных данных: `src/lib/validation-schemas.ts` (строки 179, 246) и zod-схемы в маршрутах.
- UI ввода/ошибок: `src/components/piling/to/meter-readings-panel.tsx`, `to/fuel-panel.tsx`, `report-form/use-report-form.ts`, `report-form/shift-info.tsx`, `admin-equipment/equipment-form.tsx`, `maintenance/work-order-form-dialog.tsx`, `inspections/start-inspection-form.tsx`, `inspections/run-inspection.tsx`, `src/lib/api-error-message.ts`.
- Модель данных (только чтение): `prisma/schema.prisma:731` (MeterReading), `:762` (FuelLog) — CHECK-ограничений по диапазонам нет, вся защита в коде.
- Тесты: `src/modules/equipment/application/commands/__tests__/meter-reading.test.ts`, `fuel-log.test.ts`, `equipment-metadata.test.ts`, `src/app/api/equipment/[id]/meter-readings/__tests__/route.test.ts`, `src/app/api/equipment/[id]/fuel/[entryId]/__tests__/route.test.ts`.

Команда прогона (без пайпов, exit code проверен):
`node node_modules/vitest/vitest.mjs run src/modules/equipment/application/commands/__tests__/meter-reading.test.ts src/modules/equipment/application/commands/__tests__/fuel-log.test.ts`
Результат: `Test Files 2 passed (2)`, `Tests 30 passed (30)`, `skipped 0`, exit code 0, 1.45 s.

Правило учёта по коду (для сверки таблицы):
- `checkMeterReading(engineHours, previousHours, {allowDecrease})` — `src/modules/equipment/application/commands/meter-reading.ts:148`.
- Порог скачка `METER_JUMP_WARN_HOURS = 20` — `meter-reading.ts:33`.
- Кто вправе снижать счётчик: `canDecreaseMeter` = только ADMIN/MECHANIC — `meter-reading.ts:74`.
- Отказ = 422 (число корректно, его отвергает правило учёта) — `meter-reading.ts:209-210`.

## Находки

Легенда статусов: ПРОЙДЕНО — проверка существует и подтверждена чтением кода/тестом; ПРОБЕЛ — проверки нет (подтверждено чтением); ГИПОТЕЗА — поведение выведено логически, живьём не воспроизводил.

| # | severity | поле | файл:строка | проверка | риск / сценарий | рекомендация | статус |
|---|---|---|---|---|---|---|---|
| 1 | важно | моточасы (журнал) | `D:/PillingR/wt-night/src/app/api/equipment/[id]/meter-readings/route.ts:36` | только `int().min(0)`, верхней границы НЕТ | Опечатка «56700» вместо «5670» принимается: сработает лишь текстовое предупреждение и только если есть предыдущее показание. Становится последним, пересчитываются наработка, срок ТО и балл готовности; исправить вниз оператор не может (`meter-reading.ts:155-160`) — нужен админ. Для сравнения: отчёт `max 500_000` (`validation-schemas.ts:246`), карточка `max 1_000_000` (`:179`) | добавить `.max()` (взять тот же порог, что у отчёта) и показывать отказ словами | ПРОБЕЛ |
| 2 | важно | моточасы (журнал) | `D:/PillingR/wt-night/src/app/api/equipment/[id]/meter-readings/route.ts:37` | `z.coerce.date()` без верхней границы | Показание с датой в будущем (опечатка в годе) становится «последним»: выборка идёт по `recordedAt desc` (`meter-reading.ts:88-92`), поэтому каждое следующее честное показание ниже неё → 422 у оператора. Выход — только через админа (удаление/снижение показания) | не принимать `recordedAt` позже сейчас (или ограничить «сегодня + 1 день») | ПРОБЕЛ |
| 3 | важно | моточасы (первое показание) | `D:/PillingR/wt-night/src/modules/equipment/application/commands/meter-reading.ts:153` | при отсутствии предыдущего — сразу `{reject:null, warning:null}`: ни скачка, ни нуля | Установка без журнала: и `0`, и `999999` принимаются молча, запись становится базой для всех дальнейших сравнений. Тест это фиксирует как норму: `meter-reading.test.ts:210` «первое показание принимает без замечаний» | для первого показания — предупреждение при нереальном значении (например, больше 1/3 ресурса из карточки) | ПРОБЕЛ |
| 4 | важно | моточасы (осмотр) | `D:/PillingR/wt-night/src/app/api/inspections/route.ts:18` и `:26`; `D:/PillingR/wt-night/src/modules/inspections/application/commands/inspection-commands.ts:445-451`; `D:/PillingR/wt-night/src/app/api/inspections/[id]/route.ts:56` | при старте осмотра моточасы только сохраняются; при завершении пишутся в журнал БЕЗ `allowDecrease` | Снижение = отказ 422 (`meter-reading.ts:155-159`), а транзакция завершения осмотра откатывается целиком — осмотр нельзя закрыть. Исправить число после старта нельзя: PUT осмотра принимает только `answers`. Тупик снимает только админ (правкой журнала). Сообщение до человека доходит (`run-inspection.tsx:28` → `inspection-api-error.ts:43-48`), но выхода в UI нет | либо проверять часы уже при старте осмотра, либо разрешить правку часов в незавершённом осмотре, либо не валить завершение осмотра из-за показания (предупреждение вместо 422) | ПРОБЕЛ |
| 5 | важно | `source` (и часы, и топливо) | `D:/PillingR/wt-night/src/app/api/equipment/[id]/meter-readings/route.ts:38`; `D:/PillingR/wt-night/src/app/api/equipment/[id]/fuel/route.ts:37` | `z.enum(['MANUAL','TELEMETRY'])` приходит ИЗ ТЕЛА запроса, а не от пути | Оператор может отправить `source:'TELEMETRY'` и пометить ручную цифру как телеметрию: в журнале запись выглядит авторитетной и не удаляется из UI (кнопка удаления только для MANUAL — `meter-readings-panel.tsx:216`, `fuel-panel.tsx:254`). След в аудите при этом не содержит `source` | брать `source` с сервера (MANUAL для ручного маршрута, TELEMETRY — только для будущего телеметрийного канала) | ПРОБЕЛ |
| 6 | важно | долив, л | `D:/PillingR/wt-night/src/app/api/equipment/[id]/fuel/route.ts:34`; `D:/PillingR/wt-night/src/components/piling/to/fuel-panel.tsx:188-195` | `int().min(0)`, верхней границы НЕТ; сверки с объёмом бака нет | «2000» вместо «200» уходит в расход (`fuel-log.ts:78-80`) и в «л/моточас» (`:82-85`), т.е. искажает отчёт о расходе до конца периода. Объём бака в карточке есть (`Equipment.fuelTankLiters`), но не используется как ограничитель | предупреждать при доливе больше объёма бака; добавить `.max()` | ПРОБЕЛ |
| 7 | важно | моточасы и топливо (текст отказа) | `D:/PillingR/wt-night/src/app/api/equipment/[id]/fuel/route.ts:90-95`; `D:/PillingR/wt-night/src/app/api/equipment/[id]/meter-readings/route.ts:75-80`; `D:/PillingR/wt-night/src/components/piling/to/fuel-panel.tsx:119`; `D:/PillingR/wt-night/src/components/piling/to/meter-readings-panel.tsx:110` | сервер отдаёт общее «Некорректные данные» + `details`, обе панели читают ТОЛЬКО `body.error` | Дробный долив, остаток 101 %, моточасы 12.5 → человек видит «Некорректные данные» и не знает, что править. Особенно для `refine` «Укажите долив в литрах или остаток в %» (`fuel/route.ts:40-42`) — это сообщение не доходит никогда. Готовый склейщик уже есть и используется в отчётах/осмотрах: `src/lib/api-error-message.ts:16` | использовать `apiErrorMessage` в обеих панелях (и добавить подписи полей `litersAdded`/`tankPercent` в карты `api-error-message.ts:29,36`) | ПРОБЕЛ |
| 8 | мелочь | долив/остаток (сервис) | `D:/PillingR/wt-night/src/modules/equipment/application/commands/fuel-log.ts:40-41` (`asInt` = `Math.trunc`), `:101-109` | сервис молча усекает число и повторяет проверки маршрута | Через API не проявится (маршрут требует int), но `addFuelEntry` — публичная функция модуля: 150.9 станет 150 без слова. Двойной набор правил (маршрут + сервис) может разъехаться | оставить правило в одном месте или явно отклонять нецелое в сервисе | ГИПОТЕЗА |
| 9 | мелочь | моточасы (выборка «последнего») | `D:/PillingR/wt-night/src/modules/equipment/application/commands/meter-reading.ts:88-92` | `latestReading` фильтрует ТОЛЬКО по `equipmentId`, без `tenantId` (ср. `lockEquipmentRow:106` и `syncEngineHoursTotal:127,131`) | Сейчас безвредно (id — первичный ключ), но правило «чтение строго по тенанту» нарушено именно в том месте, где решается «назад не идёт»; при будущем шаринге/копировании строки это класс IDOR | добавить `tenantId` в условие | ПРОБЕЛ |
| 10 | мелочь | моточасы (карточка) | `D:/PillingR/wt-night/src/modules/equipment/application/commands/equipment-metadata.ts:82,95-97,119-124` | очистка поля пишет `NULL` напрямую в кэш, минуя журнал; ноль как «неизвестно» и как «настоящее показание» не различаются | `Equipment.engineHoursTotal` уходит в NULL, а журнал остаётся — источник истины и кэш расходятся. Ранее это описано как намеренное, но отдельной проверки/пометки «нет данных» нет: следующий расчёт ТО берёт `meterReadings[0] ?? engineHoursTotal` (`src/app/api/maintenance-plans/route.ts:45`) и покажет прежнюю цифру | либо писать нулевое/пустое значение как показание с пометкой, либо явно показывать «наработка неизвестна» и в журнале | ГИПОТЕЗА |
| 11 | мелочь | моточасы (повтор) | `D:/PillingR/wt-night/src/modules/equipment/application/commands/meter-reading.ts:197-203`; `:148-171` | дедупликация работает только при `dedupeByNote` (сменный отчёт); равное предыдущему значение не комментируется | В журнале можно молча записать одно и то же показание дважды (кроме отчёта) — тест `meter-reading.test.ts:214` «равное предыдущему — не снижение», `:170` — повтор пишется. Для «ноль»/«то же число» подряд нет даже предупреждения | при равном значении — предупреждение «показание не изменилось» | ПРОБЕЛ |
| 12 | мелочь | моточасы при закрытии наряда | `D:/PillingR/wt-night/src/modules/equipment/application/commands/equipment-maintenance.ts:183-188`; `D:/PillingR/wt-night/src/app/api/equipment/[id]/maintenance/route.ts:27`; `.../[recordId]/route.ts:28` | `allowDecrease: true` жёстко; у `engineHoursAtService` только `min(0)`, без max | Механик может вписать любое число (в т.ч. опечатку) и снизить счётчик; защита — только право `maintenance.manage`. Запись датируется `completedAt` (`:186`) — задним числом это замысел, но и будущая дата не запрещена | добавить `.max()` и предупреждение при снижении/большом скачке (сейчас снижение молчаливое) | ПРОБЕЛ |
| 13 | мелочь | моточасы из сменного отчёта | `D:/PillingR/wt-night/src/app/api/reports/upsert/route.ts:99-113`; `D:/PillingR/wt-night/src/modules/equipment/application/commands/meter-reading.ts:186` | `recordedAt` в команду НЕ передаётся → берётся «сейчас», хотя отчёт датирован `date` | Отчёт за прошлый день, заполненный задним числом, кладёт показание сегодняшним числом, хотя пометка гласит «Показание из сменного отчёта за <дату>». Сводка топлива считает наработку «на дату» (`equipment-query.service.ts:251-259`) — сдвиг влияет на л/моточас | передавать дату отчёта как `recordedAt` (с той же дедупликацией по пометке) | ПРОБЕЛ |
| 14 | мелочь | регламент ТО (часы) | `D:/PillingR/wt-night/src/app/api/maintenance-plans/route.ts:21,24` | `intervalHours` positive без max; `lastDoneHours` `min(0)` без max | «50000» в интервале вместо «500» → «ТО через 50 000 м/ч»: наряд не появится никогда, просрочка не поднимется | добавить правдоподобный `.max()` | ПРОБЕЛ |
| 15 | мелочь | моточасы (старт осмотра) | `D:/PillingR/wt-night/src/components/piling/inspections/start-inspection-form.tsx:169,172-174` | клиентской проверки нет, читается только `err.error` | Дробные/отрицательные часы дают «Некорректные данные» без указания поля. В соседнем наряде ТО такая проверка есть (`maintenance/work-order-form-dialog.tsx:90-97`), в отчёте тоже (`report-form/use-report-form.ts:415-419`) — три формы с моточасами ведут себя по-разному | перенести проверку из наряда в общий помощник и применить во всех формах | ПРОБЕЛ |

Итого по severity: критично 0, важно 6, мелочь 9 (15 находок, лимит 60 не достигнут).
Итого по областям: моточасы — 11, топливо — 3, общее (текст отказа) — 1.

### Что проверено и работает (ПРОЙДЕНО)

| поле | файл:строка | проверка | статус |
|---|---|---|---|
| моточасы | `src/modules/equipment/application/commands/meter-reading.ts:155-160` | уменьшение показаний: оператору отказ 422, ADMIN/MECHANIC — предупреждение | ПРОЙДЕНО (тесты `meter-reading.test.ts:109,120,226`) |
| моточасы | `src/modules/equipment/application/commands/meter-reading.ts:162-168` | скачок больше 20 м/ч — предупреждение, показание принимается | ПРОЙДЕНО (`meter-reading.test.ts:129,136,218,222`) |
| моточасы | `src/modules/equipment/application/commands/meter-reading.ts:252-254` | нецелое или отрицательное — отказ 400 | ПРОЙДЕНО (`meter-reading.test.ts:75`) |
| моточасы | `src/app/api/equipment/[id]/meter-readings/route.ts:103` | право снижения выводится из роли на сервере, а не из тела | ПРОЙДЕНО |
| моточасы | `src/components/piling/to/meter-readings-panel.tsx:97-101,114` | предупреждение сервера показывается оператору тостом | ПРОЙДЕНО |
| моточасы | `src/components/piling/report-form/use-report-form.ts:415-419,452-459` | в отчёте: нецелые отклоняются до отправки; `meterWarning`/`meterError` доходят до оператора | ПРОЙДЕНО |
| топливо | `src/app/api/equipment/[id]/fuel/route.ts:34-42` | отрицательный долив и остаток вне 0–100 % отклоняются; «ни одного из двух полей» — отказ | ПРОЙДЕНО |
| топливо | `src/modules/equipment/application/commands/fuel-log.ts:101-109` | та же проверка продублирована в сервисе (обход маршрута невозможен) | ПРОЙДЕНО |
| топливо | `src/modules/equipment/application/commands/fuel-log.ts:72-88` | нулевой/отсутствующий прирост моточасов — расход `null`, не деление на ноль и не выдуманный ноль | ПРОЙДЕНО (`fuel-log.test.ts:84,55,63`) |
| наработка (кэш) | `src/modules/equipment/application/commands/meter-reading.ts:103-133` | блокировка строки установки + пересчёт кэша базой: кэш = последнее показание, а не максимум | ПРОЙДЕНО (`meter-reading.test.ts:80,100`) |

## Не проверено

- Живые сценарии через HTTP (draft-запросы к API) не воспроизводились: правила читались по коду и подтверждались только модульными тестами (`Test Files 2 passed (2)`, `Tests 30 passed (30)`). Сценарии «опечатка лишним нулём», «показание с датой в будущем», «осмотр застрял на 422» помечены ПРОБЕЛ/ГИПОТЕЗА именно поэтому — веб-сервер и БД в этой сессии не поднимались.
- Замороженные области не проверялись (по правилу задачи): `src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**` (operator-v2, operator-v5, operator-mobile/v7, v10), `src/modules/operator-mobile/**`, сайт ORION. Там тоже есть ввод моточасов и топлива (например `src/components/piling/operator-v2/shift-flow.ts`, `src/modules/operator-mobile/application/commands/shift-close.ts`) — проверки в них не оценивались.
- Не проверялись пулы соединений и конкурентность вживую: выводы о гонках (блокировка строки, порядок `recordedAt`) основаны на чтении SQL в `meter-reading.ts:103-133`, не на нагрузочном тесте.
- Не проверялись интеграционные спеки, требующие БД (`vitest.integration.config.ts`): они без `.env` молча пропускаются — прогонялись только два модульных файла, указанных выше.
- Не проверялись `scripts/` и воркеры (pm-scheduler) на предмет внешней записи показаний/топлива: `prisma/schema.prisma` и `prisma/migrations/**` читались только для модели данных, миграции не сверялись с кодом (CHECK-ограничений на диапазоны полей там не найдено, но полный аудит миграций не делался).
- Точная «правдоподобная» верхняя граница моточасов (какой `.max()`) не определена: значения 500 000 у отчёта и 1 000 000 в карточке — это цитаты из кода, а не рекомендация.
