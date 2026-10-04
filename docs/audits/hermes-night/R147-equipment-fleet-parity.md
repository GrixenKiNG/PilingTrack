# R147. Одна установка на трёх экранах: карточка admin-equipment, панель парка (мониторинг), готовность

READ-ONLY. Создан только этот файл. Код, схема, `.env*`, тесты не изменялись, сервер не поднимался,
БД не читалась. Рабочая копия `D:\PillingR\wt-night`, ветка `hermes/q4-0926`,
HEAD `f816fc87b1dc16e612d5fba94e9478b3ce674c47` (`git status --porcelain` — пусто). Замороженные зоны
(варианты экрана оператора, ORION, `src/modules/operator-mobile/**`) не читались.

Область: для одного `equipmentId` — что показывают и откуда берут наработку, дату/порог ТО,
закреплённую бригаду/объект, статус и отсутствие телеметрии три контура:
карточка установки (`/admin/equipment`, `/admin/equipment/[id]` — `admin-equipment/**`,
`GET /api/equipment/[id]/details`), панель парка (`/monitoring`, `/admin/equipment` слева,
плитка `monitoring/equipment-tile-block.tsx`, `GET /api/monitoring/fleet`) и контур техготовности
(`/admin/to` — `to/readiness/**`, снимок `modules/readiness/**`).

## Итог

- Находок **13**: **критично — 0**, **важно — 4**, **мелочь — 9**. Потери данных нет; расхождения — в
  источниках одного и того же факта и в смешении денормализованного снимка (`Equipment`) с его живым
  первоисточником.
- Общий источник у панели парка и контура готовности — ОДИН: `GET /api/monitoring/fleet`
  (`use-fleet.ts:20`; `to-module.tsx:435-438`). Карточка установки — второй запрос
  (`/api/equipment/[id]/details`). Наработка, порог ТО и бригада на всех трёх экранах читаются из
  одних и тех же колонок `Equipment` — но у этих колонок по два писателя и один из них (наработка)
  пишется ещё и в обход своего журнала-первоисточника.
- Топ-5:
  1. **важно** — очистка поля «Наработка моточасов» в карточке пишет `NULL` прямо в кэш
     `Equipment.engineHoursTotal` **мимо журнала** `MeterReading` (`equipment-metadata.ts:92-96`):
     карточка и готовность показывают «нет показаний», а журнал показаний продолжает хранить
     значения. Первоисточник наработки — журнал (`meter-reading.ts:4-7`), но кэш от него
     расходится.
  2. **важно** — срок ТО на карточке/готовности — это денормализованный снимок
     `Equipment.nextMaintenanceDate/AtHours` с **двумя несогласованными писателями** (ручная правка
     формы и проекция регламента при закрытии наряда, `maintenance-regulation.ts:97-117`), тогда как
     панель планов считает срок **живьём** (`maintenance-plans/route.ts:42-45`). Правка интервала или
     деактивация регламента карточку не обновляет; проекция пустое значение никогда не обнуляет.
  3. **важно** — плитка парка «Ближайшее ТО» показывает только остаток моточасов и **игнорирует
     `nextMaintenanceDate`**; при регламенте только по дате — «—» рядом с «ТО просрочено»
     (`equipment-tile-block.tsx:172-175,190-191,198-206`). Повтор R144 №9 (не закрыт).
  4. **важно** — «Статус» машины назван тремя разными понятиями; карточка показывает только
     жизненный цикл и **не показывает рабочее состояние** (`equipment-detail-overview.tsx:117,155`),
     а плитка парка мешает легаси-статус отчёта, флаг ТО и «в ремонте» (`equipment-tile.tsx:34-53`).
     Повтор R138 №3 / R101 №6.
  5. **мелочь** — отсутствие телеметрии показано **только** в карточке; на `/monitoring` и в
     готовности признака нет вовсе, а во вкладке телеметрии карточка советует «подключите бокс» даже
     когда устройство зарегистрировано (`equipment-monitoring.tsx:238-242`). Повтор R138 №10.

## Методика

Воспроизводимо чтением кода; Python нет, использованы `read_file`/`search_files`/`terminal`/`git`.

1. `AGENTS.md` прочитан (модель доверия, заморозка, «выглядит мёртвым, но живёт» — телеметрию и
   мультитенантность не считал мёртвыми). Рабочая копия `hermes/q4-0926`, ветка не менялась.
