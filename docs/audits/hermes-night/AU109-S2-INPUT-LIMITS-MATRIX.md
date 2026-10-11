# AU109-S2-INPUT-LIMITS-MATRIX — Матрица допустимых значений полей ввода

Версия: `git rev-parse HEAD` → `f6fb5a1c91a35fef5691c030bfb0e2402b1044c2` (ветка `hermes/q4-0926`).
Статус аудита: только чтение, код приложения не менялся. Пути даны от корня репозитория.

## Итог

Резюме для владельца (5 строк):

1. Проверки на клиенте и на сервере совпадают не везде: у 11 полей формы отчёта, топлива и моточасов клиент пропускает значения, которые сервер затем молча отклоняет общим текстом «Некорректные данные» — оператор не видит, какое поле и какой предел нарушен.
2. Два поля вообще без верхней границы и на клиенте, и на сервере: «Залито, л» в журнале топлива (`src/app/api/equipment/[id]/fuel/route.ts:34`) и «Моточасы» в журнале наработки (`src/app/api/equipment/[id]/meter-readings/route.ts:36`). В колонках БД это `Int` (int4), поэтому абсурдно большая цифра даёт 500 от базы, а любая другая выдуманная — принимается как факт.
3. «Количество свай» и «Количество скважин» ограничены тремя разными числами: клиент — ничем, zod — тоже ничем, сервис — `9999`. Один и тот же отчёт проходит или падает в зависимости от того, какой слой сработал.
4. Простой в форме отчёта (`src/components/piling/report-form/downtime-section.tsx:60`) не ограничен 24 часами и не знает шага в четверть часа, хотя админский диалог отчёта 24 часа проверяет (`src/components/piling/admin-reports/report-form-dialog.tsx:162`). То же правило «простоя» есть на экранах машиниста, но форма отчёта его не использует.
5. Механика карточки техники (включая «Наработка моточасов» и «Объём бака») сделана правильно: пределы вынесены в один `NUM_LIMITS` и повторяют серверную схему — этот приём можно распространить на формы отчёта.

Статусы: ПРОЙДЕНО / НЕ ПРОВЕРЕНО / ГИПОТЕЗА. Все числа в таблицах взяты из прочитанного кода (`файл:строка`), вычислений «на глаз» нет.

## Методика

Что искал и как (чтобы можно было повторить):

1. Серверные схемы: открыл `src/lib/validation-schemas.ts` целиком; поиск zod по модулям —
   `search_files pattern='z\.object|z\.number|z\.coerce|z\.string' path=src/modules` (в модулях своих zod-схем отчёта нет, только `src/modules/readiness/**`).
2. Маршруты-владельцы схем: `src/app/api/reports/upsert/route.ts`, `src/app/api/reports/admin-upsert/route.ts`, `src/app/api/equipment/[id]/fuel/route.ts`, `src/app/api/equipment/[id]/meter-readings/route.ts`, `src/app/api/operator/mobile/command/route.ts`.
3. Доменные проверки поверх zod: `src/modules/reports/application/commands/report-validation.service.ts`
   и вызов `validateReportInput` из `src/modules/reports/application/commands/report-command.service.ts:89` (проверил, что валидатор реально вызывается на пути сохранения).
4. Клиентские формы: `search_files pattern='type="number"' path=src/components/piling`, затем чтение каждой формы с числовым вводом в области задачи: `src/components/piling/report-form/*` (section-файлы + `use-report-form.ts` + `shift-info.tsx`), `src/components/piling/admin-reports/report-form-dialog.tsx`, `src/components/piling/to/fuel-panel.tsx`, `src/components/piling/to/meter-readings-panel.tsx`, `src/components/piling/admin-equipment/equipment-form.tsx`.
5. Типы колонок БД для оценки риска переполнения: `prisma/schema.prisma` (`MeterReading.engineHours Int` строка 736; `FuelLog.litersAdded Int?` строка 767; `FuelLog.tankPercent Int?` строка 768).
6. Правило простоя: `src/lib/downtime-hours.ts` (`DOWNTIME_MAX_HOURS = 24`, строка 39; шаг 0,25, строка 53; разбор с запятой, строка 66).

Оговорка о чтении: раздел `docs/audits/` (кроме этого файла) и `CODEX-REPORT*`, `docs/strategy` не читал. Схему Prisma и миграции не менял.

## Матрица полей

Поля отчёта за смену, топлива и моточасов. «Схема» — серверная zod-схема; «клиент» — форма, которая это поле отправляет.

