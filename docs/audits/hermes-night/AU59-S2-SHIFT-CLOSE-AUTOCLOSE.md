# AU59-S2-SHIFT-CLOSE-AUTOCLOSE — Закрытие смены: ручное, автозакрытие, отчёт за другую дату

Аудит только для чтения. Код приложения не менялся. Существующие отчёты в `docs/audits/`
(кроме этого файла), `CODEX-REPORT*`, `docs/strategy` не открывались — независимость первого прохода.

Версия: `git rev-parse HEAD` = `6167c36885c371680bb2d443c7484b44924e8d67` (ветка `hermes/q4-0926`).

## Итог

- Находок по коду: **11** — критично **1**, важно **5**, мелочь **5**.
- **Критично (1).** Смена в `HANDOVER_PENDING` (после «Завершить работу») имеет ровно один выход — ручное
  `close-shift` из мобильного контура. Автозакрытие её намеренно не берёт (`scheduler.ts:64`), отмена — тоже
  (`transitions.ts:11`). Если оператора нет / он перезакреплён (`requireCrew` → 403, `shared.ts:39`), смена зависает
  навсегда и блокирует установку частичным уникальным индексом. Это уже случалось — e2e `operator-walk.spec.ts:317-318`.
- Топ-5: (1) тупик `HANDOVER_PENDING`; (2) гонка автозакрытия с офлайн-очередью — не отправленные вовремя записи
  отвергаются `409` → `FAILED` и в отчёт не попадают; (3) автозакрытый отчёт без `shiftStart/shiftEnd/моточасов/топлива`
  и без строки `ReportAudit 'submitted'`; (4) нет проверки «отчёт уже сдан» → повторная сдача даёт вторую строку истории
  и второе событие `ReportSubmitted`; (5) окно дописывания выработки дневной смены ≈ 5 ч (до 00:00 D+1).
- Тесты автозакрытия и закрытия смены: `2 files, 23 tests passed` (команда ниже).
- Часть предыдущей находки «итоги отчёта берутся без блокировки смены» закрыта: `requireOpenShift` теперь делает
  `SELECT … FOR UPDATE` (`shared.ts:56`) — статус ПРОЙДЕНО.

## Методика

Что и как искалось (повторимо):

```
git rev-parse HEAD                       # 6167c36885c371680bb2d443c7484b44924e8d67
rg -n "close-shift|finish-work|closeShift|finishWork" src e2e
rg -n "runReadinessScheduler|SHIFT_END_HOUR|AUTO_CLOSE" src
rg -n "HANDOVER_PENDING|state: 'CLOSED'|autoClosedAt" src prisma
rg -n "другую дату|productionDate" src/modules/reports/src   # 409 за другую дату
rg -n "QUEUEABLE|classifyFailure|flushQueue" src/components/piling/operator-mobile
node node_modules/vitest/vitest.mjs run \
  src/modules/readiness/application/__tests__/scheduler.test.ts \
  src/modules/operator-mobile/application/commands/__tests__/shift-close.test.ts
```

Прочитаны: `src/modules/readiness/application/scheduler.ts`, `.../domain/shifts/{transitions,types,tenant-production-date}.ts`,
`.../application/shifts/commands.ts`, `src/modules/operator-mobile/application/commands/{shift-close,production,equipment,shared}.ts`,
`.../application/mobile-shift-query.ts`, `.../domain/shift-phases.ts`, `src/app/api/operator/mobile/command/route.ts`,
`src/app/api/reports/upsert/route.ts`, `src/core/api-wrapper.ts`, `src/modules/reports/application/commands/report-command.service.ts`,
`src/components/piling/operator-mobile/{offline-queue.ts,use-offline-queue.ts,operator-mobile-app.tsx,screens/closing-screen.tsx}`,
`prisma/schema.prisma` (model Shift), миграция `20260815120000_shift_auto_close`.

Замороженные области (варианты экранов оператора, ORION) отдельно не аудировались; `operator-v2`/`operator-shift-v2.tsx`
затронут только как источник ручного пути закрытия.

## Таблица сценариев закрытия/сдачи

