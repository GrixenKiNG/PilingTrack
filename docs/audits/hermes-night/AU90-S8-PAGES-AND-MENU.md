# AU90-S8-PAGES-AND-MENU: Страницы и меню — кто что видит и есть ли мёртвые ссылки

Версия: `git rev-parse HEAD` рабочей папки = **f82511c7a5a449b22081aebee87db09789cc6096**, ветка `hermes/q4-0926`.
Аудит только для чтения: код приложения не менялся. Замороженные области (`src/app/operator/**`, `src/app/orion/**`, варианты операторского экрана) не разбирались (см. §5).

## Итог (резюме для владельца, 5 строк)

1. Найдите **сломанную кнопку**: на экране «Шаблоны чек-листов» (`/admin/checklists`) кнопка «Новый шаблон» ведёт на `/admin/checklists/new`, а такой страницы нет — это 404 (status: ПРОЙДЕНО, `template-list.tsx:118`). Точка входа доступна 4 ролям.
2. **Страница `/monitoring` открыта всем ролям по прямой ссылке**, хотя пункт меню есть только у диспетчера и мастера; при этом API парка не проверяет право и для механика/инженера ОТ отдаёт весь парк (status: ПРОЙДЕНО).
3. **Ссылки в «мёртвый» раздел**: диспетчер на `/admin/settings` видит кнопки «Управление ролями» → `/admin/users`, а этот раздел только для администратора → отказ (status: ПРОЙДЕНО). Аналогично мастер на дашборде в блоке «С чего начать» видит ссылки на разделы без прав.
4. **`/report` — страница-сирота**: нет пункта меню, нет входящих ссылок из интерфейса (только e2e-тест) и нет проверки прав (status: ПРОЙДЕНО).
5. Пунктов меню без страницы **не найдено** — все 16 адресов из меню ведут на существующие `page.tsx` (status: ПРОЙДЕНО).

## Методика (как можно повторить)

- Список страниц: `find src/app -name page.tsx` и `search_files '**/app/**/page.tsx'` — 44 файла, из них 6 замороженных.
- Раскладки-гварды: `for f in $(find "src/app/(app)" -name layout.tsx); do grep -n 'requirePageAbility|redirect(|ALLOWED' "$f"; done`.
- Матрица прав: `src/services/auth/authorization-service.ts:62-135` (`abilityRoles`).
- Меню: `src/components/piling/icons/role-navigation.ts` (`ROLE_NAVIGATION`).
- Вкладки: `src/components/piling/to/readiness/module-tab-list.tsx` (`MODULE_TABS`, `SAFETY_TABS`), `src/components/piling/admin-reports/reports-module.tsx:57-59`, `src/components/piling/workspace-settings.tsx:216-222`.
- Входящие ссылки: `grep -rn "['\"\`]/<route>" src e2e` (без `node_modules`).
- API-гварды проверялись точечно (`src/app/api/monitoring/fleet/route.ts`, `src/app/api/reports/recent/route.ts`).

Основы видимости:
- Все страницы под `(app)` требуют активной сессии (клиентский bootstrap, `src/app/(app)/layout.tsx:301-353`); без сессии — `/login`.
- Админские разделы закрыты двумя слоями: роли в `src/app/(app)/admin/layout.tsx:14` **и** правом в `admin/<раздел>/layout.tsx`.
- `(safety)/admin/safety` и `(readiness-admin)/admin/to` в группы `admin/` не входят и своим гвардом `admin/layout.tsx` не покрыты.

## Таблица 1. Страницы (`src/app/**/page.tsx`)

Колонка «открыть по ссылке» — фактический допуск по гвардам (раскладка раздела + право). «—» = нет пункта меню ни у одной роли.

