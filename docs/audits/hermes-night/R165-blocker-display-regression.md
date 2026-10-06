# R165 — Приёмка тона и числа блокеров на административных вкладках техготовности

READ-ONLY. Существующие файлы не менялись, тесты и код не создавались; создан только этот документ.
Рабочая копия `D:\PillingR\wt-night`, ветка `hermes/q4-0926` (не переключалась), на входе `git status` —
чисто. push/merge/deploy/SSH/боевая БД не выполнялись, `.env*` не читались и не создавались.
Замороженные зоны (варианты экрана оператора, ORION, `src/modules/operator-mobile/**`) не открывались.

Область: тон и счётчик блокеров на вкладках «Техническая готовность» — «Центр готовности»
(`readiness-centre.tsx`), «Готовность парка» (`fleet-screen.tsx` / `fleet-workspace-model.ts` /
`fleet-evidence-panel.tsx`), «Отчёты» (`reports-screen.tsx`) и «Настройки → Правила готовности»,
блок «Предпросмотр расчёта готовности» (`settings-workspace.tsx`). Сверены действия
`DENY_START`, `RETURN_TO_OPERATOR`, `REQUIRE_CONFIRMATION` и неизвестное/пустое действие.

## Итог

- Находок **9**: **критично — 0**, **важно — 3**, **мелочь — 6**. Плюс **3 подтверждения** (закрытия и
  положительные проверки). Потери данных нет; всё — тон, подпись и счётчик на экране. Доменный допуск
  (`status`/`canStart`/`verdict`) нигде не менялся и правки не требует.
- **Центр готовности и парк — верно.** Плитка «Замечания и дефекты», блок «Критические блокеры» и
  панель парка красят блокер по действию через `blockerTone` (`shared.tsx:33-37`): `DENY_START` —
  красный, `RETURN_TO_OPERATOR` — «Требует решения» (оранжевый), `REQUIRE_CONFIRMATION` — «Требует
  подтверждения» (синий), неизвестное — консервативно красный. Остаток MR-CHECK-1004 №3 закрыт
  коммитом `8a913c5e` (F-N1004-BLOCKER-LABELS), регрессии нет.
- **Остатки найдены на «Отчётах» и в «Предпросмотре»** — там домен всё ещё схлопнут до «красное/не
  красное» или до двоичного `status`.
- Топ-5:
  1. **важно** — журнал «Отчётов» показывает «Заблокировано» красным для ЛЮБОГО снимка со `status:
     BLOCKED`, а туда попадают и `RETURN_TO_OPERATOR`, и `REQUIRE_CONFIRMATION` (`reports-screen.tsx:214-216`;
     `evaluator.ts:93`). Доступный полный вердикт `snapshot.verdict` не читается.
  2. **важно** — «Предпросмотр расчёта готовности» красит блокеры и итоговую плашку красным для всех,
     кроме `WARN_ONLY`: «Вернуть оператору» и «Требовать подтверждение» выходят красными
     (`settings-workspace.tsx:599-611,635-638`), тогда как центр для тех же исходов даёт оранжевый/синий.
  3. **важно** — «Причины блокировки · Парето» в «Отчётах» считает по сырым фактам, игнорируя правила и
     действие: строки «Наряд-допуск», «Просрочено ТО», «Приёмка не подтверждена» показаны как причины
     блокировки, хотя по `DEFAULT_READINESS_RULES` они не запрещают пуск (`reports-screen.tsx:254-260`).
  4. **мелочь** — на той же вкладке «Настройки» таблица правил и список «Что сейчас действует» красят
     `RETURN_TO_OPERATOR`/`REQUIRE_CONFIRMATION` красным (`settings-workspace.tsx:428,444-446,513`).
  5. **мелочь** — плитка парка «Требует внимания» объединяет «Готова с замечанием» и «Требует решения»
     (`fleet-workspace-model.ts:66-68`), счёт и подпись описывают разные категории (повтор R141 №15).

## Матрица «действие → тон» по вкладкам

