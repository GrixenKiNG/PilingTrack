# R74 — Карта версий рабочего места машиниста

Read-only разбор. Ветка `hermes/q4-0926`, worktree `D:\PillingR\wt-night`, HEAD `28663d03`.
Ни один существующий файл не изменён; создан только этот отчёт. Приложение не запускалось,
запросы не отправлялись, база не читалась и не писалась. Замороженные области (варианты экрана
оператора, ORION) только читались.

## Итог

- Находок: **19** — критично **2**, важно **7**, мелочь **10**.
- Сегодня в бою машинист после входа попадает **только на `/operator` (v1)**: адрес входа задан
  одной константой `OPERATOR_HOME_ROUTE = '/operator'` (`src/lib/routes.ts:15`), её же
  отдают корень (`src/app/page.tsx:23`) и вход (`src/app/(auth)/login/page.tsx:15`), и только
  `/operator` есть в меню машиниста (`src/components/piling/icons/role-navigation.ts:34`).
  Остальные восемь маршрутов — «тёмные»: ни одной ссылки в интерфейсе у них нет.
- Ни на одной из девяти страниц **нет проверки роли** — роль режет только API
  (`src/app/api/operator/mobile/state/route.ts:22`), и это ровно причина дефекта QA
  D-20260930-004 про v2: у v2 нет даже этого, потому что его основной источник
  `/api/operator/shift/route.ts:15-24` роли не проверяет вовсе (#4).
- Два маршрута — `/operator/module` и `/operator/tabs` — это редиректы на статический прототип,
  который лежит в `.gitignore` (`public/prototypes/`, `.gitignore:137`). Папки `operator-module`
  нет даже локально, то есть `/operator/module` не открывается нигде (#2, #3).
- Топ-5:
  1. v2 при зависшей сдаче смены (`HANDOVER_PENDING`) отдаёт конечный экран без кнопок, и новую
     смену начать нельзя — D-20260930-001 (#1, критично).
  2. `/operator/module` и `/operator/tabs` ведут в статику, которой нет ни в репозитории, ни
     локально (#2, #3).
  3. Исправление «403 показывается как „Нет связи с сервером“» (D-20260930-003) живёт **только в
     этой ветке**; в `origin/main` (= выкаченная сборка) его нет (#6, #7).
  4. У v2 нет отказа по роли: диспетчер/админ открывают экран в админской оболочке (#4).
  5. v5/v7/v10 живут вне группы `(app)` — в них нет ни кнопки выхода, ни кнопки обратной связи,
     ни баннера «Действую как» (#18).
- Удалять ничего нельзя (AGENTS.md §1): всё ниже — карта для выбора, не план удаления.

## Методика

Что открывал и как повторить (все команды из корня worktree, Git Bash):

- Перечень маршрутов: `find src/app/operator "src/app/(app)/operator" -type f | sort`;
  `find src/app -type d -name "operator*"`. Маршрута `/operator/next` нет ни в этой ветке, ни в
  `origin/main` (`git ls-tree -r --name-only origin/main src/app/operator` — девять строк, среди
  них `next` отсутствует).
- Страницы и корневые компоненты прочитаны целиком: `src/app/(app)/operator/page.tsx` (26 строк),
  `(app)/operator/v2/page.tsx`, `(app)/operator/v3/page.tsx`, `(app)/operator/v3/report/page.tsx`,
  `src/app/operator/v5/page.tsx`, `src/app/operator/v7/{page,safety/page,history/page,assistant/page}.tsx`,
  `src/app/operator/v10/page.tsx`, `src/app/operator/{module,tabs}/page.tsx`.
- Вход по роли: `src/lib/routes.ts` (полностью), `src/app/page.tsx`, `src/app/(auth)/login/page.tsx`,
  `src/components/piling/icons/role-navigation.ts` (полностью), `e2e/role-audit.spec.js:6`.
- Ссылки на версии: `grep -rln "operator/v2\|operator/v3\|operator/v5\|operator/v7\|operator/v10\|operator/module\|operator/tabs" src/ e2e/ tests/ scripts/`
  (12 файлов, из них не-комментарии — только `(app)/layout.tsx:49-50`, `operator-layout-policy.ts:15`,
  сами страницы v3/v5/v7/v10 и внутренние ссылки v7).
- Проверка роли: `grep -rn "requirePageAbility" src/app --include=*.tsx` (только админские layout'ы;
  ни одного под `operator`), плюс чтение `src/app/(app)/layout.tsx` (полностью),
  `src/app/(app)/operator-layout-policy.ts`, `src/proxy.ts` (в матчере middleware оператора нет).
- API версий: чтение `src/components/piling/operator-mobile/api.ts` (полностью) и
  `grep -rn "'/api/\|\`/api/"` по компонентам каждой версии; маршруты —
  `find src/app/api/operator -type f`, `grep -n "role"` по `state`, `command`, `shift`.
- QA: `node -e "require('D:/PillingR/qa/defects.json')"` — выгрузка id/уровень/состояние/версия/заголовок
  по всем 15 записям; `D:/PillingR/qa/owner-decisions.md` (пять версий в прогоне) и `progress.csv`
  (сборки и версии по дням).
- Объём и тесты: `find <dir> -name "*.ts*" ! -path "*__tests__*" ! -name "*.test.*" -exec wc -l {} +`,
  `grep -cE "^\s*(it|test)\("` по каждому тест-файлу.
- Бой: сравнение `git show origin/main:<файл>` с рабочей копией — `grep -n "forbidden\|403\|Нет связи"`
  по v5/v7/v10 из `origin/main`; `git ls-tree -r --name-only origin/main public/prototypes` (пусто);
  `git rev-list --count origin/main..<commit>` = 56/59 (правки 403 не в бою).
- Заморозка соблюдена: файлы операторских вариантов только читались.

## 1. Карта маршрутов

| Маршрут | Файл страницы | Корневой компонент | Объём (строк) | Тесты | Ссылки на него в UI |
|---|---|---|---|---|---|
| `/operator` (v1, боевой) | `src/app/(app)/operator/page.tsx:20-25` | `OperatorMobileApp` — `src/components/piling/operator-mobile/operator-mobile-app.tsx` (587) | 26 + 587; общий мобильный слой без v7/v10 и тестов — 6170 | 9 общих тест-файлов / 36 тестов; 4 e2e-спека | меню (`role-navigation.ts:34`), вход (`routes.ts:15`) |
| `/operator/v2` | `src/app/(app)/operator/v2/page.tsx:9-12` | `OperatorShiftV2` — `src/components/piling/operator-v2/operator-shift-v2.tsx` (1256) | 2371 (6 файлов) | 2 файла / 5 тестов | нет |
| `/operator/v3` | `src/app/(app)/operator/v3/page.tsx:11-13` | `OperatorDashboardV3` — `src/components/piling/operator-v3/operator-dashboard-v3.tsx` (199) | 199 (+10 страница отчёта) | **0** | только подмена пункта «Смена» в `(app)/layout.tsx:49-50`, когда вы уже на v3 |
| `/operator/v3/report` | `src/app/(app)/operator/v3/report/page.tsx:7-9` | общая админская `ReportForm` | 10 | 0 | из v3 (`operator-dashboard-v3.tsx:93`) |
| `/operator/v5` | `src/app/operator/v5/page.tsx:31-37` | `OperatorV5App` — `src/components/piling/operator-v5/operator-v5-app.tsx` (1312) | 1312 + 2 css | 1 файл / 9 тестов | нет |
| `/operator/v7` | `src/app/operator/v7/page.tsx:19-25` | `OperatorV7App` — `src/components/piling/operator-mobile/v7/operator-v7-app.tsx` (568) | 2996 (8 файлов) | 2 файла / 6 тестов | нет |
| `/operator/v7/history` | `src/app/operator/v7/history/page.tsx:7-12` | `HistoryV7App` (180) | — | — | из v7 (`v7-screens.tsx:528`) |
| `/operator/v7/safety` | `src/app/operator/v7/safety/page.tsx:7-12` | `SafetyV7App` (289) | — | — | нет |
| `/operator/v7/assistant` | `src/app/operator/v7/assistant/page.tsx:7-12` | `AssistantV7App` (320) | — | — | нет |
| `/operator/v10` | `src/app/operator/v10/page.tsx:18-23` | `OperatorV10App` (1716) + `v10-ui.tsx` (197) | 1913 | 2 файла / 19 тестов | нет |
| `/operator/module` | `src/app/operator/module/page.tsx:12-13` | — (редирект на `/prototypes/operator-module/index.html`) | 14 | 0 | нет |
| `/operator/tabs` | `src/app/operator/tabs/page.tsx:11-12` | — (редирект на `/prototypes/operator-tabs/index.html`) | 13 | 0 | нет |
| `/operator/next` | **нет** | — | — | — | — |

Общий бэкенд всех мобильных версий — `src/modules/operator-mobile` (38 файлов, 7412 строк,
тесты — 89 тестов в 9 файлах). Путь отхода (не смонтирован): `src/components/piling/operator-dashboard.tsx`
(603 строки) + `src/components/piling/operator/` (642 строки, 5 файлов) — по AGENTS.md §4 должны остаться.

## 2. Вход машиниста после логина

- `src/lib/routes.ts:15` — `export const OPERATOR_HOME_ROUTE = '/operator';`
- `src/lib/routes.ts:29-36` — `roleHomeRoute`: `OPERATOR` (и любая роль, не попавшая в список)
  → `OPERATOR_HOME_ROUTE`; `ASSISTANT` → `/assistant`; `ADMIN`/`DISPATCHER`/`FOREMAN` → `/admin`;
  `MECHANIC`/`SAFETY_ENGINEER` → `/admin/to`.
- Два потребителя: серверный корень `src/app/page.tsx:23` и клиентский вход
  `src/app/(auth)/login/page.tsx:15`. Обе точки используют одну функцию — разойтись не могут.
- Значит, ни v2, ни v3, ни v5/v7/v10 после входа не открываются: чтобы их увидеть, адрес набирают руками.

## 3. Ссылки на версии из меню и других экранов

- Меню машиниста — три пункта, все не версионные: `Смена → /operator`, `ТБ и допуски → /admin/safety`,
  `История → /history` (`src/components/piling/icons/role-navigation.ts:33-41`; сторож —
  `src/components/piling/icons/__tests__/role-navigation.test.ts:25-29`, он прямо сверяет
  `[OPERATOR_HOME_ROUTE, 'home']`).
- Единственное упоминание версии в интерфейсе — подмена домашней ссылки на текущую версию:
  `src/app/(app)/layout.tsx:49-50` (`if href === '/operator' && pathname.startsWith('/operator/v3') → '/operator/v3'`).
  Работает только тогда, когда человек уже на v3.
- Внутренние ссылки v7 (на самого себя и на v1): `v7-screens.tsx:528` → `/operator/v7/history`,
  `operator-v7-app.tsx:416` (метка «PilingTrack»), `v7-screens.tsx:537` → кнопка
  «Рабочий экран машиниста» → `/operator`. Последнее — прямое признание в коде, что рабочий экран v1.
- Больше нигде (админка, квитанции, письма, e2e-фикстуры) ссылок на `/operator/v2|v3|v5|v7|v10`
  нет — проверено сплошным поиском по `src/`, `e2e/`, `tests/`, `scripts/`.

## 4. Проверка роли на уровне страницы

Проверки роли **нет ни на одной** странице операторских маршрутов: все девять page-файлов —
это либо `'use client'` + рендер компонента, либо `redirect(...)`. `requirePageAbility`
(`src/lib/require-page-ability.ts:6-10`) применён только в админских разделах
(`src/app/(app)/admin/*/layout.tsx`), а у операторских маршрутов нет даже `layout.tsx`
(`find src/app/operator "src/app/(app)/operator" -name layout.tsx` — пусто).

Роль режет сервер:

| Маршрут API | Проверка роли | Строка |
|---|---|---|
| `GET /api/operator/mobile/state` | `user.role !== 'OPERATOR'` → 403 «Экран доступен только машинисту» | `src/app/api/operator/mobile/state/route.ts:22-24` |
| `POST /api/operator/mobile/command` | `user.role !== 'OPERATOR'` → 403 «Команды смены подаёт машинист» | `src/app/api/operator/mobile/command/route.ts:186-188` |
| `GET /api/operator/shift` | **нет** (только `requireAuth` + `requireTenantId`, id из сессии) | `src/app/api/operator/shift/route.ts:15-24` |
| `GET /api/safety/my-clearance` | **нет** (отдаёт только «о себе») | `src/app/api/safety/my-clearance/route.ts:20-28` |
| `GET /api/assistant/state`, `POST /api/assistant/command` | `user.role !== 'ASSISTANT'` → 403 | `src/app/api/assistant/state/route.ts:22`, `command/route.ts:39` |

Как разные версии показывают отказ по роли (403):

| Версия | Полноэкранный отказ «не для вашей роли» | Файл:строка |
|---|---|---|
| v1 `/operator` | да (`forbidden`) | `operator-mobile-app.tsx:70,125-127,202-208` |
| v2 `/operator/v2` | **нет** — текст ложится в `mobileError` внутри шага | `operator-shift-v2.tsx:325-331, 790` |
| v5 | да | `operator-v5-app.tsx:894,921-923,1089-1093` |
| v7 | да | `operator-v7-app.tsx:69,104-106,192-197` |
| v10 | **нет отдельного состояния** — 403 приходит как общая ошибка загрузки | `operator-v10-app.tsx:1432-1450,1657` |
| v3 | нет вовсе (роль нигде не проверяется, данные приходят из `/api/sites`, `/api/reports/my`) | `operator-dashboard-v3.tsx:46-49` |

Это и есть содержание QA-дефекта D-20260930-004 («v2 открывается любой роли без объяснения,
в v1 и v10 экран закрыт»): у v2 нет ни страничного гейта, ни отдельного состояния отказа, а
`/api/operator/shift` роли не проверяет, поэтому оболочка экрана рисуется для диспетчера и мастера,
и вдобавок внутри админской раскладки (`src/app/(app)/layout.tsx:270-289`).

## 5. Какие API использует версия

| Версия | Свой контур | Общий мобильный контур |
|---|---|---|
| v1 | `/api/media` (снимки), `/api/operator/knowledge-attempt` (через `screens/knowledge-screen.tsx`) | `GET /api/operator/mobile/state`, `POST /api/operator/mobile/command` — `operator-mobile/api.ts:57,134` |
| v2 | `GET /api/operator/shift` (`operator-shift-v2.tsx:315`), `GET/POST /api/readiness/defects` (`defect-sheet.tsx:54`) | те же `state`/`command` (`operator-shift-v2.tsx:63,327`) |
| v3 | **полностью свой**: `GET /api/sites?userId=`, `GET /api/reports/my?userId=` (`operator-dashboard-v3.tsx:47-48`); мобильный контур не использует | — |
| v5 | — | `state`/`command` (`operator-v5-app.tsx:20,915`) |
| v7 | `GET /api/reports/my` (история), `GET /api/safety/my-clearance`, `POST /api/assistant/state|command` (подстраница помощника), `/api/operator/knowledge-attempt` | `state`/`command` (`operator-v7-app.tsx:10,91,163`) |
| v10 | `GET /api/safety/my-clearance`, `/api/operator/knowledge-attempt` | `state`/`command` (`operator-v10-app.tsx:21,1435,1509-1601`) |
| module/tabs | нет — статический HTML | — |

Замечание по v3: `userId` уходит в строку запроса (`operator-dashboard-v3.tsx:47-48`), но сервер
сверяет его с сессией (`src/app/api/sites/route.ts:17-21` — `sessionUser` + `requestedUserId`),
то есть сам по себе это не IDOR; но это единственная версия с параметром пользователя в адресе.

## 6. Дефекты QA 27–30.09 по версиям

Источник — `D:/PillingR/qa/defects.json` (15 записей, прочитан только на чтение, состояние на 30.09.2026 07:17).
Общие для всех версий (в таблицу по версиям не дублирую): D-20260930-002 (журнал аудита не пополняется,
средний), D-20260930-007 (дробные метры через точку в выгрузках, средний), D-20260930-009
(лимит входов останавливает прогон, высокий, процесс QA), D-20260929-001 (dev-сервер умер, высокий, процесс).

| Версия | Дефекты |
|---|---|
| v1 `/operator` | D-20260930-005 (низкий, паспорт сваи: кнопка недоступна без подсказки — исправлено в ветке `f4627d6c`), D-20260930-006 (низкий, происшествие без подсказки — исправлено `71520f2c`) |
| v2 | **D-20260930-001 (блокирующий, NEW)** — смена не начинается, тупик на «После работы»; D-20260927-005 (средний) — отчёт сдан, смена висит в `HANDOVER_PENDING`; **D-20260930-004 (средний, NEW)** — открывается любой роли |
| v3 | нет (QA его не проходит: `D:/PillingR/qa/OWNER-DECISIONS.md:6` — «все пять операторских версий»; `progress.csv` — `operator,v2,v5,v7,v10`) |
| v5 | D-20260930-003 (средний) — 403 показывается как «Нет связи с сервером» |
| v7 | D-20260927-001 (высокий) — тупик на закрытии смены, ЕО после работы недостижимо; D-20260930-003 (средний) |
| v10 | D-20260927-002 (средний) — ЕО смешивает предсменные и послесменные чек-листы; D-20260927-003 (низкий) — нет сообщения о завершении допуска; D-20260927-004 (низкий) — окно времени простоя не подсказано |
| module/tabs | нет |

## 7. Что увидит машинист на бою сегодня

Выкаченной считаю сборку `origin/main` = `0a48fa06` (сообщение коммита `f5b01cd3` в этой ветке:
«merge: main (0a48fa06, выкачено 30.09)»; сам `0a48fa06` — «merge: ветка Hermes hermes/q4-0926 до
782ebfe4 в main (команда владельца 29.09: коммит и выкладка)»). На сервер я не заходил — вывод
сделан по репозиторию.

| Что делает машинист | Что происходит на бою |
|---|---|
| Входит | попадает на `/operator` — живой контур смены на общих `/api/operator/mobile/state|command` |
| Набирает `/operator/v2` | экран открывается; при вчерашней несданной смене — тупик «Смена успешно завершена» без кнопок, новую смену начать нельзя (D-20260930-001; подтверждено разбором R71) |
| Набирает `/operator/v3` | открывается экран на **других** данных (`/api/sites`, `/api/reports/my`), кнопки ведут в общую админскую форму отчёта |
| Набирает `/operator/v5` или `/operator/v7` | открывается; при не-операторской роли показывает «Нет связи с сервером» вместо отказа по роли — правки `53b77a22` (v5) и `ebc8afba` (v7) в `origin/main` **не входят** (`git rev-list --count origin/main..ebc8afba` = 56, `..53b77a22` = 59), то есть D-20260930-003 на бою открыт |
| Набирает `/operator/v10` | открывается, работает на живых данных |
| Набирает `/operator/module` | редирект на `/prototypes/operator-module/index.html` — папки нет, ожидается 404 |
| Набирает `/operator/tabs` | редирект на `/prototypes/operator-tabs/index.html` — папка есть только локально и она в `.gitignore`, в сборке из git её нет, ожидается 404 |
| Набирает `/operator/next` | ничего — маршрута нет ни в ветке, ни в `main` |

## 8. Версии, которые не открываются ни по одной ссылке (кандидаты на заморозку; ничего не удалять)

Список полный по результатам сплошного поиска ссылок. «Ссылки нет» = в интерфейсе нет ни пункта меню,
ни кнопки, ни редиректа, ведущего на маршрут; попасть можно только вручную набрав адрес.

| Маршрут | Ссылка в UI | Особое обстоятельство |
|---|---|---|
| `/operator/v2` | нет | самый «богатый» на открытые дефекты (D-20260930-001, -004, D-20260927-005) |
| `/operator/v3` | нет (кроме самоподмены в `(app)/layout.tsx:49-50`) | 0 тестов; `npm run operator:v3:preflight` ссылается на несуществующие артефакты (`package.json:12`, `scripts/operator-v3-preflight.ts:8-33`) |
| `/operator/v5` | нет | две css-темы макета, вне группы `(app)` |
| `/operator/v7` | нет (только сам на себя: history/возврат) | 3 подстраницы; единственная версия, которая ссылается на `/operator` как на рабочий экран |
| `/operator/v10` | нет | 19 тестов — самый покрытый вариант |
| `/operator/module` | нет | цель редиректа отсутствует и локально |
| `/operator/tabs` | нет | цель редиректа не в git |
| `/operator/next` | нет маршрута | упомянут в задаче; в этой ветке и в `main` отсутствует |

## 9. Что сломается, если оставить одну

- **Оставить v1 (`/operator`)** — в приложении не сломается ничего: это единственная версия,
  до которой есть дороги. Потеряется:
  — три подстраницы v7 (`/operator/v7/{history,safety,assistant}`) — таких экранов нет ни у одной
  другой версии;
  — `scripts/operator-v3-preflight.ts` и `docs/design/operator-v3-backend-design.md` (ADR-0047…0050)
  останутся без экрана;
  — 39 тестов, написанных под конкретные версии (v2 — 5, v5 — 9, v7 — 6, v10 — 19); общие 36 тестов
  `operator-mobile` остаются, потому что v1 стоит на том же слое;
  — придётся чинить `(app)/layout.tsx:49-50` и `operator-layout-policy.ts:15`, иначе останутся
  ветки кода про несуществующие маршруты (тест `operator-layout-policy.test.ts:5` уже ссылается на
  несуществующий `/operator/v2/history`).
- **Оставить v2** — сегодня это худший выбор: тупик закрытия смены (#1) и отсутствие отказа по роли (#4).
  Плюс: у v2 **нет** команды `finish-work` (`grep "command: '" operator-shift-v2.tsx` — только
  `report-incident`, `submit-checklist`, `log-production`, `accept-equipment`, `close-shift`),
  то есть контур смены у него свой и к v1 не сводится.
- **Оставить v3** — потеряется весь живой контур смены: v3 не использует `/api/operator/mobile/*`
  и не знает про фазы, допуск, СИЗ, проверку знаний (0 тестов это подтверждают). Это не «одна из
  версий рабочего места», а другой экран.
- **Оставить любую из v5/v7/v10** — машинист теряет кнопку выхода, кнопку обратной связи и баннер
  «Действую как»: их даёт общая раскладка `(app)/layout.tsx:96-106,117`, а эти три версии живут
  **вне** группы `(app)` (`src/app/operator/v5/page.tsx:28-30` — там это прямо написано). Своей
  кнопки выхода в них нет (`grep "logout\|Выйти"` по компонентам v5/v7/v10 — пусто). Плюс у v7
  открыт высокий D-20260927-001, у v10 — три дефекта Д-20260927.
- **Оставить одну версию и вычистить общий слой** — упадёт всё: `src/components/piling/operator-mobile/api.ts`,
  `offline-queue*`, `screens/*`, `operator-work-overview.tsx`, `use-offline-queue.ts` импортируются
  одновременно v1, v2, v5, v7 и v10 (`grep -rn "operator-mobile/\(api\|screens\|offline-queue\)"`).
  Оффлайн-очередь, идемпотентность команд и формы паспорта сваи живут именно там; трогать их можно
  только после выбора версии и отдельной задачей.
- **Удалять сейчас нельзя ничего** (AGENTS.md §1, §4): области заморожены, `OperatorDashboard` —
  объявленный путь отхода, а удаление «мёртвого» уже один раз уносило живые данные.

## Находки

| # | severity | path:line | проблема | сценарий / почему это важно | предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/operator-v2/shift-flow.ts:187-189` | при `facts.shift.state === 'HANDOVER_PENDING'` v2 безусловно возвращает шаг `closed` — до проверок приёмки и передачи; шаг `closed` — конечный экран «Смена успешно завершена» с единственной кнопкой «На главную» | оператор с зависшей сдачей не может ни закрыть смену, ни начать новую (409 по незакрытой смене) — это D-20260930-001; подтверждено разбором R71 (`docs/audits/hermes-night/R71-v2-handover-stuck.md:10-17`) | развести `HANDOVER_PENDING` в шаг «Сдача/приёмка» с двумя действиями: `close-shift`, когда живой передачи нет, и приём передачи, когда есть |
| 2 | критично | `src/app/operator/module/page.tsx:13` | `redirect('/prototypes/operator-module/index.html')`, а `public/prototypes/` в `.gitignore:137` и папки `operator-module` нет даже локально (`ls public/prototypes` → только `operator-tabs`) | маршрут не открывается ни в dev, ни на бою — 404; при этом он выглядит как рабочая ссылка на «модуль оператора из 36 экранов» | либо убрать маршрут, либо вернуть прототип в репозиторий (решение владельца) |
| 3 | важно | `src/app/operator/tabs/page.tsx:12` | тот же редирект на `/prototypes/operator-tabs/index.html`; папка существует только в рабочей копии и не попадает в git (`git check-ignore -v` → `.gitignore:137`) | на бою маршрут отдаёт 404; локально «работает» — расхождение dev/прод будет вводить в заблуждение | держать прототип вне `public/` (в `docs/`) или не обещать маршрут |
| 4 | важно | `src/app/(app)/operator/v2/page.tsx:1-13`, `src/app/(app)/layout.tsx:270-289`, `src/app/api/operator/shift/route.ts:15-24` | у v2 нет проверки роли ни на странице, ни в его основном API; отказ приходит только от `mobile/state` и показывается внутри шага | диспетчер/мастер/механик/инженер ОТ/помощник открывают рабочее место машиниста: админские роли получают его внутри админской оболочки — это D-20260930-004 | добавить страничный гейт (как `requirePageAbility`) или полноэкранный отказ, как в v1/v5/v7; решить, должна ли `/api/operator/shift` проверять роль |
| 5 | важно | `src/components/piling/operator-v2/operator-shift-v2.tsx:325-331,790` | 403 кладётся в `mobileError` и рисуется строкой в теле шага («Читаем ваш допуск…» → текст ошибки); оболочка, вкладки и кнопки остаются | человек видит рабочий экран с непонятной надписью вместо честного «экран не для вашей роли», как в v1/v5/v7 | отдельное состояние отказа по образцу `operator-mobile-app.tsx:202-208` |
| 6 | важно | `src/components/piling/operator-v5/operator-v5-app.tsx` (в ветке `:1089-1093`, в `origin/main` `:1077` — `<h2>Нет связи с сервером</h2>`) | на выкаченной сборке отказ по роли показывается как «Нет связи с сервером»; правка `53b77a22` в `origin/main` не входит | помощник машиниста будет жать «Повторить» до вечера — D-20260930-003; до выкладки ветки дефект на бою живой | выложить ветку (правка уже есть) |
| 7 | важно | `src/components/piling/operator-mobile/v7/operator-v7-app.tsx:96-109`; в `origin/main` ветки обработки 403 нет (`grep "forbidden\|403"` пусто) | то же для v7: без выкладки правки `ebc8afba` 403 выглядит как сбой связи | D-20260930-003 | выложить ветку |
| 8 | важно | `package.json:12` + `scripts/operator-v3-preflight.ts:8-33` | `npm run operator:v3:preflight` требует `src/app/api/operator/v3/workplace/route.ts`, `src/modules/operator-v3/**`, `src/components/piling/operator-v3/forms/**`, `tests/integration/operator-v3-*.spec.ts` — этих путей нет (`ls src/components/piling/operator-v3` → один файл) | команда падает и создаёт ложное представление, что v3 — рабочий контур с бэкендом | пометить скрипт как устаревший или удалить вместе с решением по v3 |
| 9 | важно | `src/app/(app)/layout.tsx:49-50` | единственное место в UI, где версия упоминается: пункт «Смена» подменяется на `/operator/v3`, если текущий путь — `/operator/v3` | v3 нельзя открыть из меню, зато, оказавшись там, человек видит домашнюю ссылку на v3 — то есть «дом» зависит от того, где ты стоишь | убрать подмену, когда версия будет выбрана |
| 10 | мелочь | `src/components/piling/operator-mobile/v10/operator-v10-app.tsx:1432-1450,1657` | v10 не отличает 403 от обрыва сети: текст уходит в общий `loadError`, состояние сбрасывается в `null`, кнопки повтора нет | отказ по роли выглядит как «Состояние смены недоступно» — формально D-20260930-004 засчитал v10 «правильным», но механизм тот же, что у v2 | отдельное состояние `forbidden` |
| 11 | мелочь | `src/app/(app)/operator-layout-policy.ts:15` + `src/app/(app)/__tests__/operator-layout-policy.test.ts:5` | политика и тест знают маршрут `/operator/v2/history`, которого нет (`find src/app -type d -name history` — только под `v7`) | мёртвая ветка кода и тест, охраняющий несуществующий маршрут — при удалении v2 это придётся чистить | убрать из списка |
| 12 | мелочь | `src/components/piling/icons/role-navigation.ts:33-41` + `src/components/piling/icons/__tests__/role-navigation.test.ts:25-29` | меню машиниста ведёт только на `/operator`; ни v2/v3/v5/v7/v10 не имеют пункта | это и хорошо (одна дверь), и плохо: чтобы сравнить версии, надо помнить адреса; тест это фиксирует как контракт | решить судьбу версий, потом менять тест осознанно |
| 13 | мелочь | `src/components/piling/operator-v3/operator-dashboard-v3.tsx:46-49` | v3 — отдельный контур данных: `/api/sites?userId=`, `/api/reports/my?userId=`; `userId` идёт в query (сервер сверяет с сессией — `src/app/api/sites/route.ts:17-21`) | у v3 свои правила и свои цифры; сравнение v3 с v1/v2/v5/v7/v10 «по данным» некорректно | учитывать при сравнении версий |
| 14 | мелочь | `src/app/(app)/operator/v3/report/page.tsx:7-9` | `/operator/v3/report` монтирует общую админскую форму отчёта (`ReportForm`), а не мобильный экран смены | машинист на v3 работает в форме, спроектированной для администратора — другая терминология и другой поток | учесть при выборе |
| 15 | мелочь | `src/components/piling/operator-dashboard.tsx:47` + `src/app/(app)/operator/page.tsx:14-18` | `OperatorDashboard` (603 строки) не смонтирован нигде: `grep -rn "OperatorDashboard"` даёт только комментарий страницы и само объявление | объявленный «путь отхода» существует только как файл — возврат потребует ручной правки страницы | держать (AGENTS.md §4), но знать, что это не переключатель |
| 16 | мелочь | `src/app/operator/v7/{history,safety,assistant}/page.tsx:2` | три подстраницы v7 тоже без проверки роли на странице; доступ сужают только `/api/reports/my`, `/api/safety/my-clearance`, `/api/assistant/*` | «тёмный» маршрут без гейта страницы — тот же класс, что D-20260930-004 | либо гейт, либо явно признать, что роль режет API |
| 17 | мелочь | `src/components/piling/operator-mobile/v7/v7-screens.tsx:528,537` | v7 — единственная версия, из которой есть кнопка «Рабочий экран машиниста» на `/operator` и ссылка на свою историю | код сам называет v1 рабочим экраном — это стоит учитывать при выборе | учесть как сигнал, не править |
| 18 | мелочь | `src/app/operator/v5/page.tsx:28-30` (и такие же комментарии в v7/v10) | v5/v7/v10 лежат вне группы `(app)`, потому что у них своя шапка и нижняя панель; но вместе с группой они теряют `FeedbackCenter`, `ActingAsBanner` и кнопку выхода (`src/app/(app)/layout.tsx:96-106,117`) | если выбрать v5/v7/v10, машинист останется без выхода из системы и без обратной связи — `grep "logout\|Выйти"` по их компонентам пуст | при выборе одной из них — добавить выход и обратную связь в её собственную оболочку |
| 19 | мелочь | `src/components/piling/operator-v3/operator-dashboard-v3.tsx:15-23` | набор действий v3 (`Осмотр`, `Моточасы`, `Дефект`, `Фото`, `Отправить`) и шаги (`Осмотр → Моточасы → Дефект → Передано диспетчеру`) не совпадают ни с фазовой моделью мобильного контура, ни с терминологией остальных версий | сравнение v3 с остальными «по шагам» бессмысленно; владельцу важно знать, что это другой процесс, а не другая вёрстка | учесть при выборе |

## Не проверено

- **Бой.** На сервер я не заходил (запрещено AGENTS.md §1). Сборка `0a48fa06` как выкаченная взята из
  сообщения коммита `f5b01cd3` этой ветки. Проверить на бою стоит: `/operator/module` и `/operator/tabs`
  (ожидаю 404) и текст 403 на v5/v7 (ожидаю «Нет связи с сервером»). Повторение: открыть адреса
  под диспетчером и под машинистом.
- **Права `/api/operator/shift`.** Я убедился, что роль там не проверяется, но не проверял, что именно
  вернёт этот маршрут диспетчеру или мастеру без бригады (вероятно, пустые факты). Живой запрос не отправлял.
- **`getAccessibleSites`** (`src/app/api/sites/route.ts:21`) — принимает ли `requestedUserId` чужого
  пользователя осмысленно, я не разбирал: это вне задачи, а в v3 передаётся свой id.
- **Счёт тестов** — по `grep -c` статических `it(`/`test(`, без параметризованных `it.each`
  (у v1 их нет, у `operator-layout-policy.test.ts` — есть, но это не версия). Vitest не запускался:
  прогон не входит в read-only задачу, и без `.env` часть спеков молча пропускается.
- **Прототипы.** `public/prototypes/operator-tabs` есть в рабочей копии; я не проверял, попадает ли он
  в продакшн-образ (Dockerfile и `.dockerignore` на эту папку не смотрел) — но, поскольку она в
  `.gitignore`, в сборке из git её быть не может.
- **v7 assistant/history/safety и `/assistant`** — соотношение подстраниц v7 с боевыми `/assistant`
  и `/history` подробно не разбирал (в отчёте только адреса API).
- **Производительность и вес версий** (сколько JS грузит каждая) не измерял — вне задачи.