| # | Страница / маршрут | В меню у роли | Открывается по прямой ссылке | Пункт меню | Файл:строка |
|---|---|---|---|---|---|
| 1 | `/` (корень, редирект на домашний по роли) | — | все (редирект) | нет | `src/app/page.tsx:10-23` |
| 2 | `/login` | — | аноним | нет | `src/app/(auth)/login/page.tsx:11-19` |
| 3 | `/admin` — Дашборд | ADMIN, DISPATCHER, FOREMAN | ADMIN, DISPATCHER, FOREMAN | да | `src/app/(app)/admin/page.tsx:6` |
| 4 | `/admin/analytics` | ADMIN, DISPATCHER, FOREMAN | ADMIN, DISPATCHER, FOREMAN | да | `src/app/(app)/admin/analytics/layout.tsx:4` |
| 5 | `/admin/sites` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | да | `src/app/(app)/admin/sites/layout.tsx:4` |
| 6 | `/admin/reports` (вкладки «Отчёты смен»/«Журнал забивки») | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | то же | да | `src/app/(app)/admin/reports/layout.tsx:4` |
| 7 | `/admin/equipment` | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | то же | да | `src/app/(app)/admin/equipment/layout.tsx:4` |
| 8 | `/admin/equipment/[id]` (детальная) | — (переход со списка/дашборда) | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | нет | `admin-dashboard.tsx:531` → `/admin/equipment/${r.id}` |
| 9 | `/admin/crews` | ADMIN, DISPATCHER, MECHANIC, FOREMAN, SAFETY_ENGINEER | то же | да | `src/app/(app)/admin/crews/layout.tsx:4` |
| 10 | `/admin/maintenance` | **только MECHANIC** | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | да (1 роль) | `src/app/(app)/admin/maintenance/layout.tsx:4` |
| 11 | `/admin/maintenance/new` | — | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | нет | `to/readiness/screens/maintenance-screen.tsx:127` |
| 12 | `/admin/maintenance/[id]` | — | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | нет | `src/app/(app)/admin/maintenance/[id]/page.tsx` |
| 13 | `/admin/checklists` («Шаблоны чек-листов») | — | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | **нет** | `src/app/(app)/admin/checklists/layout.tsx:4` |
| 14 | `/admin/checklists/[id]` (редактор) | — | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | нет | `template-list.tsx:145` |
| 15 | `/admin/dictionaries` | только ADMIN | ADMIN | да | `src/app/(app)/admin/dictionaries/layout.tsx:4` |
| 16 | `/admin/users` | только ADMIN | ADMIN | да | `src/app/(app)/admin/users/layout.tsx:4` |
| 17 | `/admin/telegram` | — (вкладка в «Настройках») | ADMIN | **нет** | `src/app/(app)/admin/telegram/layout.tsx:4` |
| 18 | `/admin/dlq` | — (вкладка в «Настройках») | ADMIN | **нет** | `src/app/(app)/admin/dlq/layout.tsx:4` |
| 19 | `/admin/settings` | ADMIN, DISPATCHER | ADMIN, DISPATCHER | да | `src/app/(app)/admin/settings/layout.tsx:4` |
| 20 | `/admin/incidents` → редирект `/admin/safety?view=incidents` | — (легаси) | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (затем редирект) | нет | `src/app/(app)/admin/incidents/page.tsx:12` |
| 21 | `/admin/piles` → редирект `/admin/reports?view=piles` | — (легаси) | ADMIN, DISPATCHER, FOREMAN (затем редирект) | нет | `src/app/(app)/admin/piles/page.tsx:12` |
| 22 | `/admin/safety` («ТБ и допуски») | все 7 ролей | все 7 ролей (ASSISTANT и OPERATOR тоже) | да | `src/app/(app)/(safety)/layout.tsx:17-23` |
| 23 | `/admin/to` («Техготовность») | ADMIN, DISPATCHER, MECHANIC, FOREMAN, SAFETY_ENGINEER | + OPERATOR (нет ASSISTANT) | да | `src/app/(app)/(readiness-admin)/layout.tsx:4-6` |
| 24 | `/admin/to/shifts/new` | — | ADMIN, DISPATCHER, MECHANIC, OPERATOR, FOREMAN, SAFETY_ENGINEER | нет | `src/app/(app)/(readiness-admin)/admin/to/shifts/new/page.tsx` |
| 25 | `/monitoring` | DISPATCHER, FOREMAN | **любая роль с сессией** (гварда нет) | да (2 роли) | `src/app/(app)/monitoring/page.tsx:7` |
| 26 | `/history` | OPERATOR, ASSISTANT | **любая роль с сессией** (гварда нет) | да (2 роли) | `src/app/(app)/history/page.tsx:5` |
| 27 | `/report` | — | любая роль с сессией (гварда нет) | **нет** | `src/app/(app)/report/page.tsx:5` |
| 28 | `/inspections` | — | любая роль с сессией (гварда нет) | **нет** | `src/app/(app)/inspections/page.tsx:5` |
| 29 | `/inspections/new` | — | любая роль с сессией | нет | `equipment-inspections.tsx:56` |
| 30 | `/inspections/[id]` | — | любая роль с сессией | нет | `equipment-inspections.tsx:71` |
| 31 | `/operator` («Смена машиниста») | OPERATOR | любая роль с сессией (страница пускает, API сужает) | да | `src/app/(app)/operator/page.tsx:20` |
| 32 | `/assistant` («Помощник машиниста») | ASSISTANT | любая роль с сессией | да | `src/app/(app)/assistant/page.tsx:12` |
| 33 | `/no-access` | — (системная) | любая роль с сессией | нет | `src/app/(app)/no-access/page.tsx:26-27` |
| 34 | `/print/briefing-journal` (печать журнала инструктажей) | — | любая роль с сессией (право проверяет API) | **нет** | `src/app/print/briefing-journal/page.tsx:18` |

