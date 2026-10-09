# AU42-S2-ADMISSION-LOGIC: Допуск к смене — шаги, сроки действия, правила

Ревизия рабочей папки: `git rev-parse HEAD` = `5cf0ba04c55b60413a87da8cab7cb67c0fa70c9c` (ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`).
Все ссылки вида `путь:строка` открыты в этой ревизии. Тип проверки указан у каждого вывода
(ПРОЙДЕНО — прочитан код и/или тест; НЕ ПРОВЕРЕНО — не смотрел; ГИПОТЕЗА — вывод из чтения кода без запуска).

## Итог

Допуск в системе устроен как четыре шага — СИЗ (за производственные сутки), ознакомление с инструкцией
(по версии текста), проверка знаний (30 дней), обязательные документы (по сроку `expiresAt`). Каждый шаг
имеет чистое правило расчёта и тест, кроме СИЗ (теста нет).

Главное, что нашлось: **две независимые «двери» открытия смены ведут себя по-разному.** Контур готовности
(`POST /api/readiness/shifts/:id/start`) проверяет только ДОКУМЕНТЫ работника (`commands.ts:179-191`).
Мобильный контур (`POST /api/operator/mobile/command`, команда `accept-equipment`) **не проверяет допуск
вообще ничем** — `acceptEquipment` переводит смену в `STARTED` без обращения к документам, СИЗ,
инструктажу и проверке знаний (`equipment.ts:22-108`).

Второе: **инструктаж и проверка знаний не проверяются на сервере нигде** — ни на пуске смены, ни при
записи выработки. Их удерживает только интерфейс (фаза `IDENTITY` в `derivePhase`). СИЗ сервер проверяет,
но только при записи выработки (`shared.ts:247-306`), не при открытии смены.

По тяжести: критично — 1, важно — 3, мелочь — 3.

Топ-5:
1. (критично) Открытие смены мобильной командой `accept-equipment` без любой проверки допуска — прямой API.
2. (важно) Инструктаж и проверка знаний не проверяются сервером — только фазой на экране.
3. (важно) Пуск в контуре готовности сверяет только документы; не найдена бригада оператора — проверка пропускается молча.
4. (важно) СИЗ подтверждается на дату, которую присылает телефон (не на серверные сутки).
5. (мелочь) Допуск по документам посчитан двумя разными реализациями (дубль логики).

## Методика

Поиск по `src/` (ripgrep через инструмент):
`допуск|admission|Admission`, `СИЗ|PPE|инструктаж|briefing|knowledgeCheck|KnowledgeCheck`,
`acknowledgeBriefing|confirmPpe|submitKnowledgeTest|acceptEquipment`,
`isIdentityValid|briefingUpToDate|knowledgeValid|ppeConfirmedFor|getOperatorClearance|checkOperatorDocuments`,
`OPERATOR_NOT_CLEARED|PPE_MISSING|confirmPpe`.

Прочитаны целиком/частями (файл:строки):
`modules/operator-mobile/domain/{operator-admission,operator-credentials,knowledge-bank,ppe,shift-phases,
safety-checklist-period,production-permit,safety-briefing}.ts`,
`modules/operator-mobile/application/commands/{admission,equipment,shared,production}.ts`,
`modules/operator-mobile/application/{knowledge-attempt,mobile-shift-query}.ts`,
`modules/safety/{instructions.ts,domain/briefing-requirements.ts,application/{briefing-commands,self-clearance-query,
clearance-overview-query}.ts}`,
`modules/readiness/application/{shifts/commands.ts,shifts/start-decision.ts,operator-shift-query.ts,capabilities.ts}`,
`modules/readiness/domain/capability-defaults.ts`,
`services/users/{operator-clearance,user-documents}.ts`, `lib/document-expiry.ts`,
маршруты `app/api/{readiness/shifts/[id]/start,operator/mobile/command,operator/knowledge-attempt,operator/shift,
assistant/command,safety/clearance,safety/my-clearance}`;
тесты: `operator-mobile/application/commands/__tests__/admission.test.ts`,
`operator-mobile/application/knowledge-attempt.test.ts`,
`operator-mobile/domain/__tests__/operator-mobile-rules.test.ts`,
`operator-mobile/application/commands/__tests__/production.test.ts`,
`services/users/__tests__/user-documents.test.ts`,
`readiness/application/__tests__/operator-shift-query.test.ts`.

Команды для повторного прогона (Git Bash, из корня worktree):
- `git rev-parse HEAD`
- `rg -n "acceptEquipment" src` — указывает на `equipment.ts` и маршрут мобильной команды
- `rg -n "getOperatorClearance\(" src` — 4 точки: `commands.ts:181`, `operator-shift-query.ts:156`, `self-clearance-query.ts:68`, `user-documents.ts`
- `rg -n "briefingUpToDate|knowledgeValid" src` — только чтение-моделей (`mobile-shift-query.ts`, `assistant-query.ts`)
- `rg -n "PPE_MISSING" src` — только `domain/production-permit.ts`

## Шаги допуска

### 1. СИЗ (средства индивидуальной защиты) — проверка за производственные сутки

| поле | значение |
|---|---|
| Где проверяется | запись: `admission.ts:209-244` (`confirmPpe`); правило шага: `domain/ppe.ts:19-63`; чтение для экрана: `mobile-shift-query.ts:193-196, 212-217`; блокировка выработки: `shared.ts:260-263, 287-293` → `domain/production-permit.ts:84-92` |
| Срок действия и как считается | срок не «истекает» — это ежедневный факт. Засчитывается на ПРОИЗВОДСТВЕННЫЕ СУТКИ: `ppeConfirmedFor(checks, productionDate)` сравнивает календарный день (`ppe.ts:45-50`). В БД одна строка на `[tenantId,userId,productionDate]` — `upsert` (`admission.ts:224-241`) |
| Что при просрочке | понятия «просрочено» нет. Нехватка СИЗ (не отметили какой-то пункт) НЕ запирает шаг: отметка о нехватке закрывает шаг и даёт предупреждение (`ppe.ts:9-16`, проверено). Но нехватка СИЗ ЗАПРЕЩАЕТ выработку на сервере (`production-permit.ts:84-92`) |
| Что видит оператор | `identity.ppe` (confirmed/items/missing) — `mobile-shift-query.ts:212-217`; фаза остаётся `IDENTITY`, пока не подтверждено (`shift-phases.ts:150`) |
| Тест | **нет**. Прямых юнит-тестов на `confirmPpe`/`ppeConfirmedFor` не найдено (поиск по `*.test.*`: только заглушка `downtime-hours.test.ts:21` и UI-тест `operator-v10-port.test.tsx:43`). НЕ ПРОВЕРЕНО, что шаг покрыт тестом |

### 2. Инструктаж (ознакомление с инструкцией) — по версии текста

| поле | значение |
|---|---|
| Где проверяется | запись: `admission.ts:254-295` (`acknowledgeBriefing`); правило: `domain/operator-credentials.ts:64-70` (`briefingUpToDate`); каталог/версия: `modules/safety/instructions.ts:45-62`, текст и версия `domain/safety-briefing.ts:13-16`; чтение: `mobile-shift-query.ts:198-200, 218-227`; расчёт «ожидает/просрочен»: `domain/briefing-requirements.ts:92-152` |
| Срок действия и как считается | срока в днях нет: вид документа «Ознакомление…» создаётся с `requiresExpiry:false` (`operator-credentials.ts:37-43`). Отметка привязана к ВЕРСИИ текста (`briefingUpToDate`); подняли версию — старая отметка не считается. Повторный инструктаж по графику — `repeatMonths:3` у инструкции `И-СМ-04` (`instructions.ts:52`), срок считается от ПОСЛЕДНЕГО инструктажа любых редакций (`briefing-requirements.ts:127-141`, `addMonths`) |
| Что при просрочке | «просрочен повторный инструктаж» — только предупреждение в сводке ОТ (`briefing-requirements.ts:133-141`); на экране оператора — фаза `IDENTITY` (`shift-phases.ts:151`). **Серверного запрета нет** (см. находку 2) |
| Что видит оператор | `identity.briefing` (code/title/version/acknowledgedVersion/ok) — `mobile-shift-query.ts:218-227` |
| Тест | ПРОЙДЕНО: `commands/__tests__/admission.test.ts:69-106` (одна отметка в сутки на редакцию, местные сутки), `domain/__tests__/operator-mobile-rules.test.ts:333` (`отметка привязана к версии текста`), `modules/safety/domain/__tests__/briefing-requirements.test.ts`, `modules/safety/__tests__/instructions.test.ts` |

### 3. Проверка знаний — 30 дней, попытки не ограничены

| поле | значение |
|---|---|
| Где проверяется | запись: `admission.ts:304-353` (`submitKnowledgeTest`); банк и срок: `domain/knowledge-bank.ts:34-480`; одноразовый набор: `application/knowledge-attempt.ts:12-30`; чтение: `mobile-shift-query.ts:199, 201, 228-232` |
| Срок действия и как считается | `validUntil = now + KNOWLEDGE_VALID_DAYS`, где `KNOWLEDGE_VALID_DAYS = 30` (`admission.ts:327`, `knowledge-bank.ts:480`). Действует, пока `expiresAt > now` (`operator-credentials.ts:73-74`). Вид документа «Проверка знаний…» — `requiresExpiry:true, leadTimeDays:7` (`operator-credentials.ts:44-49`), т.е. предупреждение за 7 дней до 30-дневного конца |
| Попытки | не ограничены. Набор — 8 вопросов из трёх тем (`knowledge-bank.ts:396, 411-429`); ошибка НЕ валит попытку: вопрос с ошибкой повторяется до верного (`knowledge-bank.ts:10-14`), сервер отвечает 409 и списком `wrongIds`, пока не все верны (`admission.ts:319-325`). Токен набора живёт 30 минут (`knowledge-attempt.ts:17`) |
| Что при просрочке | на экране — фаза `IDENTITY` (`shift-phases.ts:151`); в контуре готовности проверка знаний В ДОПУСК НЕ ВХОДИТ (см. находку 2 и `clearance-overview-query.ts:19-24`) |
| Что видит оператор | `identity.knowledge` (validUntil/lastResult/ok) — `mobile-shift-query.ts:228-232`; в «Мой допуск» — `self-clearance-query.ts:93-98` |
| Тест | ПРОЙДЕНО: `application/knowledge-attempt.test.ts:7-21` (ровно назначенный набор, отказ чужому пользователю/тенанту/роли, истечение 30 мин), `domain/__tests__/operator-mobile-rules.test.ts:285-339` (состав набора, «итог считает сервер», истёкшая проверка) |

### 4. Обязательные документы — по сроку `expiresAt`

| поле | значение |
|---|---|
| Где проверяется | расчёт: `services/users/operator-clearance.ts:103-156` (`evaluateOperatorClearance`); выборка: `services/users/user-documents.ts:158-178` (`getOperatorClearance`, только виды с `requiredForOperator:true`); математика срока: `lib/document-expiry.ts:26-41`; пуск смены (контур готовности): `modules/readiness/application/shifts/commands.ts:179-191`; блокировка выработки (моб.): `shared.ts:247-306` |
| Срок действия и как считается | по `expiresAt` документа; «истекает» — за `leadTimeDays` вида (по умолчанию 30), «просрочен» — `expiresAt < now` (`document-expiry.ts:26-41`). Из нескольких документов одного вида действует самый поздний (`operator-clearance.ts:87-97`) |
| Что при просрочке | в контуре готовности пуск смены отвергается 422 `OPERATOR_NOT_CLEARED` (`commands.ts:181-190`); выработка в мобильном контуре отвергается 409 (блок `DOCUMENT_INVALID`, `production-permit.ts:73-82`). Истекающий документ — только предупреждение (`operator-clearance.ts:146-152`) |
| Что видит оператор | `clearance` (blockers/warnings/documents) — `operator-shift-query.ts:156-161`; на мобильном экране `identity.documents` — `mobile-shift-query.ts:205-210` |
| Тест | ПРОЙДЕНО: `services/users/__tests__/user-documents.test.ts:223-263` (`evaluateOperatorClearance`: нет обязательных видов → чист; отсутствие/просрочка → блок; истекающий → предупреждение; новое перекрывает старое; чужие виды не влияют), `modules/safety/__tests__/clearance-overview.test.ts`. НЕ ПРОВЕРЕНО, что ветка `OPERATOR_NOT_CLEARED` в `commands.ts` покрыта тестом: в `app/api/readiness/shifts/__tests__/route.test.ts` проверяется только валидация состояния GET |

## Обход допуска прямым API

**Да, смену можно начать в обход допуска.** Две двери ведут себя по-разному (ПРОЙДЕНО — по коду):

- Дверь 1 — мобильная: `POST /api/operator/mobile/command` c телом `{"command":"accept-equipment", ...}`
  → `acceptEquipment` (`equipment.ts:22-108`). Функция проверяет только закрепление бригады
  (`requireCrew`, `shared.ts:31-41`) и создаёт/переводит смену в `state:'STARTED'`
  (`equipment.ts:76-107`). **Ни документов, ни СИЗ, ни инструктажа, ни проверки знаний.**
  Маршрут доступен роли `OPERATOR` (`route.ts:186-198, 218-221`). Этот маршрут вызывает мобильный
  экран оператора (`components/piling/operator-mobile/api.ts:512`; страницы `src/app/(app)/operator/page.tsx:2`
  и `src/app/operator/v10/page.tsx:2`).
- Дверь 2 — контур готовности: `POST /api/readiness/shifts/:id/start`
  → `startShiftCommand` проверяет ТОЛЬКО документы (`commands.ts:179-191`) и, если чисто,
  пропускает к правилам готовности машины. СИЗ/инструктаж/знания здесь не проверяются.

Запись выработки в мобильном контуре дополнительно проверяет документы и СИЗ
(`production.ts:245-253` → `shared.ts:247-306`), но **исключает служебные виды инструктажа и проверки
знаний** (`shared.ts:287-289`) — то есть выработку можно писать без действующего инструктажа и знаний.

Что касается фазы на экране: `derivePhase` не пускает дальше `IDENTITY` без СИЗ/инструктажа/знаний
(`shift-phases.ts:144-158`), но это ЧТЕНИЕ (модель экрана), а не проверка на сервере — прямой запрос её не встречает.

## Что записывается в журнал

ПРОЙДЕНО (чтением кода):

- Инструктаж: строка в `BriefingRecord` (kind `INSTRUCTION`) с кодом/названием/версией инструкции, ФИО и
  ролью копией, `employeeSignedAt` и `recordedAt` — `admission.ts:91-129`. Одна отметка в сутки на редакцию
  (местные сутки, `admission.ts:147-173`). Инженер ОТ пишет туда же через `conductBriefing`
  (`modules/safety/application/briefing-commands.ts:48-102`).
- Проверка знаний: строка `BriefingRecord` (kind `KNOWLEDGE`) с `correct`/`total` и `validUntil`
  (`admission.ts:105-128, 341-350`).
- СИЗ: строка `PpeCheck` с `items`, `missing`, `confirmedAt` на производственные сутки (`admission.ts:224-241`).
- Открытие смены: изменяется `Shift` (`state:'STARTED'`, `startedAt`, `startedById`) и пишется
  `OperatorShiftEvidence` (kind `STARTUP_READING` со снимком условий и погоды) — `equipment.ts:76-107, 135-144`.
  **Записи о допуске человека (документы/инструктаж/знания/СИЗ) в журнал пуска не попадает** — ни в
  `acceptEquipment`, ни в `startShiftCommand` (последний пишет audit-действие `shift.started`, но без
  деталей допуска, `commands.ts:202-205`).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/operator-mobile/application/commands/equipment.ts:22-108` | `acceptEquipment` открывает смену (`state:'STARTED'`) без любой проверки допуска | Прямой `POST /api/operator/mobile/command {command:'accept-equipment'}` от роли OPERATOR (`route.ts:192`) стартует смену без документов, СИЗ, инструктажа и проверки знаний. Обход всех четырёх шагов допуска одной командой | Перед переводом в `STARTED` в той же транзакции вызвать допуск: `getOperatorClearance` (документы) и проверку СИЗ/инструктажа/знаний (как в `derivePhase`), отказ 422/409 по образцу `commands.ts:181-190` |
| 2 | важно | `src/modules/operator-mobile/application/commands/shared.ts:287-289` + `mobile-shift-query.ts:200-201` | Инструктаж и проверка знаний не проверяются сервером ни на пуске, ни при выработке | `requireProductionPermit` явно исключает `BRIEFING_DOCUMENT_TYPE`/`KNOWLEDGE_DOCUMENT_TYPE`; `briefingUpToDate`/`knowledgeValid` вызываются только в чтения-моделях. Человек с просроченной проверкой знаний и без ознакомления пишет выработку | Ввести серверную проверку `briefingUpToDate`+`knowledgeValid` в `requireProductionPermit` (или отдельным блоком `IDENTITY_INVALID`), чтобы отказ был на сервере, а не только на экране |
| 3 | важно | `src/modules/readiness/application/shifts/commands.ts:179-180` | Пуск смены проверяет документы только если найдена бригада (`if (operatorId)`) | `repo.crewOperatorId(...)` вернул `null` (нет активной бригады/оператора) — блок допуска молча пропускается, смена стартует без проверки документов | При отсутствии оператора в бригаде пуск смены должен падать (или явно требовать хотя бы допуск), а не пропускать проверку |
| 4 | важно | `src/modules/operator-mobile/application/commands/admission.ts:229-235` + `app/api/operator/mobile/command/route.ts:37` | Дату СИЗ для `confirmPpe` присылает клиент; сервер проверяет только формат `\d{4}-\d{2}-\d{2}` | Телефон может подтвердить СИЗ на любую дату (в т.ч. будущую/чужую), а `requireProductionPermit` ищет `ppeCheck` по `shift.productionDate` — при расхождении проверка СИЗ «не находит» запись | Считать производственные сутки на сервере (`productionDateOf`, как уже сделано в `acknowledgeBriefing`), а не доверять присланной дате |
| 5 | мелочь | `src/modules/operator-mobile/domain/operator-admission.ts:59-122` vs `src/services/users/operator-clearance.ts:103-156` | Две разные реализации одного расчёта допуска по документам | Мобильный экран считает через `checkOperatorDocuments` (floor по дням), контур готовности/сводка ОТ — через `evaluateOperatorClearance` (`lib/document-expiry.ts`, ceil). Расхождение округления дало бы «просрочен» на одном экране и «истекает» на другом у документа в пределах суток | Свести к одной чистой функции (оставить `evaluateOperatorClearance`, `checkOperatorDocuments` переиспользовать/удалить после проверки callers) |
| 6 | мелочь | `src/modules/operator-mobile/domain/operator-admission.ts:118-122` | `isIdentityValid` не вызывается в коде приложения | Поиск по `src/` даёт вызов только в `domain/__tests__/operator-mobile-rules.test.ts:51`. Дублирует проверку `blocks`. Мёртвый экспорт (перед удалением — подтвердить текстовым поиском по всему репо, включая `e2e/`) | Удалить после подтверждения нулевых ссылок, либо пометить как публичный контракт |
| 7 | мелочь | `src/modules/safety/application/clearance-overview-query.ts:270-277` | «Проверка знаний без срока считается действующей» | Комментарий описывает случай `validUntil == null`, но `submitKnowledgeTest` всегда ставит срок (`admission.ts:327`); запись без срока может появиться только сторонним путём, и тогда она молча считается действующей | Явно решить правило для записи без срока (предупреждение/«не проверено») и покрыть тестом |

## Не проверено

- Не запускались проверки из §6 AGENTS.md (tsc/lint/test/build/playwright) — задача только чтение; числа тестов не снимались.
- Не проверялось, какой из экранов оператора реально включён в проде (`src/app/(app)/operator/page.tsx` → OperatorMobileApp
  vs `src/components/piling/operator/**` → контур готовности): оба варианта в замороженной зоне. Вывод «какая дверь боевая» —
  ГИПОТЕЗА по коду маршрутов.
- Ветка `OPERATOR_NOT_CLEARED` в `commands.ts:187` не покрыта найденным тестом — тест не искал исчерпывающе по e2e/.
- Не проверялось поведение `productionDateOf`/`zonedDayStartUtc` на реальных переходах времени (только чтение).
- Не проверялось наполнение БД (какие виды документов помечены `requiredForOperator` в проде) — по коду
  допуск по документам зависит от этой настройки администратора (`user-documents.ts:166-170`).
- Не проверялось, вызывается ли мобильная команда `accept-equipment` из очереди офлайна отдельно от онлайна
  (читал только `api.ts`; логика очереди детально не разбиралась).
