# Этап 2 — функциональность и логика промышленной работы (независимый аудит, только чтение кода)

Версия (git rev-parse HEAD): `0b3ebe59d43e35dfd0fbd8ad40e75360a0cf8ef8` (ветка `hermes/q4-0926`).
Дата проверки: октябрь 2026. Стенда и браузера нет — всё, что требует запуска, помечено НЕ ПРОВЕРЕНО.

## Итог (для владельца)

Аудит смотрел код, схему и тесты, а не живую систему. Ядро промышленной работы
сделано глубоко: забивка, лидерное бурение, паспорт сваи со залогами и расчётом
отказа, простой, запрет выработки по критическому дефекту/документу — это не
заготовки, а рабочие контуры с понятными правилами и отказами.

Найдено 12 замечаний: критичных — 0, важных — 8, мелких — 4.
Пять из них — про поправки и простой мобильного контура: там ослабили проверки,
которые в форме отчёта остались. Одно — про пробел: обещанный владельцу путь
«мастер вносит пропущенную запись в журнале забивки» в коде отсутствует — паспорт
сваи умеет завести только машинист с телефона. Испытания свай (статические и
динамические) в продукте не реализованы вовсе.

Главное: **паспорт сваи невозможно создать никому, кроме машиниста** — ни мастер,
ни администратор этого не могут, хотя тексты отказов машинисту прямо отправляют
его к мастеру. Второе по важности: **поправка простоя не ограничена сутками** —
простой в 1 час можно «поправить» на 500 часов, минуя предел 24 ч.

Топ-5 по важности:
1. F-05 — нет пути создания паспорта сваи для мастера; `recordedByForeman` не пишется никогда.
2. F-01 — поправка простоя обходит предел `DOWNTIME_MAX_HOURS = 24` (до 500 ч).
3. F-02 — мобильный контур не сверяет суммарный простой с длительностью смены (форма отчёта — сверяет).
4. F-03 — поправка создаёт строки выработки с **отрицательным** количеством (сваи, бурение).
5. F-04 — испытания свай не реализованы; в первый выпуск, судя по документам, не заявлены.

## Методика

Что читалось (файлы открывались, строки проверены `read_file`/`grep -n`):
- схема: `prisma/schema.prisma` (модели PileWork, PilePassport, PileDrivingSet, LeaderDrilling, ReportDowntime, Shift, ShiftStartWaiver, EquipmentDefect, PileGrade, Report);
- ядро забивки/бурения/простоя: `src/modules/operator-mobile/domain/pile-passport.ts`, `downtime-interval.ts`, `shift-phases.ts`, `shift-window.ts`, `production-permit.ts`, `shift-conditions.ts`;
- команды машиниста: `src/modules/operator-mobile/application/commands/production.ts`, `production-corrections.ts`, `shift-close.ts`, `equipment.ts`, `admission.ts`, `shared.ts`;
- API: `src/app/api/operator/mobile/command/route.ts`, `reports/upsert/route.ts`, `reports/edit/route.ts`, `pile-passports/[id]/decide/route.ts`, и матрица всех 141 `route.ts` через `find`/`grep`;
- отчёты и журнал: `src/modules/reports/application/commands/report-command.service.ts`, `report-validation.service.ts`, `src/modules/reports/domain/report.aggregate.ts`, `src/modules/reports/application/queries/pile-journal-list.ts`, `pile-journal-totals.ts`, `pile-passport.service.ts`;
- контур готовности: `src/modules/readiness/domain/shifts/transitions.ts`, `shift.ts`, `src/modules/readiness/application/shifts/commands.ts`, `start-decision.ts`, `readiness-facts.ts`, `src/modules/readiness/domain/defects/defect.ts`, `application/defects/commands.ts`;
- валидация: `src/lib/validation-schemas.ts`, `src/lib/downtime-hours.ts`;
- проверка пробела «испытания свай»: поиск `grep -rniE "испытани|PileTest|..."` по `src`, `e2e`, `tests`, `prisma`, `docs` (кроме `docs/audits`, `docs/strategy`, `CODEX-REPORT*`) — релевантных совпадений по смыслу «испытание сваи» нет (только «испытания» в смысле тестов ПО).