| Путь | Условие | Что пишется (файл:строка) | События | Тест |
| --- | --- | --- | --- | --- |
| Ручное закрытие с телефона `close-shift` | `requireOpenShift` (не CLOSED/CANCELLED, смена «своя») + ЕО после работы `EO_AFTER` COMPLETED + в UI `pending=0` | `Shift.state=CLOSED, closedAt, closedById` (`shift-close.ts:86-92`); отчёт `status=submitted, submittedAt, shiftStart/shiftEnd, closingComment, endingEngineHours, endingFuelPercent` (`shift-close.ts:172-185`) | `ReportAudit 'submitted'` (`shift-close.ts:204-213`); Outbox `ReportSubmitted` (`shift-close.ts:321`) | `shift-close.test.ts:74-113,158-197` |
| Ручное закрытие из `HANDOVER_PENDING` (v2/моб.) | То же; переход `close-shift` его допускает | То же | То же | `operator-shift-v2.tsx:696-709`; `operator-shift-v2.test.tsx:263` |
| `finish-work` («Работа завершена») | `requireOpenShift` | `Shift.state=HANDOVER_PENDING, lastEditedById` (`shift-close.ts:23-26`) | нет | `shift-close.test.ts:124-148` |
| `submit-report` (контур готовности) | `requireOpenShift` + ЕО после работы ИЛИ осмотр `POST_SHIFT` COMPLETED | отчёт `submitted` (тот же `submitShiftReport`), **состояние смены не меняется** (`shift-close.ts:117-217,227-294`) | `ReportAudit 'submitted'`; Outbox `ReportSubmitted` | `shift-close.test.ts:206-244` |
| Автозакрытие планировщика | `state IN ('STARTED')` (`scheduler.ts:64,161-164`) И `isAutoCloseDue`: день — с 00:00 D+1, ночь/неизвестный тип — с 12:00 D+1 по поясу смены (`scheduler.ts:92-111`) | `Shift.state=CLOSED, closedAt, autoClosedAt` (`scheduler.ts:169-172`); draft отчёта → `submitted` (`scheduler.ts:204-217`) | AuditLog `shift.auto-closed` SYSTEM (`scheduler.ts:177-193`); Outbox `ReportSubmitted {autoClosed:true}` (`scheduler.ts:220-238`) | `scheduler.test.ts:118-195,199-224` |
| Приёмка при несданной смене «за вчера» | у установки активная смена (STARTED/HANDOVER_PENDING) другой даты | `409 «По этой установке не закрыта смена за <date>»` (`equipment.ts:55-60`) | нет | `mobile-shift-query.test.ts:69,98` (`blockedShift`) |
| Отчёт за другую дату (админ-форма) | присланные `date`/`siteId` ≠ сохранённым у найденного отчёта | `409` (`report-command.service.ts:169-174` → `api-wrapper.ts:108-111`) | нет (feedback warn) | `report-command-service.test.ts:631-651` |
| Отчёт по ещё идущей смене (админ-форма) | `shift.state IN ('STARTED','HANDOVER_PENDING')` | `409 «Смена ещё идёт…»` (`report-command.service.ts:199-204`) | нет | — (не проверено) |
| Очередь устройства | `log-production` / `report-incident` / `correct-production` | localStorage `pilingtrack.operator.queue.v1` (`offline-queue.ts:29,67-69`) | нет | `offline-queue.test.ts` |
| Закрытие офлайн | `close-shift`/`finish-work` в `QUEUEABLE` отсутствуют | ничего не пишется; прямое «нет сети» (`offline-queue.ts:16-19,67-69`) | нет | — |

## Сценарии зависания смены в промежуточном состоянии

