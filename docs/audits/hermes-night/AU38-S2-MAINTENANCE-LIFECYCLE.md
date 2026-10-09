# AU38-S2-MAINTENANCE-LIFECYCLE — ТО и ремонты: жизненный цикл наряда

Репозиторий: PilingTrack (Next.js 16 + Prisma 7). Рабочая папка: `D:\PillingR\wt-night`, ветка `hermes/q4-0926`.
Версия кода (`git rev-parse HEAD`): `3501a050e2c185369f01461ec694c26ecaf02d1c`.

Аудит только чтение. Единственный созданный файл — этот отчёт. Код приложения не менялся.
Статусы ниже: **ПРОЙДЕНО** (прочитано в коде/команде), **ГИПОТЕЗА** (следствие, прямо кодом не подтверждено), **НЕ ПРОВЕРЕНО**.

## Итог

1. Жизненный цикл наряда ТО реализован в `src/modules/equipment` (создание/правка/приёмка/удаление) и опирается на `MaintenanceRecord.status`; автоматически наряд создаёт только планировщик регламентов (`pm-scheduler.ts`) в статусе `PLANNED`.
2. Главная проблема: **на сервере нет валидации переходов статуса** — `updateMaintenance` принимает любой `status` (в т.ч. `CANCELLED → DONE`, переоткрытие `DONE`), а таблица переходов живёт только на клиенте (`maintenance-helpers.ts:25`).
3. Вторая: **наряд можно создать сразу в `DONE`/`CANCELLED`** (`createMaintenance` принимает `status` без правил); созданный сразу `DONE` наряд **не сдвигает регламент и не пишет моточасы**, а `CANCELLED` — без причины.
4. Третья: **удаление закрытого наряда не откатывает его следствия** — сдвиг регламента и показание счётчика, записанные при закрытии, остаются.
5. Аудит наряда полный (created/updated/accepted/deleted/scheduled), но у **регламентов нет аудита правки** (`PATCH /api/maintenance-plans/[id]`), а запись `plan.created` не best-effort (сбой аудита = 500 при уже созданном регламенте).

Счёт по важности: **критично — 0, важно — 7, мелочь — 13** (всего 20 находок).
Топ-5: №1 (нет серверной валидации переходов), №2/№3 (создание сразу в DONE/CANCELLED обходит правила и регламент), №4 (удаление закрытого наряда не откатывает следствия), №8 (две несогласованные модели переходов), №5/№6 (аудит регламентов).

## Методика

Читал код (не отчёты — `docs/audits/`, `docs/strategy`, `CODEX-REPORT*` не читал). Команды и инструменты:

```
git rev-parse HEAD                                     # версия
find src -path '*maintenance*' -o -path '*Maintenance*' # карта файлов ТО
grep -n "maintenance\.manage" src/services/auth/authorization-service.ts
grep -rn "OPEN_MAINTENANCE" src/modules/readiness src/modules/equipment
grep -rl "maintenance\|Maintenance" --include="*.test.ts" --include="*.test.tsx" src e2e | wc -l   # => 66
```

Прочитаны целиком (с номерами строк): `src/modules/equipment/application/commands/{equipment-maintenance,maintenance-plan,pm-scheduler,maintenance-regulation,meter-reading}.ts`; `src/app/api/maintenance/**`, `src/app/api/maintenance-plans/**`, `src/app/api/equipment/[id]/maintenance/**`; `src/components/piling/maintenance/**`; `src/lib/{pm-due,maintenance-due,maintenance-read-model}.ts`; `src/modules/readiness/application/readiness-score.ts`, `.../domain/readiness-score.ts`, `.../domain/readiness-rules.ts`; `src/workers/unified-worker/pm-scheduler.ts`; `prisma/schema.prisma` (модель `MaintenanceRecord`). Тесты прочитаны: `equipment-maintenance.test.ts`, route-тесты maintenance*, `work-order-logic.test.ts`; по `grep -n "it("` — карта тестов `pm-scheduler.test.ts`, `maintenance-plan.test.ts`, `maintenance-helpers.test.ts`.

Проверки §6 AGENTS.md (`tsc/lint/test:unit/playwright/build`) **не запускал** — задача только на чтение, изменения в код не вносились; воркtree на старте уже содержал незакоммиченную правку `AGENTS.md` (к моей работе не относится).