Как воспроизвести ключевые числа:
```bash
git rev-parse HEAD
grep -rn "DOWNTIME_MAX_HOURS\|DOWNTIME_STEP_HOURS" src/lib/downtime-hours.ts
grep -n "actual: z.number" src/app/api/operator/mobile/command/route.ts
grep -n "delta" src/modules/operator-mobile/application/commands/production-corrections.ts
grep -rn "recordedByForeman" src --include=*.ts | grep -v generated   # все вхождения — только чтение
find src/app/api -name route.ts | wc -l                                # 141
npx playwright test --list                                              # Total: 291 tests in 27 files
```

Ограничения методики: читался только код, схема и тексты; поведение в браузере,
порядок кнопок, реальные данные и внешние сервисы (Telegram, погода, S3) не
проверялись. Живого стенда нет — статусы «ПРОЙДЕНО» ниже означают «по коду путь
присутствует и согласован», а не «проверено на работающей системе».

## Охват пунктов этапа

| # | Пункт этапа | Способ проверки | Статус | Причина / источник ожидаемого поведения |
|---|---|---|---|---|
| 1.1 | Настроить организацию, пользователей, объект, технику, бригаду, справочники | маршруты `sites/create`, `sites/[id]/assign\|hierarchy`, `users`, `equipment`, `crews`, `dictionary/manage`; все обёрнуты `withApi/withMutation`, `assertCan`, `safeParse` | ПРОЙДЕНО (по коду) | Права и валидация присутствуют; порядок настройки в коде не задан |
| 1.2 | Войти новичком, понять задачу, выбрать установку/смену | `operator-mobile/domain/shift-phases.ts:13-43`, `equipment.ts:22-108` | ПРОЙДЕНО (по коду) | Фазы вычисляются из фактов; меню реального экрана не проверялось |
| 1.3 | Шаги до смены: документы, инструктаж, СИЗ, осмотр, готовность, пуск | `admission.ts`, `shift-phases.ts:74-81` (порядок), `shared.ts:247-306` (запрет выработки) | ПРОЙДЕНО (по коду) | Порядок этапов вынесен на сервер, а не только в экран |
| 1.4 | Забивка, лидерное бурение, простой, измерение; паспорт (номер, глубины, залоги, отказ, единицы) | `production.ts:259-440`, `pile-passport.ts:20-280`, схема `PileWork`/`PilePassport`/`PileDrivingSet` | ПРОЙДЕНО, кроме F-01/F-02/F-03 | Отказ считается (мм/удар), единицы описаны в `pile-passport.ts:36-57` |
| 1.5 | Исправить запись с сохранением истории | `production-corrections.ts:51-214` (встречная запись + причина + аудит) | ЧАСТИЧНО | История сохраняется, но есть F-01/F-03 и F-09; паспорт поправить нельзя (F-05) |
| 1.6 | Завершить работу, ЕО после смены, сдать отчёт | `shift-close.ts:16-96` (ЕО_AFTER — условие), `submitShiftReport:117-217` | ПРОЙДЕНО (по коду) | Сдать нельзя без осмотра после работы (`:67-69`) |
| 1.7 | Под другой ролью найти результат; сверить записи, суммы, журнал, PDF/экспорт, аналитику | `pile-journal-list/totals`, `report-export.service.ts`, проекции `ReportAnalytics`/`SiteDailySummary` | ПРОЙДЕНО с оговоркой F-03/F-05 | Итоги журнала считаются по всему периоду, не по странице |
| 1.8 | Перезагрузка, повторный вход, другое устройство | клиент и сессии не проверялись (нет стенда) | НЕ ПРОВЕРЕНО | Требует запуска приложения |
| 2.1 | Таблица переходов смены/готовности | `readiness/domain/shifts/transitions.ts:4-75` | ПРОЙДЕНО (по коду) | См. таблицу переходов ниже |
| 2.2 | Разрешённые/запрещённые переходы через интерфейс и прямой API | `readiness/application/shifts/commands.ts` (`assertShiftTransition` перед мутацией), `operator/mobile/command/route.ts:192` | ПРОЙДЕНО (по коду) | Сервер проверяет состояние, не только экран |
| 2.3 | Связь Shift с контуром готовности по фактическим требованиям | `start-decision.ts`, `readiness-facts.ts`, `commands.ts:181-199` | ГИПОТЕЗА | Два контура пишут одну таблицу `Shift`; мобильный старт не проходит шлюз готовности (см. F-06) |
| 2.4 | Сохранение evidence/снимков и истории | `ReadinessScoreSnapshot`, `OperatorShiftEvidence` (`shared.ts:312-333`), `Shift.templateSnapshot` нет — evidence в отдельных таблицах | ПРОЙДЕНО (по коду) | Снимки дедуплицируются по триггеру |
| 2.5 | Изменение правил после начала смены | снимок на момент старта: `start-decision.ts:19-25`, `Shift.startSnapshotId` | ПРОЙДЕНО (по коду) | Правила версионируются, старый снимок не переписывается |
| 2.6 | Критический дефект до старта и во время работы | `production-permit.ts:103-113`, `readiness-facts.ts:74-79`, `defects/defect.ts:27` | ПРОЙДЕНО (по коду) | Блокирует только `CRITICAL` (решение владельца 2026-08-08) |
| 2.7 | Устранение и повторный допуск | `defects/commands.ts:198-214` (resolve), запрет снимается динамически при каждой записи выработки | ГИПОТЕЗА | Отдельного «повторного допуска» нет — проверка идёт на каждой записи; поведение согласовано, но сценарий не подтверждён запуском |
| 2.8 | Запрет операции не лишает фиксации простоя/дефекта/безопасного завершения | `production-permit.ts:11-18`, `production.ts:239-254` (простой идёт без проверки), `commands.ts` дефектов | ПРОЙДЕНО (по коду) | Явно задокументировано и реализовано: простой не блокируется никогда |
| 3.0 | Исключения: смена без выработки | `shift-close.ts:131-132` (отчёт заводится даже без свай) | ПРОЙДЕНО (по коду) | Пустая смена сдаётся |
| 3.1 | Только бурение / только простой | `production.ts:390-441` | ПРОЙДЕНО (по коду) | Отдельные виды выработки; простой доступен без остальных |
| 3.2 | Работа через полночь | `downtime-hours.ts:94-107`, `validation-schemas.ts` (`shiftWindow`), `shift.ts:7-9` | ПРОЙДЕНО (по коду) | Окончание раньше начала трактуется как переход через сутки |
| 3.3 | Разные часовые пояса | `shared.ts:83-88` (`productionDateOf`), `shift-window.ts:29-58` | ПРОЙДЕНО (по коду) | Смещение учитывается раскладкой даты в поясе |
| 3.4 | Замена оператора/помощника | `shared.ts:43-80` (`requireOpenShift`) | ПРОЙДЕНО (по коду) | Чужую смену вести нельзя; назначение помощника — через `crewAssistant` |
| 3.5 | Перевод техники, изменение бригады после старта | `requireCrew` (`shared.ts:31-41`), `report-command.service.ts:238-259` (crew фиксируется на отчёт) | ГИПОТЕЗА | Отчёт хранит снимок бригады/машины; фактический перепривязки в UI не проверялся |
| 3.6 | Просроченный документ | `production-permit.ts:69-82`, `shared.ts:247-306` | ПРОЙДЕНО (по коду) | Блокирует выработку, не журнал |
| 3.7 | Вывод техники из эксплуатации | `production-permit.ts:94-101` (`Equipment.isActive = false`) | ПРОЙДЕНО (по коду) | Отдельного `Equipment.status` нет — только `isActive` |
| 3.8 | Недоступность ответственного | логика эскалации/таймаутов не найдена в коде этапа | НЕ ПРОВЕРЕНО | Требует уточнения требований; в коде явного «дежурного» нет |
| 3.9 | Исправление уже сданного отчёта | `production.ts:216-227` (запрет в сданный отчёт), `report-command.service.ts:199-219` (окно 24 ч), `reports/edit` (GET) | ПРОЙДЕНО (по коду) | Правка только через админа после окна; в журнал пишется след |
| 4.0 | Типы ввода: пустое, ноль, отрицательное, дробное, максимум и сверх, пробелы, запятая/точка, длинный текст, неверные даты, пересекающиеся интервалы, единицы | `validation-schemas.ts:237-292`, `route.ts` (мобильный), `downtime-hours.ts:56-85`, `downtime-interval.ts:35-52` | ПРОЙДЕНО с оговорками F-01/F-02/F-03 | Пределы взяты из схемы и домена; неизвестные не выдумывались |