| Место (path:line) | DENY_START | RETURN_TO_OPERATOR | REQUIRE_CONFIRMATION | неизвестное / null |
|---|---|---|---|---|
| Центр — блок «Что держит допуск», счётчики (`readiness-centre.tsx:33-51,224-242,786-788,905`) | красный | оранжевый «Требует решения» | синий «Требует подтверждения» | красный (консервативно) |
| Парк — группа и панель (`fleet-workspace-model.ts:66-68`; `fleet-evidence-panel.tsx:130-136`) | группа «Заблокировано» + красный в панели | группа «Требует внимания» + оранжевый в панели | группа «Требует внимания» + синий в панели | красный |
| Отчёты — журнал снимков (`reports-screen.tsx:214-216`) | «Заблокировано» красный | **«Заблокировано» красный ✗** | **«Заблокировано» красный ✗** | «Заблокировано» красный (по `status`) |
| Отчёты — Парето (`reports-screen.tsx:254-260`) | факт «Критический дефект» | факт «Нет осмотра за сегодня» | — | — |
| Предпросмотр — список блокеров и плашка (`settings-workspace.tsx:599-611,635-638`) | красный | **красный ✗** | **красный ✗** | красный |
| Настройки — таблица правил (`settings-workspace.tsx:428,444-446,513`) | красный | **красный ✗** | **красный ✗** | красный |

## Методика

Воспроизводимо чтением кода, `git` и прогоном существующих проверок. Python нет (Windows, `node`).
Рантайм (браузер, приложение, БД) не поднимался.

1. Прочитан `AGENTS.md` (модель доверия, заморозка, «выглядит мёртвым, но живёт»).
2. Домен: `src/modules/readiness/domain/readiness-rules.ts` (весь, включая `BLOCKER_ACTIONS:36-44`,
   `BLOCKER_LABELS:46-65`, `SYSTEM_SAFETY_BLOCKERS:96-104`, `DEFAULT_READINESS_RULES:146-202`),
   `domain/readiness-score.ts` (весь: `ACTION_VERDICT:109-115`, `blockers:206-213`, `criticalBlockers:224`,
   `resolveReadinessOutcome:91-100`, `OUTCOME_LABELS:84-89`), `domain/evaluation/evaluator.ts` (весь —
   двоичный `status:93`, сплит WARN_ONLY:86-89).
3. Экраны: `readiness/screens/shared.tsx` (`blockerTone:33-37`, `BLOCKER_TONE_CLASS:40-44`,
   `BLOCKER_TONE_LABEL:47-51`), `readiness-centre.tsx` (открыт по фрагментам 200-319, 320-444, 440-559,
   560-759, 760-999, 1000-1156), `fleet-screen.tsx`, `fleet-workspace-model.ts`, `fleet-evidence-panel.tsx`
   (целиком), `reports-screen.tsx` (160-239, 220-339, 340-499), `settings-workspace.tsx` (184-644),
   `maintenance-screen.tsx` (45-159), `blocker-guidance.ts`.
4. Представление из снимка: `readiness/authoritative-presentation.ts` (весь), `readiness/api/contracts.ts`
   (`verdict:261`, схемы блокеров:246-254).
5. Поиск остатков: `grep -rn "blockerTone|BLOCKER_TONE_LABEL|BLOCKER_TONE_CLASS|BlockerTone"`,
   `grep -rn "criticalBlockers"`, `grep -rn "Критическ"`, `grep -rn "WARN_ONLY|advisory|action ==="`,
   `grep -rn "RETURN_TO_OPERATOR|REQUIRE_CONFIRMATION|DENY_START"` по `src/components/piling/to`.
6. Мёртвый набор экранов: `grep -rn "readiness-design-views|readiness-model"` — `readiness-design-views.tsx`
   импортируется только как тип (`maintenance-screen.tsx:16`, `types.ts:6`, `to-module.tsx:17`).
