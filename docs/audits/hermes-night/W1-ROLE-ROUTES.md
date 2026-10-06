# W1-ROLE-ROUTES: маршруты ролей MECHANIC, FOREMAN, SAFETY_ENGINEER

Дата: 2026-10-06. Ветка: `hermes/q4-0926` (worktree `D:\PillingR\wt-night`).
Только чтение: код не менялся, приложение не запускалось, база не читалась.
Источник находок обхода — `D:/PillingR/qa/runs/FULL-20261006-1211/` (report.md, tasks.md,
`evidence/`). Замороженные области (операторские экраны, ORION) не разбирались.

## Итог

- Найдено **5** пунктов: критично **0**, важно **1**, мелочь **4**.
- Из четырёх «критичных» дефектов обхода подтверждается **ни один** как есть:
  - три редиректа (MECHANIC: `/admin`, `/admin/sites`, `/admin/settings`;
    SAFETY_ENGINEER: `/admin`, `/admin/settings`; FOREMAN: `/admin/settings`) —
    **так задумано**: это проверка права (`requirePageAbility`) уводит роль на её домашний
    маршрут, а не показывает отказ. Роль действительно лишена соответствующего права.
  - «пустой Мониторинг» у MECHANIC и FOREMAN — **ошибка теста**: страница рисует парк
    (8 карточек, KPI, фильтры), но не таблицей `<table>`; автотест считал только `<table>`
    и объявил экран пустым.
- Единственная подтверждённая находка уровня «важно»: мастер (FOREMAN) **не видит** на
  `/monitoring` таблицу аналитики за период, хотя право `analytics.read` у него есть и
  сервер её отдаёт — интерфейс гейтит блок по собственной роли `ADMIN|DISPATCHER`
  (`src/app/(app)/monitoring/page.tsx:11`). Уже отмечалось в аудите 42 (находка 16), на
  этой ветке не исправлено.
- Топ-5:
  1. **важно** — `/monitoring`: мастер не видит блок аналитики (право есть, интерфейс прячет).
  2. **мелочь** — «Мониторинг пустой» у MECHANIC/FOREMAN: ошибка автотеста (ищет `<table>`).
  3. **мелочь** — `roleHomeRoute('SAFETY_ENGINEER')` = `/admin/to` (техника), хотя его модуль —
     «ТБ и допуски» и он стоит у роли первым в меню.
  4. **мелочь** — при отказе в праве раздел молча уводит на домашний маршрут; экрана
     «нет доступа» нет (запрос D-20261006-NEW-2 просил именно понятный отказ).
  5. **мелочь** — «английский заголовок» перенаправленных страниц — это `metadata.title`
     корневого layout (`PilingTrack - Управление свайными работами`), фактически бренд+русский,
     а не отдельный дефект локализации.

## Методика

Поиск по коду (повторяемо из корня worktree; `rg` без `-r` — MSYS подменяет шаблон):
1. `grep -rn "roleHomeRoute'" src` → все точки редиректа: `src/lib/routes.ts:29-36`,
   `src/app/page.tsx:23`, `src/app/(auth)/login/page.tsx:15`, `src/app/(app)/admin/layout.tsx:13`,
   `src/lib/require-page-ability.ts:9`. `find . -name middleware.ts` → **пусто**: middleware нет,
   все проверки живут в layout/page через `requirePageAbility`.
2. Права: `src/services/auth/authorization-service.ts:62-135` (`abilityRoles`), функция
   `can` (:158-160). Ключи: `analytics.read` (:63), `sites.read_all` (:72), `system.read` (:131).
3. Оболочки и разделы: `src/app/(app)/layout.tsx:151-160,285-299`,
   `src/app/(app)/admin/layout.tsx:12-14`, `(readiness-admin)/layout.tsx:5-16`,
   `(safety)/layout.tsx:17-24`; `layout.tsx` разделов `admin/page.tsx:6`,
   `admin/sites/layout.tsx:4`, `admin/settings/layout.tsx:4`, `admin/equipment/layout.tsx:4`,
   `admin/maintenance/layout.tsx:4`, `admin/crews/layout.tsx:4`, `admin/reports/layout.tsx:4`.
4. Меню: `src/components/piling/icons/role-navigation.ts` (MECHANIC:106-120, FOREMAN:124-142,
   SAFETY_ENGINEER:143-153, настройки :95,154,159).
5. Мониторинг: `src/app/(app)/monitoring/page.tsx:1-23`,
   `src/components/piling/monitoring/fleet-dashboard.tsx`,
   `src/app/api/monitoring/fleet/route.ts:21-34`,
   `src/app/api/admin/equipment-analytics/route.ts:14`,
   `src/modules/monitoring/application/queries/fleet-monitoring.service.ts:106-166`.
6. Сверка с внешним обходом: `qa/runs/FULL-20261006-1211/evidence/foreman___________.html`,
   `mechanic___________.html` (обе — страница «Мониторинг», снята Playwright),
   `evidence/scripts/foreman-walkthrough.mjs:32-33` (что именно считает тест).
