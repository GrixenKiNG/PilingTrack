# R174 — Итоговая ночная приёмка конкретного HEAD

READ-ONLY приёмка пакета `D:/PillingR/night-logs/hermes-night-24-20261004.json` (24 задачи: 10 code /
14 report) на ветке `hermes/q4-0926`, worktree `D:\PillingR\wt-night`. Код, тесты, конфигурация,
`AGENTS.md` и `.env*` не менялись и не читались как секреты; единственная запись — этот отчёт.
Production/SSH/боевых БД не касался, ничего не слито и не выкачено.

## Итог

- Зафиксированное состояние: **HEAD = `2707009b3ec5f464d278e7cf966760f6544a6280`**, ветка
  `hermes/q4-0926`, `git status --porcelain` — пусто (до и после всех проверок). База манифеста —
  `b6b0f228` (`docs(audit): R152 …`, 2026-10-04 20:51).
- Диапазон `b6b0f228..HEAD` — **31 коммит**: 10 code-фиксов F-N1004, 13 отчётов R161–R173 и 8
  наследованных коммитов R153–R160 из предыдущего пакета. **Все 23 коммита текущего пакета уложились
  строго в свои `allowed`-пути** (проверено поимённо скриптом по каждому `allowed`-регексу): замороженных
  зон (operator/ORION), auth/security/rate-limiter/tenancy/Prisma/docker не касались. Потерь/переименований
  файлов нет.
- Статусы пакета: в `reviewed.txt` (журнал Codex) все 10 code и 13 report — **EXIT=0 без NO-COMMIT и без
  REVERTED** (строки 628–638); подтверждено наличием 23 непустых коммитов. Фиктивных «зелёных» отчётов о
  падениях нет.
- §6 AGENTS.md — **все проверки exit 0**: tsc; lint (0 ошибок, 7 предупреждений — все в НЕизменённых
  файлах); test:unit `343 файла (341 passed | 2 skipped)`, `3288 тестов (3249 passed | 39 skipped)`,
  **0 failed, 0 expected fail**; `playwright --list` `99 tests / 11 файлов`; build. Счётчик «3 expected
  fail» из MR-CHECK-1004 исчез — три `it.fails` PDF переведены в обычные passing `it`.
- GitNexus: индекс **отставал** (было `lastCommit 468f3a2e` при HEAD `2707009b`); переиндексирован
  штатным `analyze --index-only` → `lastCommit = HEAD`. Свежий `detect-changes --scope compare --base-ref
  b6b0f228` — **39 файлов (= `git diff`), 23 символа, 1 execution flow, risk medium, не partial/truncated**.
- Вердикт по 10 code-коммитам: **кандидат — 10, отклонён по коду — 0, не проверено — 0**; но
  **F-N1004-SELECTED-SOURCES неполный** (находка 1), а **F-N1004-UNKNOWN-READINESS не покрыл Парето**
  (находка 2). Вывод отчёта **R161** («новый фикс не требуется») **отклонён** доказательством.
- Находок **13**: **критично — 0**, **важно — 6**, **мелочь — 7**. Топ-5:
  1. **важно** — `fleet-evidence-panel.tsx:197`: отказ журнала (`/api/to/journal`) гасит уже загруженные
     записи `props.maintenance` (`/api/maintenance`) — независимый источник (№1).
  2. **важно** — `reports-screen.tsx:415-416`: при отказе `/api/readiness/current` Парето пишет «Ни одна
     причина сейчас не срабатывает» — неизвестное выдано за «блокировок нет» (№2).
  3. **важно** — `history/route.ts:45-60` не сериализует `verdict` (в `current/route.ts:37` он есть);
     поставленная F-N1005-HISTORY-VERDICT не закрывается только во фронте (№3).
  4. **важно** — `to-module-shell.test.tsx:592` берёт реальный календарный день при `NOW = 2026-10-05`
     (`:539`): тест зелёный только сегодня, завтра упадёт (№4).
  5. **важно** — `to-module.tsx:686`: при успешном current без записи по установке всё ещё берётся
     производная оценка с возможным `canOperate=true` (R151 №4 закрыт только для ветки ошибки) (№5).

## Методика