7. История и сверка: `git log --oneline -40`, `git log --oneline --all | grep -i "BLOCKER|R141"`,
   `git show 8a913c5e` (F-N1004-BLOCKER-LABELS, полный дифф). Прошлые отчёты: `R141-readiness-board.md`,
   `R143-readiness-preview-parity.md`, `R164-preview-state-regression.md`, `R163-error-attribution-matrix.md`,
   `MR-CHECK-1004.md`, `32-exports.md`.
8. Проверки §6 AGENTS.md — отдельными командами, реальные exit-коды (см. «Не проверено»).
9. GitNexus `impact` не запускался: символов не менял. `detect-changes` — см. «Не проверено».

## Находки

| # | важность | path:line | проблема | сценарий / почему важно | что предложить |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/to/readiness/screens/reports-screen.tsx:214-216` против `src/modules/readiness/domain/evaluation/evaluator.ts:93` | Журнал снимков строит исход как `snapshot.status === 'READY' ? {Готово, success} : {Заблокировано, danger}`. `status` — двоичная проекция (`canStart ? READY : BLOCKED`), поэтому `RETURN_TO_OPERATOR` и `CONFIRMATION_REQUIRED` дают `status: BLOCKED` и рисуются «Заблокировано» красным. Полный вердикт `snapshot.verdict` (есть в DTO, `contracts.ts:261`) не читается. | Диспетчер открывает журнал за период: машину, которую правила лишь «вернули оператору» на незакрытый осмотр, экран называет «Заблокировано» красным — тем же словом, что и запрет пуска. На «Центре» и в парке та же оценка — «Требует решения» (оранжевый). Два экрана по одному снимку дают разный тон и разное слово. | Считать исход по `snapshot.verdict` + число замечаний (как `authoritative-presentation.ts:297-301` / `resolveReadinessOutcome`): READY / «Готово с замечанием» / «Требует решения» / «Заблокировано» с соответствующим тоном. |
| 2 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:599-611,635-638` | Предпросмотр: `advisory = blocker.action === 'WARN_ONLY'` — блокер красный для всех прочих действий, включая `RETURN_TO_OPERATOR` и `REQUIRE_CONFIRMATION` (`:604-605`). Итоговая плашка «Результат» красится `preview?.canStart ? success : destructive` (`:635-638`), то есть «Возврат оператору» и «Требуется подтверждение» — красные. `blockerTone` здесь не используется. | Админ включает правило «Нет осмотра за сегодня» (RETURN_TO_OPERATOR) и видит в предпросмотре красный блокер и красную плашку «Возврат оператору», тогда как на «Центре» тот же исход — «Требует решения» (синий). Он либо считает правило запретом пуска, либо теряет доверие к предпросмотру. R143 №11/R164 №3 уже отмечали отсутствие теста предпросмотра. | Взять тон из `blockerTone`/`BLOCKER_TONE_CLASS`, а плашку считать по `resolveReadinessOutcome({verdict, warningCount})`, как на доске. |
| 3 | важно | `src/components/piling/to/readiness/screens/reports-screen.tsx:254-260` | «Причины блокировки · Парето» собирает `blockerRows` из сырых `facts` (`criticalDefect`, `!inspectionCompleted`, `permitValid===false||permitExpired`, `maintenanceOverdueHours>0||days>0`, `!accepted`) и не смотрит ни на `snapshot.blockers`, ни на действие активных правил. По `DEFAULT_READINESS_RULES:146-202` наряд не нужен (веса 0, правила выключены), просрочка ТО — `WARN_ONLY`, а `ACCEPTANCE` блокером не является вовсе. Легенда диаграммы при этом — «Количество блокировок». | Ночной отчёт: наряд не оформлен у N машин, ТО просрочено у M — Парето ставит их в «причины блокировки» и рисует столбцы, хотя запуск они не держат. На «Центре» блокеров по этим правилам нет вовсе. Счёт на аналитике противоречит снимку, по которому тот же экран строкой выше печатает причины через `describeBlockers(snapshot.blockers)` (`:211`). R141 №9 (переименование «Осмотр») закрыт — это другой дефект. | Считать по `snapshot.blockers` (как журнал того же экрана) либо из `facts` с оговоркой действия: столбец — только условия, которые по опубликованным правилам дают `DENY_START`; `WARN_ONLY` и не-блокеры выводить отдельной строкой «предупреждения». |
| 4 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:513` | Список «Что сейчас действует»: значок правила окрашен `rule.action === 'WARN_ONLY' ? warning : destructive` — `RETURN_TO_OPERATOR` и `REQUIRE_CONFIRMATION` получают тот же красный, что `DENY_START`. | Админ читает список действующих правил: «Нет осмотра за сегодня — вернуть оператору» стоит красным, как «Критический дефект — запретить запуск». Действия домен различает, а настройки — нет. | Тот же `blockerTone(rule.action)`, что и на доске («Требует решения»/«Требует подтверждения»). |
| 5 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:428,444-446` | Таблица «Блокеры и предупреждения»: значок и стиль селекта действия тоже `advisory ? warning : destructive` — все действия, кроме `WARN_ONLY`, красные. | Рядом с `DENY_START` строка `RETURN_TO_OPERATOR` не отличается по цвету; админ не видит, что правило мягче. | Ветвить на `RETURN_TO_OPERATOR`→attention и `REQUIRE_CONFIRMATION`→info, как `BLOCKER_TONE_CLASS`. |
| 6 | мелочь | `src/components/piling/to/readiness/screens/fleet-workspace-model.ts:66-68`; `fleet-screen.tsx:131-137`; `fleet-workspace-model.ts:26-28` | Плитка парка «Требует внимания» объединяет исходы `READY_WITH_WARNING` (готова с замечанием) и `ATTENTION` (требует решения) в одну группу `attention`. Счётчик плитки и подпись строки (`presentation.title` = `OUTCOME_LABELS`) описывают разные категории; центр их различает. **Повтор R141 №15** (не закрыт). | Машина с одним лишь `WARN_ONLY`-замечанием и машина с `RETURN_TO_OPERATOR` попадают в один счёт «Требует внимания», и непонятно, что именно отфильтрует плитка. | Либо развести группы/подписи (как `OUTCOME_LABELS`), либо в подписи плитки перечислить оба исхода. |
| 7 | мелочь | `src/components/piling/to/readiness/screens/readiness-centre.tsx:786-788` | «Критические блокеры» выводится всегда, а «Требует решения»/«Требует подтверждения» — только при `> 0`. При единственном `RETURN_TO_OPERATOR` на экране рядом «Критические блокеры 0» и «Требует решения 1». | Не ошибка счёта, но «Критические блокеры 0» рядом с ненулевым блокером читается как «блокеров нет». MR-CHECK-1004 №3 рекомендовал нейтральное слово; `8a913c5e` оставил «Критические блокеры» (теперь это честно счёт `DENY_START`). | Либо нейтральное «Блокеры» с разбивкой по тону, либо прятать нулевую строку, как соседние. |
| 8 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:598-616` против `src/modules/readiness/domain/readiness-score.ts:206-213` и `evaluator.ts:86-89` | Раздел предпросмотра назван «Блокеры», но `computeReadinessScore(...).blockers` включает и сработавшие правила `WARN_ONLY` (фильтр только `isActive && triggered`). Сервер те же записи выносит в `warnings` (`evaluator.ts:86-89`). | Админ включает правило с действием «Предупредить» — оно появляется в предпросмотре под заголовком «Блокеры», хотя на «Центре» то же правило лежит в «Замечаниях» и работу не останавливает. | Делить на блокеры/замечания по действию (как в снимке) или назвать раздел «Правила, которые сработали». |
| 9 | мелочь | `src/components/piling/to/readiness-design-views.tsx:410,523-530` | Мёртвый альтернативный набор экранов: плитка «Критические дефекты» и зашитый список правил «Осмотр текущей смены … Ремонт и неисправности» с подписью «Блокирует» у всех пяти — расходится с действующими правилами. Импортируется только как тип (`maintenance-screen.tsx:16`, `screens/types.ts:6`, `to-module.tsx:17`). **Повтор R141 №18** (кандидат на удаление отдельной задачей, read-only). | Если набор когда-нибудь подключат, он покажет «блокирует» там, где правила `WARN_ONLY`/выключены. Сейчас на живые экраны не влияет. | Не трогать в этой задаче; вынести решение об удалении владельцу. |