Замороженные страницы (не разбирались, §5): `src/app/(app)/operator/v2/page.tsx` (клиентская проверка «только машинист», стр. `13`), `src/app/(app)/operator/v3/page.tsx`, `src/app/(app)/operator/v3/report/page.tsx`, `src/app/operator/v5/page.tsx`, `src/app/operator/v7/**`, `src/app/operator/v10/page.tsx`, `src/app/orion/page.tsx`.

## Таблица 2. Пункты меню (`ROLE_NAVIGATION`)

| Пункт | Маршрут | Роли, видящие пункт | Страница существует | Файл:строка |
|---|---|---|---|---|
| Дашборд | `/admin` | ADMIN, DISPATCHER, FOREMAN | да | `role-navigation.ts:81,125` |
| Мониторинг | `/monitoring` | DISPATCHER, FOREMAN | да | `role-navigation.ts:82,126` |
| Объекты | `/admin/sites` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | да | `role-navigation.ts:83,127,151` |
| Отчёты | `/admin/reports` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | да | `role-navigation.ts:84,140,152` |
| Установки | `/admin/equipment` | ADMIN, DISPATCHER, MECHANIC | да | `role-navigation.ts:85,110` |
| Техготовность | `/admin/to` | ADMIN, DISPATCHER, MECHANIC, FOREMAN, SAFETY_ENGINEER | да | `role-navigation.ts:86,107,132,150` |
| Бригады | `/admin/crews` | ADMIN, DISPATCHER, MECHANIC, FOREMAN | да | `role-navigation.ts:87,118,133` |
| ТБ и допуски | `/admin/safety` | все 7 ролей | да | `role-navigation.ts:91,119,139,149` |
| Аналитика | `/admin/analytics` | ADMIN, DISPATCHER, FOREMAN | да | `role-navigation.ts:92,141` |
| Справочники | `/admin/dictionaries` | ADMIN | да | `role-navigation.ts:157` |
| Пользователи | `/admin/users` | ADMIN | да | `role-navigation.ts:158` |
| Настройки | `/admin/settings` | ADMIN, DISPATCHER | да | `role-navigation.ts:95,154,159` |
| Смена | `/operator` | OPERATOR | да | `role-navigation.ts:34` |
| История | `/history` | OPERATOR, ASSISTANT | да | `role-navigation.ts:40,57` |
| Допуск | `/assistant` | ASSISTANT | да | `role-navigation.ts:55` |

**Пунктов меню без страницы не найдено** — все 16 уникальных адресов из `ROLE_NAVIGATION` ведут на существующие `page.tsx` (status: ПРОЙДЕНО).

## Таблица 3. Вкладки (admin-вкладки, вкладки модулей, настройки)

| Вкладка | Где | Роли / условие показа | Файл:строка |
|---|---|---|---|
| Центр готовности, Готовность парка, Смены, Обслуживание ТО, Отчёты, Настройки | модуль «Техготовность» `/admin/to` | фильтруются по `screens` (матрица готовности); базовая полоса — все | `module-tab-list.tsx:29-36` |
| Мой допуск, Обзор, Сотрудники, Журнал инструктажей, Инструкции и регламенты, Проверка знаний, Происшествия, Документы, Наряд-допуски | модуль «ТБ и допуски» `/admin/safety` | «Мой допуск» — все; остальные по `screens` (инженер ОТ) | `module-tab-list.tsx:45-62` |
| Отчёты смен / Журнал забивки | `/admin/reports` | «Журнал забивки» — при `mayJournal` (право `piles.manage`) | `reports-module.tsx:45,57-59` |
| Рабочее пространство, Пользователи и роли, Уведомления, Шаблоны плиток | `/admin/settings` | все, кто открыл страницу (ADMIN, DISPATCHER) | `workspace-settings.tsx:216-220` |
| Telegram, Очередь (DLQ) | `/admin/settings` | **только ADMIN** (клиентское `isAdmin`) | `workspace-settings.tsx:99,222` |