### Таблица переходов смены (источник: `readiness/domain/shifts/transitions.ts:4-15,66-75`)

| Исходное | Действие | Роль (полномочие) | Условие | Новое | Записи/события | Отказ |
|---|---|---|---|---|---|---|
| PLANNED | edit | readiness.shift.manage | окно валидно | PLANNED | Shift.updated + снимок | 409 при неверной версии |
| PLANNED | request-acceptance | readiness.shift.manage | — | PENDING_ACCEPTANCE | acceptance-requested | — |
| PENDING_ACCEPTANCE | start | readiness.shift.authorize | clearance + authorative readiness | STARTED | started + decision | 422 `OPERATOR_NOT_CLEARED` / `SHIFT_START_BLOCKED` (`commands.ts:181-199`) |
| PENDING_ACCEPTANCE | decline | readiness.shift.authorize | причина | PLANNED | acceptance-declined | 422 без причины |
| PLANNED/PENDING_ACCEPTANCE/STARTED | cancel | readiness.shift.manage | причина | CANCELLED | cancelled | — |
| STARTED | handover | readiness.handover.prepare | отчёт сдан | HANDOVER_PENDING | submitted | 409 без сданного отчёта (`commands.ts:326-330`) |
| HANDOVER_PENDING | accept | readiness.handover.decide | версия | CLOSED | accepted; самоприёмка помечается | 409 при конфликте версии |
| HANDOVER_PENDING | rework | readiness.handover.decide | причина | STARTED | rework-requested | — |
| — | мобильный close-shift | машинист (OPERATOR) | ЕО_AFTER выполнен | CLOSED | submitted + отчёт | 409 без осмотра (`shift-close.ts:67-69`) |