2. Карточка: `modules/equipment/application/queries/equipment-query.service.ts`
   (`getEquipmentDetails`), `app/api/equipment/[id]/details/route.ts`, `app/api/equipment/[id]/meter-readings/route.ts`,
   `modules/equipment/application/commands/{equipment-metadata.ts,meter-reading.ts,maintenance-regulation.ts}`,
   компоненты `admin-equipment/detail/{equipment-detail,equipment-detail-overview,equipment-detail-parts,equipment-monitoring}.tsx`,
   `admin-equipment/{equipment-tile,equipment-table,equipment-status,equipment-maintenance-flag,fleet-types,use-fleet}.tsx`.
3. Панель парка: `modules/monitoring/application/queries/fleet-monitoring.service.ts`,
   `app/api/monitoring/fleet/route.ts`, `components/piling/monitoring/equipment-tile-block.tsx`.
4. Готовность: `modules/equipment/application/queries/operational-state.ts`,
   `modules/readiness/{application/readiness-score.ts,application/readiness-facts.ts}`,
   `components/piling/to/{to-module.tsx,readiness-model.ts,to-stats.ts,to-module-bits.tsx}`,
   `components/piling/to/readiness/{authoritative-presentation.ts,screens/fleet-workspace-model.ts,screens/fleet-evidence-panel.tsx,screens/fleet-screen.tsx,screens/readiness-centre.tsx}`.
5. Общие помощники и словари: `lib/maintenance-due.ts`, `lib/pm-due.ts`, `to/meter-readings-panel.tsx`,
   `prisma/schema.prisma` (`model Crew`:1862-1865), `modules/crews/application/commands/crew-command.service.ts`.
6. Сверка прошлых отчётов и коммитов: прочитаны `R118-fleet-dashboard.md`, `R119-admin-equipment-card.md`,
   `R138-equipment-card-content.md`, `R139-analytics-meaning.md`, `R141-readiness-board.md`,
   `R143-readiness-preview-parity.md`, `R144-maintenance-date-consistency.md`; `git log` и `git show` по
   `8a1ae460` (F-R138-TOP), `b8add1a9` (F-R138-NEXT), `b10b3187` (F-R139-NEXT), `4b4af9bc`
   (F-R141-ENGINE-UNIT), `8080f369` (F-R141-TOP). Закрытое не переоткрываю.
7. GitNexus `impact` не запускал: символов не менял, кода не правил. Проверки §6 выполнены (см.
   «Не проверено»).