7. Сверка с прежними выводами: `docs/audits/hermes-night/42-role-screens.md` (находки 16, 24).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как править |
|---|---|---|---|---|---|
| 1 | важно | `src/app/(app)/monitoring/page.tsx:8-11`; `src/services/auth/authorization-service.ts:63`; `src/app/api/admin/equipment-analytics/route.ts:14` | Блок аналитики за период на `/monitoring` показывается только при `role === 'ADMIN' || role === 'DISPATCHER'` (собственная роль), хотя право `analytics.read` выдано и `FOREMAN` (`authorization-service.ts:63`), и API отдаёт данные по этому праву (`equipment-analytics/route.ts:14`) | Мастер приходит на «Мониторинг» и не видит таблицу установок (моточасы/ТО/выработка/простой) — именно ту, что у ADMIN/DISPATCHER. Сервер бы её отдал; интерфейс прячет то, что право разрешает. Комментарий рядом (`page.tsx:9-10`) устарел: утверждает «есть только у администратора и диспетчера» | Гейт по фактическому праву: `can({role, actingAs}, 'analytics.read')` / `useAbility('analytics.read')` вместо сравнения с ролями |
| 2 | мелочь | `qa/runs/FULL-20261006-1211/evidence/scripts/foreman-walkthrough.mjs:32-33`; `evidence/foreman___________.html`; `evidence/mechanic___________.html` | «Мониторинг пустой» у MECHANIC и FOREMAN — ложная тревога автотеста: он считает `table, [role="table"], .table`, а экран рисует карточки сеткой. В снятых HTML обеих ролей есть «Соединение активно», «0 из 8 в работе», фильтры «Все объекты / Сначала активные» и 8 карточек установок | Тест отчитывается «ПУСТОЙ / нет данных», хотя данные есть. Из-за этого дефект-таск D-20261006-NEW-3 (FOREMAN) и часть D-20261006-NEW-1 (MECHANIC) направлены на несуществующую проблему | Уточнить проверку автотеста (искать карточки парка/«Соединение активно», а не `<table>`); либо пометить как «ошибка теста» |
| 3 | мелочь | `src/lib/routes.ts:31`; `src/components/piling/icons/role-navigation.ts:149-152` | `roleHomeRoute('SAFETY_ENGINEER')` = `/admin/to` (центр технической готовности), тогда как первый пункт меню роли — «ТБ и допуски» (`/admin/safety`), а техцентр у неё второй | Первый экран роли не соответствует её работе: ежедневно начинается с чужого рабочего места. Совпадает с аудитом 42 (находка 24), не исправлено | Вернуть `roleHomeRoute('SAFETY_ENGINEER')` → `/admin/safety` (у MECHANIC `/admin/to` — верно) |
| 4 | мелочь | `src/lib/require-page-ability.ts:9`; `src/app/(app)/admin/settings/layout.tsx:4`; `src/app/(app)/admin/sites/layout.tsx:4`; `src/app/(app)/admin/page.tsx:6` | Отказ по праву — это не экран «нет доступа», а молчаливый редирект на домашний маршрут роли (`redirect(roleHomeRoute(user.role))`). Так `/admin/settings` уводит MECHANIC/SAFETY_ENGINEER на `/admin/to`, а FOREMAN — на `/admin`; `/admin/sites` уводит MECHANIC на `/admin/to` | Человек жмёт адрес из письма/закладки и оказывается на другом экране без объяснения; выглядит как «страница исчезла». Задача D-20261006-NEW-2 прямо просит понятный отказ вместо редиректа | Показывать страницу-заглушку с причиной («Раздел ведёт администратор», кнопка на домашний экран) вместо `redirect` в `requirePageAbility` |
| 5 | мелочь | `src/app/layout.tsx:80`; `qa/runs/FULL-20261006-1211/report.md:100,117,123` | Обход называет заголовок перенаправленных разделов «английским». Фактически это `metadata.title` корневого layout — `PilingTrack - Управление свайными работами` (бренд латиницей + русское описание), а не дефект локализации | На перенаправленных/неразмеченных страницах остаётся общий заголовок вкладки. В отчёте обхода это описано неверно («английский»), в D-20261006-NEW-7 (низкий) — верно | Отдельного кода править не нужно; при желании задать `metadata.title` для редирект-целей (`/admin/to`, `/admin`, `/admin/sites`) либо считать пункт закрытым |

### Таблица «маршрут × роль»

Обозначения вердикта: **задумано** — поведение следует из матрицы прав и
`requirePageAbility`; **ошибка теста** — расхождение только на стороне проверки;
**дефект** — расхождение интерфейса с правами.

