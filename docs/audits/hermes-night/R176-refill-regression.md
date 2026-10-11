# R176-refill-regression — Приёмочные доказательства новых фиксаций данных и загрузки после ночного пополнения

READ-ONLY аудит фактически выполненных код-задач очереди `hermes-night-8-20261005` (батчи 02:15 и 03:20)
на ветке `hermes/q4-0926`, worktree `D:\PillingR\wt-night`, HEAD `5e38a5c7`. Единственная запись —
этот файл. Код, тесты, конфиг, `.env*`, Prisma/auth/tenancy/docker не менялись. Production/SSH/боевые
БД не касался, ничего не слито и не выкачено. Замороженные зоны (варианты экрана оператора, ORION,
`src/modules/operator-mobile/**`) не читались.

## Итог

- Проверены **6 выполненных код-коммитов** F-N1005: `28ee04bc`, `b0cf2172`, `a99349d2`, `aca683d5`,
  `b4e5ea62`, `93119d52` — все в HEAD, диффы соответствуют задачам, поведение подтверждено **реальным
  прогоном** целевых тест-файлов: `4 files / 111 tests passed`, **exit 0**, 0 skipped, 0 failed.
- **8 задач очереди НЕ выполнены** (отсутствуют коммиты): 7 помечены `EXIT=1 NO-COMMIT` из-за
  исчерпания кредитов OpenRouter (`HTTP 402`), ещё 1 (`F-N1005-HISTORY-VERDICT`) — доказательный
  `NO-COMMIT`. Их дефекты на текущем HEAD **воспроизводятся** (см. находки 1–6), кроме
  `F-N1005-CALENDAR-TEST-CLOCK`, закрытого позже коммитом `9f63f92d`.
- Остаточная проверка R175 (ручное обновление дефектов при том же `snapshotId`) **выполнена**: отчёт
  `docs/audits/hermes-night/R175-defect-refresh-same-snapshot.md` существует (коммит `5e38a5c7`,
  2026-10-11), его ключевые `path:line` переоткрыты и подтверждены (находка 7). Заявление R167 о
  закрытии R151 №8 покрывает только ветку **нового** снимка.
- GitNexus: индекс был на 8 коммитов позади → переиндексирован (`analyze --index-only`, `lastCommit`=HEAD).
  `impact` на свежем индексе по `countBlockersByTone` / `authoritativeFactsForEquipment` /
  `FleetEvidencePanel` даёт **risk LOW** (2 / 3 / 3 узла), а **не** заявленные CRITICAL 348 / «direct 81» /
  542 — числа прошлых отчётов на этом индексе не воспроизводятся (находка 11).
- Находок **15**: **критично — 0**, **важно — 7**, **мелочь — 8**. Потерь данных и утечек не обнаружено.
- Топ-5:
  1. **важно** — `history/route.ts:45-60` не сериализует `verdict`, а `reports-screen.tsx:213-219` читает
     только двоичный `status`: `F-N1005-HISTORY-VERDICT/HISTORY-WIRE-VERDICT` не закрыт end-to-end (№1).
  2. **важно** — `equipment-to-tab.tsx:46-48,66-67`: non-ok/сеть тихо выдаются за «Записей ТО нет» (№2).
  3. **важно** — `equipment-detail.tsx:69-92`: поздний/конкурирующий ответ `refresh` без проверки
     актуальности перезаписывает данные (№3).
  4. **важно** — `report-form-dialog.tsx:43-58,247-251` + `admin-reports.tsx:376,618`: `filterError` не
     передан внутрь формы отчёта (№4).
  5. **важно** — `settings-workspace.tsx:193,336-347`: «только чтение» и «не загрузилось» не различаются (№5).

## Методика

Воспроизводимо; Python нет, браузер не поднимался. Инструменты: `read_file`, `search_files`, `git`,
`node`, `vitest`, `node .gitnexus/run.cjs`.

1. Прочитан `AGENTS.md` (модель доверия, заморозка, «выглядит мёртвым, но должно остаться», §6).
   `git status --short` → `M AGENTS.md` (не мой, не трогал); `git branch --show-current` → `hermes/q4-0926`;
   `git log` → HEAD `5e38a5c7`.
2. Сверен журнал очереди `D:/PillingR/night-logs/backlog-summary.txt` (строки 757–773) и прочитан
   `D:/PillingR/night-logs/tasks/R175-defect-refresh-same-snapshot.md` (полное исходное задание), а также
   ТЗ всех 8 невыполненных F-N1005-задач (`D:/PillingR/night-logs/tasks/F-N1005-*.md`).
