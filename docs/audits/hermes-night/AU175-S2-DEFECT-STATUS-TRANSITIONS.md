# AU175-S2-DEFECT-STATUS-TRANSITIONS — Дефекты оборудования: переходы статусов

Версия кода: `git rev-parse HEAD` = `58ec69b63761be3e20b65a843de100e9c9eb4d97` (branch `hermes/q4-0926`).
Отчёт только читает код; ни один файл приложения не изменён. Область: `src/modules/readiness/**`
(журнал дефектов `EquipmentDefect`) и его потребители (авторитетный расчёт готовности, пуск смены,
панель дефектов). Замороженные зоны (`operator-mobile/**`, варианты экранов оператора, ORION) не
правились; `operator-mobile` упоминается лишь там, где он создаёт дефекты.

## Итог

- Всего находок: **10** — критично **1**, важно **3**, мелочь **6**.
- Автомат переходов ровно один (`domain/defects/defect.ts:59-64`): `OPEN → IN_WORK|REJECTED`,
  `IN_WORK → CLOSED`, `CLOSED|REJECTED` — конечные. Он покрыт доменным тестом (ПРОЙДЕНО).
- **Главное (критично):** «неотключаемое» системное правило безопасности `CRITICAL_DEFECT`
  (`readiness-rules.ts:96-108`) обходится одним обычным действием — разбором с понижением severity
  `CRITICAL → любое ниже` (`commands.ts:191-194` + `readiness-score.ts:88-91`). Дефект остаётся
  открытым и не отремонтированным, а блокировка пуска снимается.
- Закрытие «Устранён» требует только свободный текст ≥ 3 символов: ни наряда, ни вложения, ни
  фото (`commands.ts:204-213`, `defect-repository.ts:140-153`) — критический дефект снимается
  одной фразой (важно).
- Критические дефекты, заведённые из завершённого осмотра, **не оповещают** Telegram: ветка
  `inspection-commands.ts:472-498` не вызывает `enqueueCriticalDefects`, в отличие от
  `commands.ts:139` (важно).
- Письменное разрешение диспетчера (`waiver`) снимает тот же «неотключаемый» запрет одним
  человеком (`start-decision.ts:30-39`) — противоречие с текстом системного правила (важно).

## Методика

Что и как искалось (команды/приёмы воспроизводимы):

1. `git rev-parse HEAD` — версия. `git status --short` — рабочее дерево (в нём уже был правлен
   `AGENTS.md` посторонней сессией; я его не трогал).
2. Каталог: `search_files target=files pattern="Defect"`, затем `find src/modules/readiness -type f`.
   Отдельно `search_files pattern="дефект|Дефект|недостат"` — русские подписи.
3. Полное чтение домена и команд дефектов: `domain/defects/types.ts`, `domain/defects/defect.ts`,
   `application/defects/commands.ts`, `application/defects/queries.ts`, `application/defects/schemas.ts`,
   `infrastructure/defects/defect-repository.ts`.
4. Права: `application/capabilities.ts`, `domain/capability-defaults.ts`, `domain/access-matrix.ts`,
   HTTP-контекст `app/api/readiness/_shared/request-context.ts`, адаптер `_shared/route-adapter.ts`.
5. Что блокирует допуск: `domain/readiness-rules.ts`, `domain/readiness-score.ts`,
   `domain/evaluation/evaluator.ts`, `application/readiness-score.ts` (авторитетный расчёт),
   `application/shifts/start-decision.ts`, `application/shifts/commands.ts` (пуск/waiver),
   `domain/shifts/waiver.ts`.
6. Побочные эффекты: `application/defects/commands.ts` (`emitEffects`), `core/notifications/durable-alert.ts`.
7. Прочие пути создания дефектов: `modules/inspections/application/commands/inspection-commands.ts`
   (осмотр → дефект), `modules/operator-mobile/application/commands/checklist.ts` (только чтение, зона заморожена).
8. UI: `components/piling/to/readiness/screens/defects-panel.tsx`, подпись прав в
   `application/bootstrap-query.ts`.
9. Схема БД: `prisma/schema.prisma:658-722` (модель `EquipmentDefect`, enum `DefectStatus/DefectSeverity`).
10. Тесты по теме: `domain/defects/__tests__/defect.test.ts`, `application/__tests__/capabilities.test.ts`,
    `app/api/readiness/defects/**` (маршрутных тестов нет — см. находку 10).

Проверки кода (`tsc`/`lint`/`vitest`/`playwright`) в этой задаче НЕ запускались: задание — аудит
только чтением, кода не менял (НЕ ПРОВЕРЕНО; см. соответствующий раздел).