## Жизненный цикл наряда ТО

### Создание

- **По регламенту (авто).** Суточный воркер `startPmScheduler` → `runPmScheduler(tenantId)` (`src/workers/unified-worker/pm-scheduler.ts:78-84`, `src/modules/equipment/application/commands/pm-scheduler.ts:46-157`). Для каждого активного регламента `evaluatePlanDue` (HOURS по последнему показанию счётчика, CALENDAR по дате); при `due_soon`/`overdue` под advisory-замком `pg_advisory_xact_lock(hashtext('pm:{tenant}:{eq}:{type}'))` создаётся наряд `status='PLANNED'`, `title = "<план> (подходит срок|просрочено)"`, `scheduledAt = result.dueDate` (`pm-scheduler.ts:105-131`). Дедупликация — «нет открытого наряда того же типа» (`:110-119`). Аудит `maintenance.scheduled` с `actorId: null` (`:148-152`). — **ПРОЙДЕНО**.
- **Вручную.** `POST /api/equipment/[id]/maintenance` → `createMaintenance` (`src/app/api/equipment/[id]/maintenance/route.ts:55-99`, `equipment-maintenance.ts:58-100`). Схема `createSchema` (`route.ts:20-37`) допускает `type`, `status` (по умолчанию `PLANNED`), `priority`, `title`, `description`, `scheduledAt`, `completedAt`, `engineHoursAtService`, `cost`, `performedBy`, `startedAt`, `laborHours`, `assigneeId`, `faultCause`, `workDone`, `partsUsedText`. Аудит `maintenance.created` (best-effort, `route.ts:79-91`). — **ПРОЙДЕНО**.
- **Кто.** Право `maintenance.manage`: `ADMIN`, `DISPATCHER`, `MECHANIC`, `SAFETY_ENGINEER` (`src/services/auth/authorization-service.ts:108`). — **ПРОЙДЕНО**.
- Формы создания: доска (`WorkOrderFormDialog`, статус выбирается из полного списка — `work-order-form-dialog.tsx:327-335`), страница `/admin/maintenance/new` (`MaintenanceRequestForm`, всегда `status: 'PLANNED'` — `maintenance-request-form.tsx:109-120`), вкладка ТО установки. — **ПРОЙДЕНО**.

### Статусы и переходы

Статусы (`prisma/schema.prisma:585,634-641`): `PLANNED, ASSIGNED, IN_PROGRESS, ON_HOLD, DONE, CANCELLED`.

Единственная таблица переходов — клиентская (`src/components/piling/maintenance/maintenance-helpers.ts:25-32`):

| из → в | действие | кто | условия | события (снимок готовности) | запись в аудит |
|---|---|---|---|---|---|
| (нет) → PLANNED/IN_PROGRESS/DONE/CANCELLED/… | POST создать | maintenance.manage | `equipment` того же тенанта существует; при создании `DONE`/`CANCELLED` проверок нет | `MAINTENANCE_CHANGED` `:created` (`equipment-maintenance.ts:97`) | `maintenance.created` (`route.ts:80-88`) |
| (нет) → PLANNED | планировщик | система (`actorId:null`) | регламент активен, срок наступил, нет открытого наряда того же типа | `MAINTENANCE_CHANGED` `:scheduled` (`pm-scheduler.ts:135-143`) | `maintenance.scheduled` (`:148-152`) |
| PLANNED → IN_PROGRESS | «В работу» | maintenance.manage | — (сервер не проверяет исходный статус) | `:status-changed` (`:270`) | `maintenance.updated` (`[recordId]/route.ts:82-102`) |
| ASSIGNED → IN_PROGRESS | «В работу» | maintenance.manage | — | `:status-changed` | `maintenance.updated` |
| IN_PROGRESS → ON_HOLD | «Приостановлено» | maintenance.manage | причина не требуется | `:status-changed` | `maintenance.updated` |
| ON_HOLD → IN_PROGRESS | «В работу» | maintenance.manage | — | `:status-changed` | `maintenance.updated` |
| IN_PROGRESS → DONE | «Выполнено» | maintenance.manage | `workDone` непустой; ставится `completedAt`, `closedById` | `:status-changed`; сдвиг регламента + показание счётчика (`:257-267`) | `maintenance.updated` |
| PLANNED/ASSIGNED/ON_HOLD → DONE | кнопка «Закрыть ТО» доски/журнала, PUT `{status:'DONE'}` | maintenance.manage | `workDone` непустой (иначе 422) | то же | `maintenance.updated` |
| любой неначатый/закрытый → DONE (приёмка) | «Принять» | `ADMIN` (`assertRole`, accept/route.ts:24) | `workDone` непустой; `acceptedById` был пуст | `:accepted` (`:322`); сдвиг регламента; показание — только если статус не был `DONE` (`:319-321`) | `maintenance.accepted` (`accept/route.ts:35-42`) |
| любой → CANCELLED | «Отменено» | maintenance.manage | `cancelReason` непустой; ставится `closedById` | `:status-changed` | `maintenance.updated` |
| любой не принятый → удалён | DELETE | maintenance.manage | `acceptedById === null`; иначе 409 | `:deleted` только если удалённый статус открытый (`:355-362`) | `maintenance.record.deleted` (`[recordId]/route.ts:161-176`) |
| принятый → любое изменение | PUT | — | `acceptedById !== null` → 409 (`:206-208`) | — | — |
| принятый → удаление | DELETE | — | `acceptedById !== null` → 409 (`:342-344`) | — | — |

