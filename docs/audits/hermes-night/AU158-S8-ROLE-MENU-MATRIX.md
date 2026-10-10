# AU158-S8-ROLE-MENU-MATRIX: Меню по ролям

Версия: `git rev-parse HEAD` = `33d84b91972881588181c9300b9bc5ff86ddded0` (ветка `hermes/q4-0926`).
Только чтение: файлы приложения не менялись. Создан один файл — этот отчёт.

## Итог

- Матрицу меню задаёт один файл — `src/components/piling/icons/role-navigation.ts`. Пунктов: OPERATOR 3, ASSISTANT 3, MECHANIC 5, FOREMAN 8, SAFETY_ENGINEER 4, DISPATCHER 10, ADMIN 12.
- Среди **пунктов самого меню** пунктов, ведущих в отказ, не найдено: каждый пункт ведёт на страницу, право которой у показываемой роли есть (см. таблицу 1). Это зафиксировано и тестом `src/components/piling/icons/__tests__/role-navigation.test.ts`.
- Отказы есть у **ссылок внутри страниц** (не в меню): карточки «Рисков дня» на дашборде ведут FOREMAN на `/admin/equipment/{id}` без `equipment.read`; блок «С чего начать» и «Настройки» в `/admin/to` ведут DISPATCHER/FOREMAN/SAFETY_ENGINEER на админские разделы (`/admin/users`, `/admin/dictionaries`, `/admin/telegram`, `/admin/checklists`) — все 5 таких мест перечислены в таблице 2.
- «Право есть, дороги нет»: SAFETY_ENGINEER имеет `equipment.read` и `crews.read`, но пунктов в меню к `/admin/equipment` и `/admin/crews` у него нет; ADMIN/DISPATCHER/SAFETY_ENGINEER имеют `maintenance.manage`, а пункт «Обслуживание» есть только у MECHANIC.
- Крупных (критично) находок нет: это навигационные тупики, а не утечки данных. Самые ценные — 5 ссылок-отказов (важно).
- Найдено: критично 0, важно 5, мелочь 4; отдельно 4 информационных наблюдения.

## Методика

Что и как искал (можно повторить):

1. Точка входа навигации: `rg -n "role-navigation|ROLE_NAVIGATION|NavigationItem" src` →
   `src/components/piling/icons/role-navigation.ts` (единственный источник меню),
   экспорт в `src/components/piling/icons/index.ts:3`, потребители — `src/app/(app)/layout.tsx:13,42,155`.
2. Права ролей: `src/services/auth/authorization-service.ts` (карта `abilityRoles`, строки 62–135).
3. Гварды страниц: `rg -n "requirePageAbility\(" src/app` → 15 вызовов (тест `src/lib/__tests__/page-ability-layouts.test.ts:62-78` перечисляет те же 15). Плюс групповые раскладки:
   `src/app/(app)/admin/layout.tsx`, `src/app/(app)/(readiness-admin)/layout.tsx`, `src/app/(app)/(safety)/layout.tsx`.
4. Вторая система прав (контур готовности): `src/modules/readiness/domain/capability-defaults.ts` + `src/modules/readiness/application/bootstrap-query.ts:216-241` (карта `capabilities.screens`).
5. Ссылки внутри страниц: `rg -n "['\"]/admin/" src/components src/app` и ручная проверка условий показа каждой ссылки.
6. Проверка отсутствия централизованного перехвата: `ls src/middleware.ts` → файла нет.

Числа (выводы команд приведены там, где используются):
- пунктов меню: `sed -n '<диапазон>p' role-navigation.ts | grep -c "href:"` → 3/3/9/5/8/4 (+ общий `settingsNav`); роли DISPATCHER = 9+1, ADMIN = 9+3.
- страниц под `(app)`: `find "src/app/(app)" -name page.tsx | wc -l` → 34.
- раскладок с гвардом: `rg -l "requirePageAbility\(" src/app | wc -l` → 15.

## Таблица 1. Пункт меню → роли → страница → право на странице

