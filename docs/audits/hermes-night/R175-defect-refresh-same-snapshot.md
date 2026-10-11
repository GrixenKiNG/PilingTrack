# R175. Ручное обновление дефектов при неизменном snapshotId

READ-ONLY follow-up к F-N1004-DEFECT-REFRESH (коммит `9c4b9c27`) и к заявлению R167 о закрытии
R151 №8. Единственная запись — этот файл. Рабочая копия `D:\PillingR\wt-night`, ветка
`hermes/q4-0926`, HEAD `707fa049`. Замороженные зоны (варианты экрана оператора, ORION,
`src/modules/operator-mobile/**`) не читались. `.env*`, Prisma, auth/security/rate-limiter,
tenancy/RLS, docker — не читались и не менялись. Production/SSH/боевых БД не касался.

## Итог

- Проверен именно контракт «ручной повтор при НЕизменном снимке» и отделён от доказанной защиты
  «нового снимка». Защита нового снимка — **реальна и покрыта зелёным тестом**; предположение
  «любой refresh перечитывает дефекты» — **неверно**.
- Находок **6**: **критично — 0**, **важно — 2**, **мелочь — 4**. Потери данных и утечек нет;
  выводы — из чтения кода, существующих тестов и прогона одного тест-файла без правок.
- Топ:
  1. **важно** — `fleet-evidence-panel.tsx:70-80,215-217` + `fleet-screen.tsx:220` +
     `to-module.tsx:844`: «Обновить данные»/«Повторить загрузку» **не перечитывает** открытый
     журнал дефектов, пока `snapshotId` не сменился. Панель не перемонтируется (ключ —
     `equipmentId`), а эффект зависит от `snapshotId`. Доказано зелёным тестом
     `fleet-screen.test.tsx:183-193`.
  2. **важно** — `defects/commands.ts:79-89` + асинхронная проекция (`embedded-workers.ts:142,245`;
     `register-readiness-projection.ts:29-31`; `project-event.ts:60-69`): запись дефекта коммитится
     сразу, а новый снимок создаётся отдельным воркером через секунды. В этом окне журнал дефектов
     на сервере уже новее, чем `snapshotId`, — и ручной повтор его не покажет.
  3. **мелочь** — `current/route.ts:20-53`: GET `/api/readiness/current` только **читает**
     сохранённый снимок, пересчёт не запускает. Значит «Обновить данные» сам по себе нового
     `snapshotId` не создаёт.
  4. **мелочь** — `defects/queries.ts:41-51`: GET дефектов **не** фильтруется по снимку — это живой
     регистр; `snapshotId` как признак свежести — прокси, а не гарантия.

## Методика

Воспроизводимо; инструменты — `read_file`/`search_files`/`git`/`node`/`vitest`, Python нет, браузер
не поднимался. Пошагово:

1. Прочитан `AGENTS.md` (модель доверия, заморозка, «выглядит мёртвым, но должно остаться», §6).
   `git status`/`git branch`/`git log` — ветка `hermes/q4-0926`, HEAD `707fa049`; рабочее дерево
   содержит `modified: AGENTS.md` (не мой; я его не трогал).
2. Сверка с прошлым: целиком прочитан `docs/audits/hermes-night/R174-night-final-acceptance.md`
   (находка №9 про `9c4b9c27`) и `R167-admin-retry-contract.md` (заявление о закрытии R151 №8,
   §125-129); `git show --stat 9c4b9c27` — что именно вошло в фикс.
3. Полностью открыты (path:line ниже — из этих файлов):
   `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx`,
   `.../screens/fleet-workspace-model.ts`, `.../screens/fleet-screen.tsx`,
   `src/components/piling/to/to-module.tsx`, `src/components/piling/to/readiness-reference-ui.tsx`,
   `src/components/piling/to/readiness/api/client.ts`,
   `src/components/piling/to/readiness/screens/defects-panel.tsx`,
   `src/app/api/readiness/current/route.ts`, `src/app/api/readiness/history/route.ts`,
   `src/app/api/readiness/defects/route.ts`,
   `src/modules/readiness/application/defects/{commands,queries}.ts`,
   `src/modules/readiness/application/projection/{project-event,consumer,current-read-model}.ts`,
   `src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts`,
   `src/workers/{register-readiness-projection,embedded-workers}.ts`,
   `src/workers/unified-worker/outbox.ts`,
   `src/modules/reports/application/projections/projection-worker.ts`.