Замечание к таблице: смену в состоянии `STARTED` **можно** отменить
(`transitions.ts:11`). Это осознанный переход кода; последствия для уже
записанной выработки не проверялись (НЕ ПРОВЕРЕНО).

## Находки

Формат: ID | серьёзность | доказательство (файл:строка, проверено открытием) |
проблема и сценарий/последствие | что проверить.

### Важные

**F-01 | важно | `src/modules/operator-mobile/application/commands/production-corrections.ts:185-207`; `src/app/api/operator/mobile/command/route.ts:145`; `src/lib/downtime-hours.ts:39`**
Поправка простоя не ограничена сутками. Схема команды `correct-production`
принимает `actual` до 500 (`route.ts:145`), а сама поправка пишет
`duration: delta` без сверки с `DOWNTIME_MAX_HOURS = 24`
(`production-corrections.ts:191,200`). Сценарий: машинист записал простой 1 ч,
затем «поправил» его на 480 ч — запись пройдёт. Последствие: простой в отчёте,
аналитике и предупреждениях Telegram превышает и сутки, и смену; цифра для спора
с подрядчиком недостоверна. Проверить: для `kind = DOWNTIME` ограничить `actual`
значением `≤ DOWNTIME_MAX_HOURS` и кратностью `DOWNTIME_STEP_HOURS`.