8. Динамика не воспроизводилась: сервер не поднимался, браузер/Playwright в сессии недоступны.

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что предложить |
|---|----------|-----------|----------|------------------------|----------------|
| 1 | важно | `src/modules/equipment/application/commands/equipment-metadata.ts:92-96` против `src/modules/equipment/application/commands/meter-reading.ts:4-11,100-131`; отображение — `admin-equipment/detail/equipment-detail-overview.tsx:156`, `to/readiness/fleet-evidence-panel.tsx:136,177` | Наработка на всех трёх экранах — это кэш `Equipment.engineHoursTotal`; первоисточник — журнал `MeterReading` (`meter-reading.ts:4-7`). Правка числа в карточке заводит показание (`:95-111`), но **очистка** поля (`typeof hours !== 'number'`) пишет `null` в `Equipment` **напрямую, мимо журнала** (`equipment-metadata.ts:92-96`) | Админ стирает «Наработка моточасов» («неизвестно»): карточка показывает «—», готовность — «Показания отсутствуют» (fail, `authoritative-presentation.ts:233-235`), а журнал показаний (`meter-readings-panel.tsx:203-217`) тут же под карточкой продолжает показывать значения. Один факт — два противоположных ответа на одном экране | Обнуление наработки тоже проводить через журнал (запись «счётчик заменён») либо явно писать «журнал не пуст, кэш обнулён» и не считать `meterKnown=false`, пока в журнале есть показания |
| 2 | важно | `src/modules/equipment/application/commands/maintenance-regulation.ts:97-117` и `equipment-metadata.ts:56-57` против `src/app/api/maintenance-plans/route.ts:42-45`; отображение — `equipment-detail-overview.tsx:173-174`, `readiness-score.ts:34` | Срок ТО (`Equipment.nextMaintenanceDate/AtHours`) — денормализованный снимок с двумя писателями: ручная форма карточки (`equipment-form.tsx:295-297,415-416`) и проекция регламента при закрытии наряда (`maintenance-regulation.ts:109-117`). Панель планов и `/api/maintenance-plans` считают срок **живьём** через `evaluatePlanDue` (`pm-due.ts:44-76`). Арбитража между ручным значением и проекцией нет; пустую проекцию код намеренно не пишет (`:110-115`) и старое значение не сбрасывает | Админ меняет интервал регламента ТО-1 (или деактивирует план) — в панели планов срок уже новый/исчез, а карточка, плитка и готовность показывают **прежний** срок, пока наряд не закроют. Обратно: вручную выставленный порог молча затирается проекцией при следующем закрытии наряда | Показывать срок ТО на карточке из того же источника, что панель планов (`listMaintenancePlans` + `evaluatePlanDue`), либо явно помечать поле как ручное и не затирать его проекцией без confirm |
| 3 | важно | `src/components/piling/monitoring/equipment-tile-block.tsx:172-175,190-191,198-206` | Блок «Ближайшее ТО» берёт `hoursLeft = nextMaintenanceAtHours − engineHoursTotal` и не смотрит `nextMaintenanceDate`; перебег клампится в «0 ч». Рядом `maintenanceAlert` в той же плитке использует `checkMaintenanceDue` (обе причины) | Машина с регламентом только по дате: в поле «Ближайшее ТО» — «—», а на той же плитке «ТО просрочено». Диспетчер не понимает, задан ли регламент. **Повтор R144 №9** (открыт) | Показывать дату и остаток/перебег из `checkMaintenanceDue` (`lib/maintenance-due.ts`), не клампить перебег в 0 |
| 4 | важно | `equipment-detail-overview.tsx:117,155`; `admin-equipment/equipment-tile.tsx:34-53`; `equipment-tile-block.tsx:111-118,181`; источник рабочего состояния `modules/monitoring/application/queries/fleet-monitoring.service.ts:247-251,308` | «Статус» одной машины назван тремя понятиями: (а) жизненный цикл `isActive` («В эксплуатации/Списана») — карточка; (б) легаси-статус отчёта `active/expected/idle` (`fleet-monitoring.service.ts:30,51-52`) — бейдж плитки парка; (в) рабочее состояние `working/repair/idle` (`operational-state.ts:27-58`) — `equipmentStatus`. Карточка не показывает рабочее состояние вовсе | Диспетчер открывает карточку простаивающей (ремонт) машины из списка, где она «Ремонт», и видит «Статус: В эксплуатации» — карточка не отвечает, почему машина стоит. Плитка парка мешает легаси-статус, флаг ТО и «Ремонт» в одном бейдже. **Повтор R138 №3 / R101 №6** | Показать на карточке рабочее состояние тем же `resolveEquipmentOperationalStates`; на плитке развести рабочий статус и плановое ТО в два индикатора |
| 5 | мелочь | `admin-equipment/detail/equipment-monitoring.tsx:238-242`; `equipment-detail-overview.tsx:157`; `equipment-query.service.ts:74-81` | Отсутствие телеметрии показано **только** в карточке (плитка «Телематика: не подключена» / секция устройств). На `/monitoring` (плитка парка) и в контуре готовности признака «бокс не подключён» нет. Во вкладке телеметрии совет «Подключите телематический бокс» печатается, даже если устройство зарегистрировано | Диспетчер на `/monitoring` и в готовности не отличает машину с боксом от машины без него. Во вкладке телеметрии карточка предлагает подключить бокс, который уже в списке устройств выше. **Повтор R138 №10** | Показывать признак «телеметрия: нет/есть/нет данных за период» в плитке парка и готовности; развести «бокс не установлен» и «данных за период нет» |
| 6 | мелочь | `equipment-detail-overview.tsx:156` и `equipment-tile-block.tsx:189` («ч») против `meter-readings-panel.tsx:210`, `to/readiness-model.ts:115`, `to/readiness/screens/fleet-screen.tsx:213` («м/ч») | Наработка подписана «ч» на карточке и в плитке парка, и «м/ч» в журнале показаний и в готовности | Одна величина названа двумя единицами на соседних экранах. **Повтор R138 №8 / R141 №14** (в `fleet-screen.tsx` уже «м/ч» — коммит `4b4af9bc`, здесь свелось к карточке и плитке) | Одно «м/ч» во всех подписях наработки |
| 7 | мелочь | `modules/readiness/application/readiness-score.ts:145-148`; `to/readiness/authoritative-presentation.ts:244-254`; `to/readiness/screens/readiness-centre.tsx:254-260,313-322` | Контур готовности считает срок своими формулами: `overdueDays = Math.ceil((now−date)/сутки)`, `overdueHours` со знаком равенства `Math.max(0, …)`; тайл центра — `Math.ceil((nextDate−now)/сутки)`; общий помощник `checkMaintenanceDue` — `floor` и `>=` | Ровно на пределе моточасов или в день срока парк/журнал говорят «просрочено», а готовность — «срок не нарушен»; число суток на одном экране расходится на 1. **Повтор R144 №1/№2** (открыт) | Свести все расчёты срока к одному помощнику (`lib/maintenance-due.ts` / `daysUntil`), зафиксировать знак равенства |
| 8 | мелочь | `to/readiness-model.ts:119-124` против `admin-equipment/detail/equipment-detail.tsx:238` | В контуре готовности «Бригада» — только число («назначена · N»); имени бригады нет. Карточка показывает имя, объект и оператора | Диспетчер в готовности видит «Бригада: назначена · 1», но не может понять, какая; в карточке — «Бригада: …». Один факт — две глубины | Показать имя бригады в контуре готовности (оно есть в снимке парка, `fleet-monitoring.service.ts:323`) |
| 9 | мелочь | `modules/crews/application/commands/crew-command.service.ts:34-46`; `prisma/schema.prisma:1862-1865`; `equipment-query.service.ts:66-73,174`; `fleet-monitoring.service.ts:145-148` | Гарантия «одна активная бригада на установку» держится **только в коде** (`assertEquipmentNotDoubleBooked`, и лишь при новом закреплении); DB-констрейнта нет. Карточка берёт `crews[0]` из выборки `where isActive` **без `orderBy`**, плитка парка — `take: 1, orderBy updatedAt desc` | Пока гарантия держится, оба выбирают одну бригаду. При её нарушении (старые/ручные данные, правка в БД) карточка и плитка покажут **разных** операторов/объекты для одной машины. **Не подтверждено достижимостью** (см. «Не проверено») | Добавить детерминированный порядок (`orderBy updatedAt desc`) в `getEquipmentDetails`, чтобы выбор не зависел от гарантии уровня приложения |
| 10 | мелочь | `src/app/api/monitoring/fleet/route.ts:35`; `admin-equipment/use-fleet.ts:20` | Снимок парка кэширован на 30 с и один для `/monitoring`, списка `/admin/equipment` слева и контура готовности; карточка установки кэша не имеет (`/api/equipment/[id]/details`) | Сразу после правки карточка показывает новое значение, а плитка слева/готовность — до 30 с старое, и наоборот. **Повтор класса R118/R119** (кэш снимка) | Инвалидировать домен `monitoring` при записи техники (часть уже сделана через `onSaved`), либо помечать плитку временем снимка |
| 11 | мелочь | `to/to-module.tsx:471-481` | Если `/api/equipment` вернул пустой массив, контур готовности фабрикует опции установок из `bootstrap.selectors.equipment` с `crewCount: 0` и **без** `engineHoursTotal`/`nextMaintenance*` | В этой ветке готовность покажет «Бригада не назначена» и «нет показания» для машин, у которых и бригада, и наработка есть. Экран достовернее не станет — он покажет ложную пустоту | Не подставлять фабрикованные опции: при пустом списке честно показать, что данные парка не получены |
| 12 | мелочь | `modules/equipment/application/queries/operational-state.ts:42-49` | `MaintenanceRecord` читается по `equipmentId in ids` **без** `tenantId` (в отличие от соседнего запроса `Shift`, где `tenantId` есть) | Утечки нет — `equipmentIds` уже тенантно-ограничены (`fleet-monitoring.service.ts:119-132`), но правило проекта «тенант строгим равенством» здесь не выполнено, и при будущем вызове с чужим id набор расширится | Добавить `tenantId` в запрос (не меняю сам — задача read-only; правки требуют impact) |
| 13 | мелочь | `to/readiness/screens/fleet-evidence-panel.tsx:136` против `:178-179` | В одной панели контура готовности наработка берётся из `item.equipment` (запрос `/api/equipment`), а срок ТО — из `detail.equipment` (запрос `/api/equipment/[id]/details`): два источника на одну машину | Оба запроса читают одни колонки `Equipment`, поэтому обычно совпадают; при рассинхроне времени/прав панель покажет наработку и ТО из разных ответов. Панель сама честно предупреждает «могли обновиться после оценки» (`:136`) | Брать оба поля из одного ответа (или из снимка оценки, как `facts`) |