Что делал и как повторить (path:line — по фактически открытым файлам; `git`/`node`/`read_file`/
`search_files`/PowerShell `Get-CimInstance`; без Python, без чтения секретов, без мутаций):

1. Прочитан `AGENTS.md` целиком (модель доверия, заморозка, «выглядит мёртвым, но должно остаться»,
   §6). `git rev-parse HEAD`, `git branch --show-current`, `git status --short` — HEAD и чистота дерева.
2. Манифест `D:/PillingR/night-logs/hermes-night-24-20261004.json` разобран через `node`: 24 задачи
   (10 code / 14 report), `base: b6b0f228`. Из него же сверены `allowed`/`frozen` каждой задачи.
3. Границы: скрипт на `node` (`spawnSync git show --name-only`) сверил изменённые файлы **каждого** из 10
   code-коммитов с `allowed` соответствующей задачи и файлы каждого report-коммита с
   `^docs/audits/hermes-night/`. Результат — 10× OK, 13× OK(1 md-файл).
4. `git log --format` показал 31 коммит от базы; R153–R160 (21:23–23:31) — наследие предыдущего пакета
   (`hermes-30`), к текущему пакету не относятся; R161–R173 и 10 фиксов — текущий пакет.
5. Чтение кода HEAD по изменённым областям (все открыты): `use-reports-data.ts`, `admin-reports.tsx`,
   `to-module.tsx`, `authoritative-presentation.ts`, `readiness-centre.tsx`, `settings-workspace.tsx`,
   `reports-screen.tsx`, `shifts-screen.tsx`, `fleet-evidence-panel.tsx`, `pdf-generator/format.ts`,
   `to-module-shell.test.tsx`, `api/readiness/{history,current}/route.ts`. Дополнительно сверены диффы
   коммитов `36fa7e87`, `0bbd1ee0` (`git show`).
6. Статусы пакета: `reviewed.txt` — сплошной поиск `NO-COMMIT|REVERTED` (52 совпадения, все — старые
   задачи до 04.10; для текущего пакета строки 628–638 фиксируют «новые EXIT0 OK» без откатов).
7. GitNexus: `cat .gitnexus/meta.json` (был `lastCommit 468f3a2e`, 8 коммитов позади);
   `node .gitnexus/run.cjs analyze --index-only` (38.8 с, 26037 узлов / 57079 рёбер / 827 flows,
   `lastCommit = HEAD`); `detect-changes --scope compare --base-ref b6b0f228` (39 файлов = `git diff` =
   39; 23 символа; 1 flow; medium; не partial/truncated); `detect-changes --scope all` → «No changes».
   `impact` по `countBlockersByTone` и `authoritativeFactsForEquipment` — результат в находке 6.
8. §6 AGENTS.md — каждая команда отдельно, без `tail`/`head`-пайпов, с записью реального exit-кода
   (см. «Проверки §6»). `.next/dev/types` перед очисткой проверен: пути нет (ничего не удалялось).
9. Браузер: `netstat -ano | grep :3000` → PID 13980; `Get-CimInstance Win32_Process -Filter 'ProcessId=13980'`
   → `C:\Program Files\nodejs\node.exe D:\PillingR\my-project\node_modules\next\dist\server\lib\start-server.js`
   — порт обслуживает **другую** рабочую копию, не `wt-night`. Свой сервер не поднимал (нужны `.env` и БД).
10. Сверка с прошлыми отчётами: прочитан `R160-release-candidate-review.md` целиком и разделы «Итог»
    всех R161–R173 (в т.ч. их выводы NO-COMMIT и найденные остатки). Закрытые ранее пункты не переоткрывал.

## Проверки §6 (отдельно, с реальными exit-кодами)

| команда | exit | результат |
|---|---|---|
| проверка `.next/dev/types` | — | пути нет (`ls`: No such file) → удалять нечего |
| `npx tsc --noEmit` | **0** | без вывода |
| `npm run lint` | **0** | eslint `0 errors, 7 warnings` + «Text integrity check passed» |
| `npm run test:unit` | **0** | Test Files `341 passed \| 2 skipped (343)`; Tests `3249 passed \| 39 skipped (3288)`; **0 failed, 0 expected fail**; Duration 96.3 s |
| `npx playwright test --list` | **0** | `Total: 99 tests in 11 files` (только коллекция) |
| `npm run build` | **0** | Next.js 16.3.6 (webpack), 94/94 страниц; предупреждения: `@valkey/valkey-glide` не найден (bullmq), `SENTRY_AUTH_TOKEN not set` |