- **S1 — `HANDOVER_PENDING` навсегда (критично).** `finish-work` переводит смену в это состояние (`shift-close.ts:23-26`).
  Планировщик его не трогает (`scheduler.ts:64`), `cancel` разрешён только из PLANNED/PENDING_ACCEPTANCE/STARTED
  (`transitions.ts:11`), `handover` — только из STARTED (`transitions.ts:12`), а `accept` требует уже `SUBMITTED`-передачи
  (`transitions.ts:13`), которой при мобильном `finish-work` нет. Единственный выход — вернуться и нажать `close-shift`.
  Пока оператор недоступен или перезакреплён (`requireCrew` → 403, `shared.ts:39`), установку нельзя открыть заново
  (уникальный индекс, `equipment.ts:41-45`). Подтверждение реального случая: e2e `operator-walk.spec.ts:317-318`
  (`test.fail`, «смена зависла в HANDOVER_PENDING с 27.09, новый цикл не начинается»).
- **S2 — «STARTED» + офлайн-очередь (важно).** Записи выработки лежат на телефоне (`PENDING`), наступает порог
  автозакрытия (день — 00:00 D+1, ночь — 12:00 D+1), сервер закрывает смену. При следующем сливе `log-production`
  упирается в `requireOpenShift` → `409 «Смена уже закрыта»` (`shared.ts:66-68`), `classifyFailure(409)=permanent`
  (`offline-queue.ts:139-144`) → запись навсегда `FAILED`, в отчёт не входит.
- **S3 — PLANNED/PENDING_ACCEPTANCE висит (по замыслу).** Не начатую смену автозакрытие не берёт (`scheduler.ts:49-53,64`),
  остаётся диспетчеру на разбор. Зависание «насовсем», если диспетчер не отменит.
- **S4 — отчёт сдан, смена не передана (важно-мелочь).** `submit-report` пишет отчёт `submitted`, а смену оставляет
  `STARTED` (`shift-close.ts:227-294`). Дальше выработку не записать (`production.ts:220-227`, `409`), а закрытие —
  только автозакрытием или ручным `close-shift`.
- **S5 — обрыв сети ровно после коммита закрытия (восстанавливается, ПРОЙДЕНО).** `close-shift` не кладётся в очередь;
  повтор даёт `409 «Смена уже закрыта»`, `run()` по 409 тихо перечитывает состояние и уводит экран в CLOSED
  (`operator-mobile-app.tsx:474-481`).

## Находки