### Что закрыто (не переоткрываю)

- **R138 №1, №2** — закрыты коммитом `8a1ae460` (единый словарь `KIND_LABEL`, статус «Списана»);
  в коде: `equipment-form.tsx:88-91` (`KIND_LABELS = KIND_LABEL`), `equipment-detail.tsx:181-185`.
- **R138 №4, №6, №9** — закрыты коммитом `b8add1a9` (порог 7/50, «Простои за 30 дней»,
  `formatCountMeters`); в коде: `equipment-detail-parts.tsx:273-278`, `equipment-detail-overview.tsx:175`,
  `equipment-detail.tsx:264-265`.
- **R141 №14** («ч» в строке парка) — закрыт коммитом `4b4af9bc`; сейчас `fleet-screen.tsx:213` «м/ч».
- **R141 №19** (в панели парка нет даты) — устарел: `fleet-evidence-panel.tsx:179` печатает дату.
- **R119 №5** (список не перечитывается после правки) — закрыт: `equipment-detail.tsx:143-146`
  вызывает `onSaved`.
- **R144 №9 / №1 / №2**, **R138 №3 / №5 / №8 / №10** — открыты, вынесены в находки 3, 7, 4, 2, 6, 5.
- **R118, R139** — про сообщения панели мониторинга и смысл показателей аналитики; паритета по одному
  `equipmentId` не пересекают, не переоткрываю (R139 №19 «Установок всего = активные» известно).