4. Воспроизведение без мутаций/БД/секретов — **существующим** тест-механизмом, без новых файлов и
   без правок tracked-тестов: `node node_modules/vitest/vitest.mjs run
   src/components/piling/to/readiness/screens/fleet-screen.test.tsx` → **exit 0**, `Test Files 1
   passed (1)`, `Tests 29 passed (29)`, 0 skipped, 0 failed. В этом файле уже есть обе ветви
   контракта (см. «Что доказано»); отдельный репродьюс не писал — это было бы новым тест-файлом.
5. GitNexus `impact`/`detect_changes` не запускал: символов не менял, кода не правил, граф не
   затронут (то же решение, что в R167). Предложенный узкий diff требует отдельного impact-анализа
   перед исполнением.

Замечание о нумерации: текст задания и R167 ссылаются на `onRetry` «to-module.tsx:820». На этом
HEAD строки сместились: `onRetry={() => void loadWorkspace()}` — `to-module.tsx:844` (reference-UI) и
`:875` (production shell). Это дрейф номеров, не второй путь.

## Точные read paths, события и endpoints

- **Панель дефектов (открытый журнал).** Ключ результата `defectKey = equipment.id:snapshotId`
  (`fleet-evidence-panel.tsx:70`); эффект перезапускается только на
  `[equipment.id, section, snapshot?.snapshotId]` (`:71-80`). Запрос: `fetchReadinessDefects(signal,
  {equipmentId})` → GET `/api/readiness/defects?equipmentId=…&limit=200` (`api/client.ts:187-193`).
  Устаревший ответ не выдаётся за свежий: при `defectResult?.key !== defectKey` показывается
  «Загружаем журнал дефектов…» (`:217`).
- **Панель не перемонтируется при повторе.** `<FleetEvidencePanel key={selected.equipment.id} …>`
  (`fleet-screen.tsx:220`) — ключ только по установке. Локальное `defectResult` живёт между
  загрузками модуля.
- **Ручной повтор.** «Обновить данные» (`fleet-screen.tsx:103-105`) и «Повторить загрузку»
  (`fleet-evidence-panel.tsx:92`) вызывают `props.onRetry` = `loadWorkspace`
  (`to-module.tsx:844`). `loadWorkspace` (`to-module.tsx:389-600`) делает `setLoading(true)` и
  перечитывает источники, в т.ч. `fetchCurrentReadiness` (`:465`), но локальное состояние панели
  дефектов не сбрасывает.
- **GET current не пересчитывает.** `/api/readiness/current` (`current/route.ts:20-53`) читает
  `CurrentReadiness` и связанные `ReadinessScoreSnapshot`; никакой команды/пересчёта не запускает.
- **Регистрация/разбор дефекта.** POST `/api/readiness/defects` (`defects/route.ts:67-81`) →
  `createDefectCommand` (`defects/commands.ts:116-146`); triage/resolve/reject —
  `versionedAction` (`:148-174`). Любое изменение пишет в одной транзакции строку дефекта +
  outbox-событие `ReadinessSnapshotRequested`, `triggerType='DEFECT_CHANGED'`,
  `triggerId=${defectId}:v${version}:${action}` (`commands.ts:79-89`).
- **Реальный путь обновления снимка (асинхронный).** Событие забирает воркер: подписка
  `registerReadinessProjectionHandler` (`register-readiness-projection.ts:29-31`) на outbox-шину,
  `startOutboxWorker(..., 2000)` (`embedded-workers.ts:142`) и/или
  `projectEvent → consumeReadinessProjectionEvent`; `projectReadinessEvent`
  (`project-event.ts:26-72`) вызывает `evaluateAuthoritativeReadiness` → `createDeduplicatedSnapshot`
  (`:60-64`) → `advanceCurrentReadiness` (`:65-69`). Проекция крутится по интервалу
  (`startProjectionWorker(1_000)` в embedded, `embedded-workers.ts:245`; дефолт внешнего воркера
  `5000`, `projection-worker.ts:147`) и под лидер-выбором — то есть **не** в транзакции команды.
- **Дедуп/продвижение снимка.** `snapshot-repository.ts:35` — `ON CONFLICT (tenantId, equipmentId,
  triggerType, triggerId) DO NOTHING`; `current-read-model.ts:13-29` — upsert с
  `WHERE EXCLUDED.calculatedAt > CurrentReadiness.calculatedAt OR (равно AND EXCLUDED.snapshotId >
  старый)`. Поэтому новый `snapshotId` появляется только когда воркер успешно спроецировал событие.

## Что доказано (гарантия нового снимка)

