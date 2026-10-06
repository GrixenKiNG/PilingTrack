# R71 — Зависшая смена HANDOVER_PENDING: почему v2 не даёт начать новую смену

Read-only разбор дефекта QA **D-20260930-001**: в операторском приложении v2 (`/operator/v2`, `src/app/(app)/operator/v2/page.tsx:1-13` → `src/components/piling/operator-v2/operator-shift-v2.tsx`) две бригады не могут начать новую смену — смена от 27.09 висит в `HANDOVER_PENDING` («сдаётся»), экран держит «После работы».

Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`. Ни один существующий файл не изменён; создан только этот отчёт. База не читалась и не писалась. Замороженные зоны (варианты экрана оператора, ORION) только читались — правок в них нет.

## Итог

- Счёт по важности: **критично — 3, важно — 4, мелочь — 3** (всего 10). Найдена не «ошибка UI», а дыра в жизненном цикле смены: состояние `HANDOVER_PENDING` **не имеет ни одного исполнителя перехода**, если его поставила мобильная команда «Завершить работу».
- Причина в одну фразу: **`HANDOVER_PENDING` пишут двое — контур готовности (через приёмку/возврат передачи) и мобильная команда `finish-work` (напрямую, без записи `ShiftHandover`); автозакрытие это состояние исключено намеренно (`scheduler.ts:64`), а экран v2 при `HANDOVER_PENDING` показывает конечный экран «Смена закрыта» без единой кнопки действия (`shift-flow.ts:187-189`, `operator-shift-v2.tsx:1201-1254`) — смена без передачи запирается насмерть, а новая не открывается из-за 409 по незакрытой вчерашней смене (`equipment.ts:54-60`).**
- Топ-5:
  1. `HANDOVER_PENDING` выведен из автозакрытия (`scheduler.ts:64`, обоснование `:54-63`) — единственный автоматический выход закрыт, и статус держится вечно (#2).
  2. `finishWork` ставит `HANDOVER_PENDING` **без** `ShiftHandover` (`shift-close.ts:23-26`), поэтому ни оператор, ни диспетчер не могут ни принять, ни вернуть, ни закрыть смену через контур (#3).
  3. v2 при `HANDOVER_PENDING` безусловно отдаёт шаг `closed` → экран «Смена успешно завершена», где есть только «На главную» (#1).
  4. Новая смена не открывается: `acceptEquipment` отвечает 409 «По этой установке не закрыта смена за 27.09» (#4).
  5. У диспетчера тоже нет рычага: кнопки «Принять»/«На доработку» выключены, если живой передачи нет, а KPI и панель считают только смены сегодняшних суток (#5).
- Отличие от v1/v10: мобильный экран ведёт по **фазе рабочего места** и на фазе `CLOSING` даёт «Закрыть смену и отправить отчёт» (`operator-mobile-app.tsx:499-516`, `operator-v10-app.tsx:1595-1602`), то есть выход есть; v2 решает по **состоянию смены** и на `HANDOVER_PENDING` выходит из логики раньше (#6).
- Проверено на данных только текстом: какой из двух сценариев (со записью передачи или без) у двух бригад — **не проверено**, даёт `SELECT` в конце.

## Методика

Что открывал и как повторить:

- Поиск писателей состояния: `grep -rn "state: 'HANDOVER_PENDING'" --include="*.ts" --include="*.tsx" src/ | grep -v generated` → ровно два места: `src/modules/operator-mobile/application/commands/shift-close.ts:25` и `src/modules/readiness/infrastructure/shifts/shift-repository.ts:138`.
- Поиск всех упоминаний: `search_files pattern='HANDOVER_PENDING'` и `pattern='HANDOVER|handover'` по репо; затем полное чтение:
  - домен смены: `src/modules/readiness/domain/shifts/{transitions,types,handover}.ts`;
  - команды контура: `src/modules/readiness/application/shifts/commands.ts` (полностью), `infrastructure/shifts/{shift-repository,handover-repository}.ts`;
  - планировщик: `src/modules/readiness/application/scheduler.ts`, `src/workers/unified-worker/readiness-scheduler.ts`, `application/__tests__/scheduler.test.ts`;
  - мобильный контур: `src/modules/operator-mobile/application/commands/{shift-close,equipment,shared}.ts`, `application/mobile-shift-query.ts`, `domain/shift-phases.ts`;
  - экран v2: `src/app/(app)/operator/v2/page.tsx`, `src/components/piling/operator-v2/{operator-shift-v2.tsx,shift-flow.ts,__tests__/*}`;
  - для сравнения: `src/components/piling/operator/shift-phase.ts` (легаси-путь отхода), `src/components/piling/operator-mobile/operator-mobile-app.tsx`, `operator-mobile/v10/operator-v10-app.tsx`;
  - экран диспетчера: `src/components/piling/to/readiness/screens/shifts-screen.tsx`, `api/readiness/shifts/route.ts`, `application/shifts/queries.ts`;
  - запрос фактов оператора: `src/modules/readiness/application/operator-shift-query.ts`.
- Маршруты веб-контура: `find src/app/api/readiness -name route.ts | sort` — маршрута закрытия смены нет; есть `shifts/[id]/{cancel,decline,handover,request-acceptance,start,waiver}` и `handovers/[id]/{route,accept,rework}`.
- Схема (только чтение): `prisma/schema.prisma` (`ShiftState` 1065-1072, `Shift` 1081-1133, `ShiftHandover` 1160-1186, `Report` 1927-1962), `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41` (частичный уникальный индекс).
- Писателя поля `closeExceptionReason` (`prisma/schema.prisma:1104`) искал текстом по `src/` — совпадений нет (только `src/generated/**`), то есть «закрыть смену с оговоркой» в коде не реализовано.
- Экраны вариантов читались, но не менялись: `operator-mobile/v10`, `operator-v5`, `operator-dashboard.tsx` (последний никуда не смонтирован — `grep -rn "OperatorDashboard" src/` даёт только комментарий в `src/app/(app)/operator/page.tsx:15`).
- База не затрагивалась: `SELECT` в конце отчёта приведён текстом и **не выполнялся**.

## Цепочка статусов (с файл:строка)

Кто ставит `HANDOVER_PENDING` (двое, и это разные по смыслу пути):

1. Контур готовности, обычная передача смены: `POST /api/readiness/shifts/:id/handover` (`src/app/api/readiness/shifts/[id]/handover/route.ts:11-16`) → `submitHandoverCommand` (`src/modules/readiness/application/shifts/commands.ts:318-360`): требует права `readiness.handover.prepare`, требует **уже сданный сменный отчёт** (`:330`, `domain/shifts/handover.ts:59-67`), создаёт/переоформляет запись `ShiftHandover` со состоянием `SUBMITTED` (`infrastructure/shifts/handover-repository.ts:19-29`) и только затем переводит смену: `shifts.markHandoverPending` (`commands.ts:351` → `shift-repository.ts:136-141`, условие `state: 'STARTED'`). Доменное правило перехода: `domain/shifts/transitions.ts:12` (`handover: ['STARTED']`), результат — `transitions.ts:71`.
2. Мобильный контур, кнопка «Завершить работу»: `POST /api/operator/mobile/command` c `command: 'finish-work'` (`src/app/api/operator/mobile/command/route.ts:155,239-240`) → `finishWork` (`src/modules/operator-mobile/application/commands/shift-close.ts:16-29`): проверяет бригаду и «открытость» смены и **сразу пишет** `state: 'HANDOVER_PENDING'` (`:25`). Записи `ShiftHandover` здесь нет и не создаётся — состояние используется как «работа кончилась, идёт ЕО после работы». Эту команду шлют экраны `/operator` (`operator-mobile-app.tsx:494`), v7 (`operator-v7-app.tsx:451`), v10 (`operator-v10-app.tsx:1591`), v5 (`operator-v5-app.tsx:1238`). **v2 её не шлёт вовсе** (`grep "command: '"` по `operator-shift-v2.tsx`: `report-incident`, `submit-checklist`, `log-production`, `accept-equipment`, `close-shift`).

Кто обязан перевести смену дальше:

3. Приёмка передачи следующим оператором или диспетчером: `POST /api/readiness/handovers/:id/accept` (`src/app/api/readiness/handovers/[id]/accept/route.ts`) → `decideHandover` (`commands.ts:390-428`, право `readiness.handover.decide`): требует состояние передачи `SUBMITTED` (`:406-410`), затем `handovers.accept` (`handover-repository.ts:56-62`) **и** `shifts.close` (`commands.ts:417-418` → `shift-repository.ts:143-148`, условие `state: 'HANDOVER_PENDING'`) → `CLOSED`. Доменно: `transitions.ts:13` (`accept: ['HANDOVER_PENDING']`), `:72`.
4. Возврат на доработку: `POST /api/readiness/handovers/:id/rework` → тот же `decideHandover`, `shifts.reopen` (`commands.ts:419` → `shift-repository.ts:150-155`) → смена возвращается в `STARTED`. Тоже требует живую запись передачи `SUBMITTED`.
5. Автозакрытие планировщика: `runReadinessScheduler` (`src/modules/readiness/application/scheduler.ts:113`) из воркера `readiness-scheduler.ts` (интервал 1 ч, `:21`; старт `:50-57`), `forEachTenant` (`:30-39`). Выборка незакрытых смен — `scheduler.ts:161-164`: `where: {state: {in: [...UNFINISHED_SHIFT_STATES]}}`, где `UNFINISHED_SHIFT_STATES = ['STARTED'] as const` (`scheduler.ts:64`). Часы: конец смены `DAY 19:00` / `NIGHT 07:00` (`:73`) плюс запас `AUTO_CLOSE_GRACE_HOURS = 5` (`:76`) → с 00:00 следующих суток для дневной, с 12:00 — для ночной (`:92-96`); для смены с пустым типом — с 12:00 (`:83`). Запись результата: `:169-172` (`state: 'CLOSED'`, `autoClosedAt`), событие `:177-193`.
6. Досдача отчёта автозакрытой смены — `scheduler.ts:204-239` (черновики `draft` → `submitted`, событие `ReportSubmitted` с `autoClosed: true`).

Вывод по цепочке: после `HANDOVER_PENDING` существует ровно два перехода — приёмка (в `CLOSED`) и возврат (в `STARTED`) — и **оба требуют живой записи `ShiftHandover`**. Автозакрытие состояние не покрывает.

## Находки

| # | severity | path:line | проблема | сценарий / почему это важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/operator-v2/shift-flow.ts:187-189` | при `facts.shift.state === 'HANDOVER_PENDING'` v2 безусловно возвращает шаг `closed` — до проверок приёмки, передачи и фазы; шаг `closed` рендерится как конечный экран «Смена успешно завершена», в футере только «На главную» (`src/components/piling/operator-v2/operator-shift-v2.tsx:1201-1254`) | оператор со зависшей сдачей видит «Смена закрыта, отчёт отправлен диспетчеру» (подпись «После работы» — `shift-flow.ts:80-83`, `operator-shift-v2.tsx:738-740`) и не имеет ни одной кнопки, которая бы двигала смену: перезагрузка возвращает на тот же экран. Это и есть D-20260930-001 | отдать `HANDOVER_PENDING` в отдельный шаг «Сдача/приёмка» с двумя действиями: «Закрыть смену» (`close-shift`) когда передачи нет, «Принять машину» (accept передачи) когда передача живая; шаг `closed` оставлять только для `phase === 'CLOSED'` и отсутствия смены |
| 2 | критично | `src/modules/readiness/application/scheduler.ts:64` (обоснование `:54-63`, выборка `:161-166`) | автозакрытие покрывает только `STARTED`; `HANDOVER_PENDING` исключён намеренно и в список не входит | нет ни одного автоматического перехода из `HANDOVER_PENDING` → статус «навсегда». Исключение сделано осознанно (раньше автозакрытие ломало приёмку передачи: смена уже `CLOSED`, передача оставалась `SUBMITTED` — «принять невозможно НАВСЕГДА», `scheduler.ts:54-60`), но после появления «сдачу без передачи» (`finish-work`) это исключение стало капканом | добавить в автозакрытие `HANDOVER_PENDING` **только при отсутствии живой передачи** (`ShiftHandover.state in (DRAFT, SUBMITTED, REWORK_REQUIRED)`) — старая авария не вернётся, а зависшая сдача закроется сама; либо отдельная команда «закрыть сдачу без передачи» для диспетчера |
| 3 | критично | `src/modules/operator-mobile/application/commands/shift-close.ts:16-29`, в связке с `src/modules/readiness/application/operator-shift-query.ts:241-253` и `src/components/piling/to/readiness/screens/shifts-screen.tsx:238,243` | `finishWork` ставит `HANDOVER_PENDING` без записи `ShiftHandover`; контур же считает смену сдаваемой только по живой записи `SUBMITTED` | у смены без передачи нет ни субъекта приёмки, ни возврата: `decideHandover` требует `state === 'SUBMITTED'` (`commands.ts:406-410`), у диспетчера кнопки «Принять»/«На доработку» выключены (`shifts-screen.tsx:243`, проверка `shift.handovers.find(state==='SUBMITTED')` — `:238`), а v2 даже не показывает шаг приёмки, потому что `incomingHandover` остаётся `null` (`operator-shift-query.ts:246-250`) | на `finishWork` заводить `ShiftHandover` в состоянии `SUBMITTED` с описанием «работа завершена, ЕО после работы не сдан» — тогда статус остаётся прежним, но у смены появляется принимающий. Дешевле и безопаснее: смену с `HANDOVER_PENDING` и без живой передачи трактовать как «сдаётся без приёмки» и разрешать `close-shift`/автозакрытие |
| 4 | важно | `src/modules/operator-mobile/application/commands/equipment.ts:41-60` (`acceptEquipment`), индекс `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:40-41` | новая смена не открывается, пока по установке есть активная смена (`STARTED`/`HANDOVER_PENDING`) **другой** производственной даты: 409 «По этой установке не закрыта смена за 27.09. Сдайте её, прежде чем открывать новую» | это и есть симптом «не могут начать новую смену». Текст честный, но действий для «сдать» на v2 нет (см. #1), а база дополнительно не даст две активные смены одной машины (частичный уникальный индекс) | ничего не менять в самой проверке: она защищает от двух живых смен одной машины. Требуется вернуть на экран путь «сдать» — см. варианты исправления ниже |
| 5 | важно | `src/components/piling/to/readiness/screens/shifts-screen.tsx:51-56` и `:238,243`; KPI `:183`; запрос `src/modules/readiness/application/shifts/queries.ts:7-11` | панель «Передача смены» и KPI «Ждут приёмки» считают только смены сегодняшних суток (при периоде «День»), а кнопки приёмки требуют живую передачу | вчерашняя зависшая смена в режиме «День» диспетчеру не видна вовсе; в режиме «Неделя» она появится, но «Принять» будет выключено при отсутствии записи передачи. То есть заявка «экран держит» подтверждается и со стороны диспетчера | показывать ожидающие приёмки смены независимо от производственных суток (фильтр по состоянию, не по дате) и добавить в панели явное «сдаётся без передачи» с кнопкой закрытия для диспетчера (`readiness.handover.decide` — `domain/capability-defaults.ts:69`) |
| 6 | важно | v2: `src/components/piling/operator-v2/shift-flow.ts:187-189`; мобильный контур: `src/modules/operator-mobile/domain/shift-phases.ts:105-107,144-158`, `src/modules/operator-mobile/application/mobile-shift-query.ts:356-367,582`, экраны `src/components/piling/operator-mobile/operator-mobile-app.tsx:499-516` и `operator-mobile/v10/operator-v10-app.tsx:1595-1602` | v1 (`/operator` → `OperatorMobileApp`) и v10 дают выход, v2 — нет; разница не в правах, а в правиле показа | мобильный контур выбирает смену по `OR: [state in (STARTED, HANDOVER_PENDING), productionDate = сегодня]` (любая дата, `mobile-shift-query.ts:356-367`), выводит фазу `CLOSING` при `state === 'HANDOVER_PENDING'` (`:582` → `shift-phases.ts:152-153`) и на этой фазе показывает «Закрыть смену и отправить отчёт» (`operator-mobile-app.tsx:499-516`, v10 `:1595-1602`), а `closeShift` из `HANDOVER_PENDING` разрешён (`shared.ts:62-64` запрещает только `CLOSED`/`CANCELLED`). v2 решает по состоянию смены и на `HANDOVER_PENDING` выходит раньше фазы | выровнять v2 по мобильному правилу: состояние `HANDOVER_PENDING` при наличии своей смены — это «Сдача», а не «закрыто». Правка локальная (`shift-flow.ts`), но требует согласования с владельцем — зона заморожена |
| 7 | важно | маршруты `src/app/api/readiness/**` (список: `shifts/[id]/{cancel,decline,handover,request-acceptance,start,waiver}`), `prisma/schema.prisma:1104` (`closeExceptionReason`) | в веб-контуре нет ни одной команды, закрывающей смену из `HANDOVER_PENDING` без передачи; поле «причина закрытия мимо правил» в схеме есть, писателя в коде нет (`grep closeExceptionReason src/` — 0) | единственный доступный способ закрыть вчерашнюю сдачу — телефон оператора (v1/v10) или, при живой передаче, приёмка диспетчером. Для администратора/диспетчера пути нет вообще, хотя схема под него готовилась | добавить маршрут закрытия смены с оговоркой (`POST /api/readiness/shifts/:id/close` с обязательной причиной в `closeExceptionReason`) — это тот же класс, что «разрешение пуска» (`ShiftStartWaiver`, `schema.prisma:1144-1158`) |
| 8 | мелочь | `src/components/piling/operator-v2/shift-flow.ts:80-83` и `:167-169`, `:187-189` | шаг `closed` получает подпись `stepCaption('closed') = 'После работы'` (`:82`), в том числе когда смена фактически не закрыта | именно эту подпись видит QA («экран держит „После работы“»), и она честна только для настоящего `CLOSED`; `phase === 'CLOSED'` (`:167-169`) и `handover_pending` (`:187`) сведены в один шаг | после разделения шагов (#1) подпись станет однозначной; отдельная правка текста без правки логики проблему не снимает |
| 9 | мелочь | `src/components/piling/operator-v2/operator-shift-v2.tsx:960` (`onFinish={() => setFinishing(true)}`) в связке с `src/modules/operator-mobile/application/mobile-shift-query.ts:582` и `shift-phases.ts:152-153` | «Завершить работу» в v2 — признак только в памяти вкладки, команда `finish-work` не отправляется; фаза `CLOSING` на сервере возникает лишь при `HANDOVER_PENDING`, которого v2 сам не создаёт | после перезагрузки между «Работа завершена» и «Закрыть смену» оператор возвращается на шаг «Работа»: экран отчёта теряется (шаги `post-inspection`/`report` доступны только внутри незакрытой вкладки) | отправлять `finish-work` на сервер (как остальные модули) — но это снова создаст `HANDOVER_PENDING`, поэтому допустимо только вместе с исправлением #1/#3 |
| 10 | мелочь | `src/components/piling/operator-v2/__tests__/operator-shift-v2.test.tsx:39-44` против `src/components/piling/operator-v2/operator-shift-v2.tsx:602-630` | комментарий теста утверждает «Передачи (`handover`) экран не шлёт вовсе», тогда как код отправляет `POST /api/readiness/handovers/:id/accept`; тест этого не ловит, потому что в фикстуре `incomingHandover: null` (`:69`) | расхождение текста и кода мешает разбору: при будущей правке легко «починить» несуществующее поведение | либо убрать ветку приёма передачи из v2, либо поправить комментарий и добавить кейс с живой передачей |

Сводка: критично 3 (#1, #2, #3), важно 4 (#4, #5, #6, #7), мелочь 3 (#8, #9, #10).

## Причина в одну фразу

У состояния `HANDOVER_PENDING` два несовместимых источника — передача смены через контур готовности (с записью `ShiftHandover`) и мобильная команда `finish-work` (без записи); выход из состояния есть только по живой записи передачи, автозакрытие это состояние исключает, а экран v2 показывает `HANDOVER_PENDING` как «Смена закрыта», поэтому смена без передачи не закрывается никогда, а следующая не открывается из-за 409 по незакрытой смене прошлых суток.

## Варианты исправления (кода не касался)

1. **Разделить «сдаётся» и «закрыто» на экране v2** (минимум правок, только `shift-flow.ts` и футер шага).
   Что делать: шаг `closed` оставить за `phase === 'CLOSED'` и отсутствием смены; для `facts.shift.state === 'HANDOVER_PENDING'` вернуть шаг сдачи с кнопкой «Закрыть смену и отправить отчёт» (`close-shift` — он работает из `HANDOVER_PENDING`, `shared.ts:62-64`) и, если `incomingHandover` живая, кнопкой приёма передачи (ветка уже написана, `operator-shift-v2.tsx:602-630`).
   Риски: правится замороженная зона (`src/components/piling/operator-v2/**`) — нужна команда владельца; `close-shift` требует завершённый `EO_AFTER` (`shift-close.ts:58-69`), то есть при незакрытом послесменном осмотре кнопка ответит 409 — значит шаг сдачи должен вести на послесменный осмотр, а не сразу закрывать; «На главную» перестанет вести домой для незакрытой смены.

2. **Закрывать через автозакрытие только смены без живой передачи** (`scheduler.ts`: список состояний + условие отсутствия живой передачи, одна выборка `ShiftHandover`).
   Что делать: считать «брошенной» смену, которая в `STARTED` (как сейчас) **или** в `HANDOVER_PENDING` без живой передачи (`DRAFT/SUBMITTED/REWORK_REQUIRED`) дольше конца смены плюс 5 часов.
   Риски: правка планировщика — там же истечение нарядов и суточный пересчёт, цена ошибки выше; старая авария «передача осталась `SUBMITTED` на закрытой смене» (`scheduler.ts:54-60`) вернётся, если условие «нет живой передачи» будет сформулировано нестрого; зависшая смена закроется без отчёта и без осмотра — нужен `autoClosedAt` в разборе (уже есть, `schema.prisma:1109`).

3. **Дать диспетчеру закрытие смены с оговоркой** (`POST /api/readiness/shifts/:id/close` + причина в `closeExceptionReason`, `schema.prisma:1104`; в UI — кнопка в панели «Передача смены», `shifts-screen.tsx:231-249`).
   Что делать: отдельная команда с правом `readiness.handover.decide` (`capability-defaults.ts:69`), перевод `HANDOVER_PENDING → CLOSED` с обязательной причиной и записью в аудит; заодно показать ожидающие смены независимо от суток (#5).
   Риски: новая команда — новый маршрут, схема и аудит (задача сама этого не просила); `closeExceptionReason` до сих пор нигде не пишется, то есть контракт поля придётся определить; без ограничения прав диспетчер получит способ закрывать любые смены молча — причина обязательна, как у `cancelReason`/`ShiftStartWaiver`.

Что рекомендую: **1 + 2 вместе** (немедленно возвращает людям работу и не требует новых сущностей), вариант 3 — следующим шагом, чтобы у смены без оператора и без телефона тоже был выход.

## SELECT: все зависшие смены (только чтение, НЕ выполнялся)

```sql
-- Смены, застрявшие в HANDOVER_PENDING: с признаком, есть ли живая передача
-- (submitted_handovers > 0) или сдача без передачи (submitted_handovers = 0).
SELECT
  s."tenantId"                                   AS tenant_id,
  s."id"                                          AS shift_id,
  s."equipmentId"                                 AS equipment_id,
  e."name"                                        AS equipment_name,
  s."type"                                        AS shift_type,
  s."state"                                       AS shift_state,
  s."productionDate"                              AS production_date,
  s."startedAt"                                   AS started_at,
  s."updatedAt"                                   AS updated_at,
  s."autoClosedAt"                                AS auto_closed_at,
  (SELECT count(*) FROM "ShiftHandover" h
     WHERE h."tenantId" = s."tenantId"
       AND h."shiftId"  = s."id"
       AND h."state" = 'SUBMITTED')               AS submitted_handovers,
  (SELECT count(*) FROM "ShiftHandover" h
     WHERE h."tenantId" = s."tenantId"
       AND h."shiftId"  = s."id")                 AS handovers_total,
  (SELECT count(*) FROM "Report" r
     WHERE r."shiftId" = s."id"
       AND r."status" = 'submitted')              AS submitted_reports
FROM "Shift" s
JOIN "Equipment" e
  ON e."tenantId" = s."tenantId"
 AND e."id" = s."equipmentId"
WHERE s."state" = 'HANDOVER_PENDING'
ORDER BY s."productionDate" ASC, s."updatedAt" ASC;
```

Контрольный вариант — то же, но по одной установке или с сутками:

```sql
... WHERE s."state" = 'HANDOVER_PENDING' AND s."productionDate" >= DATE '2026-09-20';
```

Пояснения к колонкам (проверено по схеме): таблица `"Shift"` и колонки в кавычках — `prisma/migrations/20260730105000_readiness_shifts_handovers/migration.sql:4-25`; `ShiftHandover` — `:49-69`; `Report.shiftId` и `Report.status` — `prisma/schema.prisma:1939,1950` (значение сданного отчёта `'submitted'` — `src/modules/operator-mobile/application/commands/shift-close.ts:175`); `Equipment.name` — `prisma/schema.prisma:440-442`. Запросы без записи; для запуска читать только (например, `psql` с `DATABASE_URL` из окружения, без секрета в аргументах, либо read-only учёткой) — сам я их не выполнял (см. «Не проверено»).

Толкование результата:
- `submitted_handovers > 0` — обычный сценарий контура готовности: диспетчер может принять смену в режиме «Неделя» (`shifts-screen.tsx:238-243`), смена закрывается сразу;
- `submitted_handovers = 0` и `handovers_total = 0` — сценарий `finish-work`: выхода через UI нет ни у оператора на v2, ни у диспетчера — это и есть класс дефекта (#3);
- `handovers_total > 0` при `submitted_handovers = 0` — передача возвращена на доработку (`REWORK_REQUIRED`), оператор может передать заново (`commands.ts:343-350`).

## Не проверено

- **На данных ничего не проверено.** Все выводы получены чтением кода; на какой из двух сценариев (#3 без передачи или обычная передача) приходятся смены двух бригад от 27.09 — не проверено, потому что задача запрещает трогать базу. Ответит `SELECT` выше: `submitted_handovers = 0` подтвердит сценарий `finish-work`.
- Не проверял, каким именно экраном пользовались бригады 27.09 (журнала доступа и `AuditLog` не читал — это база). Косвенно: `finish-work` шлют `/operator`, v7, v10, v5; v2 его не шлёт.
- Не запускал ни одного теста, сборки, tsc и линта — задача read-only и не просит прогонов; утверждения о поведении кода опираются на прочитанные строки.
- Не смотрел историю изменений (`git log -L`) по `shift-flow.ts` и `scheduler.ts`: когда именно `HANDOVER_PENDING` перестал автозакрываться (в коде это решение владельца с датой 27.08.2026 в `domain/shifts/handover.ts:26-46`, но коммит не искал).
- Замороженные варианты (`operator-v3`, `operator-v5`, v7, `src/app/operator/**`) прочитаны фрагментарно — только там, где нужно было сравнить путь выхода из `HANDOVER_PENDING`; их собственные дефекты не искал.
- Число строк в файлах и точные границы диффов не считал (файлы не менялись).