## Не проверено

- **Рантайм не воспроизводился**: сервер не поднимался, браузер/Playwright в сессии недоступны, БД не
  читалась. Все «что видно» — из разметки, ветвлений и запросов кода; живые значения колонок
  `Equipment` конкретной установки не смотрел.
- **Находка 1 (очистка наработки)**: вывод по коду (`typeof hours === 'number'` → иначе пишется
  `null`). Прогоном схемы/команды не подтверждал; что после очистки в журнале остаются показания —
  следует из того, что ветка `data.engineHoursTotal = null` не трогает `MeterReading`.
- **Находка 2 (снимок срока ТО)**: что конкретная пр-организация ведёт регламенты `MaintenancePlan` и
  как часто ручной порог затирается проекцией — не измерял (сид регламентов не создаёт — `grep` по
  `src/lib/seed`). Расхождение «карточка ↔ панель планов» выведено из кода, не из данных.
- **Находка 9 (две бригады на установку)**: достижимость не подтверждена — гарантия
  `assertEquipmentNotDoubleBooked` есть; нарушение возможно только старыми/ручными данными. Поэтому
  мелочь, а не важно.
- **Находка 11 (фабрикованные опции)**: не проверял, как часто `/api/equipment?limit=100` возвращает
  пустой массив при непустом `bootstrap.selectors.equipment`; ветка выведена из кода `to-module.tsx:465-481`.
- **Телеграфия телеметрии**: сервис `src/services/telemetry/**` и границы `TelematicsDevice`
  прочитаны обзорно (dormant по AGENTS); сквозной путь `machine_state` → «Состояние машины» в живом
  виде не запускался.
- **Проверки §6** (каждая команда отдельно, exit-код без `tail/head`-пайпов): `.next/dev/types`
  отсутствует (проверено `ls` — каталога нет, ложной «чистоты» нет; абсолютный путь внутри этой
  рабочей копии); `npx tsc --noEmit` → **exit 0**; `node node_modules/vitest/vitest.mjs run
  src/components/piling/admin-equipment src/modules/monitoring src/components/piling/to` →
  `Test Files 28 passed (28)`, `Tests 245 passed (245)`, пропусков 0, **exit 0**. `npm run lint`,
  `npx playwright test --list`, `npm run build` не запускались — задача read-only, изменён только этот
  `.md`, сборке нужны env/БД.
- **GitNexus `impact`/`detect-changes` не запускал**: символов не менял, кода не правил, изменён только
  отчёт — граф не затронут. Единственные предложенные правки (находки 1, 2, 9, 12) требуют отдельного
  impact-анализа перед исполнением, но исполнения в этой задаче нет.
- **Тестов на паритет одного `equipmentId` между тремя экранами нет**: `fleet-monitoring.service.test.ts`
  фиксирует поля карточки снимка (в т.ч. `engineHoursTotal`), `equipment-maintenance.test.ts` —
  `projectNextMaintenance`, но ни один тест не сверяет карточку/плитку/готовность между собой и не
  покрывает находки 1, 2, 3, 4. Это и есть причина, по которой расхождения дожили до аудита.