## Таблица переходов (переход | файл:строка | право | побочный эффект | тест)

| Переход | Файл:строка | Право (matrix) | Побочный эффект | Тест |
|---|---|---|---|---|
| ∅ → `OPEN` (создание) | `src/modules/readiness/application/defects/commands.ts:116-146` | `readiness.defect.report` (`commands.ts:54-58`) | аудит `defect.reported`; outbox `ReadinessSnapshotRequested` (`DEFECT_CHANGED`); `enqueueCriticalDefects` для HIGH/CRITICAL (`commands.ts:139`) | НЕТ (доменного/командного теста на `createDefectCommand` нет) |
| ∅ → `OPEN` (из осмотра) | `src/modules/inspections/application/commands/inspection-commands.ts:472-498` | права осмотра (`readiness.inspection.manage`), не `defect.report` | outbox `ReadinessSnapshotRequested`; **оповещения нет** | НЕТ (маршрутный тест `inspections/[id]/complete` покрывает иное) |
| `OPEN → IN_WORK` (`TRIAGE`) | `src/modules/readiness/application/defects/commands.ts:176-196`; автомат `domain/defects/defect.ts:60`; запись `infrastructure/defects/defect-repository.ts:123-138` | `readiness.defect.manage` (`commands.ts:61-65`) | можно сменить `severity` и привязать наряд (`maintenanceRecordId`); `triagedById/At`; аудит `defect.triage`; пересчёт снимка | `domain/defects/__tests__/defect.test.ts:71`, `application/__tests__/capabilities.test.ts:54` (ПРОЙДЕНО, домен) |
| `OPEN → REJECTED` (`REJECT`) | `src/modules/readiness/application/defects/commands.ts:216-231`; автомат `domain/defects/defect.ts:60` | `readiness.defect.manage` | `reason → resolution`, `resolvedById/At`; аудит `defect.reject`; пересчёт снимка | `defect.test.ts:76` (ПРОЙДЕНО, домен) |
| `IN_WORK → CLOSED` (`RESOLVE`) | `src/modules/readiness/application/defects/commands.ts:198-214`; автомат `domain/defects/defect.ts:61`; запись `defect-repository.ts:140-153` | `readiness.defect.manage` | `resolution` (≥3 симв.); `resolvedById/At`; аудит `defect.resolve`; пересчёт снимка; **наряд/вложение не требуются** | `defect.test.ts:72` (ПРОЙДЕНО, домен) |
| `CLOSED → ∅` / `REJECTED → ∅` | `src/modules/readiness/domain/defects/defect.ts:62-63` | — (перехода нет) | конечное состояние, журнал не переписывается | `defect.test.ts:83-85` (ПРОЙДЕНО) |