**F-02 | важно | `src/modules/operator-mobile/application/commands/production.ts:408-441`; `src/modules/reports/application/commands/report-validation.service.ts:27`; `src/modules/reports/domain/report.aggregate.ts:231`**
Мобильный контур не проверяет **сумму** простоев против длительности смены.
Ветка «часы» проверяет только одно значение (≥ 0,25; ≤ 24; кратность,
`production.ts:415-423`), а суммарный простой по смене нигде не сверяется
(`shift-close.ts:335` просто складывает). Форма отчёта ту же сумму проверяет
(`report-validation.service.ts:27`, `report.aggregate.ts:231`). Сценарий: шесть
остановок по 2 ч в 12-часовой смене → 12 ч простоя, и ещё раз → 14 ч.
Последствие: по данным с телефона смена может «стоять» дольше, чем длится.
Проверить: считать Σ простоев по смене перед записью команды.

**F-03 | важно | `src/modules/operator-mobile/application/commands/production-corrections.ts:110-119,147-160`; `prisma/schema.prisma:2180`; сравн. `src/modules/operator-mobile/application/commands/production.ts:260,391`**
Поправка создаёт строки выработки с **отрицательным** количеством. `delta` может
быть меньше нуля (`count: delta`, `meters: delta * metersPerUnit`), а колонка
`PileWork.count`/`LeaderDrilling.count` — `Int` без ограничения (`schema.prisma:2180`).
Прямая запись выработки отрицательное число запрещает (`production.ts:260,391`).
Последствие: отрицательные строки попадают в суммы проекций и в журнал забивки;
любой читатель, фильтрующий `count > 0` или считающий число строк, даст неверное
число. Проверить: либо не допускать отрицательный `delta`, либо явно поддержать
знаковые поправки у всех читателей и в выгрузке.

**F-04 | важно (пробел) | поиск по репозиторию; список моделей `prisma/schema.prisma:14-2860`**
Испытания свай (статические/динамические) не реализованы: модели, маршрута и кода
нет — `grep -rniE "испытани|PileTest|staticTest|несущая способн"` по `src`, `e2e`,
`tests`, `prisma`, `docs` (без `docs/audits`, `docs/strategy`, `CODEX-REPORT*`) дал
совпадения только про «испытания» как тесты ПО. Источник ожидаемого поведения —
требование этапа; в `docs/product/*` и `docs/adr/*` первого выпуска испытания не
заявлены (поиск пуст), то есть, **вероятно**, вне объёма. Проверить у владельца:
входят ли испытания в первый выпуск; если да — это крупный пробел.

**F-05 | важно | `src/modules/reports/application/queries/pile-journal-list.ts:151`; `src/modules/operator-mobile/application/commands/production.ts:344,225`; `src/modules/operator-mobile/application/commands/shift-close.ts:158`; `src/app/api/operator/mobile/command/route.ts:192`**
Обещанный путь «мастер вносит пропущенную запись в журнале забивки» в коде
отсутствует. Паспорт сваи создаётся единственным местом — мобильной командой
машиниста (`pilePassport.create` только в `production.ts:344`), а маршрут пропускает
только роль `OPERATOR` (`route.ts:192`). Поле `recordedByForeman` **читается**
(`pile-journal-list.ts:151`), но нигде не пишется в `true` (`grep recordedByForeman`
по `src` без `generated` — только чтение). При этом тексты отказов прямо отправляют
машиниста к мастеру (`production.ts:225`, `shift-close.ts:158`). Последствие:
пропущенную сдачу и паспорт сваи завести некому; обещание в интерфейсе не выполне-
но. Проверить: реализовать для мастера/администратора запись выработки и паспорта
через журнал — либо убрать мастера из текстов отказов.