Клиентская таблица `TRANSITIONS` (строгая, для карточки наряда): `PLANNED → {IN_PROGRESS, CANCELLED}`, `ASSIGNED → {IN_PROGRESS, CANCELLED}`, `IN_PROGRESS → {ON_HOLD, DONE, CANCELLED}`, `ON_HOLD → {IN_PROGRESS, CANCELLED}`, `DONE/CANCELLED → ∅` (`maintenance-helpers.ts:25-32`, покрыта тестом `maintenance-helpers.test.ts:32-42`). **Сервер её не знает** — см. находку №1.

### Приёмка после ТО

`acceptMaintenance` (`equipment-maintenance.ts:280-325`): проверяет тенант (fail-closed, `:284`), отказ при повторной приёмке (409, `:294`), требует `workDone` (`:297`), пишет `acceptedById/acceptedAt/status:'DONE'/closedById/completedAt`, сдвигает регламент и (только если наряд не был `DONE`) заводит показание счётчика. Право: `maintenance.manage` **и** реальная роль `ADMIN` через `assertRole` (accept/route.ts:19,24) — режим «Действую как механик» приёмку не пропускает. UI: кнопка «Принять» только у админа (`work-order-detail.tsx:456-470`). — **ПРОЙДЕНО**.

### Влияние на допуск техники

Снимок готовности заказывается на `created` / `status-changed` / `accepted` / `scheduled` / `deleted(открытый)` через `requestReadinessSnapshot` с `triggerType: 'MAINTENANCE_CHANGED'` (`equipment-maintenance.ts:111-126`, `pm-scheduler.ts:135-143`). В авторитетном расчёте (`src/modules/readiness/application/readiness-score.ts`) открытые наряды (`OPEN_MAINTENANCE = PLANNED/ASSIGNED/IN_PROGRESS/ON_HOLD`) читаются в `:63-66` и влияют только на флаг `criticalDefect` — если тип `FAULT`/`REPAIR` и приоритет `CRITICAL` (`:193-194`), это системный блокер `CRITICAL_DEFECT` с `DENY_START` (`readiness-rules.ts:100-104`), неотключаемый (`sanitizeRuleSet`, `:271-274`). Критерий «Обслуживание» (вес 27, `readiness-rules.ts:169`) считается **из полей самой техники** `nextMaintenanceAtHours` / `nextMaintenanceDate` (`domain/readiness-score.ts:147-163`), а не из открытых нарядов; открытые наряды попадают только в `evidence.maintenanceRecordIds` (`application/readiness-score.ts:211`). Подробнее — находка №7. — **ПРОЙДЕНО**.

### Моточасы и интервалы