Права по умолчанию (матрица кода, `domain/capability-defaults.ts:52-135`): `report` — ADMIN, DISPATCHER,
OPERATOR, ASSISTANT, MECHANIC, FOREMAN, SAFETY_ENGINEER; `manage` — ADMIN, DISPATCHER, MECHANIC,
SAFETY_ENGINEER. Замещение роли (`actingAs`) заменяет набор, а не добавляет (`capabilities.ts:53-70`).

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему важно | Предлагаемый фикс |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/domain/readiness-rules.ts:96-108`; `src/modules/readiness/application/defects/commands.ts:191-194`; `src/modules/readiness/application/readiness-score.ts:88-94` | «Неотключаемое» системное правило `CRITICAL_DEFECT` (санитайзер всегда оставляет `isActive:true`, `readiness-rules.ts:271-274`) обходится через смену `severity`: разбор (`TRIAGE`) принимает `severity` и `defect-repository.ts:131` пишет новое значение; блокировка ищет только `severity: 'CRITICAL'`. | Диспетчер/механик/админ одним действием «Взять в работу» меняет `CRITICAL → NORMAL`. Машина с незакрытым (и, возможно, неотремонтированным) критическим дефектом получает допуск (`DENY_START` больше не срабатывает). Единственное правило, обещанное как снимаемое только тенанта-независимо (комментарий «не отключается»), снимается штатной командой. Аудит пишет `before/after`, но отдельного подтверждения/второй подписи нет. | Запретить понижение `severity` из `CRITICAL` штатной командой разбора (отдельное право/вторая подпись) либо считать дефект блокирующим по истории: если он когда-либо имел `CRITICAL` и открыт — оставить `criticalDefect=true`, пока не закрыт. |
| 2 | важно | `src/modules/readiness/application/defects/commands.ts:198-214`; `src/modules/readiness/infrastructure/defects/defect-repository.ts:140-153`; `src/modules/readiness/application/defects/schemas.ts:28-31` | Закрытие «Устранён» требует только свободный текст `resolution` (min 3 симв.). Наряд (`maintenanceRecordId`) не требуется (в разборе он опционален, при закрытии не проверяется вовсе); вложения/фото не проверяются. | Критический дефект закрывается фразой из трёх символов → блокировка допуска снимается, ремонт нигде не зафиксирован. Нет доказательства «что сделано», кроме текста. | Для `CRITICAL` (и, вероятно, `HIGH`) требовать связанный наряд или минимум вложение; поднять минимальную длину `resolution` и показывать требование в UI. |
| 3 | важно | `src/modules/inspections/application/commands/inspection-commands.ts:472-498` (ср. `src/modules/readiness/application/defects/commands.ts:139`) | Дефекты из завершённого осмотра создаются прямым `tx.equipmentDefect.create` и не вызывают `enqueueCriticalDefects`. Оповещение о HIGH/CRITICAL есть только на пути API-создания. | Критический дефект, найденный при осмотре, блокирует пуск (расчёт видит его), но ответственный в Telegram не оповещается — узнают в лучшем случае при попытке пуска. | Вызвать `enqueueCriticalDefects` в этой ветке (в той же транзакции), как в `checklist.ts:294`. |
| 4 | важно | `src/modules/readiness/application/shifts/start-decision.ts:30-39`; `src/modules/readiness/application/shifts/commands.ts:238-279`; `src/modules/readiness/domain/shifts/waiver.ts:34-38` | Письменное разрешение диспетчера (`waiver`, право `readiness.shift.waive`) покрывает набор блокировщиков, включая `CRITICAL_DEFECT`, и снимает запрет. Требований к причине — только ≥10 символов; вторая подпись не нужна. | Один диспетчер разрешает выпуск машины с незакрытым критическим дефектом, хотя системное правило текстом обещает «эксплуатация запрещена» (`readiness-rules.ts:100-103`). Противоречие между «неотключаемым» правилом и обходимым разрешением. | Решение осознанное (владелец, `readiness-rules.ts:174-190`), поэтому это скорее расхождение текста и механики: либо смягчить формулировку системного правила, либо для `CRITICAL_DEFECT` требовать две подписи (как в нарядах, `domain/permits/approval-policy.ts`). |
| 5 | мелочь | `src/modules/readiness/domain/defects/defect.ts:59-64` | `IN_WORK` нельзя отклонить и нельзя разобрать повторно: после разбора `severity` заморожена (изменить её можно только на переходе `OPEN → IN_WORK`). | Если при ремонте выяснилось, что дефект тяжелее выставленного, повысить `severity` той же записью нельзя — только закрыть и завести новый. Операционно терпимо, но неочевидно. | Документировать в подсказке UI; либо разрешить уточнение `severity` на `IN_WORK` отдельным действием с аудитом. |
| 6 | мелочь | `src/modules/readiness/domain/defects/defect.ts:67-68` | `transitionDefect` индексирует `TRANSITIONS[from][action]` без защиты от неизвестного `from`; незнакомое значение статуса даст `TypeError`, а не `null`. | Защищено enum `DefectStatus` на уровне БД (`prisma/schema.prisma:717-722`), поэтому на практике недостижимо; риск — при появлении статуса в данных помимо кода. | `TRANSITIONS[from]?.[action] ?? null`. |
| 7 | мелочь | `src/components/piling/to/readiness/screens/defects-panel.tsx:117-124` | UI разбора не передаёт `severity` и `maintenanceRecordId` — шлёт только `comment`. Возможности API (уточнение серьёзности, привязка наряда) с основной панели недостижимы. | Находка 1 достижима только через прямой вызов API, не через штатный экран дефектов; при этом связь «дефект ↔ наряд устранения» через панель не заводится. | Если смена severity нужна — добавить контрол в диалог разбора (с подтверждением для понижения из `CRITICAL`); иначе сузить `triageDefectSchema`. |
| 8 | мелочь | `src/modules/readiness/application/defects/queries.ts:57-64` | `summary` считается по ТЕКУЩЕЙ странице списка, а не по всей установке. | На экране с пагинацией счётчик «открытых/блокирующих» рядом со списком может не совпасть с полной картиной. В комментарии это осознано (`queries.ts:61-62`), но потребитель должен знать. | Не проблема, если экран берёт сводку отдельным запросом с `equipmentId`; иначе считать сводку по полному фильтру. |
| 9 | мелочь | `src/modules/inspections/application/commands/inspection-commands.ts:472-483` | Дефект из осмотра создаётся без `shiftId`, хотя схема трактует поле как «смена, в которую обнаружен» (`prisma/schema.prisma:672`), и без `requireEquipment/requireActor` (проверок репозитория команд). | Дефекты от осмотра теряют привязку к смене; проверки существования установки/актора обходятся (впрочем, оба берутся из уже валидированного осмотра). | Проставлять `shiftId` из осмотра; при желании — вынести создание дефекта в общую функцию. |
| 10 | мелочь | `src/modules/readiness/application/defects/commands.ts`; `src/app/api/readiness/defects/**` (нет `*.test.ts`) | Нет командных/маршрутных тестов дефектов: проверяются доменный автомат и права, но не 403 при отсутствии `manage`, не 422 без версии, не 409 при недопустимом переходе, не отказ в закрытии без разбора. | Регрессия в `versionedAction`/`assertCanManage` не будет поймана. Домен `defect.test.ts` покрыт (ПРОЙДЕНО). | Добавить один контрактный тест на `triage/resolve/reject` (403/409/422) — по образцу `application/shifts/__tests__/commands-contract.test.ts`. |

## Детали по ключевым находкам (с доказательством)

- Автомат переходов — единственный источник истины: `TRANSITIONS` (`domain/defects/defect.ts:59-64`),
  исполняется в командах через `transitionDefect` (`commands.ts:183,205,223`). Кнопки панели строго
  по автомату: `OPEN → «Взять в работу»|«Отклонить»`, `IN_WORK → «Устранён»`
  (`components/piling/to/readiness/screens/defects-panel.tsx:233-249`), с комментарием, что сервер
  отвергает недопустимый переход (`:227-232`).
- Блокировка допуска: факт `criticalDefect` (`readiness-score.ts:88-94`, `:193-194`) взводится открытым
  `CRITICAL`-дефектом ИЛИ открытым нарядом `FAULT/REPAIR` приоритета `CRITICAL`. Правило
  `CRITICAL_DEFECT` активно всегда (`readiness-rules.ts:100-103`, `sanitizeRuleSet:271-274`), действие
  `DENY_START`; `canStart` ложно при любом вердикте кроме `ALLOWED` (`domain/readiness-score.ts:228`).
- Единственный законный путь из отказа — `waiver` (`start-decision.ts:26-39`), покрывающий ровно
  зафиксированный набор препятствий (`domain/shifts/waiver.ts:15-38`).
- Схема данных: `EquipmentDefect` (`prisma/schema.prisma:658-708`), статусы/enum — `:710-722`.
  `status @default(OPEN)` и `severity @default(NORMAL)`; отдельного DB-CHECK на статус нет — тип
  гарантирует только enum.

## Статусы проверки

- ПРОЙДЕНО: чтение кода всех перечисленных файлов; сверка автомата переходов с доменным тестом
  (`domain/defects/__tests__/defect.test.ts`) и тестом прав (`application/__tests__/capabilities.test.ts`).
- ГИПОТЕЗА: находка 1 (обход `CRITICAL_DEFECT` через `severity`) выведена из чтения кода
  (команда пишет `severity`, расчёт ищет `severity='CRITICAL'`); интеграционного прогона нет.
- ГИПОТЕЗА: находка 4 (waiver снимает `CRITICAL_DEFECT`) — по коду `blockerFingerprint` включает
  `condition`, а `waiverCoversBlockers` покрывает совпавшие; проверено чтением, не запуском.
- НЕ ПРОВЕРЕНО: фактическое поведение на живых данных/БД (нет запуска приложения и тестов в этой
  задаче); фактическая отправка оповещений (`enqueueCriticalDefects` → доставка) не наблюдалась.

## Не проверено

- Не запускались `npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npx playwright test --list`,
  `npm run build`: задание — аудит только чтением, кода не менял. Все выводы — по чтению исходников.
- Не проверялась цепочка доставки оповещений после `enqueueCriticalDefects`
  (`services/notifications/durable-alert-delivery.ts`) — поведенчески.
- Не проверялись маршрутные тесты дефектов на практике (их нет; вывод о пробеле — из отсутствия файлов).
- `modules/operator-mobile/**` (создание дефектов из чек-листа машиниста, `checklist.ts:294`) —
  зона заморожена; читал только для полноты картины создания дефектов, находок там не заявляю.
- Не проверялся UI-путь добавления/просмотра дефектов на живом стенде; вывод находки 7 — из чтения
  `defects-panel.tsx`.
- Не проверялись RLS/политики на уровне БД для `EquipmentDefect` (вне области этой задачи).