**F-06 | важно | `src/modules/operator-mobile/application/commands/equipment.ts:75-108`; `src/modules/readiness/application/shifts/commands.ts:181-199`**
Два контура пишут одну таблицу `Shift`, но мобильный старт обходит шлюз готовности.
`acceptEquipment` сразу ставит `state: 'STARTED'` (`equipment.ts:80-107`), не
проверяя ни `getOperatorClearance`, ни `evaluateAuthoritativeShiftStart`, которые
стоят в readiness-команде `startShiftCommand` (`commands.ts:181-199`). Сценарий:
по машине есть препятствие готовности — через readiness пуск запрещён (422),
через мобильный экран смена всё равно открывается; запрет сработает позже, только
на записи выработки (`production.ts:239-254`). Последствие: расхождение бизнес-
логики пуска между экранами; проверка допуска человека по документам при мобильном
пуске не выполняется. Проверить: решить — нужен ли шлюз готовности в мобильном
контуре, или задокументировать, что мобильный старт намеренно его не проходит.

**F-09 | важно (гипотеза) | `src/modules/operator-mobile/application/commands/production-corrections.ts:93-131`**
Поправка `kind: 'PILES'` не проверяет, есть ли у целевой `PileWork` паспорт.
Сценарий: паспортированная свая (`count = 1`, `PilePassport`) «поправляется» как
пачка. Последствие: создаётся отдельная запись выработки без паспорта; итог
сходится (сумма), но в журнале паспортная строка останется с `count = 1`, а рядом
появится «пустая» поправочная строка без номера сваи. Не подтверждено на данных —
статус «гипотеза». Проверить: запрещать правку `PileWork` с паспортом.

**F-10 | важно | `src/modules/reports/application/queries/pile-journal-list.ts:47-89,135-141`; `src/modules/reports/application/queries/pile-journal-totals.ts:146`**
Журнал забивки печатает поправочные строки как самостоятельные: список берёт все
`PileWork` (`:47`), включая строки-поправки (`correctsId`), у которых `count` может
быть отрицательным и `pileNumber = null` (`:135-141`). Комментарий в агрегате это
признаёт (`pile-journal-totals.ts:146`). Последствие: в нормативной форме журнала
(СП 45.13330) появляется строка с отрицательным «Свай» и без номера сваи. Проверить:
сворачивать поправки в строку-оригинал при печати/выгрузке или помечать их явно.

### Мелкие

**F-07 | мелочь | `docs/pile-journal.md:13-18`**
Документ ссылается на строки `pile-passport.service.ts:309/329-332/717` и др., но
файл разделён (`pile-passport.service.ts:1-22` — теперь фасад, реализация в
`pile-journal-*.ts`). Последствие: документация вводит в заблуждение при разборе.
Проверить: обновить номера строк/файлов.

**F-08 | мелочь | `src/modules/operator-mobile/application/commands/production-corrections.ts:186-189,191`**
Комментарий утверждает «полные часы, неполный вверх», а код округления не делает
(`delta = Math.round((actual - current) * 100) / 100`). Последствие: расхождение
текста и поведения. Проверить: обновить комментарий.

**F-11 | мелочь | `src/app/api/operator/mobile/command/route.ts:72,114` против `src/lib/validation-schemas.ts:260` и `src/modules/reports/domain/report.aggregate.ts:96`**
Несогласованные потолки количества: мобильная команда — `max(500)`, схема отчёта и
агрегат — `9999`. Последствие: разные пределы одного показателя в двух местах ввода.
Проверить: свести к одному значению или объяснить разницу.

**F-12 | мелочь | `src/modules/readiness/domain/shifts/transitions.ts:11`**
Смену в `STARTED` можно отменить (`cancel: ['PLANNED','PENDING_ACCEPTANCE','STARTED']`).
Последствие: не определено, что происходит с уже записанной выработкой отменённой
смены. Проверить: определить судьбу записей при отмене активной смены (или запретить
отмену из `STARTED`).