Излишние уточнения:
- **Playwright-прогон не запускался** — только `--list` (99/11 совпадает с базой R160: коллекция не
  просела). Реальные e2e требуют сервера и учётных данных владельца; они не использовались.
- `npm run build` печатает `injected env (32) from .env` (штатная обёртка проекта, `dotenvx`); содержимое
  `.env` я не открывал и не менял.
- 7 lint-предупреждений — в файлах, не входящих в диффы пакета (см. находку 8).
- `test:unit`: 2 skipped файла — интеграционные/контрактные спеки, гейтированные на живой БД/URL
  (`tests/integration/rls-tenant-enforcement.spec.ts:44` и др.; `vitest.config.ts:8`). Какие именно из
  четырёх `describe.skip(If)`-файлов пропущены — не разбирал.

## GitNexus

- **Было:** `.gitnexus/meta.json` → `lastCommit 468f3a2e` (2-й code-коммит), т.е. индекс **на 8 коммитов
  позади** HEAD. `detect-changes --scope compare` на старом индексе давал 103 символа / 10 flows / risk
  **high** — артефакт устаревшего графа.
- **Стало:** переиндексация `analyze --index-only` (38.8 с, 26037 узлов / 57079 рёбер / 480 кластеров /
  827 flows) → `lastCommit = 2707009b` (= HEAD). Свежий `compare --base-ref b6b0f228`: **39 файлов
  (полное совпадение с `git diff --name-only b6b0f228..HEAD`), 23 символа, 1 flow, risk medium, не
  partial / не truncated**. `detect-changes --scope all` → «No changes detected» (дерево чистое).
- Оговорка самого анализатора: на уровне всего репозитория `processes` усечены (2391 из 2591
  кандидатных точек входа не ранжированы; «An absent flow does NOT mean the code path does not exist»).
  Поэтому отсутствие flow в графе нельзя читать как «путь не существует».
- **`impact` не читать буквально:** `impact countBlockersByTone --direction upstream` → risk **CRITICAL**,
  `impactedCount 348` (195 processes); `impact authoritativeFactsForEquipment` → risk **CRITICAL**,
  «direct 81». Но текстовый поиск даёт **одного** боевого вызывающего `authoritativeFactsForEquipment`
  (`settings-workspace.tsx:199`) и одного у `countBlockersByTone` (внутри `readiness-centre.tsx`). Числа
  раздуты (проход через дерево рендера / разрешение по типу) — HIGH/CRITICAL здесь как грубое
  предупреждение, а не как измеренный радиус. (Совпадает с оговоркой AGENTS про UNKNOWN.)

## По каждому code-коммиту (кандидат / отклонён / не проверено)