| # | Пункт меню (label) | href | Показывается ролям | Право/гвард на странице (path:line) | Статус |
|---|---|---|---|---|---|
| 1 | Смена | /operator | OPERATOR | серверного гварда нет (клиентский экран) `src/app/(app)/operator/page.tsx:20` | ПРОЙДЕНО |
| 2 | Допуск | /assistant | ASSISTANT | серверного гварда нет `src/app/(app)/assistant/page.tsx:12` | ПРОЙДЕНО |
| 3 | История | /history | OPERATOR, ASSISTANT | серверного гварда нет `src/app/(app)/history/page.tsx:5` | ПРОЙДЕНО |
| 4 | ТБ и допуски | /admin/safety | все 7 ролей | только сессия; вкладки — по `readiness` bootstrap `src/app/(app)/(safety)/layout.tsx:17` | ПРОЙДЕНО |
| 5 | Дашборд | /admin | ADMIN, DISPATCHER, FOREMAN | `analytics.read` `src/app/(app)/admin/page.tsx:6` | ПРОЙДЕНО |
| 6 | Мониторинг | /monitoring | DISPATCHER, FOREMAN | серверного гварда нет `src/app/(app)/monitoring/page.tsx:7` | ПРОЙДЕНО |
| 7 | Объекты | /admin/sites | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | `sites.read_all` `src/app/(app)/admin/sites/layout.tsx:4` | ПРОЙДЕНО |
| 8 | Отчёты | /admin/reports | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER | `reports.read_all` `src/app/(app)/admin/reports/layout.tsx:4` | ПРОЙДЕНО |
| 9 | Установки | /admin/equipment | ADMIN, DISPATCHER, MECHANIC | `equipment.read` `src/app/(app)/admin/equipment/layout.tsx:4` | ПРОЙДЕНО |
| 10 | Готовность техники | /admin/to | MECHANIC, FOREMAN | layout `(readiness-admin)` + `readiness.read` `src/app/(app)/(readiness-admin)/layout.tsx:4-6`, `bootstrap-query.ts:140` | ПРОЙДЕНО |
| 11 | Техготовность | /admin/to | ADMIN, DISPATCHER, SAFETY_ENGINEER | то же | ПРОЙДЕНО |
| 12 | Обслуживание | /admin/maintenance | MECHANIC | `maintenance.manage` `src/app/(app)/admin/maintenance/layout.tsx:4` | ПРОЙДЕНО |
| 13 | Бригады | /admin/crews | ADMIN, DISPATCHER, MECHANIC, FOREMAN | `crews.read` `src/app/(app)/admin/crews/layout.tsx:4` | ПРОЙДЕНО |
| 14 | Аналитика | /admin/analytics | ADMIN, DISPATCHER, FOREMAN | `analytics.read` `src/app/(app)/admin/analytics/layout.tsx:4` | ПРОЙДЕНО |
| 15 | Настройки | /admin/settings | ADMIN, DISPATCHER | `system.read` `src/app/(app)/admin/settings/layout.tsx:4` | ПРОЙДЕНО |
| 16 | Справочники | /admin/dictionaries | ADMIN | `dictionary.manage` `src/app/(app)/admin/dictionaries/layout.tsx:4` | ПРОЙДЕНО |
| 17 | Пользователи | /admin/users | ADMIN | `users.manage` `src/app/(app)/admin/users/layout.tsx:4` | ПРОЙДЕНО |

Источник прав в столбце «Показывается ролям» — `src/components/piling/icons/role-navigation.ts:33-160`; источник прав страницы — раскладки выше и `abilityRoles` в `authorization-service.ts:62-135`.

## Таблица 2. Находки (источник — не меню, а ссылки/структура)