| # | severity | path:line | problem | scenario / why it matters | suggested fix |
| --- | --- | --- | --- | --- | --- |
| 1 | критично | `scheduler.ts:64` + `transitions.ts:11-13` + `shared.ts:39` | `HANDOVER_PENDING` не закрывается автозакрытием, не отменяется и не может получить передачу (её `handover` разрешён только из STARTED). Единственный выход — ручной `close-shift` | Оператор нажал «Работа завершена», но не вернулся / перезакреплён — смена висит вечно и блокирует установку. Реальный случай: e2e `operator-walk.spec.ts:317-318` | Дать путь закрытия/отмены для HANDOVER_PENDING без живого оператора (диспетчерское закрытие с причиной) либо включить такие смены в автозакрытие, не ломая приёмку передачи |
| 2 | важно | `scheduler.ts:169-172` vs `offline-queue.ts:139-144` | Автозакрытие идёт по времени сервера и не знает про очередь телефона | Записи выработки, не успевшие синхронизироваться до порога автозакрытия, отвергаются `409` → `FAILED` и в отчёт не попадают (S2) | Не помечать 409 «Смена уже закрыта» постоянным отказом: при закрытии смены принимать дозапись за производственные сутки либо буферизовать её в отчёт |
| 3 | важно | `scheduler.ts:204-218` vs `shift-close.ts:172-213` | Автозакрытый отчёт: `status=submitted`, но без `shiftStart/shiftEnd/closingComment/endingEngineHours/endingFuelPercent` и без строки `ReportAudit 'submitted'` (в отличие от ручного закрытия) | В истории отчёта нет шага сдачи, в журнале — пустое время смены/моточасы/топливо; разбор «что и когда сдалось» нечем закрыть | Пропускать автозакрытые отчёты через тот же `submitShiftReport` (или добирать поля и писать `ReportAudit 'submitted'` с пометкой `autoClosed`) |
| 4 | важно | `shift-close.ts:117-217`; тест `shift-close.test.ts:238-244` | Нет проверки «отчёт уже сдан» перед `report.update status=submitted` | Повторная сдача пишет вторую строку `ReportAudit` и второе событие `ReportSubmitted` — двойное уведомление/PDF и «Корректировка отчёта» (`event-handlers.ts:636`) | Ранний выход/идемпотентность по `status==='submitted'` |
| 5 | важно | `scheduler.ts:73,76,92-96` | Дневная смена (конец 19:00 + запас 5 ч) автозакрывается уже с 00:00 D+1 | Окно «дописать выработку после работы» для дневной смены — всего ~5 ч; после полуночи запись не принять (`10`) | Увеличить/сделать настраиваемым запас либо не закрывать смену, по которой идут неотправленные записи |
| 6 | важно | `src/components/piling/to/readiness/api/contracts.ts:116-129`; `shifts-screen.tsx:214,234` | В клиентском `ReadinessShiftDto` нет `autoClosedAt` (только `closedAt`); экран рисует общий ярлык `CLOSED` | Диспетчер не отличает «закрыто планировщиком» от «закрыто по сдаче», хотя `autoClosedAt` сервер отдаёт (`commands.ts:44`) | Добавить `autoClosedAt` в DTO и отдельную подпись/признак на экране смен |
| 7 | мелочь | `scheduler.ts:257` vs `scheduler.ts:104-110` | Ключ суточного пересчёта (`DAILY_RECALC`) считается по `tenantProductionDate(now, null)` → Europe/Moscow, а автозакрытие — по поясу смены | Для смен в других поясах сутки дедупликации пересчёта и сутки автозакрытия могут разойтись | Брать пояс из настроек организации там же, где берёт автозакрытие |
| 8 | мелочь | `scheduler.ts:63,83` | Час/запас автозакрытия зашиты в код (`AUTO_CLOSE_GRACE_HOURS=5`, `AUTO_CLOSE_UNKNOWN_TYPE_HOUR=12`) | Операционно значимое поведение меняет только разработчик | Вынести в `TenantSettings` либо задокументировать как фиксированную политику |
| 9 | мелочь | `offline-queue.ts:16-19,67-69` | `close-shift`/`finish-work` не кладутся в очередь устройства | Без сети смену закрыть нельзя — только «нет сети»; закрытие недоступно до восстановления связи | Оставить как есть (осознанно), но явно сообщать оператору в UI о невозможности офлайн-закрытия |
| 10 | мелочь (ГИПОТЕЗА) | `scheduler.ts:169-239` | Автозакрытие не заказывает пересчёт готовности по смене (нет `ReadinessSnapshotRequested`), в отличие от `acceptEquipment` (`equipment.ts:147`) | Если закрытие смены влияет на готовность, снимок останется устаревшим до суточного пересчёта | Проверить, участвует ли состояние смены в расчёте готовности; если да — заказывать снимок и на автозакрытие |
| 11 | мелочь | `shift-close.ts:41-96` (нет `assertShiftTransition`) | `closeShift` не проверяет переход и закрывает смену напрямую из `STARTED`, минуя `finish-work` | «Завершить работу» становится необязательным шагом (обязателен только `EO_AFTER`); это не баг, но фазы UI и сервера расходятся по строгости | Либо требовать промежуточное состояние, либо задокументировать, что `finish-work` — только для UI-фазы |

## Не проверено

- Поведение автозакрытия на реальной БД: строки `Shift`/`Report` не читались (доступа к БД нет) — выводы только по коду и миграциям.
- Идёт ли планировщик `startReadinessScheduler` в dev (`npm run dev`) — в коде планировщик поднимается только в `worker:all`
  (`workers/unified-worker/readiness-scheduler.ts:56`); в dev-режиме автозакрытие, вероятно, не запускается (не подтверждал запуском).
- Фактическая настройка часовых поясов организации и наличие смен в поясах, отличных от Europe/Moscow (влияет на находки 7).
- Влияет ли состояние смены на расчёт готовности (находка 10) — по коду не прослежено.
- Тест реального слияния очереди при автозакрытии (S2/находка 2) — воспроизведения на стенде не делал.
- Статус 409 из `reports/admin-upsert` (отдельная админ-форма) — читал только `reports/upsert`.