- Сдвиг регламента при закрытии: `advanceMaintenanceRegulation` (`maintenance-regulation.ts:76-118`) — по активным регламентам техники того же `type` пишет `lastDoneHours = engineHoursAtService ?? engineHoursTotal`, `lastDoneAt = completedAt`, затем проекция ближайшего срока в `Equipment.nextMaintenanceAtHours/Date` (`projectNextMaintenance`, `:45-64`). Идемпотентно (значения из записи, не приращением). — **ПРОЙДЕНО**.
- Показание счётчика при закрытии: `recordServiceHours` (`equipment-maintenance.ts:176-189`) → `recordMeterReadingInTx(... allowDecrease:true, recordedAt: completedAt)`; вызывается только на переходе в `DONE` (`:265-267`) и при приёмке не-`DONE` наряда (`:319-321`); кэш `engineHoursTotal` пересчитывает база (`meter-reading.ts:118-133`). — **ПРОЙДЕНО**.
- Планировщик считает срок по регламенту (HOURS: `lastDoneHours + intervalHours`; CALENDAR: `lastDoneAt + intervalDays`), порог «скоро» — `SOON_HOURS = 50` / `leadTimeDays` (`src/lib/pm-due.ts:7,57-75`). — **ПРОЙДЕНО**.

### Уведомления

Единственный путь — суточный дайджест просроченных регламентов: `notifyOverdue` в воркере, включается настройкой `maintenanceOverdue`, шлёт `telegramNotifier.sendAlert` одним сообщением на тенант (`src/workers/unified-worker/pm-scheduler.ts:30-65,83`). Уведомлений о создании/назначении/закрытии/приёмке наряда нет. Ручной запуск `POST /api/maintenance-plans/run` уведомление **не** шлёт (только воркер). — **ПРОЙДЕНО**.

### Что при удалении наряда после приёмки