3. Границы: `git show --stat` по каждому из 6 коммитов — изменённые файлы совпадают с `allowed`
   соответствующих задач (только `src/**` и, где положено, существующие `*.test.tsx`).
4. Полные диффы выгружены (`git show`) и прочитаны; текущий код изменённых областей открыт целиком:
   `fleet-evidence-panel.tsx`, `to-module.tsx`, `defects-panel.tsx`, `maintenance-screen.tsx`,
   `reports-screen.tsx`, `permits-screen.tsx`, `settings-workspace.tsx`, `types.ts`,
   `pdf-generator/components.ts`, `api/readiness/{current,history}/route.ts`,
   `modules/readiness/application/defects/{commands,queries}.ts`.
5. Для 8 невыполненных задач открыт **текущий** код их целей и подтверждено, что дефект на месте:
   `equipment-to-tab.tsx`, `detail/equipment-detail.tsx`, `report-form-dialog.tsx`, `admin-reports.tsx`,
   `use-reports-data.ts` + `__tests__/use-reports-data.test.ts`, `to-module-shell.test.tsx`.
6. Воспроизведение без мутаций/БД/секретов существующими тестами (без новых файлов и без правок):
   `node node_modules/vitest/vitest.mjs run src/components/piling/to/readiness/screens/fleet-screen.test.tsx \
   src/components/piling/to/__tests__/to-module-shell.test.tsx src/lib/__tests__/pdf-generator.test.ts \
   src/components/piling/to/readiness/authoritative-presentation.test.ts`
   → **exit 0**, `Test Files 4 passed (4)`, `Tests 111 passed (111)`, 0 skipped, 0 failed.
7. GitNexus: `cat .gitnexus/meta.json` → `lastCommit 2707009b` (8 коммитов позади HEAD);
   `node .gitnexus/run.cjs analyze --index-only` (77.5 с, 30134 узла / 63090 рёбер / 838 flows,
   `lastCommit`=HEAD); `impact --direction upstream` по трём символам; `detect-changes --scope all`
   (1 файл — изменённый `AGENTS.md`, риск low, не partial/truncated) и `--scope compare --base-ref main`
   (159 файлов, 389 символов, 273 flows, риск critical — вся ветка, не partial).
8. Сверка с прошлыми отчётами: прочитаны целиком `R174-night-final-acceptance.md` и
   `R175-defect-refresh-same-snapshot.md`; закрытые без регресса пункты не переоткрывались.

Позитивный результат (не находки): все 6 коммитов F-N1005 **подтверждены** триггер→результат
зелёными тестами:

- `28ee04bc` — `fleet-evidence-panel.tsx:197-213`: сбой журнала (`/api/to/journal`) больше не гасит
  уже загруженные записи `props.maintenance` (`/api/maintenance`); ошибки и пустой ответ разведены.
- `b0cf2172` — `to-module.tsx:136,322,400,509,526-529` + `types.ts:106` (`defectsError`): отказ
  `/api/readiness/defects` даёт собственный источник «Дефекты» и состояние «не проверено», а не
  подтверждённый ноль; `defects-panel.tsx:149,178-183`, `maintenance-screen.tsx:130` показывают прочерк.
- `a99349d2` — `reports-screen.tsx:425-427`: при `authoritativeReadinessError` Парето пишет «Причины
  блокировки не проверены», а не «Ни одна причина сейчас не срабатывает».
- `aca683d5` — `permits-screen.tsx:110,239,243`: при отказе авторитетного снимка плитки осмотров/ТО
  дают `missing`/«не проверено», а не зелёный pass и «0 из N».
- `b4e5ea62` — `settings-workspace.tsx:206-215`: причина недоступности предпросмотра берётся из
  `buildAuthoritativeReadinessPresentation`, различая отсутствие снимка / снимок старого формата /
  испорченное доказательство.
- `93119d52` — `pdf-generator/components.ts:84-85`: пробельные значения шапки идут через `safeText`
  и печатаются «—», а не пустой ячейкой.

## Состояние батча 03:20 (сверка summary)