| Маршрут | Роль | Что происходит | Требуемое право (`authorization-service.ts`) | Вердикт | path:line |
|---|---|---|---|---|---|
| `/admin` | MECHANIC | редирект на `/admin/to` | `analytics.read` — у MECHANIC нет (:63) | задумано | `admin/page.tsx:6`, `require-page-ability.ts:9`, `routes.ts:31` |
| `/admin` | SAFETY_ENGINEER | редирект на `/admin/to` | `analytics.read` — нет (:63) | задумано | `admin/page.tsx:6`, `routes.ts:31` |
| `/admin` | FOREMAN | открывается дашборд | `analytics.read` — есть (:63) | задумано (работает) | `admin/page.tsx:6` |
| `/admin/sites` | MECHANIC | редирект на `/admin/to` | `sites.read_all` — нет (:72) | задумано | `admin/sites/layout.tsx:4`, `routes.ts:31` |
| `/admin/sites` | SAFETY_ENGINEER | открывается список объектов | `sites.read_all` — есть (:72) | задумано (работает) | `admin/sites/layout.tsx:4` |
| `/admin/sites` | FOREMAN | открывается список объектов | `sites.read_all` — есть (:72) | задумано (работает) | `admin/sites/layout.tsx:4` |
| `/admin/settings` | MECHANIC | редирект на `/admin/to` | `system.read` — нет (:131) | задумано | `admin/settings/layout.tsx:4`, `routes.ts:31` |
| `/admin/settings` | SAFETY_ENGINEER | редирект на `/admin/to` | `system.read` — нет (:131) | задумано | `admin/settings/layout.tsx:4`, `routes.ts:31` |
| `/admin/settings` | FOREMAN | редирект на `/admin` | `system.read` — нет (:131) | задумано | `admin/settings/layout.tsx:4`, `routes.ts:30` |
| `/monitoring` | MECHANIC | парк показан карточками, аналитики нет | снимок парка — **права не требует**; аналитика — `analytics.read` (нет) | задумано + ошибка теста (в отчёте «пусто») | `api/monitoring/fleet/route.ts:21-34`, `monitoring/page.tsx:11`, `evidence/mechanic___________.html` |
| `/monitoring` | FOREMAN | парк показан карточками, аналитики нет | аналитика `analytics.read` — **есть**, но скрыта UI | дефект (см. находку 1); «пусто» — ошибка теста | `monitoring/page.tsx:11` vs `authorization-service.ts:63`, `evidence/foreman___________.html` |
| `/admin/to` | MECHANIC/SAFETY_ENGINEER/FOREMAN | открывается центр готовности | `readiness.read` (матрица готовности) | задумано | `(readiness-admin)/layout.tsx:5-16` |
| `/admin` (оболочка) | все 5 «офисных» ролей | оболочка админки рендерится, содержимое решает layout раздела | — | задумано | `(app)/admin/layout.tsx:12-14` |

### Что видит роль без права на данные мониторинга

Снимок парка (`/api/monitoring/fleet`) **не требует права**: маршрут проверяет только сессию,
а оператора/помощника сужает до их бригад (`api/monitoring/fleet/route.ts:26-32`); остальные
роли получают весь парк арендатора (`fleet-monitoring.service.ts:120-133`). Поэтому MECHANIC и
FOREMAN видят карточки, KPI-плитки и фильтры — пустого экрана или сообщения «нет доступа» тут
быть не может. Сообщения-заглушки у экрана всё же есть и корректны: ошибка загрузки —
`fleet-dashboard.tsx:200-217` и `fleet-failure-message` (:70-76, в т.ч. 403/401 словами),
пустой парк — «Нет установок для отображения.» (:280-286). Аналитика за период — отдельный
компонент и отдельное право `analytics.read` (см. находку 1).

## Не проверено

- **Приложение не запускалось**: сборка/тесты/запросы не выполнялись (задача read-only, сборка
  требует env и базы). Поведение редиректов выведено из кода (`requirePageAbility` →
  `roleHomeRoute`), а не из браузера. Единственное подтверждённое «живьём» поведение — из
  сохранённых HTML обхода (`evidence/*.html`), снятых автоматизацией, а не мной.
- **Живыми пользователями роли не проверялись**: MECHANIC, FOREMAN, SAFETY_ENGINEER в проде
  пользователей не имеют (AGENTS.md §3), в QA-стенде есть тестовые (`qa-mechanic@`,
  `qa-foreman@`, `qa-safety_engineer@piling.test` — из скриптов обхода); сам вход я не
  воспроизводил.
- **Матрица готовности по умолчанию не сверялась построчно** для этих трёх ролей —
  разбирался только доступ к `/admin/to` (через `(readiness-admin)/layout.tsx`). После
  публикации собственной матрицы доступа поведение `/admin/to` может отличаться.
- **Не проверено, должен ли FOREMAN видеть аналитику на мониторинге** «по замыслу владельца»:
  право `analytics.read` мастеру выдано в коде (`authorization-service.ts:63`) и пункт
  «Мониторинг» в меню есть (`role-navigation.ts:126`), но ни PRD, ни комментарии этого явно не
  проговаривают; вывод «дефект» сделан из расхождения права и UI, а не из бизнес-решения.
- **Не проверено, есть ли у MECHANIC право настолько же «законно» отсутствующее**: то, что
  MECHANIC не входит в `analytics.read`/`sites.read_all`/`system.read`, взято из `abilityRoles`;
  намеренность этих исключений (комментарии рядом их не поясняют) не подтверждена — возможно,
  это тоже недосмотр карты прав, а не решение.