Удаление принятого наряда **запрещено**: `deleteMaintenance` при `acceptedById !== null` отдаёт 409 «Наряд принят, удалить его нельзя» (`equipment-maintenance.ts:342-344`), покрыто тестом (`equipment-maintenance.test.ts:289-294`). Права на обход нет (приёмку отделяет `assertRole ADMIN`). — **ПРОЙДЕНО**. При этом UI кнопку «Удалить» для принятых нарядов не скрывает — см. находки №11, №12.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | важно | `src/modules/equipment/application/commands/equipment-maintenance.ts:228-243` | Сервер не проверяет допустимость перехода статуса: `updateMaintenance` пишет любой присланный `status` (единственные охраны — `workDone` для `DONE`, `cancelReason` для `CANCELLED`, `acceptedById`). Таблица переходов есть только на клиенте (`maintenance-helpers.ts:25-32`). | Прямой PUT `{status:'DONE'}` на `CANCELLED`-наряд вернёт его в работу, сдвинет регламент и запишет показание счётчика; `DONE → IN_PROGRESS` переоткроет закрытый наряд. Автор это знает (коммент `work-order-table.tsx:146-148`), но защита — только UI. | Валидировать переход во `updateMaintenance` (таблица допустимых переходов) и отдавать 409/422. |
| 2 | важно | `equipment-maintenance.ts:69-96` + `src/app/api/equipment/[id]/maintenance/route.ts:20-37` | `createMaintenance` принимает `status` напрямую и не применяет правила завершения: POST `{status:'DONE'}` создаёт закрытый наряд без `workDone`, POST `{status:'CANCELLED'}` — без причины. Форма на создании даёт выбрать любой статус (`work-order-form-dialog.tsx:327-335`). | Правило «нельзя закрыть наряд без описания работ» (комментарий `:128-146`) обходится созданием. | На создании разрешать только `PLANNED`/`IN_PROGRESS`, либо применять `assertWorkDescribed`/`assertCancelExplained` и сдвиг регламента. |
| 3 | важно | `equipment-maintenance.ts:73-99` (ср. `:257-267`) | Наряд, созданный сразу в `DONE`, не вызывает `advanceMaintenanceRegulation` и `recordServiceHours`. | Мастер заводит прошедшее ТО «задним числом» сразу закрытым → порог следующего ТО и журнал моточасов не обновляются; критерий «Обслуживание» остаётся «просрочено». | При создании в `DONE` прогонять тот же путь закрытия, что и `updateMaintenance`. |
| 4 | важно | `equipment-maintenance.ts:345-364` | Удаление закрытого (`DONE`, не принятого) наряда не откатывает ни сдвиг регламента (`lastDone*`, `nextMaintenance*`), ни показание счётчика, записанные при закрытии; снимок готовности для закрытого удаления не заказывается (`:355`) — по замыслу, но следствия наряда остаются. | Закрыть наряд, затем удалить его как ошибочный → порог ТО остаётся сдвинутым, «лишнее» показание — в журнале; исходных данных наряда уже нет. | Либо запретить удаление закрытых нарядов, либо откатывать/пересчитывать регламент и показание при удалении. |
| 5 | важно | `src/app/api/maintenance-plans/[id]/route.ts:29-57` | `PATCH /api/maintenance-plans/[id]` не пишет аудит, хотя create (`maintenance-plans/route.ts:72-75`) и delete (`[id]/route.ts:96-114`) пишут. Тест есть только на DELETE. | Правку интервала или выключение регламента (`isActive`) нельзя восстановить по ленте; «почему ТО не запланировано» не разобрать. | Добавить `maintenance.plan.updated` со снимком before/after. |
| 6 | важно | `src/app/api/maintenance-plans/route.ts:70-80` | Запись аудита `maintenance.plan.created` не best-effort: `await recordAuditEvent` внутри `try`, `catch` ловит только `ServiceError`; иной сбой аудита → 500 при уже созданном регламенте. Прочие пути ТО оборачивают аудит в отдельный `try/catch` (напр. `equipment/[id]/maintenance/route.ts:79-91`). | Клиент видит 500, считает регламент несохранённым и повторяет → дубль регламента. | Обернуть запись следа в собственный try/catch, как в остальных путях ТО. |
| 7 | мелочь | `equipment-maintenance.ts:102-110` | Комментарий утверждает: «Открытый наряд ТО — вход … критерия «Обслуживание», 20 баллов». Фактически критерий `MAINTENANCE` считается из `Equipment.nextMaintenanceAtHours/Date` (`domain/readiness-score.ts:147-163`), вес 27 (`readiness-rules.ts:169`), а открытые наряды влияют только на `criticalDefect` (`application/readiness-score.ts:193-194`) и `evidence`. | По комментарию примут, что открытый наряд снижает балл «Обслуживание», и будут искать эффект не там. | Привести комментарий к реальному поведению. |
| 8 | важно | `work-order-table.tsx:143-155`; `equipment-maintenance.tsx:194-200`; `maintenance-board.tsx:479-488` | Две несогласованные модели переходов: карточка наряда использует строгую `nextStatusActions` (DONE только из `IN_PROGRESS`), а кнопка «Закрыть ТО» доски и журнала установки шлёт `{status:'DONE'}` из любого открытого статуса (в т.ч. `PLANNED`). | Закрытие только что заведённого `PLANNED`-наряда минуя «В работу»: `startedAt` не проставляется, MTTR-данные (`startedAt`/`completedAt`) неполны. | Единый источник переходов (взять `nextStatusActions` и в таблице/журнале). |
| 9 | мелочь | `work-order-form-dialog.tsx:328-335` | Статус `ASSIGNED` недостижим действиями: назначение исполнителя не меняет статус, переход в `ASSIGNED` есть только через ручной выбор статуса в форме. | Назначение ответственного не отображается статусом; `ASSIGNED` в БД — ручной артефакт. | Либо авто-переход в `ASSIGNED` при назначении, либо убрать статус из модели выбора. |
| 10 | мелочь | `src/workers/unified-worker/pm-scheduler.ts:83`; `src/app/api/maintenance-plans/run/route.ts:23` | Уведомление о просрочке шлёт только воркер; ручной прогон планировщика (`POST /api/maintenance-plans/run`) возвращает результат, но `notifyOverdue` не вызывает. | Админ жмёт «запустить планировщик», просрочки видит, уведомления никому не уходит. | Вызывать `notifyOverdue` и в ручном прогоне. |
| 11 | мелочь | `equipment-maintenance.tsx:133` | `remove()` бросает `new Error('Удаление не удалось')`, теряя серверный текст; на 409 «Наряд принят, удалить его нельзя» пользователь не узнаёт причину. На доске (`maintenance-board.tsx:266`) сообщение сервера сохраняется. | Один и тот же отказ объясняется по-разному на двух экранах. | Пробрасывать `maintenanceErrorText(res.status, err.error)`. |
| 12 | мелочь | `work-order-table.tsx:156-165`; `equipment-maintenance.tsx:206-210` | Кнопка «Удалить» показывается и для принятых нарядов (не учитывают `acceptedAt`), хотя сервер всегда ответит 409 (`equipment-maintenance.ts:342-344`). | Мёртвое действие: пользователь жмёт «Удалить», получает отказ. | Скрывать/дизейблить удаление при `acceptedAt`. |
| 13 | мелочь | `work-order-table.tsx:149`; `equipment-maintenance.tsx:194` | Кнопка «Закрыть ТО» показывается для наряда без `workDone`; нажатие гарантированно даёт 422 (`equipment-maintenance.ts:140-146`). | Лишний цикл «нажал → отказ → пошёл заполнять Стадию 2». | Дизейблить кнопку закрытия при пустом `workDone`. |
| 14 | мелочь | `work-order-detail.tsx:187-205` + `equipment-maintenance.ts:265` | «Сохранить» на закрытом (не принятом) наряде меняет `engineHoursAtService`, но показание счётчика пишется только на переходе в `DONE` — расхождения наряда и журнала. | Механик поправил моточасы после закрытия — в журнале остаётся прежнее значение. | Либо пересчитывать показание при правке моточасов, либо запретить правку после `DONE`. |
| 15 | мелочь | `equipment-maintenance.ts:299-309` | Приёмка переводит наряд в `DONE` из любого статуса (в т.ч. `PLANNED`) — без требования побывать в `IN_PROGRESS`/`DONE`; проверяется только `workDone`. | Приёмка «ни разу не начатой» работы закрывает наряд без `startedAt`. | Требовать предшествующий `DONE`/`IN_PROGRESS` либо документировать как задумку. |
| 16 | мелочь | `equipment-maintenance.ts:233-242` | Причина обязательна только для `DONE` и `CANCELLED`; `ON_HOLD` («Приостановлено») ставится без объяснения. | Простой наряда без причины — неотличим от забытого. | Требовать причину и для `ON_HOLD`. |
| 17 | мелочь | `equipment-maintenance.ts:211` | `type` наряда меняется свободно после создания. | Смена `TO1 → REPAIR` перенаправляет закрытие под другой регламент/другой критический блокер готовности. | Запретить смену `type` после начала работ. |
| 18 | мелочь | `pm-scheduler.ts:129` + `pm-due.ts:65` + `work-order-logic.ts:33-36` | Наряд, созданный планировщиком по моточасам, получает `scheduledAt = null` (для HOURS `dueDate` всегда `null`), поэтому не попадает в «Просрочено» и «Срок» (`isOverdue` требует дату). | Просроченный по моточасам наряд не подсвечивается на доске как просроченный, хотя он просрочен. | Проставлять `scheduledAt` для HOURS-нарядов (напр. датой планового перебега) или учитывать `engineHoursAtService` в `isOverdue`. |
| 19 | мелочь | `equipment-query.service.ts:13,493` | Список доски ограничен `take: 500` без курсорной пагинации; у крупного парка журнал молча срежется. | Диспетчер видит неполный журнал, не зная об этом. | Индикатор усечения или курсорная пагинация. |
| 20 | мелочь | `src/lib/maintenance-read-model.ts:16`; `work-order-logic.ts:27`; `pm-scheduler.ts:25`; `src/modules/readiness/application/readiness-score.ts:16` | Список «открытых» статусов скопирован в 4 местах (в модуле готовности — экспорт `OPEN_MAINTENANCE`, остальные — локальные копии). | Разъехавшись, копии дадут наряды, меняющие балл молча (риск явно назван в `readiness-score.ts:13-15`). | Импортировать `OPEN_MAINTENANCE` из модуля готовности везде. |