| задача | время | статус | HEAD/примечание |
|---|---|---|---|
| F-N1005-MAINTENANCE-SOURCE | 03:13:19 | EXIT=0 OK | `28ee04bc` |
| F-N1005-DEFECTS-UNKNOWN | 03:26:54 | EXIT=0 OK | `b0cf2172` |
| F-N1005-PARETO-UNKNOWN | 03:35:48 | EXIT=0 OK | `a99349d2` |
| F-N1005-PERMIT-EVIDENCE | 03:45:58 | EXIT=0 OK | `aca683d5` |
| F-N1005-PREVIEW-REASON | 03:57:05 | EXIT=0 OK | `b4e5ea62` |
| F-N1005-HISTORY-VERDICT | 03:58:20 | EXIT=0 **NO-COMMIT** | доказательный отказ, не выполнен |
| F-N1005-PDF-INFO-EMPTY | 04:04:56 | EXIT=0 OK | `93119d52` |
| R175-defect-refresh-same-snapshot | 04:08:36 | EXIT=1 NO-COMMIT | позже закрыт отдельно (`5e38a5c7`) |
| F-N1005-EQUIPMENT-TO-ERROR и далее (6 задач) | 04:13–04:16 | EXIT=1 NO-COMMIT | `HTTP 402`, не запускались |
| R176-refill-regression | 04:16:53 | EXIT=1 NO-COMMIT | `HTTP 402` (эта задача) |

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | suggested fix |
|---|----------|-----------|----------|--------------------------|----------------|
| 1 | важно | `src/app/api/readiness/history/route.ts:45-60`; `src/components/piling/to/readiness/screens/reports-screen.tsx:213-219`; ср. `api/readiness/current/route.ts:43`; `api/contracts.ts:261` | `history` сериализует `status`/`facts`, но **опускает** `verdict`; экран журнала строит исход только по двоичному `status`. DTO (`contracts.ts:261`) поле допускает, `current` его отдаёт. | F-N1005-HISTORY-VERDICT/HISTORY-WIRE-VERDICT не закрыт (NO-COMMIT). Журнал «Отчёты» не отличает `RETURN_TO_OPERATOR`/`CONFIRMATION_REQUIRED` от `DENIED` — возврат и требование подтверждения читаются как запрет. | Отдельная серверная задача: `verdict: item.verdict ?? null` в ответе истории + использование доменного resolver'а в `reports-screen`. Вне scope R176. |
| 2 | важно | `src/components/piling/admin-equipment/equipment-to-tab.tsx:46-48,66-67` | `res.ok && active` — иначе тишина; `catch { }` игнорирует сеть; `finally` снимает `loading`; при `records.length===0` печатается «Записей ТО по этой установке пока нет». | F-N1005-EQUIPMENT-TO-ERROR не выполнен: HTTP 500/403, обрыв сети и битый ответ показываются как «журнал пуст», повтора чтения нет. | Развести успешный `records: []` и отказ чтения; явная ошибка/ограничение с рабочим повтором; сбрасывать состояние при смене `equipmentId`. |
| 3 | важно | `src/components/piling/admin-equipment/detail/equipment-detail.tsx:69-92` | `refresh` делает `authFetch`/`setDetails`/`setError`/`finally` без проверки актуальности запроса; `equipmentId` меняется без remount у родителя. | F-N1005-EQUIPMENT-DETAIL-RACE не выполнен: поздний ответ старой установки или конкурирующий `refresh` заменяет данные/ошибку новой карточки. | Поколение запроса на каждый `equipmentId`/`refresh`; проверять после всех `await` (в т.ч. `finally`); отменять на unmount. |
| 4 | важно | `src/components/piling/admin-reports/report-form-dialog.tsx:43-58,247-251`; `src/components/piling/admin-reports/admin-reports.tsx:376,618` | `ReportFormDialog` получает только `dictionaryError`; `filterError` (`use-reports-data.ts:45`) показывается баннером **вне** модалки (`admin-reports.tsx:376`) и в форму не передан (`:618`). | F-N1005-REPORT-FORM-SOURCE не выполнен: при частичной загрузке справочников открытая форма молчит, пустые опции установок/площадок/пользователей выглядят как «данных нет». | Передать существующий `filterError` и показать внутри формы отдельно от `dictionaryError`, не сбрасывая уже загруженные списки. |
| 5 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:193,336-347` | `rulesUnavailable = !rulesAvailable \|\| !manage` сливает две причины; баннер (:339-341) всегда заявляет «Действующая версия не загрузилась» и предлагает «Повторить». | F-N1005-RULES-READONLY-CAUSE не выполнен: при загруженной версии и отсутствии права управлять сообщение лжёт («версия не загрузилась») и обещает исправить повтором то, что повтором не исправляется. | Различать «версия не загрузилась» (ошибка/повтор) и «загружена, доступ только для чтения»; при обеих причинах не лгать. |
| 6 | важно | `src/components/piling/admin-reports/__tests__/use-reports-data.test.ts:11-13` | `vi.mock('@/lib/api', () => ({ authFetch: authFetchMock }))` предоставляет только `authFetch`; хук при mount зовёт `loadJson`/`isAbort`. | F-N1005-REPORT-REFERENCE-MOCK не выполнен: успешные assertions списка отчётов не доказывают загрузку справочников/`filterError`; часть ветвей мертва. | Довести mock до реальной `fetch`-границы (или связанного `loadJson`), добавить кейсы «все 3 списка», «один источник non-ok», abort-cleanup. |
| 7 | важно | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:70-80,217`; `.../screens/fleet-screen.tsx:220`; `src/components/piling/to/to-module.tsx:844` | Эффект дефектов зависит от `[equipment.id, section, snapshot?.snapshotId]`; панель не перемонтируется (ключ — `equipmentId`); «Обновить данные»/«Повторить загрузку» (`onRetry → loadWorkspace`) журнал дефектов не сбрасывает. | R175 (подтверждено): при том же `snapshotId` ручной повтор показывает **прежний** список как свежий. R151 №8 / заявление R167 закрыто только для ветки **нового** снимка; регистр дефектов (`queries.ts:41-51`) живой и по снимку не фильтруется. | Прокинуть в панель поколение повтора (`refreshNonce`) и добавить в зависимости эффекта. Отдельный impact перед правкой. |
| 8 | мелочь | `src/modules/readiness/application/defects/commands.ts:81-86` (outbox `ReadinessSnapshotRequested`, `DEFECT_CHANGED`) | Строка дефекта коммитится сразу, снимок создаёт отдельный воркер позже. | R175 №2: окно, когда `CurrentReadiness.snapshotId` ещё старый, а регистр уже новый; при сбое проекции `snapshotId` не меняется вовсе. Живого воркера не наблюдал. | Продуктово — не завязывать свежесть списка на `snapshotId`; инфраструктурно — вне scope. |
| 9 | мелочь | `src/app/api/readiness/current/route.ts:20-53` | GET только читает `CurrentReadiness` + `ReadinessScoreSnapshot`, пересчёта не запускает. | R175 №3: «Обновить данные» физически не создаёт новый `snapshotId`. Зафиксировано для трассы. | Не требуется. |
| 10 | мелочь | `src/modules/readiness/application/defects/queries.ts:41-51` | GET дефектов фильтруется по `equipmentId/status/severity`, но **не** по снимку. | R175 №4: `snapshotId` в ключе панели — прокси свежести, а не гарантия совпадения снимка и списка. | Учесть при правке находки 7. |
| 11 | важно (предупреждение) | `.gitnexus/meta.json` + `impact` на свежем индексе | На переиндексированном графе `impact --direction upstream`: `countBlockersByTone` → risk **LOW**, 4 узла (direct 2: `ReadinessCentre`, `buildReadinessMetricTiles` — оба в `readiness-centre.tsx`); `authoritativeFactsForEquipment` → risk **LOW**, 3 узла (`settings-workspace.tsx:200` и косвенно); `FleetEvidencePanel` → risk **LOW**, 3 узла. | Заявленные в R174/задании CRITICAL (348 / «direct 81» / 542) на свежем индексе **не воспроизводятся**; текстовый поиск даёт 2 реальных вызывающих `countBlockersByTone` (`readiness-centre.tsx:487,676`) и **одного** у `authoritativeFactsForEquipment` (`settings-workspace.tsx:200`; остальные вхождения — определение `authoritative-presentation.ts:397` и тесты). Раздутые числа прошлых прогонов — артефакт устаревшего/иного индекса, а не измеренный радиус. Analyzer явно предупреждает: процессы усечены (2449 из 2649 точек входа не ранжированы) — отсутствие flow ≠ отсутствие пути. | HIGH/CRITICAL из старых прогонов не использовать как основание; самозавершённый свежий индекс — источник (сделан). Отдельные общие функции не редактировать. |
| 12 | мелочь | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:70,74`; `src/components/piling/to/to-module.tsx:239-252,512` | Ключ `snapshot?.snapshotId ?? ''`: при отказе `/api/readiness/current` `currentReadiness=[]` → `snapshot=null` → ключ меняется на `equipment_id:`. | R175 №6: мимолётный отказ current перезапускает эффект дефектов под пустым снимком, затем ещё раз при восстановлении — лишние запросы и мигание. Данные не теряются. | Не считать регрессом; при желании не менять ключ дефектов при `authoritativeReadinessError`. |
| 13 | мелочь | `src/components/piling/to/to-module.tsx:708` | `if (!presentation) return [item.id, derived]` — при успешном current без записи по установке берётся производная оценка (может дать `canOperate=true`). | R174 №5, не регресс: «снимка нет вовсе» = производная. Продуктовое решение. | Отдельная задача; вне scope R176. |
| 14 | мелочь | `AGENTS.md` (рабочее дерево) | `git status --short` показывает `M AGENTS.md` — правка не моя, не трогал и не коммитил. | Не относится к R176; фиксируется, чтобы `detect-changes --scope all` (1 файл, риск low) не был прочитан как мой интент. | Не требуется. |
| 15 | мелочь | `src/components/piling/to/__tests__/to-module-shell.test.tsx:622-636` | Задача `F-N1005-CALENDAR-TEST-CLOCK` на HEAD **закрыта** — часы подменяются `beforeEach` до тела теста (комментарий :628-629). | Дефект «тест недели смен зависел от даты прогона» устранён позже коммитом `9f63f92d` (2026-10-06, ancestor HEAD), **не** этой очередью. Ре-находкой не считать. | Не требуется; засчитано как закрытое. |

## Кандидаты / отклонённые / непроверенные

- **Кандидаты к последующему рассмотрению** (не разрешение merge): 6 коммитов F-N1005 (`28ee04bc`,
  `b0cf2172`, `a99349d2`, `aca683d5`, `b4e5ea62`, `93119d52`) — код и тесты подтверждены; но триггер→результат
  доказан только юнит-тестами (не браузером).
- **Отклонено/не выполнено** (нужны новые задачи): `F-N1005-HISTORY-VERDICT` и
  `F-N1005-HISTORY-WIRE-VERDICT` (находка 1), `EQUIPMENT-TO-ERROR` (2), `EQUIPMENT-DETAIL-RACE` (3),
  `REPORT-FORM-SOURCE` (4), `RULES-READONLY-CAUSE` (5), `REPORT-REFERENCE-MOCK` (6).
- **Закрыто вне очереди**: `F-N1005-CALENDAR-TEST-CLOCK` (`9f63f92d`, находка 15).
- **Непроверенные сценарии** (статика/тесты, не живой рантайм): окно асинхронной проекции снимка (8),
  ручной повтор в открытой вкладке (7), поведение воркеров готовности.

## Не проверено

- **UI/браузер нужной ветки — BLOCKED.** Порт `:3000` занят `LISTENING` (PID 15312) — это **другая**
  рабочая копия, не `wt-night` (совпадает с выводом R174 про `D:\PillingR\my-project`). Свой сервер из
  `wt-night` не поднимал: нужны `.env` и БД, про которую нельзя утверждать, что она локальная. Ни одного
  UI-сценария визуально не подтверждаю; зелёные юнит-тесты и статика **не** выдаются за PASS живого UI.
- **Playwright-прогон не запускался** (даже `--list` в этой задаче не гонял — сервер/аккаунты владельца
  не использовались). Число собранных тестов не проверял.
- **§6 (tsc/lint/test:unit/build) целиком не запускал** — задача read-only и кода не меняет. Прогнаны
  только 4 целевых тест-файла (`111 passed`, exit 0). Про tsc/lint/build «зелёно» не заявляю.
- **Рантайм воркеров/снимков**: интервалы проекции, лидер-выбор и фактическая задержка `snapshotId` —
  из кода, живого воркера не наблюдал. Реальные данные готовности в БД не открывал.
- **`impact` HIGH/CRITICAL прошлых прогонов**: на свежем индексе дают LOW (находка 11); воспроизвести
  условия, при которых получались 348/542, не удалось — оставляю **unresolved**, а не «граф раздут».
- **`npm test:unit` skipped-файлы** — какие именно интеграционные/контрактные спеки пропускаются без
  `.env`, не разбирал (вне scope).