- **Новый снимок → дефекты перечитываются.** Эффект панели зависит от `snapshotId`; при его смене
  запрос идёт заново, прежний список не выдаётся за свежий, сбой показывает ошибку. Закреплено
  зелёными тестами `fleet-screen.test.tsx:164-177` («перечитывает открытые дефекты после обновления
  снимка») и `:198-210` («при сбое показывает ошибку, а не прежний список»). Это и есть содержание
  R151 №8 / F-N1004-DEFECT-REFRESH — коммит `9c4b9c27`, повторно проверен, регрессии нет.
- **Тот же снимок → запроса нет (намеренно).** `fleet-screen.test.tsx:183-193` утверждает, что
  повторный рендер с тем же `snapshotId` (включая тик `loading:true/false`, который как раз и даёт
  ручной повтор) **не** порождает нового запроса. Тест зелёный — то есть «ручной повтор не
  перечитывает дефекты при том же снимке» это не случайность, а закреплённое поведение (защита от
  дёрганья журнала на каждом рендере).

Вывод: заявление R167 о закрытии R151 №8 **верно для ветки нового снимка** и **не покрывает** ветку
«снимок тот же, а регистр дефектов уже изменился» — см. находку 1.

## Незакрытый сценарий (ручной повтор без нового snapshotId)

1. Диспетчер открывает вкладку «Дефекты» установки (журнал загружен под снимок `S1`).
2. Другой клиент (или тот же, на экране ТО) заводит/закрывает дефект. Строка дефекта коммитится
   **немедленно**; событие `DEFECT_CHANGED` уходит в outbox.
3. Проекция создаёт снимок `S2` и `CurrentReadiness.snapshotId` становится `S2` — но **позже**, через
   секунды (интервалы outbox 2 с / проекции 1-5 с, лидер-выбор), а при сбое воркера — **никогда**.
4. Пока `snapshotId === S1`, ручной повтор в открытой вкладке (`loadWorkspace`) обновляет всё, кроме
   журнала дефектов: панель не перемонтируется (ключ `equipmentId`), эффект не перезапускается
   (`snapshotId` не изменился) → показывается **прежний** список. Признака «данные прежние» нет.
5. Обходной путь в UI: переключить раздел (вкладку) и вернуться — `section` входит в зависимости
   эффекта, произойдёт повторный запрос. Но сам «Обновить данные» этого не делает, и пользователь
   считает, что обновил.