## Переходы без теста

Покрытие по прочитанным тестам (`equipment-maintenance.test.ts`, route-тесты maintenance*, `maintenance-helpers.test.ts`; карта по `grep -n "it("`).

| перехода / сценарий | покрытие |
|---|---|
| создание → `PLANNED` (значение по умолчанию) | ПРОЙДЕНО — `equipment-maintenance.test.ts:90-115` |
| создание сразу `IN_PROGRESS` (авто-`startedAt`) | ПРОЙДЕНО — `equipment-maintenance.test.ts:125-129` |
| создание сразу `DONE` / `CANCELLED` (обход правил) | **не покрыто** |
| `PLANNED → IN_PROGRESS` (авто-`startedAt`) | ПРОЙДЕНО — `equipment-maintenance.test.ts:144-148,165-170` |
| `IN_PROGRESS → DONE` (правило `workDone`, `completedAt`, `closedById`) | ПРОЙДЕНО — `equipment-maintenance.test.ts:150-156,179-191` |
| `* → CANCELLED` (требование причины) | ПРОЙДЕНО частично — только из `PLANNED` (`:194-208`); из `IN_PROGRESS`/`ON_HOLD` **не покрыто** |
| `* → ON_HOLD`, `ON_HOLD → IN_PROGRESS` | **не покрыто** |
| `CANCELLED → DONE` (запрет на сервере отсутствует — находка №1) | **не покрыто** |
| `DONE → IN_PROGRESS` / `DONE → CANCELLED` (переоткрытие) | **не покрыто** |
| приёмка `DONE`-наряда, идемпотентность, повтор | ПРОЙДЕНО — `equipment-maintenance.test.ts:231-271,379-396` |
| приёмка `PLANNED`-наряда без `IN_PROGRESS` (находка №15) | **не покрыто** |
| удаление открытого наряда, снимок по возвращённой строке | ПРОЙДЕНО — `equipment-maintenance.test.ts:296-323` |
| удаление принятого наряда (409) | ПРОЙДЕНО — `equipment-maintenance.test.ts:289-294` |
| удаление закрытого наряда и его следствия (находка №4) | **не покрыто** |
| сдвиг регламента и показание счётчика при закрытии | ПРОЙДЕНО — `equipment-maintenance.test.ts:329-413` |
| планировщик: дедуп, advisory-замок, событие только при успехе | ПРОЙДЕНО (по названиям) — `pm-scheduler.test.ts:70-143` |
| правка регламента `PATCH` (аудит отсутствует — находка №5) | **не покрыто** |
| клиентская таблица переходов | ПРОЙДЕНО — `maintenance-helpers.test.ts:32-42` |
| серверная валидация переходов вообще | **не покрыто** (её нет — находка №1) |