## Находки

| # | severity | path:line | Проблема | Сценарий / почему важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/components/piling/inspections/template-list.tsx:118` | Кнопка «Новый шаблон» ведёт на `/admin/checklists/new`, но `page.tsx` по этому пути нет (есть только `checklists/page.tsx` и `checklists/[id]/page.tsx`) | 4 роли (ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER) открывают `/admin/checklists` и нажатие даёт 404 — рабочее действие сломано | Создать `src/app/(app)/admin/checklists/new/page.tsx` либо убрать кнопку/перевести её на существующий редактор создания |
| 2 | важно | `src/app/(app)/monitoring/page.tsx:7`; `src/app/api/monitoring/fleet/route.ts:21-32` | Страница `/monitoring` не имеет гварда; API парка проверяет только сессию: для OPERATOR/ASSISTANT сужает до своей техники, а для остальных (в т.ч. MECHANIC, SAFETY_ENGINEER) отдаёт **весь парк** | Роль без пункта «Мониторинг» в меню открывает его по прямой ссылке и видит весь парк — видимость в меню и на странице расходятся | Либо добавить проверку права (например, `analytics.read`/новое `monitoring.read`) в API и раскладку, либо добавить пункт в меню механика/инженера |
| 3 | важно | `src/components/piling/workspace-settings.tsx:270,280,335` | На `/admin/settings` карточка «Доступ по ролям» и вкладка «Пользователи и роли» содержат ссылки на `/admin/users`, который требует `users.manage` (только ADMIN) | Диспетчер штатно открывает «Настройки» (`system.read`), жмёт «Управление ролями» → `/no-access`. Ссылка, ведущая в отказ | Прятать ссылки на `/admin/users` для не-админа (`isAdmin`), как уже сделано для вкладок Telegram/DLQ |
| 4 | важно | `src/components/piling/admin-dashboard.tsx:58-64` | Блок «С чего начать» на дашборде ведёт на `/admin/dictionaries`, `/admin/equipment`, `/admin/users` без учёта прав | Мастер (FOREMAN) открывает `/admin` (у него есть `analytics.read`), но не имеет `equipment.read`/`dictionary.manage`/`users.manage` → шаги «Установки», «Справочники», «Пользователи» ведут в отказ | Фильтровать шаги онбординга по `can(...)` исполняемой роли (как уже сделано для блока парка — `canReadEquipment`) |
| 5 | важно | `src/app/(app)/report/page.tsx:5`; `src/lib/routes.ts:45` | Страница `/report` — сирота: нет пункта меню, нет входящих ссылок из UI (единственная ссылка — e2e `e2e/release-critical-path.spec.ts:33`), гварда нет | Экран `ReportForm` доступен по прямой ссылке любой роли, но найти его в интерфейсе нельзя — «мёртвая» точка входа | Решить судьбу: либо удалить маршрут и ссылку в `PAGE_TO_ROUTE`, либо вернуть ссылку (если он нужен как отдельный экран) |
| 6 | важно | `src/app/(app)/admin/maintenance/layout.tsx:4` vs `role-navigation.ts:114` | Страница `/admin/maintenance` доступна ADMIN, DISPATCHER, SAFETY_ENGINEER, но пункт «Обслуживание» есть только у MECHANIC | Диспетчер и инженер ОТ попадают в «Обслуживание» только ссылками из модуля «Техготовность» и заявок, из меню — нельзя | Либо добавить пункт меню для ролей с `maintenance.manage`, либо признать раздел «механика» и не расширять право |
| 7 | мелочь | `src/app/(app)/history/page.tsx:5` vs `role-navigation.ts:40,57` | `/history` без гварда; пункт «История» — только у OPERATOR/ASSISTANT | Любая админ-роль открывает `/history` по прямой ссылке (данные ограничивает API) — видимость меню и страницы расходятся | Добавить серверный гвард страницы или принять как осознанное поведение и зафиксировать комментарием |
| 8 | мелочь | `src/app/(app)/admin/telegram/layout.tsx:4`, `admin/dlq/layout.tsx:4`, `workspace-settings.tsx:222` | `/admin/telegram` и `/admin/dlq` существуют и как отдельные страницы, и как вкладки внутри «Настроек»; в меню их нет | Две двери к одному экрану (страница + вкладка). Прямая ссылка на страницу остаётся рабочей — трудно понять, какая форма «настоящая» | Оставить один способ: либо редиректы со страниц на `/admin/settings`, либо убрать вкладки |
| 9 | мелочь | `role-navigation.ts:29-32` vs `role-navigation.ts:106-120` | Комментарий называет «Мониторинг» инструментом **диспетчера и механика**, но у механика пункта «Мониторинг» в меню нет | Механик (по замыслу — пользователь мониторинга) не находит раздел в меню; страница ему открыта (§ находка 2) | Привести меню и комментарий в соответствие: добавить пункт механику либо исправить комментарий |
| 10 | мелочь | `src/app/(app)/admin/incidents/page.tsx:12`, `src/app/(app)/admin/piles/page.tsx:12` | Легаси-маршруты `/admin/incidents` и `/admin/piles` оставлены редиректами, в меню их нет | Намеренно (закладки/уведомления), но это страницы без пункта меню — при сверке «меню↔страницы» их надо исключать явно | Оставить как есть; при желании пометить в карте маршрутов как «легаси-редирект» |
| 11 | мелочь | `src/app/(app)/inspections/page.tsx:5`, `inspections/new/page.tsx`, `inspections/[id]/page.tsx` | Раздел осмотров не имеет ни пункта меню, ни серверного гварда; вход — только ссылками с карточки установки и модуля «Техготовность» | Осмотры доступны любой роли по прямой ссылке (право ограничивает API `inspection.perform`); найти раздел в меню нельзя | Зафиксировать осознанность: либо пункт меню, либо серверный гвард страницы |
| 12 | мелочь | `src/app/(app)/(readiness-admin)/layout.tsx:4-6` vs `role-navigation.ts:33-41` | `/admin/to` открыт оператору (страница), но пункта «Техготовность» у оператора в меню нет | Документировано как намеренное (доступ по ссылке из уведомления), но формально это «страница без пункта меню» для OPERATOR | Оставить; в отчётах по ролям учитывать |
| 13 | мелочь | `e2e/qa-ac/tools/roles-map-md.mjs:25-26` | Ожидаемые меню в QA-инструменте устарели: у MECHANIC нет `/admin/equipment`, `/admin/maintenance`, `/admin/crews`; у FOREMAN нет `/admin/to` — хотя в коде они есть | Инструмент сверки ролей будет печатать ложные «расхождения» в отчёте `roles-map.md` | Обновить `EXPECTED` до текущего `ROLE_NAVIGATION` |
| 14 | мелочь | `src/app/print/briefing-journal/page.tsx:18-19` | Печатная форма журнала инструктажей — маршрут без пункта меню и без собственного гварда | Открывается из вкладки «Инструктажи» (`/admin/safety?view=briefings`); защита только на API. Формально «страница без пункта меню» | Оставить; фиксировать как осознанный маршрут печати |
| 15 | мелочь | `workspace-settings.tsx:99,222` vs `admin/settings/layout.tsx:4` | Страница `/admin/settings` открыта диспетчеру (право `system.read`), но вкладки Telegram/DLQ у него скрыты клиентским `isAdmin` | Видимость вкладки (клиент) строже видимости страницы (сервер): диспетчер видит «Настройки», но не часть их возможностей | Ожидаемо; при желании показать диспетчеру вкладки в read-only |