| # | коммит | задача | вердикт | основание |
|---|--------|--------|---------|-----------|
| 1 | `e3f77f5f` | F-N1004-REPORT-RACE | **кандидат** | Поколение `reportsGenRef` + AbortController + ref-защёлка (`use-reports-data.ts:100-105,217-227,310-365`); устаревшая догрузка отбрасывается по `isCurrent()` (`:321,332,345`). Верно. |
| 2 | `468f3a2e` | F-N1004-EMPTY-PAGE | **кандидат** | Блок догрузки вынесен из непустой ветки под `hasMore` (`admin-reports.tsx:504-541`); пустое состояние различает «нет среди загруженных»/«отбор пуст» (`:477-484`). Верно. |
| 3 | `36fa7e87` | F-N1004-HISTORY-ERROR | **кандидат** | `authoritativeReadinessError` больше не сливается с `readinessHistoryError` (`to-module.tsx:499-500`); история видна только у отчётов (`reports-screen.tsx:312-319`). Верно. |
| 4 | `99b06fe3` | F-N1004-SELECTED-SOURCES | **кандидат, НЕПОЛНЫЙ** | Раздельная догрузка и `loadAttempts` против цикла — верны (`to-module.tsx:606-650`); но новый `journalError` гасит успешные записи другого источника (`fleet-evidence-panel.tsx:197`) — см. находку 1. |
| 5 | `0bbd1ee0` | F-N1004-UNKNOWN-READINESS | **кандидат, ЧАСТИЧНЫЙ** | Отказ current → `NO_DATA`/`canOperate:false` (`to-module.tsx:681-698`), прочерк в отчётах/сменах — верно; но Парето «Отчётов» остался с ложным «нет причин» — см. находку 2. |
| 6 | `b8d45058` | F-N1004-PREVIEW-STATE | **кандидат** | `authoritativeFactsForEquipment` гоняет снимок через `buildAuthoritativeReadinessPresentation` и отсекает не-`authoritative` (`authoritative-presentation.ts:390-397`); сбой загрузки отделён от «фактов нет» (`settings-workspace.tsx:206-209`). Верно. |
| 7 | `8a913c5e` | F-N1004-BLOCKER-LABELS | **кандидат** | Строка «Критические блокеры» теперь выводит `blockerTones.critical` (`readiness-centre.tsx:786`), плитка — счётчики по тонам (`:326-340,470-474`). Остаток MR-CHECK-1004 №3 **закрыт**. |
| 8 | `8a535724` | F-N1004-PDF-INVALID | **кандидат** | `safeText`/`formatRuDate` (`pdf-generator/format.ts:6-40`) сохраняют конечный 0, «—» на NaN/±Inf/пробел/битую дату; 3 `it.fails` → `it`, счётчик expected fail исчез. Верно. |
| 9 | `9c4b9c27` | F-N1004-DEFECT-REFRESH | **кандидат** | Ключ дефектов включает `snapshot.snapshotId` (`fleet-evidence-panel.tsx:70-80`), устаревший ответ не выдаётся за свежий. Верно. |
| 10 | `07853c60` | F-N1004-PREVIEW-CONTEXT | **кандидат** | База сравнения (балл/версия/время авторитетного снимка) показана отдельно от чернового preview (`settings-workspace.tsx:199-209,551-564`). Верно. |