Почему это возможно: `snapshotId` — это признак **пересчёта оценки**, а не **свежести регистра
дефектов**. GET дефектов (`queries.ts:41-51`) живой и по снимку не фильтруется; ключевание по
`snapshotId` опирается на то, что изменение дефекта «почти всегда» влечёт новый снимок — но с
асинхронной задержкой и без гарантии. Потери данных нет (журнал не портится), вред — устаревшая
картина и ложное ощущение свежести. То же окно объясняет находку R174 №9-а: без нового снимка
устаревший ответ не отличим от актуального.

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что предложить (узкий diff) |
|---|----------|-----------|----------|--------------------------|------------------------------|
| 1 | важно | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:70-80,215-217`; `.../screens/fleet-screen.tsx:220`; `src/components/piling/to/to-module.tsx:844` | «Обновить данные»/«Повторить загрузку» перечитывают модуль, но **не** журнал дефектов, пока `snapshotId` не сменился: эффект зависит от `[equipment.id, section, snapshotId]`, панель не перемонтируется (ключ — `equipmentId`). | Открытая вкладка дефектов после ручного повтора показывает прежний список как актуальный. Доказано зелёным тестом `fleet-screen.test.tsx:183-193` (тот же снимок + тик `loading` → 0 доп. запросов). Заявление R167 о закрытии R151 №8 покрывает только ветку нового снимка. | Прокинуть в панель счётчик/поколение повтора (`onRetry` инкрементит `refreshNonce`) и добавить его в зависимости эффекта — тогда ручной повтор перечитывает дефекты даже при том же снимке. Либо, если это нежелательно (дёрганье журнала), показывать у списка метку «на момент оценки <calculatedAt>». Отдельный impact-анализ перед правкой. |
| 2 | важно | `src/modules/readiness/application/defects/commands.ts:79-89`; `src/workers/register-readiness-projection.ts:29-31`; `src/workers/embedded-workers.ts:142,245`; `src/modules/readiness/application/projection/project-event.ts:60-69` | Регистрация/закрытие дефекта коммитит строку **и** outbox-событие сразу, а новый снимок создаёт отдельный воркер (outbox ~2 с, проекция 1-5 с, под лидер-выбором). Окно, когда `CurrentReadiness.snapshotId` ещё старый, а регистр уже новый. | В этом окне ручной повтор (находка 1) не покажет изменений; при остановленном/невыбранном лидере или сбое проекции `snapshotId` не меняется вовсе — журнал в панели остаётся прежним сколь угодно долго. Живого воркера в этой сессии не наблюдал. | Продуктово: не завязывать свежесть списка дефектов на `snapshotId` (см. находку 1) либо дать признак «обновлено <время>». Инфраструктурно — вне этого scope: проверять здоровье воркеров (уже отслеживается хартбитами, `health-tracker`). |
| 3 | мелочь | `src/app/api/readiness/current/route.ts:20-53` | GET `/api/readiness/current` только читает `CurrentReadiness` + `ReadinessScoreSnapshot`, пересчёта не запускает. | «Обновить данные» физически не может создать новый `snapshotId`; он появится лишь из внешнего триггера (команда дефекта/старт смены/бэкфилл). Подтверждает, что опора на смену `snapshotId` как сигнал «пора перечитать» зависит от чужого пути. | Не требуется; зафиксировано для полноты трассы. |
| 4 | мелочь | `src/modules/readiness/application/defects/queries.ts:41-51`; `src/components/piling/to/readiness/api/client.ts:187-193` | GET дефектов фильтруется по `equipmentId/status/severity` и **не** по снимку — это живой регистр. `snapshotId` в ключе панели — прокси, а не гарантия совпадения снимка и списка. | Объясняет корень находки 1: «тот же снимок» не означает «тот же список дефектов». | Учесть при правке находки 1: решать вопрос свежести на стороне списка, а не снимка. |
| 5 | мелочь | `src/modules/readiness/infrastructure/snapshots/snapshot-repository.ts:35`; `src/modules/readiness/application/projection/current-read-model.ts:13-29` | Снимок дедуплицируется по `(tenantId, equipmentId, triggerType, triggerId)` (`DO NOTHING`), а `CurrentReadiness` продвигается только при строго новом `calculatedAt`. Повторная доставка того же события `snapshotId` не меняет. | Полезно для модерации: «snapshotId не изменился» ≠ «пересчёт не шёл» (мог пройти повтор того же события/дедуп). Не дефект; уточнение к трактовке сигнала. | Не требуется. |
| 6 | мелочь | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:70,74`; `src/components/piling/to/to-module.tsx:239-252,510` | Ключ использует `snapshot?.snapshotId ?? ''`. При отказе чтения `/api/readiness/current` `readAuthoritativeCollection` возвращает `data: []` (`to-module.tsx:244-251`) → `currentReadiness = []` → `snapshot === null` → `snapshotId` становится `''`. | Мимолётный отказ current временно меняет ключ с `S1` на `equipment_id:` → эффект перезапускается и перечитывает дефекты под пустым снимком; при восстановлении current — перечитывает ещё раз. Лишние запросы и мигание «Загружаем журнал дефектов…». Данные не теряются. | Не считать это регрессией; при желании — не менять ключ при `authoritativeReadinessError` (сохранять прежний снимок дефектов). Отдельный impact-анализ. |

## Не проверено

- **UI/браузер — BLOCKED.** Порт поднимать не стал: из `wt-night` нужны `.env` и БД, а утверждать,
  что БД локальная, а не боевая, нельзя (правило про `.env`/production). Ни одного UI-сценария (повтор
  в открытой вкладке, приход нового снимка, задержка воркера) визуально не подтверждаю. Статический
  разбор и зелёные тесты **не** объявляю за PASS живого UI — это BLOCKED.
- **Рантайм воркеров не наблюдался**: интервалы (`embedded-workers.ts:142,245`), лидер-выбор и
  фактическая задержка проекции `snapshotId` — из кода, а не из живого прогона. Насколько часто
  лидер не выбран или проекция падает в проде — не измерял.
- **`EMBEDDED_WORKERS`**: по коду в проде воркеры включены по умолчанию (`embedded-workers.ts:26,46-57`),
  в тестах — выключены. Фактическую настройку на боевом контуре не читал (`.env` запрещён).
- **Number/строки `onRetry`**: текст задания и R167 ссылаются на `to-module.tsx:820`; на HEAD это
  `:844`/`:875`. Проверено, что это дрейф нумерации, а не второй путь, но иных несоответствий
  прошлых ссылок не искал.
- **Полный прогон §6** (tsc/lint/test:unit/playwright --list/build) в этой задаче не выполнялся: она
  read-only и не меняет код. Прогнан только один тест-файл (`fleet-screen.test.tsx`, 29 passed). По
  остальным проверкам «зелёно» не заявляю.
- **Узкий diff (находка 1)** не исполнялся и не проверялся `impact`-анализом; это предложение, не
  решение. Внесение правки требует отдельной задачи с полным набором проверок.
