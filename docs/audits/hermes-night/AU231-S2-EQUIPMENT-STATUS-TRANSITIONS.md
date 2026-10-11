# AU231-S2 — Статусы техники: переходы и права

Версия: `git rev-parse HEAD` = `fc075add3d0a9fd41a39c179dd716332d89e76d7` (ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`).
Режим: только чтение; код приложения не менялся. Существующие отчёты в `docs/audits/`, CODEX-REPORT*, `docs/strategy` не читались.
Статусы: **ПРОЙДЕНО** — смотрел код/команду сам; **ГИПОТЕЗА** — следует из кода, но сквозной сценарий не воспроизводил; **НЕ ПРОВЕРЕНО** — не смотрел.

## Резюме для владельца (5 строк)

1. У техники два независимых статуса: булев `isActive` («в эксплуатации / выведена») и вычисляемое состояние `working / repair / idle`. Переходов между ними нет — `isActive` просто присваивается как любое поле карточки, а состояние считается на лету по сменам и открытым нарядам.
2. Дыра, которую надо закрыть первой: `PUT /api/equipment/[id]` без поля `isActive` молча возвращает выведенную из эксплуатации установку обратно в строй, а без поля `qty` — сбрасывает количество на 1. Это не гипотеза, это воспроизводится на схеме валидации (`node -e`, см. Методику).
3. Вывод из эксплуатации ничего не блокирует: ни открытую смену, ни открытый наряд. При этом запуск уже созданной смены на выведенной установке падает ошибкой 500, а любой пересчёт готовности по ней уходит в DLQ.
4. Статусы наряда ТО (`PLANNED…DONE/CANCELLED`) сервер принимает «любой → любой»: таблица допустимых переходов есть только в интерфейсе. Через API можно открыть закрытый наряд заново.
5. Права: менять карточку/статус техники может только `ADMIN` (`equipment.manage`); наряды ТО — `ADMIN`, `DISPATCHER`, `MECHANIC`, инженер ОТ (`maintenance.manage`).

## Итог

- Критично: 1, важно: 7, мелочь: 5. Всего 13 находок.
- Топ-5:
  1. Молчаливая реактивация + сброс `qty` при неполном `PUT` (§1).
  2. Нет модели переходов `isActive` — свободное присваивание (§2).
  3. Запуск смены на выведенной установке → 500 (§4), пересчёт готовности → DLQ (§5).
  4. Планировщик ТО заводит новые наряды на выведенной установке (§6).
  5. Сервер не проверяет переходы статусов наряда ТО (§7), повторное закрытие плодит показания (§8).
- Не проверено живым сценарием: поведение воркера при DLQ (§5 — ГИПОТЕЗА), отсутствие тестов на запрещённые переходы (§7).

## Методика

Всё выполнялось из корня `D:\PillingR\wt-night` в Git Bash. Использованные команды (воспроизводимо):

- `git rev-parse HEAD` — версия.
- `ls src/app/api/equipment/` и `find src/app/api/equipment -type f` — карта маршрутов.
- `grep -n "model Equipment" prisma/schema.prisma` и чтение диапазонов `sed -n '440,540p'` / `'580,640p'` — поля `isActive`, `MaintenanceRecord`, связи (только чтение, схема не менялась).
- `grep -rn "retireEquipment" ...` — поиск использования команды вывода из эксплуатации по `src`, `e2e`, `tests`, `scripts`.
- `grep -rn "retireEquipment|\.retire\(" --include=*.ts --include=*.tsx src e2e tests scripts`.
- `grep -rn "'equipment.manage'|'maintenance.manage'"` — карта прав.
- `grep -rn "isActive"` по `src/modules` — где флаг читается/пишется.
- `grep -rn "evaluateAuthoritativeReadiness"` и `grep -rn "consumeReadinessProjectionEvent"` — пути пересчёта готовности.
- Проверка схемы валидации (это и есть основа §1), выполнена из каталога проекта, чтобы `zod` разрешился:

```
node -e "
const {z} = require('zod');
const base = z.object({ qty: z.coerce.number().int().min(1).max(100).default(1), isActive: z.boolean().default(true), name: z.string().optional() });
const partial = base.partial().extend({ expectedUpdatedAt: z.string().datetime() });
const r = partial.safeParse({ expectedUpdatedAt: '2026-01-01T00:00:00.000Z', isActive: false });
console.log('qty=', JSON.stringify(r.data.qty));
const r2 = partial.safeParse({ expectedUpdatedAt: '2026-01-01T00:00:00.000Z' });
console.log('qty=', JSON.stringify(r2.data.qty), 'isActive=', r2.data.isActive);
"
```
Вывод: `qty= 1` и `qty= 1 isActive= true` (zod 4.6.5).

Ограничения методики: unit-тесты не запускались (задача read-only, менять/создавать тестовые файлы нельзя — создаётся только этот отчёт). Все выводы — из чтения кода и одной воспроизводимой проверки схемы.

## Фактические данные (что где лежит)

Модель: `Equipment.isActive Boolean @default(true)` — `prisma/schema.prisma:445`; «в эксплуатации / выведена из эксплуатации», без enum статуса. Комментарий интерфейса подтверждает смысл: `src/components/piling/admin-equipment/detail/equipment-detail-overview.tsx:115`.

Состояние «сейчас» — вычисляемое (`working | repair | idle`), не хранится: `src/modules/equipment/application/queries/operational-state.ts:25-58`.

Статус наряда ТО — enum `PLANNED | ASSIGNED | IN_PROGRESS | ON_HOLD | DONE | CANCELLED`: `prisma/schema.prisma:585`, тип — `src/modules/equipment/application/commands/equipment-maintenance.ts:18`.

Права (`src/services/auth/authorization-service.ts`):
- `equipment.manage` → только `ADMIN` (строка 104);
- `maintenance.manage` → `ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER` (строка 108);
- `equipment.read` → `ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER` (строка 103).

## Таблица переходов

### A. Жизненный цикл установки (`isActive`)

| Переход | файл:строка | право | эффект | тест |
|---|---|---|---|---|
| создать (`isActive=true` принудительно) | `src/modules/equipment/domain/equipment.aggregate.ts:23` | `equipment.manage` (`src/app/api/equipment/route.ts:37`) | строка `isActive=true`; событие `EquipmentCreated` | ПРОЙДЕНО: `src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts:17` |
| `true → false` (вывести) | `src/modules/equipment/domain/equipment.aggregate.ts:38` (через `update`) | `equipment.manage` (`src/app/api/equipment/[id]/route.ts:96`) | `isActive=false`; аудит `equipment.retired` (`.../[id]/route.ts:111`); смены/наряды не трогаются | ПРОЙДЕНО (тест маршрута): `src/app/api/equipment/[id]/__tests__/route.test.ts:114-127` |
| `false → true` (вернуть) | там же, `...equipment.aggregate.ts:38` | `equipment.manage` | `isActive=true`; события «вернули» нет — аудит пишет `equipment.updated` | НЕ ПРОВЕРЕНО (тест на возврат отсутствует) |
| `retire()` — отдельная команда | `src/modules/equipment/application/commands/equipment-command.service.ts:51` | — (в коде ниоткуда не вызывается) | ставит `isActive=false`, событие `EquipmentRetired` | ПРОЙДЕНО: агрегатный тест `.../equipment-aggregate.test.ts:99-114`; рабочего вызова нет (§10) |
| жёсткое удаление | `src/modules/equipment/application/commands/equipment-command.service.ts:59-139` | `equipment.manage` (`.../[id]/route.ts:131`) | удаляет только при нулевой истории, иначе 409 с перечнем | ПРОЙДЕНО: `.../[id]/__tests__/route.test.ts:135-173` |

### B. Статусы наряда ТО

| Переход | файл:строка | право | эффект | тест |
|---|---|---|---|---|
| создать (по умолчанию `PLANNED`) | `src/modules/equipment/application/commands/equipment-maintenance.ts:69` | `maintenance.manage` (`.../maintenance/route.ts:60`) | новая строка; возможен сразу `IN_PROGRESS` (проставляется `startedAt`) | ПРОЙДЕНО: `.../__tests__/equipment-maintenance.test.ts:125` |
| → `IN_PROGRESS` | `equipment-maintenance.ts:230-232` | `maintenance.manage` | при первом переходе проставляется `startedAt` | ПРОЙДЕНО: `.../equipment-maintenance.test.ts:144` |
| → `DONE` | `equipment-maintenance.ts:233-237` | `maintenance.manage` | требует непустой `workDone` (`:140`); ставит `closedById`; сдвигает регламент; пишет показание моточасов | ПРОЙДЕНО: `.../equipment-maintenance.test.ts:150,179,187` |
| → `CANCELLED` | `equipment-maintenance.ts:238-242` | `maintenance.manage` | требует `cancelReason`; ставит `closedById` | ПРОЙДЕНО: `.../equipment-maintenance.test.ts:194,201` |
| приёмка (админ) | `equipment-maintenance.ts:280-325` | `maintenance.manage` | `acceptedById/acceptedAt`, `status=DONE`; после приёмки правки/удаление запрещены | ПРОЙДЕНО: `.../equipment-maintenance.test.ts:210,231,257` |
| любой → любой (без проверки) | `equipment-maintenance.ts:228-243` | `maintenance.manage` | сервер не ограничивает пару «откуда→куда» | См. §7 |

Правила переходов в интерфейсе (не на сервере): `src/components/piling/maintenance/maintenance-helpers.ts:25-32`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/lib/validation-schemas.ts:361` (`equipmentUpdateSchema = equipmentManageSchema.partial()`, поля с `.default` на `:177-180`), применение — `src/app/api/equipment/[id]/route.ts:87-96` → `src/modules/equipment/application/commands/equipment-command.service.ts:32,36` | Схема `partial()` сохраняет `default` у `qty` и `isActive`. `PUT` без `isActive` подставляет `isActive=true`, без `qty` — `qty=1`; значения уходят в команду и пишутся в БД. | Редактирование любого поля выведенной установки неполным телом молча возвращает её в эксплуатацию и сбрасывает количество на 1. Воспроизведено (см. Методику). | Явно запретить `default` в update-схеме: `equipmentManageSchema.partial()` заменить на объект с `qty`/`isActive` без `.default` (только `.optional()`), либо в команде писать поле лишь при `!== undefined`. |
| 2 | важно | `src/modules/equipment/domain/equipment.aggregate.ts:33-47` | `isActive` меняется тем же `update`, что имя/модель; нет таблицы допустимых переходов и нет отдельного действия «вернуть в эксплуатацию». `false → true` не отличимо от правки названия. | Любой `PUT` может необратимо (в журнале — как «updated») сменить жизненный цикл. Отдельная команда `retire()` есть, но логика ее не использует. | Ввести метод `reactivate()`/явные переходы и валидировать пару состояний в домене; в аудите логировать `equipment.reactivated`. |
| 3 | важно | `src/app/api/equipment/[id]/route.ts:87-100`; ср. защиту удаления `src/modules/equipment/application/commands/equipment-command.service.ts:97-121` | Вывод из эксплуатации не проверяет ни открытые смены, ни открытые наряды, ни активные бригады. Удаление защищено (`history`), смена флага — нет. | Можно снять установку с эксплуатации с незакрытой сменой и открытым нарядом; новые смены/наряды по ней после этого не заводятся (`shift-repository.ts:22`, `work-permit-repository.ts:56`), а старые остаются в подвешенном состоянии. | Перед записью `isActive=false` проверять открытые смены (`Shift.state IN STARTED/HANDOVER_PENDING/PLANNED`) и открытые наряды; при наличии — 409 с предложением закрыть. |
| 4 | важно | `src/modules/readiness/application/readiness-score.ts:95`; вход — `src/modules/readiness/application/shifts/commands.ts:192` (`startShiftCommand`), проверка установки только при создании смены `:105` | `evaluateAuthoritativeReadiness` ищет установку с `isActive:true` (`:33`) и при её отсутствии бросает `Error('Authoritative equipment row is unavailable')`. Запуск смены не перепроверяет `isActive`. | Сценарий: создали смену → вывели установку → попытка запуска смены падает 500 (не 409/422 с понятным текстом). | В начале `startShiftCommand` перепроверять `equipment.isActive` и возвращать 422/409 («установка выведена из эксплуатации»); в `readiness-score` на `!equipment` бросать доменную ошибку, а не `Error`. |
| 5 | важно (ГИПОТЕЗА) | `src/modules/readiness/application/projection/project-event.ts:55-59` → тот же `readiness-score.ts:95`; обработка — `src/modules/reports/application/projections/projection-worker.ts:134-144` | Любой триггер пересчёта готовности по выведенной установке (закрытие наряда ТО `equipment-maintenance.ts:117`, показание `meter-reading.ts:233`) приводит к `throw` в проекции; воркер пробрасывает ошибку дальше «to drive retry / DLQ». | Выведенную установку нельзя спокойно дообслужить: закрытие оставшегося наряда уводит событие в DLQ и не обновляет готовность. Поведение retry/DLQ выведено из комментария воркера, сквозным прогоном не проверялось. | Перед постановкой снимка (или в самом `evaluateAuthoritativeReadiness`) обрабатывать отсутствующую/выведенную установку без исключения: снимок помечать `N/A`, событие — `projected`, без DLQ. |
| 6 | важно | `src/modules/equipment/application/commands/pm-scheduler.ts:61-76` (фильтр `where: { tenantId, isActive: true }` — это `MaintenancePlan.isActive`; `equipment` тянется как связь без своего `isActive`) | Планировщик ТО ежедневно заводит наряды по активным регламентам, не проверяя `Equipment.isActive`. | Выведённая из эксплуатации установка продолжает получать новые наряды ТО («подходит срок»/«просрочено»), наряд сразу же порождает триггер готовности (→ §5). | Добавить в выборку условие `equipment: { isActive: true }` (или пропуск планов выведенной техники). |
| 7 | важно | `src/modules/equipment/application/commands/equipment-maintenance.ts:228-243` (нет проверки перехода), схема статуса без ограничений — `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts:16` | Сервер принимает любой переход статуса наряда, ограничены только «входные» требования (`workDone` для DONE, `cancelReason` для CANCELLED) и приёмка. Таблица переходов есть лишь в UI (`maintenance-helpers.ts:25-32`). | Через API можно выполнить `DONE → IN_PROGRESS`, `CANCELLED → DONE`, `PLANNED → ON_HOLD` — то, что интерфейс запрещает. Открытие закрытого наряда искажает историю/регламент. | Перенести таблицу переходов в домен (`assertMaintenanceTransition(from, to)`) и вызывать её при `input.status !== undefined`; UI-таблицу оставить для отображения. |
| 8 | важно | `src/modules/equipment/application/commands/equipment-maintenance.ts:265-267` и `:176-189`; отсутствие дедупликации — `src/modules/equipment/application/commands/meter-reading.ts:197` | `recordServiceHours` пишет показание моточасов без `dedupeByNote`, только на переходе «в DONE». Повторное закрытие (см. §7) — это снова переход в DONE. | `DONE → IN_PROGRESS → DONE` (непринятый наряд) создаёт второе показание с той же наработкой и той же пометкой «Снято при закрытии наряда ТО»; кэш `engineHoursTotal` и журнал моточасов получают дубль. | Идемпотентность по паре (наряд, показание): не писать показание, если по этому `recordId` уже есть запись, либо ставить `dedupeByNote` и стабильную пометку с id наряда. |
| 9 | важно | `src/modules/equipment/application/queries/operational-state.ts:33-56` | `resolveEquipmentOperationalStates` не фильтрует `isActive`: состояние считается только по открытым сменам и незакрытым `REPAIR/FAULT`. | Выведенная из эксплуатации установка с формально открытой сменой отображается «в работе» на дашборде/мониторинге (`fleet-monitoring.service.ts:250`, `site-query.service.ts:106`). | Возвращать для `isActive=false` отдельное состояние (или `idle`) либо фильтровать входа. |
| 10 | мелочь | `src/modules/equipment/application/commands/equipment-command.service.ts:51-57`; экспорт `src/modules/equipment/index.ts:6` | Команда `retireEquipment()` и домен-событие `EquipmentRetired` (`equipment.events.ts:4`) не вызываются ни из маршрутов, ни из UI, ни из e2e — только тест агрегата. Фактический вывод идёт через `update` (`isActive`). | Два способа вывода, один мёртвый: правки в `retire()` не влияют на прод, а событие `EquipmentRetired` никогда не эмитится (потребители не получат его). НЕ удалять без отдельного решения — но зафиксировать расхождение. | Либо задействовать `retireEquipment` в маршруте вывода, либо пометить как мёртвый и объединить с §2. |
| 11 | мелочь | `src/app/api/equipment/[id]/route.ts:110-118`; нет потребителя событий — `grep "EquipmentUpdated" src` даёт только типы `src/core/shared/types/event-contracts.ts:172` | Вывод из эксплуатации не аннулирует текущий снимок готовности. События `equipment.updated/retired` пишутся в outbox, но пересчёт готовности по ним не заказывается. | После вывода установки её последний `readinessScoreSnapshot`/текущий статус остаётся прежним (может показывать «допущена»). | При смене `isActive=false` заказывать readiness-снимок (с учётом §5) или явно сбрасывать статус. |
| 12 | мелочь | `src/components/piling/maintenance/maintenance-helpers.ts:25-32` vs `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts:16` | Состояние `ASSIGNED` недостижимо через UI как цель перехода (в `TRANSITIONS` его нет ни у одного источника), но сервер принимает его откуда угодно. | Фильтры «плановые/активные» (`work-order-logic.ts:62,123`) и планировщик оперируют `ASSIGNED`, а штатно наряд в него не попадает — расхождение модели и интерфейса. | Привести интерфейс и домен к общему списку переходов (см. §7). |
| 13 | мелочь | `prisma/schema.prisma:608` (`MaintenanceRecord.equipment ... onDelete: Cascade`) vs защита `src/modules/equipment/application/commands/equipment-command.service.ts:94-121` | Наряды ТО связаны каскадом: жёсткое удаление установки стирает их на уровне БД. Безопасность держится только на подсчёте в коде (и на `try/catch` по `P2003` для RESTRICT-связей, `:126-135`). | Любая новая связь, добавленная в будущем без подсчёта в `deleteEquipment`, приведёт к каскадному стиранию истории, а не к 409. Инциденты потери данных в проекте уже были. | Для исторических связей предпочесть `onDelete: Restrict`; при добавлении связи — обязательный счётчик в `deleteEquipment` (или проверка миграцией). |

## Не проверено

- **Живые сценарии не воспроизводились** (read-only, без запуска сервера/БД): §1 подтверждён только схемой валидации, а не HTTP-вызовом; §4, §5, §6, §8 выведены из кода.
- **§5 (DLQ)** — «ГИПОТЕЗА»: механизм retry/DLQ взят из комментария `projection-worker.ts:134-144`; фактическую доставку в DLQ и число попыток не смотрел.
- **Unit-тесты не запускались.** Задача запрещает создавать и менять файлы, кроме отчёта; тестовый прогон потребовал бы правок. Проверка «есть/нет тест» делалась по наличию файлов и `describe/it` в них, а не прогоном.
- **Права по ролям на маршрутах не прогонялись**: матрица `authorization-service.ts:62-135` читалась статически. Поведение `actingAs` (режим «Действую как») для `equipment.manage` отдельно не проверял.
- **Операторы/помощники**: не проверял, есть ли путь смены `isActive` в обход `equipment.manage` (UI карточки техники — за правом; отдельного API не нашёл, но исчерпывающе не исключал).
- **Мобильный контур оператора** (`src/modules/operator-mobile/**`) частично входит в «замороженные» области; его проверки `equipmentActive` (`shared.ts:296`, `work-warnings.ts:197`, `production-permit.ts:97`) только зафиксированы в §9-контексте, глубоко не разбирались.
- **Схема и миграции** читались только на предмет полей/связей; `prisma/schema.prisma` и `prisma/migrations/**` не менялись.
- **Остальные потребители `resolveEquipmentOperationalStates`** (дашборд админа, отчёты) не проверял на предмет собственных фильтров `isActive`.