## Протокол проверок

Все команды выполнялись из корня `D:\PillingR\wt-night`; сборка, сервер, Docker и
база не запускались (аудит только для чтения, `.env` не читался).

| Команда | Результат |
|---|---|
| `git rev-parse HEAD` | `0b3ebe59d43e35dfd0fbd8ad40e75360a0cf8ef8` |
| `git branch --show-current` | `hermes/q4-0926` |
| `find src/app/api -name route.ts \| wc -l` | `141` маршрут |
| `npx playwright test --list` | `Total: 291 tests in 27 files` (exit 0) |
| `grep -rn "recordedByForeman" src --include=*.ts \| grep -v generated` | только чтения: `pile-journal-list.ts:151`, тип `pile-journal-types.ts:79`; записи `true` нет |
| `grep -rln "pilePassport.create\|pilePassport.upsert" src --include=*.ts \| grep -v __tests__` | единственный писатель `src/modules/operator-mobile/application/commands/production.ts` |
| `grep -rniE "испытани\|PileTest\|staticTest\|несущая способн" ...` | совпадений по смыслу «испытание сваи» нет |
| `grep -n "MAX_DOWNTIME_PER_SHIFT\|MAX_PILE_COUNT\|MAX_DRILLING_METERS" src/modules/reports/domain/report.aggregate.ts` | `24` / `9999` / `99999` (минутная ловушка прошлого исправлена) |
| `grep -rn "as any" src --include=*.ts \| grep -v __tests__` | совпадения только в telemetry/pdf/export — вне ядра этапа |
| `grep -rn "tenantId.*IS NULL\|IS NULL OR" src --include=*.ts` | только комментарии-предупреждения и осознанные `par IS NULL OR cond` в фильтрах журнала; утечки тенанта не найдено |

Проверки, которые НЕ запускались по условию этапа: `tsc`, `npm run lint`,
`npm run test:unit`, `npm run build`, любой запуск Next.js/Playwright в браузере.
Причина — режим «только чтение» и отсутствие стенда; вывод о поведении строится
на коде и схеме.

## Не проверено

- Поведение в реальном браузере/на телефоне: порядок экранов, кнопки, офлайн-очередь,
  повторный вход, другое устройство (пункт 1.8). Нет стенда.
- Реальные данные: значения `count`, `duration`, содержимое проекций
  `ReportAnalytics`/`SiteDailySummary` и выгрузок `PDF`/`.xlsx`. Проверялся только
  код читателей.
- Внешние сервисы: Telegram (отправка PDF и предупреждения о простое), погода
  (Open-Meteo), S3/медиа, метрики. Код читался, вызовы не выполнялись.
- Сценарии, помеченные ГИПОТЕЗА в таблице охвата: устранение дефекта и «повторный
  допуск» (2.7), связь Shift с готовностью при мобильном старте (2.3, см. F-06),
  перевод техники/смена бригады после старта (3.5), а также F-09 (поправка
  паспортированной сваи).
- «Недоступность ответственного» (3.8): требований в коде/доках этапа не найдено —
  оценить нечем.
- Эскалации, таймауты, авто-закрытие смены по времени (`Shift.autoClosedAt`) — вне
  выбранного фокуса этапа, отдельно не разбирались.
- Покрытие тестами найденных мест: специально не измерялось; отмечу только, что у
  команд машиниста есть модульные тесты (`src/modules/operator-mobile/application/commands/__tests__/production-corrections.test.ts` существует), но проверяют ли они пределы простоя из F-01/F-02 — не смотрел.

Всего находок: 12 (важных 8, мелких 4, критичных 0). Ссылки на код даны полными
путями; каждую строку проверял открытием файла. Если что-то в отчёте выглядит как
факт без ссылки — это осознанное «не проверено», а не утверждение.