## Что не проверено / ограничения

- **Живой доступ по ролям в браузере не проверялся** (не запускались dev-сервер и Playwright). Выводы о «прямой ссылке» сделаны по коду гвардов (`layout.tsx`, `requirePageAbility`, `AdminOnly`, клиентские проверки), а не по факту навигации. Утверждения имеют статус ПРОЙДЕНО по коду, но НЕ ПРОВЕРЕНО в рантайме.
- **Вкладки модулей `readiness`/`safety` фильтруются по `screens` из bootstrap контура готовности** — источник этих прав (`readiness/domain/capability-defaults.ts`) в рамках этой задачи не разбирался; какие именно вкладки видит каждая роль, не проверено.
- **`/history` для админ-ролей**: клиентского гварда нет (подтверждено), но что именно покажет `ReportHistory` при открытии админом (свои отчёты? пусто? ошибка API?) — не проверено.
- **`/operator` и `/assistant`** открыты по прямой ссылке любой роли на уровне страницы; ограничение — только на API. Поведение страниц для «чужих» ролей не проверялось.
- Существующие отчёты в `docs/audits/` (кроме этого файла), `CODEX-REPORT*`, `docs/strategy` не читались в соответствии с условием задачи.
- Замороженные области (`src/app/operator/**`, `src/app/orion/**`, варианты операторского экрана, операторские компоненты) не разбирались.