### Проверено — регрессии нет (не переоткрываю)

- **Центр готовности** (`readiness-centre.tsx:224-242,293,474,533,546,786-788,905`): счёт и цвет идут
  через `countBlockersByTone`/`blockerTone`; `returnToOperator`/`requireConfirmation` не красные,
  неизвестное действие — консервативно красное и покрыто тестом
  (`screens/__tests__/readiness-centre.test.tsx:266-331`, все четыре сценария). **MR-CHECK-1004 №3
  закрыт** коммитом `8a913c5e`.
- **Парк** (`fleet-workspace-model.ts:63-68`; `fleet-evidence-panel.tsx:130-136`): группа `blocked`
  только для исхода `BLOCKED`, панель красит по `blockerTone`; тесты
  (`fleet-screen.test.tsx:220-239`) подтверждают «возврат оператору — не запрет пуска».
  **R141 №2 закрыт** коммитом `8080f369`, дополнен `8a913c5e`.
- **Отчёты — журнал**: строка причины читается из авторитетного снимка (`reports-screen.tsx:211`,
  `describeBlockers(snapshot.blockers)`), а не из производной модели — **R141 №9 закрыт**
  коммитом `394246a1`.
- `status`/`canStart`/`verdict` и сами условия допуска нигде не меняются — во всех находках правится
  только тон/подпись/источник счёта.