Отчёты R161–R173 — 13 коммитов, каждый меняет только свой `docs/audits/hermes-night/R1xx-*.md`; приняты
как аудиты. **Вывод R161 «новый фикс не требуется» — отклонён** (находка 1). R172/R173 — числовые
несогласованности внутри отчётов (находки 10, 11).

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что предложить |
|---|----------|-----------|----------|--------------------------|----------------|
| 1 | важно | `src/components/piling/to/readiness/screens/fleet-evidence-panel.tsx:197` (и `:54`) | Цепочка `maintenanceError ? alert : journalError ? alert : records…` — отказ журнала (`Журнал «…»»`, `/api/to/journal`) **гасит** уже успешно загруженные `records` из `props.maintenance` (`/api/maintenance`, `to-module.tsx:436-440,549`). Это два независимых источника. | F-N1004-SELECTED-SOURCES обязывал учитывать удачу/отказ журнала и карточки **раздельно**. При живом `/api/maintenance` и упавшем журнале диспетчер видит только alert и не видит реальные записи ТО — данные есть, но скрыты. Дефект подтверждён независимо (Codex, `reviewed.txt:630`), но отчёт R161 объявил «фикс не нужен». | Показывать alert журнала **отдельно** от списка записей, не подавляя `records`; сценарий в существующем `fleet-screen.test.tsx`. |
| 2 | важно | `src/components/piling/to/readiness/screens/reports-screen.tsx:253-260,415-416` | `facts` строится из `props.currentReadiness`; при отказе `/api/readiness/current` массив пуст → все `blockerRows` = 0 → `blockerTotal === 0` → «Ни одна причина сейчас не срабатывает». | Отказ чтения выдан за утверждение «блокировок нет» (R163 №1). Коммит `0bbd1ee0` починил процент готовности и смены, но **не** блок Парето. | При `authoritativeReadinessError` показывать «не подтверждено» вместо «нет причин». |
| 3 | важно | `src/app/api/readiness/history/route.ts:45-60` (ср. `src/app/api/readiness/current/route.ts:37`) | `current` отдаёт `verdict`, а `history` — **нет** (поля `verdict` в сериализаторе отсутствует). | Поставленная F-N1005-HISTORY-VERDICT (правка только во фронте) не докажет реального исправления: DTO истории `verdict` не получает. Связано с R165 №1 (журнал «Отчёты» красит красным любой `status: BLOCKED`). | Добавить `verdict: item.verdict ?? null` в ответ истории отдельной задачей (вне текущего allowed). |
| 4 | важно | `src/components/piling/to/__tests__/to-module-shell.test.tsx:592` (и `:539`) | `getTodayInTimezone(timezone)` вызывается на **реальном** времени ДО установки fake-timers, а компонент считает окно недели по фиксированному `NOW = 2026-10-05T02:00:00Z`. | Тест «шестой производственный день в окне недели» зелёный, только пока календарный день = 2026-10-05; с 06.10 он начнёт падать (сдвиг ожидаемого `2`). Non-deterministic тест в приёмочном прогоне. Подтверждено независимым расчётом (Codex, `reviewed.txt:638`). | Брать `today` из того же fake-NOW (или зафиксировать часы до вычисления `today`). |
| 5 | важно | `src/components/piling/to/to-module.tsx:686` | `if (!presentation) return [item.id, derived]` — когда `/api/readiness/current` **успешен**, но записи по установке нет, возвращается производная оценка (может дать `canOperate=true` и балл). | R151 №4 закрыт только для ветки **ошибки** (`:681-685`); ветка «снимка нет вовсе» остаётся производной. Производная оценки читаются «Отчётами» и экипажами смен. (Codex, R163, называет ветку остатком, не регрессией.) | Отдельной задачей решить: «снимка нет» = `NO_DATA` или честная производная; не расширять текущий scope. |
| 6 | важно | `.gitnexus/meta.json` + `impact` на свежем индексе | Индекс отставал на 8 коммитов; после переиндексации `impact` даёт завышенные числа (`countBlockersByTone` → CRITICAL/348; `authoritativeFactsForEquipment` → «direct 81» при одном реальном вызывающем, `settings-workspace.tsx:199`). | Пока индекс был устаревшим, `impact`-полнота не гарантировалась; но и на свежем индексе радиус раздут (обход дерева рендера). Опираться на HIGH/CRITICAL для release-решения нельзя. | Переиндексировать перед решением (сделано); `impact` читать как грубое предупреждение, подтверждая вызывающих текстовым поиском. |
| 7 | важно | `docs/audits/hermes-night/R172-readiness-page-completeness.md` | Отчёт сам пишет «граф не запускался», а его stdout заявляет `detect_changes exit0 / 1 doc / 0 symbols` — внутреннее противоречие доказательств. | Приёмка не может опереться на заявление отчёта о графе; сам вывод о лимитах (`take` без `+1`) подтверждается кодом независимо. (Codex, `reviewed.txt:638`.) | Привести формулировку в соответствие; независимо граф по R172 перепроверен сейчас (см. «GitNexus»). |
| 8 | мелочь | `src/components/piling/to/readiness/screens/readiness-centre.tsx:339` vs `:789` | «Обычные» = `facts?.findings ?? presentation.warnings.length`, а «Замечания» = `warnings` (= `presentation.warnings.length`) — два разных числа для близкого смысла. | При `facts.findings ≠ warnings.length` два блока одного экрана показывают разные счётчики. | Унифицировать источник числа (не блокирует). |
| 9 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:199-200` | Предпросмотр считает балл по черновым весам, даже когда правила не опубликованы (`publishedInDb=false`) / не загрузились — рядом с авторитетным «0 из 100». | Заметнее после `07853c60` (R164 №1): два числа про одну установку расходятся по смыслу. Продуктовое решение, не дефект фикса. | Решить у владельца: показывать предпросмотр при неопубликованных правилах или скрывать. |
| 10 | мелочь | `npm run lint` (7 warnings; напр. `src/app/api/crews/all/route.ts:26`) | `AGENTS.md:55` заявляет «lint baseline is zero warnings», фактически 7 (exit 0). | Не дефект пакета (ни один файл предупреждений не менялся), но описание baseline расходится с реальностью. Совпадает с R160 №10 / MR-CHECK №11. | Либо почистить предупреждения, либо поправить строку в AGENTS.md. |
| 11 | мелочь | `docs/audits/hermes-night/R173-tests-evidence-blindspots.md` | Сводка «5 важно / 9 мелочь» расходится с таблицей «6 / 8». | Численные расхождения в отчёте затрудняют сверку. (Codex, `reviewed.txt:638`.) | Согласовать счётчики. |
| 12 | мелочь | `src/components/piling/to/__tests__/to-module-shell.test.tsx:23` | `vi.mock('@/lib/api', () => ({ authFetch }))` неполон: `to-module`/`use-reports-data` импортируют ещё `loadJson`/`isAbort`; соответствующие ветки в тесте мертвы. | Пробел доказательства (R173 №2/№3): «снимок есть» и неуспешные ветки чтения не исполняются. | Расширить mock до реальной границы `fetch` (в существующем тест-файле). |
| 13 | мелочь | `docs/audits/hermes-night/R161-selected-source-regression.md` | Отчёт объявляет «доказательный NO-COMMIT, новый фикс не требуется», хотя дефект `journalError→records` на месте (находка 1). | Ложноположительное закрытие вводит в заблуждение приёмку; уже отклонено Codex. | Переоткрыть R151 №3 как незакрытый; завести узкую follow-up правку. |

Положительные подтверждения (не находки, регрессий нет): `use-reports-data.ts` действительно гасит
поколение/догрузку при смене отбора и повторном вызове в одном тике (`:217-227,310-365`); карточка и
журнал грузятся раздельно, `loadAttempts` исключает цикл (`to-module.tsx:606-650`); `pdf-generator/format.ts`
не отвергает поддерживаемый валидный вход `ГГГГ-ММ-ДД` (только строгая форма); эффект `F-N1004-DEFECT-REFRESH`
привязан к `snapshotId`, а не к каждому тику `loading`.

## Кандидат / отклонён / не проверено

- **Кандидат (принято как результат):** 10 code-коммитов F-N1004 + 13 отчётов R161–R173. Ничего не слито,
  не выкачено.
- **Отклонён:** вывод R161 о полном закрытии (находка 13/1); Парето-«нет причин» в «Отчётах» как
  поведение, соответствующее заданию (находка 2).
- **Не проверено:** браузерная приёмка UI и Playwright-прогон (см. «Не проверено»); реальные данные
  готовности в БД; полный набор skipped-тестов; соответствие предупреждений сборки (bullmq/Sentry)
  продовой конфигурации.

## Не проверено

- **Браузер (desktop и 375px) — BLOCKED.** Порт `:3000` обслуживает PID 13980 =
  `D:\PillingR\my-project\node_modules\next\dist\server\lib\start-server.js`, т.е. **другую** рабочую копию,
  не `wt-night`/`hermes/q4-0926`. Свой сервер из `wt-night` не поднимал: нужны `.env` и БД, про которую
  нельзя утверждать, что она локальная, а не боевая (правило про `.env`/production). Ни одного UI-сценария
  (предупреждение журнала, Парето при отказе, колонки отчётов, тон блокеров) визуально не подтверждаю —
  только статикой и существующими тестами.
- **Playwright-прогон** не запускался (только `--list` = 99/11); реальные аккаунты владельца не
  использовались.
- **Реальные данные/снимки готовности** — БД не открывал; ветка `to-module.tsx:686` («снимка нет»)
  логическая, а не подтверждённая на данных.
- **`npm run test:unit` — 2 skipped файла / 39 skipped тестов**: какие именно, не разбирал (вне scope);
  подозрение на интеграционные/контрактные спеки без `.env`.
- **Причина предупреждений сборки** (`@valkey/valkey-glide`, `SENTRY_AUTH_TOKEN`) — вне scope пакета;
  влияние на продукт не оценивал.
- **`impact` по изменённым символам** на свежем индексе даёт завышенный радиус (находка 6) — истинную
  цепочку вызовов я подтверждаю лишь текстовым поиском, не графом.