| # | Поле (RU) | Тип | Сервер min | Сервер max | Ноль | Отриц. | Дробное | Запятая | Длина текста | Файл:строка схемы | Клиент vs сервер |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Сваи: количество (`PileWork.count`) | int | 1 | нет в zod; 9999 в сервисе | нет | нет | нет (zod `.int()`) | н/п | н/п | `src/lib/validation-schemas.ts:260`; `src/modules/reports/application/commands/report-validation.service.ts:64` | НЕ СОВПАДАЕТ: клиент не ограничен сверху (`src/components/piling/report-form/pile-section.tsx:73`), и не требует целого (`src/components/piling/report-form/use-report-form.ts:363`) |
| 2 | Бурение: количество скважин (`LeaderDrilling.count`) | int | 1 | 9999 | нет | нет | нет | н/п | н/п | `src/lib/validation-schemas.ts:266` | НЕ СОВПАДАЕТ: клиент без max и без `.int()` (`src/components/piling/report-form/drilling-section.tsx:61`; `use-report-form.ts:370`) |
| 3 | Бурение: метров на 1 шт (`metersPerUnit`) | number | 0 | 9999 | да (сервер), нет (клиент) | нет | да | да (браузер — см. ГИПОТЕЗА) | н/п | `src/lib/validation-schemas.ts:267` | НЕ СОВПАДАЕТ: клиент без max (`drilling-section.tsx:63`), и требует `>0` (жёстче сервера, где 0 допустим) |
| 4 | Бурение: итого метров (`deprecated`-поле `meters`) | number | 0 | 99999 | да | нет | да | н/п | н/п | `src/lib/validation-schemas.ts:268`; `report-validation.service.ts:79` | НЕ СОВПАДАЕТ: клиент считает `count × metersPerUnit` (`use-report-form.ts:371,402`) и может превысить 99999 (9999×9999) |
| 5 | Бурение: диаметр шпура (`diameter`) | number | 0 | 999 | да | нет | да | н/п | н/п | `src/lib/validation-schemas.ts:269` | форма отчёта это поле не отправляет (НЕ ПРОВЕРЕНО, задаётся только через API) |
| 6 | Простой: длительность (`duration`), ч | number | 0 | 24 | да | нет | да | да | н/п | `src/lib/validation-schemas.ts:280`; `DOWNTIME_MAX_HOURS` в `src/lib/downtime-hours.ts:39` | НЕ СОВПАДАЕТ: форма отчёта (`src/components/piling/report-form/downtime-section.tsx:60`; `use-report-form.ts:377`) сверху не ограничена; админский диалог ограничен (`report-form-dialog.tsx:162`) |
| 7 | Простой: комментарий (`comment`) | string | — | — | — | — | — | — | 1000 | `src/lib/validation-schemas.ts:281` | НЕ СОВПАДАЕТ: `downtime-section.tsx:64` без `maxLength`; в админском диалоге стоит `maxLength={1000}` (`report-form-dialog.tsx:406`) |
| 8 | Отчёта комментарий (`comment`) | string | — | — | — | — | — | — | 2000 | `src/lib/validation-schemas.ts:283` | форма отчёта это поле не заполняет (НЕ ПРОВЕРЕНО) |
| 9 | Моточасы конца смены (`engineHours`, отчёт) | int | 0 | 500 000 | да | нет | нет | н/п | н/п | `src/lib/validation-schemas.ts:246` | НЕ СОВПАДАЕТ: клиент проверяет целое ≥ 0, но без max (`src/components/piling/report-form/use-report-form.ts:415`; `shift-info.tsx:84`) |
| 10 | Моточасы журнала (`engineHours`, /meter-readings) | int | 0 | НЕТ | да | нет | нет | н/п | н/п | `src/app/api/equipment/[id]/meter-readings/route.ts:36`; `src/modules/equipment/application/commands/meter-reading.ts:252` | СОВПАДАЕТ по отсутствию max — оба без верхней границы; клиент `min={0}` (`meter-readings-panel.tsx:163`) |
| 11 | Топливо: залито (`litersAdded`), л | int | 0 | НЕТ | да | нет | нет | н/п | н/п | `src/app/api/equipment/[id]/fuel/route.ts:34`; `fuel-log.ts:104` | СОВПАДАЕТ по отсутствию max — оба без верхней границы; клиент `min={0}`, без max (`fuel-panel.tsx:188`) |
| 12 | Топливо: остаток (`tankPercent`), % | int | 0 | 100 | да | нет | нет | н/п | н/п | `src/app/api/equipment/[id]/fuel/route.ts:35`; `fuel-log.ts:107` | НЕ СОВПАДАЕТ: клиент шлёт `Number(percent)` без проверки целого (`fuel-panel.tsx:113`), сервер требует `.int()` |
| 13 | Топливо: примечание (`note`) | string | — | — | — | — | — | — | 500 | `src/app/api/equipment/[id]/fuel/route.ts:38` | НЕ СОВПАДАЕТ: `fuel-panel.tsx:217` без `maxLength` |
| 14 | Карточка: наработка (`engineHoursTotal`) | int | 0 | 1 000 000 | да | нет | нет | н/п | н/п | `src/lib/validation-schemas.ts:179` + `NUM_LIMITS` в `equipment-form.tsx:135` | СОВПАДАЕТ (клиент скопировал серверный предел, `equipment-form.tsx:293`) |
| 15 | Карточка: объём бака (`fuelTankLiters`), л | int | 0 | 100 000 | да | нет | нет | н/п | н/п | `src/lib/validation-schemas.ts:180` + `equipment-form.tsx:136` | СОВПАДАЕТ (`equipment-form.tsx:294`) |