## Не проверено

- **Рантайм не воспроизводился**: браузер/Playwright в сессии не поднимались, приложение и БД не
  открывались, реальные снимки `CurrentReadiness` не читались. Все выводы и числовые примеры — из кода
  ветки. Визуальную вёрстку предпросмотра, журнала и Парето на desktop и 375px не смотрел.
- **Содержимое БД** (`readinessRuleSet`, реальные `blockers`/`verdict` снимков) не смотрел — read-only
  запрещает подключаться к БД. Находка 3 сформулирована по `DEFAULT_READINESS_RULES`; в проде `orion`
  правила опубликованы и могли быть переопределены через настройки — частоту не измерял.
- **Отдельного поведенческого теста блока предпросмотра нет** (строковый `readiness-reference-authority.test.ts`);
  находки 2 и 8 тестами не покрыты — это R143 №11/R164 №3, здесь только подтверждено.
- **GitNexus `impact` не запускал**: символов не менял. `detect-changes --scope all` выполню перед
  коммитом; правится только этот `.md`, поэтому ожидается «No changes detected», `partial/truncated` не
  ожидается.
- **Проверки §6 AGENTS.md — результаты** (каждая команда отдельно, exit-код из самого процесса):
  - `.next/dev/types` сначала проверен (`ls -d`) — каталога нет, `rm -rf` не требовался.
  - `npx tsc --noEmit` → **exit 0**.
  - `npm run lint` → **exit 0**, **7 warning** (0 errors), все в не изменявшихся файлах:
    `src/app/api/crews/all/route.ts:26`,
    `tests/integration/{rls-tenant-enforcement,tech-readiness-projection,tech-readiness-shifts,tech-readiness-work-permits}.spec.ts`.
    AGENTS заявляет базовый ноль warning — расхождение предсуществующее.
  - `npm run test:unit` → **exit 0**: Test Files **341 passed | 2 skipped (343)**, Tests
    **3249 passed | 39 skipped (3288)**.
  - `npx playwright test --list` → **exit 0**: **99 тестов в 11 файлах** (счёт не просел).
  - `npm run build` → **exit 0** (предупреждения: `SENTRY_AUTH_TOKEN not set` — исходные карты Sentry;
    `@valkey/valkey-glide` в `../my-project/node_modules/bullmq` — соседняя копия, не связано).
- **E2e-прогон не запускался** (только `--list`): требуются сервер и учётные данные, боевые аккаунты
  владельца не использовались.