| # | Severity | path:line | Проблема | Сценарий / почему важно | Как чинить (предложение) |
|---|---|---|---|---|---|
| 1 | важно | `src/components/piling/admin-dashboard.tsx:277` (также `:279`, `:282`; рендер `:562-564`; обработчик `src/components/piling/admin-dashboard-bits.tsx:174-198`) | Карточки «Рисков дня» ведут на `/admin/equipment/{id}` (статусы idle/expected, простой) и кликабельны для всех, кто открыл дашборд | FOREMAN видит `/admin` (`analytics.read`), но `equipment.read` у него нет (`authorization-service.ts:103`). Клик по риску «нет отчётов более 3 дней»/«простой» → `router.push('/admin/equipment/{id}')` → раскладка `admin/equipment/layout.tsx:4` отправляет на `/no-access`. Соседний блок «Парк установок» от права уже закрыт (`admin-dashboard.tsx:511-537`), а риски — нет | Гейтить href риска тем же `canReadEquipment`: для роли без `equipment.read` не делать карточку кликабельной на `/admin/equipment`, сохранив текст |
| 2 | важно | `src/components/piling/admin-dashboard.tsx:59`, `:62` (рендер `:461-473`) | Блок «С чего начать» на пустой базе всегда содержит «Справочники» (`/admin/dictionaries`) и «Пользователи» (`/admin/users`) | Показывается, когда в системе нет объектов и парка — включая DISPATCHER и FOREMAN. `dictionary.manage` и `users.manage` есть только у ADMIN (`authorization-service.ts:129,83`). Клик → `/no-access` | Показывать шаг только роли с соответствующим правом (`useAbility('dictionary.manage')`, `useAbility('users.manage')`), как уже сделано для карточки установки |
| 3 | важно | `src/components/piling/workspace-settings.tsx:270`, `:280`, `:335` | Ссылки «Управление ролями» → `/admin/users` показаны всем, кто открыл `/admin/settings` | `/admin/settings` требует `system.read` (ADMIN, DISPATCHER, `admin/settings/layout.tsx:4`). У DISPATCHER нет `users.manage` (`authorization-service.ts:83`). Клик «Управление ролями» → `/no-access` | Скрывать ссылку при отсутствии `users.manage` (в файле уже есть флаг `isAdmin`, стр. 99) |
| 4 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:67-85`, `:99-128` | Вкладка «Настройки» модуля `/admin/to` рендерит все 7 разделов без учёта прав; кнопки-ссылки ведут в админские разделы | Вкладка видна при `readiness.rules.manage || readiness.audit.read` (`bootstrap-query.ts:240`) → её видят ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER. Ссылки: `/admin/users` (`roles-section.tsx:200`), `/admin/dictionaries` (`dictionaries-section.tsx:132`), `/admin/checklists` (`checklists-section.tsx:201`), `/admin/telegram` (`notifications-section.tsx:142,169`). Для DISPATCHER/FOREMAN/SAFETY_ENGINEER это тупики (`authorization-service.ts:83,129,130`, `inspection.perform` без FOREMAN `:120`) | Фильтровать пункты/ссылки разделов по правам роли (у модуля уже есть `capabilities.entities`/`screens`) либо вести на вкладку модуля, а не в чужой раздел |
| 5 | важно | `src/components/piling/icons/role-navigation.ts:103`, `:108`, `:126` против `:106-120`, `:143-153` | «Право есть, дороги нет»: SAFETY_ENGINEER имеет `equipment.read` и `crews.read`, но пунктов «Установки»/«Бригады» у него нет; ADMIN/DISPATCHER/SAFETY_ENGINEER имеют `maintenance.manage`, а «Обслуживание» есть только у MECHANIC | Признанный проектом анти-паттерн (ср. тест `role-navigation.test.ts:103-115` для механика). Чтобы дойти до этих разделов, роль набирает адрес вручную | Добавить пункты либо задокументировать намеренную недоступность; тест `role-navigation.test.ts` правило уже сторожит у других ролей |
| 6 | мелочь | `src/components/piling/icons/role-navigation.ts:86`, `:150` против `:107`, `:132` | Один и тот же `/admin/to` называется двумя словами: «Техготовность» (ADMIN/DISPATCHER/SAFETY_ENGINEER) и «Готовность техники» (MECHANIC/FOREMAN) | Комментарий в коде прямо требует единой подписи (`:129-131`), но для диспетчера и инженера она другая | Привести подписи к одному варианту |
| 7 | мелочь | `src/app/(app)/layout.tsx:159`, `:167-169` | Заголовок боковой панели различает только DISPATCHER: всем остальным говорит «Панель администратора» | MECHANIC/FOREMAN/SAFETY_ENGINEER видят «Панель администратора», хотя админ не они | Подпись по роли либо нейтральное «PilingTrack» |
| 8 | мелочь | `src/app/(app)/monitoring/page.tsx:7` | У `/monitoring` нет серверного гварда права; доступ решает только пункт меню и клиентский `useAbility('analytics.read')` для блока аналитики | Любая аутентифицированная роль по прямому адресу открывает дашборд парка (данные сужены в API `src/app/api/monitoring/fleet/route.ts:26-28`). OPERATOR/ASSISTANT из меню исключены (`role-navigation.test.ts:46-51`), но URL не закрыт | Если это нежелательно — добавить серверный гвард раскладки для `/monitoring` |
| 9 | инфо | `src/app/(app)/admin/page.tsx:6` | «Дашборд» требует `analytics.read` (не `system.read`/админ-роль) | Работает: FOREMAN имеет `analytics.read` (`authorization-service.ts:63`), поэтому его домашний экран `/admin` открывается. Отмечено для полноты матрицы | — |
| 10 | инфо | `src/app/(app)/admin/incidents`, `admin/piles`, `admin/checklists`, `admin/telegram`, `admin/dlq` | Страницы без пункта меню: доступны только вкладкой или прямым адресом | Сделано нарочно (разбор происшествий — вкладка «ТБ и допуски», Telegram/DLQ — вкладки «Настроек», `role-navigation.ts:60-61,88-90`, тест `:134-140`). Права при этом остаются у ADMIN/DISPATCHER/FOREMAN/SAFETY_ENGINEER | — |

## Что не проверено

- Поведение экранов в браузере (реальные клики, редиректы) — не запускалось: это чтение кода. Ссылки-отказы выведены по раскладкам-гвардам и по отсутствию проверки права у самой ссылки; живой прогон Playwright не делал.
- Роли Мастер (FOREMAN) и Инженер ОТ (SAFETY_ENGINEER) не имеют живых пользователей (AGENTS.md §1), поэтому клики «от лица этих ролей» возможны только через режим «Действую как» — фактически не воспроизводил.
- Контур оператора и его варианты (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) и сайт ORION не проверялись — это замороженные области (AGENTS.md §1), и задача их не требовала.
- Полная карта вкладок `SAFETY_TABS`/`MODULE_TABS` и права каждой вкладки на сервере (маршруты `src/app/api/readiness/**`) отдельно по вкладкам не сверял — только точку входа `/admin/safety` и вкладку «Настройки» модуля `/admin/to`.
- Не проверял, показывает ли `NotificationsSettings` (передаётся `isAdmin`) дополнительное скрытие ссылок на `/admin/telegram` для не-админа — прочитаны только строки 100-179; ссылки на `/admin/telegram` на строках 142 и 169 от `isAdmin` не зависят, остальные части файла не читал.
- `/monitoring` (компонент `fleet-dashboard`) на собственные ссылки-отказы не проверял.
- Файлы в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не открывал (запрет задачи).