## Не проверено

1. **Правку `AGENTS.md` в рабочем дереве** (`git status` на старте: `M AGENTS.md`) я не создавал и не трогал — это состояние воркtree на момент старта; кому и зачем она сделана — не выяснял.
2. **Тесты не запускались** (`npm run test:unit`, `playwright test --list`, `tsc`, `lint`, `build`) — задача read-only, судить о прохождении/пропусках не могу. Числовой состав тестов взят из `grep` (66 файлов с упоминанием maintenance), а не из прогона.
3. Состав `pm-scheduler.test.ts` и `maintenance-plan.test.ts` просмотрен только по строкам `it(...)`; тела проверок построчно не читал — какие именно утверждения там, **НЕ ПРОВЕРЕНО**.
4. Тела тестов `maintenance-messages.test.tsx`, `maintenance-mobile-targets.test.tsx`, `maintenance-labels.test.ts`, а также `equipment-query.service.test.ts` (частично) читал не полностью — покрытие UI-сообщений о переходах **НЕ ПРОВЕРЕНО**.
5. Реальное поведение в браузере (какие кнопки видны при каком статусе) — по коду; e2e-спеки ТО не читал, **НЕ ПРОВЕРЕНО**.
6. Поведение RLS/мультитенантности на живом Postgres — код читал (strict equality, fail-closed), запросы не исполнял → динамика **НЕ ПРОВЕРЕНО**.
7. Настройка `maintenanceOverdue` (где хранится, дефолт) — только по вызову `isNotificationEnabled` (`pm-scheduler.ts:36-37`); реализацию настройки не открывал.
8. Файлы `src/app/(app)/admin/to/**` и `src/components/piling/to/**` (второй контур экранов ТО/готовности) разобраны лишь в объёме влияния на допуск; жизненный цикл наряда там дублируется или нет — **НЕ ПРОВЕРЕНО**.
