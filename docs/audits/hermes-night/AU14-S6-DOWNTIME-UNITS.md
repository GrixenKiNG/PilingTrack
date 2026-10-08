# AU14-S6-DOWNTIME-UNITS: Единицы измерения простоя и выработки по всему коду

Версия кода: `git rev-parse HEAD` = `48d9ce55645db71025d9224b6ef2a75fa39639f1` (ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`).
Аудит только для чтения: код приложения не менялся; создан только этот файл.
Замороженные области (экраны машиниста `operator-*`, сайт ORION) не аудировались — если файл из них всё же упомянут, это помечено словом «заморожено».

## Итог

- Всего находок: **14** — критично: **0**, важно: **5**, мелочь: **9**.
- Величина «простой» во всех живых слоях хранится в ЧАСАХ (Float) и это согласовано; старое «минутное» наследство в агрегате уже вычищено (`report.aggregate.ts:95` — `MAX_DOWNTIME_PER_SHIFT_HOURS = 24`).
- Главная проблема — не единица, а **разъехавшиеся правила ввода и вывода** одной и той же величины «простой, часы»: шаг ввода 0,25 / 0,5 / 1 ч в трёх разных местах, четыре разных формата показа.
- Top-5:
  1. Шаг ввода простоя разный: мобильная команда требует 0,25 ч, форма отчёта — целые часы (`step=1`), диалог админа — 0,5 ч; zod шаг не проверяет вовсе. (важно)
  2. `ReportDowntime.kind='BREAK'` (перерыв) фильтруется только на экране машиниста; во всей аналитике/выгрузках/PDF сумма `duration` идёт без фильтра — перерыв может попасть в «простой». (важно)
  3. Единицу `м.п.` для свай считают по-разному: живая запись забивки обходит резолвер `pileLengthMeters` и делит `lengthMm/1000` вручную (`production.ts:288`). (важно)
  4. Три хранилища одной и той же остановки уже разошлись: `duration` (часы) + `durationSeconds` (сек) — второе не читает ни один потребитель, риск расхождения. (важно)
  5. Простой рисуют четырьмя разными функциями (`formatDowntimeHours`, `formatHours`, `formatNumber + ' ч'`), вопреки явному правилу в `downtime-hours.ts:111-114`. (важно)

## Методика

Только чтение. Команды (git-bash / MSYS, из `D:\PillingR\wt-night`), без `| tail`/`| head`, чтобы не терять код возврата:

```bash
git rev-parse HEAD
# карта потребителей единиц
grep -rn "duration\|durationSeconds\|downtimeHours\|engineHours\|laborHours\|cardinalHours" src --include=*.ts --include=*.tsx -l
# где живёт единица простоя и её производные
grep -rn "DOWNTIME_MAX_HOURS\|DOWNTIME_STEP_HOURS\|downtimeHoursBetween\|parseDowntimeHours\|formatDowntimeHours\|formatDowntimeHoursOnly\|formatHours" src
# поиск опасных преобразований час↔минута
grep -rn "duration \* 60\|hours \* 60\|duration / 60\|\* 3600\|/ 3600" src
# перерыв vs простой
grep -rn "BREAK" src prisma/migrations
# ввод простоя на всех экранах
grep -rn "step=\|tempDuration\|tempDtDuration\|downtimeDuration" src/components/piling
```

Дальше читал найденные файлы целиком (перечислены в «Находки» через `path:line`). Prisma-схему смотрел по `model ReportDowntime`, `MeterReading`, `FuelLog`, `MaintenanceRecord`; миграции — только `prisma/migrations/**` (не запускал, БД не трогал). Существующие отчёты в `docs/audits/**`, `CODEX-REPORT*`, `docs/strategy` НЕ читал (правило независимости). Наличие строк в проде не проверял — доступа к БД нет.

## Таблица единиц: величина → хранение → вывод

| Величина | Где вводится | Единица ввода | Как хранится (тип колонки) | Где пересчитывается | Единица вывода | Риск смешения |
|---|---|---|---|---|---|---|
| Простой смены | моб. команда `log-production` (`command/route.ts:118-134`); форма отчёта (`downtime-section.tsx:60`); диалог админа (`report-form-dialog.tsx:402`); интервал из офлайн-очереди (`production.ts:442-460`) | часы: 0,25 (моб.) / 1 (форма) / 0,5 (админ) / интервал-секунды | `ReportDowntime.duration` `Float @default(0)` (`schema.prisma:2399`); рядом `durationSeconds Int?` (`:2405`), `startedAt/endedAt` (`:2403-2404`) | `production.ts:433-434, 519-522` (часы→сек); резолвер `downtime-hours.ts:102-107` (интервал→часы) | `formatDowntimeHours` «1 ч 29 мин» / `formatNumber`+«ч» / `formatHours` | **да** — шаг и формат не едины |
| Шаг простоя | — | 0,25 ч (`downtime-hours.ts:53`) | — | `isWholeDowntimeStep` (`:56-59`) проверяет только моб. команда (`production.ts:421`) | — | **да** — zod шаг не проверяет |
| Сваи, шт | `PileWork.count` (форма, моб.) | шт | `PileWork.count Int` | сумма `count` | «N шт.» (`format.js:132-134`) | низкий |
| Сваи, м.п. | косвенно (марка сваи) | — | `PileGrade.lengthMm Int?` | `pileLengthMeters` (`pile-length.ts`); **дубль вручную** `production.ts:288` | «M м.п.» | **да** — два способа считать метры |
| Лидерное бурение | форма/моб. (`count`, `metersPerUnit`) | скв, м | `LeaderDrilling.count Int`, `metersPerUnit Float`, `meters Float` | `meters = count × metersPerUnit` (`production.ts:403`) | «N скв. / M м.п.» | средний — бурение выводят как м.п. |
| Моточасы (наработка) | форма отчёта (`shift-info.tsx:88-92`); карточка техники | целое, м/ч | `MeterReading.engineHours Int` (`schema.prisma:736`); кэш `Equipment.engineHoursTotal Int?` (`:489`) | `equipment-query.service.ts:250-258` (последнее ≤ момента) | «N м/ч» (`equipment-tile-block.tsx:185`) | низкий |
| Топливо, л / % | `FuelLog` | л; % (0–100) | `FuelLog.litersAdded Int?`, `tankPercent Int?` (`schema.prisma:767-768`) | `computeFuelConsumption` (`fuel-log.ts:72-88`); л/моточас | «X л», «Y л/м/ч» | низкий |
| Трудозатраты ТО | наряд ТО | часы | `MaintenanceRecord.laborHours Float?` (`schema.prisma:596`) | — | «N ч» | низкий (max не задан) |
| Простой ТО/ремонт (MTTR/MTBF) | из `MaintenanceRecord.startedAt/completedAt` | часы | Timestamptz | `fleet-kpi.ts:21,74-109` | `fmtHours` «36 ч» / «1,5 дн.» | средний — подпись «ч», вывод «дн.» |

## Находки

| # | severity | path:line | Проблема | Что это значит / сценарий | Починка |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/operator-mobile/application/commands/production.ts:421`; `src/lib/validation-schemas.ts:280`; `src/components/piling/report-form/downtime-section.tsx:60`; `src/components/piling/admin-reports/report-form-dialog.tsx:402` | Шаг ввода простоя не един. Мобильная команда требует кратность 0,25 ч (`isWholeDowntimeStep`), форма отчёта имеет `step="1"`/`min="1"`, диалог админа — `step="0.5"`/`min="0.5"`, а zod-схема (`min(0).max(24)`) и валидаторы шаг не проверяют. | Одна и та же остановка на разных экранах вводится с разной точностью; через прямой API/скрытую правку можно записать `1,3 ч`, что `downtime-hours.ts:49-51` прямо называет недопустимым. Цифры простоя в отчётах станут несравнимы. | Задать шаг в ОДНОМ месте (выбрать 0,25 ч) и применять во всех формах + проверить кратность в `reportUpsertSchema`/`validateDowntimeEntries`. |
| 2 | важно | `src/modules/operator-mobile/application/mobile-shift-query.ts:48-49,700-702` против `src/services/analytics/site-analytics-service.ts:146-150`, `src/services/reports/event-handlers.ts:221-229`, `src/modules/reports/application/queries/report-export.service.ts:222,338,363`, `src/components/piling/admin-reports/report-totals.ts:28`, `src/app/api/admin/analytics/overview/route.ts:87` | `ReportDowntime.kind='BREAK'` (перерыв) исключается из простоя только на экране машиниста; во всех остальных суммах берутся все строки `ReportDowntime` без фильтра `kind`. | Перерыв — «нормальный элемент смены», не потеря времени объекта (`mobile-shift-query.ts:48`; `prisma/migrations/20260829200100_downtime_reason_required/migration.sql:12-13`). Если в базе есть строки `kind='BREAK'`, аналитика/выгрузки/PDF покажут завышенный простой, а экран машиниста — правильный. Живой код сейчас `BREAK` не создаёт (проверено grep'ом), но интервальный контур v3 их писал. Наличие строк в проде — **НЕ ПРОВЕРЕНО** (нет доступа к БД). | Вынести фильтр `kind !== 'BREAK'` в общий хелпер суммирования простоя и заменить им все места. |
| 3 | важно | `src/modules/operator-mobile/application/commands/production.ts:288` | Живой путь записи паспорта сваи считает длину вручную: `grade?.lengthMm / 1000`, вместо резолвера `pileLengthMeters` (`src/lib/pile-length.ts`). | Нарушает инвариант «одна длина — один резолвер». Возврат `null` даёт `null`, а не 0, — поведение отличается от `pileLengthMeters`, который при `null` возвращает 0. Правило глубины сваи (`validatePassport`) получает другую семантику неизвестной длины, чем экраны/PDF. | Заменить на `pileLengthMeters({ gradeLengthMm: grade?.lengthMm })`. |
| 4 | важно | `prisma/schema.prisma:2399,2405`; `src/modules/operator-mobile/application/commands/production.ts:434,522` | Одна и та же остановка хранится дважды: `duration` (часы) и `durationSeconds` (секунды). Ни один потребитель `durationSeconds` не читает (grep по `src`: только запись и тест). | Двойное представление факта может разойтись (правки/миграции трогают одно поле). Секунды создают видимость точности, которой во вводе нет. | Либо удалить колонку (миграция), либо объявить её источником истины и читать длительность только из неё. |
| 5 | важно | `src/lib/downtime-hours.ts:111-117` против `src/components/piling/monitoring/fleet-dashboard.tsx:343`, `src/components/piling/monitoring/equipment-tile-block.tsx:193`, (заморожено) `src/components/piling/operator-mobile/v7/history-v7-app.tsx:165` | Простой рисуют не тем форматёром: правило в файле прямо запрещает общий `formatHours` для простоя, но дашборд мониторинга и плитка техники используют именно его; ещё три места (`report-detail-dialog.tsx:141`, `report-form-dialog.tsx:416`, `report-history-detail-dialog.tsx:168`) печатают `formatNumber(...) + ' ч'`. Итого 4 разных формата простоя. | Числа почти совпадают, но правило «формат обязан совпадать везде, где простой сравнивают» нарушено; при дробях форматы расходятся. `formatHours` к тому же может вывести «N ч 60 мин» (`format.ts:26-29`) — оно не переносит 60 минут в час. | Все места простоя перевести на `formatDowntimeHours`; `formatHours` оставить только для времени смены. |
| 6 | мелочь | `src/components/piling/report-form/downtime-section.tsx:60-61`; `src/components/piling/report-form/use-report-form.ts:376-381` | Форма отчёта: `placeholder="Полных часов"`, `min="1"`, `step="1"`, а `addDowntime` проверяет лишь `duration > 0`. Дробные часы (0,5 / 1,5) через поля ввести нельзя, хотя форма принимает их на сервере. | Владелец (07.10.2026) разрешил простой «только в часах» с шагом 0,25; форма отчёта этот шаг не поддерживает и стимулирует целые часы — то самое «скрытое округление», от которого отказались. | Привести поле к общему шагу 0,25 и подписи «Часы». |
| 7 | мелочь | `src/components/piling/report-form/downtime-section.tsx:76,89`; `src/components/piling/report-form/report-form.tsx:45` | Форма отчёта показывает простой через `formatDowntimeHours` («1 ч 29 мин»), т.е. с минутами, тогда как решение владельца 07.10.2026 — «простой только в часах, никаких 5–10 минут». | На одном продукте простой местами «часы+минуты», местами «часы» — оператор видит разную точность одной цифры. | Для экранов машиниста/отчёта — `formatDowntimeHoursOnly` (только часы); минуты оставить только там, где это осознанно (PDF по интервалу). |
| 8 | мелочь | `src/components/piling/admin-reports/report-detail-dialog.tsx:141`; `src/components/piling/admin-reports/report-form-dialog.tsx:416`; `src/components/piling/report-history-detail-dialog.tsx:168` | Простой печатается как `formatNumber(dt.duration) + ' ч'` (не более 1 знака после запятой), а не `formatDowntimeHours`. | Четверть часа (0,25) округлится до «0,3 ч»; для дробных значений число в карточке расходится с числом в формате простоя, используемом на других экранах. | Использовать `formatDowntimeHours`/`formatDowntimeHoursOnly` во всех трёх диалогах. |
| 9 | мелочь | `src/modules/reports/domain/report.aggregate.ts:90-95` | Комментарий описывает «мертвые» минутные границы (1440, `*60`) как текущее состояние, хотя код уже переведён на часы (`MAX_DOWNTIME_PER_SHIFT_HOURS = 24`). | Вводящее в заблуждение описание единицы на пути записи; риск, что будущий код скопирует минутное правило. | Обновить комментарий: границы в часах. |
| 10 | мелочь | `src/services/reports/event-handlers.ts:315-320` | Порог алерта `if (duration <= 2) return;` (срабатывает строго >2 ч). Комментарий/название настройки — `downtime30` — тянут за собой «30 минут», которых в правиле нет. | Само по себе корректно (часы), но имя настройки и порог «30» вводят в заблуждение при сопровождении. **НЕ ПРОВЕРЕНО**: что именно означает `downtime30` в настройках тенанта. | Переименовать/задокументировать настройку под фактический порог в часах. |
| 11 | мелочь | `src/app/api/admin/analytics/overview/route.ts:6-7,114`; `src/components/piling/analytics-dashboard/kpi-widgets.tsx:113` | «Доля простоя в смене, %» считается как `duration_hours*60 / shiftMinutes * 100` (формула верная), но и в комментарии, и на экране ссылается на проекцию `OperatorPerformance`, удалённую 17.08.2026 (`src/workers/__tests__/projection-worker.test.ts:374-378`). | Ссылка на несуществующий источник вводит в заблуждение при проверке «а тем ли способом считаем». Сама арифметика единиц корректна. | Переписать комментарий/подпись на фактические данные (`loadPeriod`). |
| 12 | мелочь | `src/modules/reports/application/queries/report-export.service.ts:167,315` | В выгрузках бурение подписано «Метры бурения»/«Бурение, м», тогда как на экранах `formatCountMeters` (`format.ts:127-134`) выводит бурение как «м.п.» — «Сваи и бурение пишутся одинаково». | Одно и то же число в UI — «м.п.», в файле — «м»; получатель выгрузки может прочитать это как разные величины. | Согласовать подписи единиц между UI и CSV/XLSX. |
| 13 | мелочь | `src/components/piling/admin-analytics-bits.tsx:69-73,86` | `fmtHours` печатает «дн.» при значении ≥48 ч, но строка подписана «Ремонт по ТО, ч». | Единица в подписи («ч») противоречит единице в значении («дн.») для одного показателя. | Печатать значение без смены сущности либо переименовать подпись. |
| 14 | мелочь | `src/lib/format.ts:22-29` | `formatHours` не переносит 60 минут в час: `(h-whole)*60` может дать 60 → вывод «N ч 60 мин». Используется для простоя в `fleet-dashboard.tsx:343` и `equipment-tile-block.tsx:193`. | На дробях, округляющихся до полного часа, показ простоя будет вида «1 ч 60 мин». Достижимо при значениях, введённых в обход UI (zod допускает любой float 0..24). Подтверждено запуском: `formatHours(1.999) = "1 ч 60 мин"`, тогда как `formatDowntimeHours(1.999) = "2 ч"` (node, см. Методику). | Перенести остаток: при `mins === 60` → `whole+1`, `0 мин`; либо убрать `formatHours` из мест простоя. |

Приложение: найдено всего 14; ничего сверх лимита в приложение не вынесено.

## Не проверено

- **Наличие строк `kind='BREAK'` в базе** — доступа к БД нет; вывод о находке №2 основан только на коде и миграциях. Если таких строк нет, №2 — латентный риск, а не текущая ошибка.
- **Что означает настройка `downtime30`** (`event-handlers.ts:326`) в интерфейсе настроек — не открывал экран настроек; порог трактуется по коду (>2 ч).
- **Prod-данные о простоях** (границы значений, дробность, доли 0,25/0,5) — не проверял, нет доступа к БД; `durationSeconds` считал «write-only» по grep исходников, без проверки чтения через сырой SQL вне `src`.
- **Все экраны замороженных областей** (`operator-*`, ORION) — не аудировал (правило 3); находки №5, №7, №8 упоминают их только как источники формата, не как объект правки.
- **Тесты и сборка** (tsc/lint/vitest/build, §6 AGENTS.md) — не запускал: задача read-only и требует только отчёт; вносимых изменений кода нет.
- **Полнота пар `(reportId, reasonId, duration)` как ключа алерта** (`event-handlers.ts:307-311`) — не относится к единицам, не разбирал.
- **`formatHours` vs `formatDowntimeHours`** — расхождение ПОДТВЕРЖДЕНО запуском node (см. команду ниже), а не только чтением:
  `node -e "…"` → `formatHours(1.999)="1 ч 60 мин"` vs `formatDowntimeHours(1.999)="2 ч"`; на «нормальных» долях (0,25/0,5/1,5/2,75) обе функции совпадают.
- **Достижимость значения `1,999`** через живые формы — не проверял (речь о вводе в обход UI; UI даёт 0,25/0,5/1).