Три места с одним и тем же числом — «Количество свай» — расходятся (клиент: ничем; zod `validation-schemas.ts:260`: ничем; сервис `report-validation.service.ts:64`: 9999). Аналогично «Количество скважин»: клиент ничем (`drilling-section.tsx:61`), zod `validation-schemas.ts:266`: 9999.

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | `src/app/api/equipment/[id]/fuel/route.ts:34` | `litersAdded` без верхней границы; команда тоже только `>=0` (`src/modules/equipment/application/commands/fuel-log.ts:104`) | Оператор вводит «2000000000» — уходит в `Int`-колонку `prisma/schema.prisma:767`; значение выше int4 (2 147 483 647) даёт 500 от базы, любое другое абсурдное принимается как факт и попадает в расчёт расхода | Добавить разумный `max` (например `max(100_000)`) в схему маршрута и в команду |
| 2 | критично | `src/app/api/equipment/[id]/meter-readings/route.ts:36` | `engineHours` без верхней границы; команда только `Number.isInteger && >=0` (`src/modules/equipment/application/commands/meter-reading.ts:252`) | То же: значение выше int4 → 500; иначе нереальная наработка принимается и влияет на планирование ТО (`src/lib/pm-due.ts`) | Задать верхний предел, согласованный с `reportUpsertSchema` (500 000) |
| 3 | важно | `src/lib/validation-schemas.ts:260` | У `piles[].count` нет `.max()`; предел 9999 живёт в другом слое (`report-validation.service.ts:64`) | Правка zod не сдвинет реальный предел, и наоборот — расхождение незаметно; контракт API и фактическая граница разъезжаются | Перенести `max(9999)` в zod-схему |
| 4 | важно | `src/lib/validation-schemas.ts:266` | У `drillings[].count` верхняя граница есть (9999), но клиент её не знает (`src/components/piling/report-form/drilling-section.tsx:61`) | Ввод 10 000 шт. проходит на клиенте и падает на сервере текстом «Некорректные данные» без имени поля | Ограничить поле на клиенте и назвать поле/предел в ответе сервера |
| 5 | важно | `src/components/piling/report-form/use-report-form.ts:371` | `meters` клиента = `count × metersPerUnit` (`:402`) без проверки предела сервера 99999 (`src/lib/validation-schemas.ts:268`) | Большие, но по отдельности допустимые count и metersPerUnit дают `meters` > 99999 → отказ валидации всего отчёта | Проверять вычисленный `meters` до отправки (и/или считать `meters` на сервере) |
| 6 | важно | `src/components/piling/report-form/downtime-section.tsx:60` | Форма отчёта не ограничивает простой 24 ч и не знает шага 0,25 ч | Ввод «30» ч уходит на сервер (`validation-schemas.ts:280` → 400 без имени поля). При этом админский диалог предел знает (`src/components/piling/admin-reports/report-form-dialog.tsx:162`) | Использовать `DOWNTIME_MAX_HOURS` и `downtimeHoursProblem` из `src/lib/downtime-hours.ts` и в форме отчёта |
| 7 | важно | `src/components/piling/report-form/use-report-form.ts:377` | Клиентская проверка простоя — только `duration > 0`; шаг в четверть часа (`src/lib/downtime-hours.ts:53`) на пути отчёта не применяется вообще | Правило «простой только часами с шагом 1/4 ч» (решение владельца, шапка `src/lib/downtime-hours.ts:41-53`) действует на экранах машиниста, но не в форме отчёта | Переиспользовать `parseDowntimeHours` в `addDowntime` |
| 8 | важно | `src/lib/validation-schemas.ts:246` | `engineHours` отчёта ограничен 500 000, клиент верхнюю границу не проверяет (`src/components/piling/report-form/use-report-form.ts:415`) | Ввод «600000» проходит на клиенте, сервер отклоняет — оператор видит общую ошибку | Проверять тот же предел на клиенте |
| 9 | важно | `src/components/piling/report-form/fuel-panel.tsx:113` | Остаток топлива шлётся как `Number(percent)` (дробное возможно), сервер требует `.int()` (`src/app/api/equipment/[id]/fuel/route.ts:35`) | Ввод «40,5»/«40.5» отклоняется сервером как «Некорректные данные» | Округлять или валидировать целое на клиенте |
| 10 | важно | `src/components/piling/to/fuel-panel.tsx:112` | Аналогично «Залито, л» шлётся дробным `Number(liters)` при `.int()` на сервере (`src/app/api/equipment/[id]/fuel/route.ts:34`) | Дробный литраж отклоняется без указания поля | Привести типаж клиент↔сервер |
| 11 | важно | `src/lib/validation-schemas.ts:281` | Комментарий простоя `max(1000)`, форма отчёта без `maxLength` (`src/components/piling/report-form/downtime-section.tsx:64`) | Длинный комментарий (напр. вставка текста) роняет отправку всего отчёта | Поставить `maxLength={1000}` |
| 12 | важно | `src/app/api/equipment/[id]/fuel/route.ts:38` | `note` топлива `max(500)`, поле на клиенте без `maxLength` (`src/components/piling/to/fuel-panel.tsx:217`) | Длинная заметка → 400 | Поставить `maxLength={500}` |
| 13 | важно | `src/app/api/operator/mobile/command/route.ts:72` | Мобильный путь задаёт ДРУГИЕ пределы: сваи `max(500)` (`:72`), бурение `count max(500)` (`:114`), `metersPerUnit 0.1..200` (`:116`), простой `0.25..24` (`:124`) | Один и тот же домен «сваи/бурение/простой» ограничен по-разному в форме отчёта и с телефона машиниста — цифры, принятые на одном экране, отклоняются на другом | Свести границы в один общий модуль-словарь (как `DOWNTIME_MAX_HOURS`) |
| 14 | важно | `src/lib/validation-schemas.ts:283` | Общий комментарий отчёта `max(2000)` — на клиенте путь для этого поля не найден | Поле принимает данные только через API; НЕ ПРОВЕРЕНО, что формы его не шлют (раздел ниже) | Уточнить владельца поля или убрать из схемы |
| 15 | мелочь | `src/lib/validation-schemas.ts:394` | `siteManageSchema.plannedDrilling` — `z.coerce.number().min(0).max(999999)` без `.int()`, тогда как соседнее `plannedPiles` — `.int()` (`:393`) | В план бурения можно сохранить дробное число; расхождение внутри одной схемы | Добавить `.int()` для консистентности |
| 16 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:310` | «Кол-во» свай в админском диалоге: `min="1"`, без max; проверка `>0` (`:130`) | Тот же разрыв клиент/сервер, что и в форме отчёта (находка 3) | Ограничить сверху |
| 17 | мелочь | `src/components/piling/admin-reports/report-form-dialog.tsx:358` | «Кол-во» бурения и «м/шт» (`:360`) без max | Как находки 4 и 5 в админском пути | Ограничить сверху |

Итого по серьезности: критично — 2, важно — 12, мелочь — 3 (всего 17).

## Приложение: поля без верхней границы (одним взглядом)

Полностью без верхнего предела — ни клиент, ни zod, ни команда:
- `src/app/api/equipment/[id]/fuel/route.ts:34` — «Залито, л»;
- `src/app/api/equipment/[id]/meter-readings/route.ts:36` — «Моточасы» (журнал наработки).

Без верхнего предела в одном из слоёв:
- `src/lib/validation-schemas.ts:260` — `piles[].count` (предел 9999 — в `report-validation.service.ts:64`);
- клиентские входы формы отчёта: `pile-section.tsx:73,94`, `drilling-section.tsx:61,63`, `downtime-section.tsx:60`, `shift-info.tsx:84`;
- клиент топлива/моточасов: `fuel-panel.tsx:188`, `meter-readings-panel.tsx:163`.

## Не проверено

- Поведение браузера при вводе запятой в `<input type="number">` (столбец «Запятая»): ГИПОТЕЗА, что Chrome/мобильные отдают пустое значение на «1,5». Браузер в этой сессии не запускался (Hermes browser недоступен на хосте).
- Не отправляет ли какая-либо форма общий комментарий отчёта (`src/lib/validation-schemas.ts:283`) — искал только в области задачи; полный обход всех вызывающих `/api/reports/*` не делал.
- Поле «диаметр» бурения (`validation-schemas.ts:269`) — какая именно форма его шлёт, не установлено (в форме отчёта и админском диалоге поле не найдено).
- Мобильные экраны машиниста (`src/modules/operator-mobile/**`, `src/components/piling/operator*/**`) — замороженная зона по `AGENTS.md`, клиентские проверки там детально не разбирал; взял только серверные границы маршрута.
- Соответствие HTML-атрибутов `min`/`max`/`step` фактической валидации при клике «Сохранить»: атрибуты — это подсказка браузеру, а не проверка при программной отправке; подтверждено только по коду обработчиков, без прогона в браузере.
- Числа вне области задачи (аналитика, ТО-заказы, осмотры, телеметрия) не разбирал.
