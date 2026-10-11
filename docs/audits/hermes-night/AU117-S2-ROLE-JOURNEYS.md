# AU117-S2-ROLE-JOURNEYS — Сценарии ролей по коду: диспетчер, механик, ТБ, администратор

Версия кода: `git rev-parse HEAD` = **7bb2e4ac7bfeb0a5d70d541bd407c6034aa2f7bb** (ветка `hermes/q4-0926`, в рабочем дереве изменён только `AGENTS.md`, к аудиту отношения не имеет).
Только чтение: код приложения не менялся; создан один файл — этот отчёт.

## Итог

- Разобраны 4 роли (DISPATCHER, MECHANIC, SAFETY_ENGINEER, ADMIN) по трём слоям: меню (`role-navigation.ts`), серверные права (`authorization-service.ts` + матрица готовности `capability-defaults.ts`) и гварды маршрутов/раскладок.
- Находок: **22**, из них критично — **0**, важно — **8**, мелочь — **14**. Критичных нет: доступ на сервере закрыт корректно (гварды `requirePageAbility` / `assertCan` / матрица готовности), все находки — расхождения интерфейса, «право есть, дороги нет» и неиспользуемые права.
- Топ-5:
  1. Право `media.upload` объявлено и разложено по ролям, но **нигде не проверяется** — контроль, сняв который, ничего не отнимешь (`src/services/auth/authorization-service.ts:50` и `:132`).
  2. У инженера ОТ есть права на установки, обслуживание и бригады, но **нет пунктов меню** к ним — разделы доступны только по прямому адресу (`src/services/auth/authorization-service.ts:103,108,126` против `src/components/piling/icons/role-navigation.ts:143-153`).
  3. Комментарий в коде называет мониторинг инструментом диспетчера **и механика**, но у механика пункта «Мониторинг» в меню нет (`src/components/piling/icons/role-navigation.ts:29-32` против `:106-120`).
  4. Диспетчер ведёт раздел «Отчёты», но **не может выгрузить** журнал: право `reports.export` только у ADMIN (`src/services/auth/authorization-service.ts:66`, `src/app/api/reports/export/route.ts:24`).
  5. Оболочка приложения выбирается по «своей» роли, а навигация — по исполняемой: администратор в режиме «Действую как» остаётся в админской раскладке (`src/app/(app)/layout.tsx:288-294` против `:42` и `:155-156`).

## Методика

Что и как искал (воспроизводимо):

1. Меню: `src/components/piling/icons/role-navigation.ts` (ROLE_NAVIGATION, все 7 ролей) — прочитан целиком.
2. Права приложения: `src/services/auth/authorization-service.ts` — матрица `abilityRoles` (`:62-135`), `can/assertCan/assertRole` (`:158-181`).
3. Права контура готовности (вторая система): `src/modules/readiness/domain/capability-defaults.ts` (`ROLE_ABILITIES`, `:52-136`) и `src/modules/readiness/application/capabilities.ts`.
4. Гварды страниц: все `src/app/(app)/**/layout.tsx` (20 файлов) + `src/lib/require-page-ability.ts`; карта вкладок — `src/modules/readiness/application/bootstrap-query.ts:214-241`.
5. Гварды API: поиск `assertCan(|assertRole(|assertAnyRole(|can(` по `src/app` (120 совпадений) и адресная проверка ключевых маршрутов.
6. Переключение ролей: `src/lib/types.ts` (ACTING_ROLES, `resolveEffectiveRole`), `src/lib/routes.ts` (roleHomeRoute), `src/app/(app)/layout.tsx` (выбор оболочки).
7. Проверка «право объявлено, но не используется»: поиск литерала `media.upload` по всему `src/` (единственное вхождение — объявление в матрице).

Ограничения метода: read-only по коду; живое приложение, БД и прод не запускались. Итоговые проверки `tsc/lint/build` (AGENTS.md §6) не запускались — они не нужны для аудита чтения и не меняют выводов.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/services/auth/authorization-service.ts:50` и `:132` | Право `media.upload` объявлено и перечислено по ролям, но ни один маршрут его не проверяет. | Единственная проверка загрузки — `assertCanAccessMediaEntity` (`src/app/api/media/route.ts:41`), а он смотрит на тип сущности, не на право. Если администратор снимет `media.upload` у роли, рассчитывая закрыть загрузку, — не изменится ничего. Непроверяемое право в матрице хуже отсутствующего: оно врёт. | Либо проверять `assertCan(user,'media.upload')` в `src/app/api/media/route.ts:39`, либо убрать право из `abilityRoles`, чтобы матрица не обещала несуществующего контроля. |
| 2 | важно | `src/components/piling/icons/role-navigation.ts:143-153` (меню) против `src/services/auth/authorization-service.ts:103,108,126` | У инженера ОТ есть `equipment.read`, `maintenance.manage`, `crews.read`, но в меню только «ТБ и допуски», «Техготовность», «Объекты», «Отчёты». | Инженер ОТ в первый день не найдёт «Установки», «Обслуживание», «Бригады» — разделы, которые его же права открывают. Попасть можно только по прямому адресу (`/admin/maintenance`, `/admin/equipment`, `/admin/crews`). Это тот же класс «право есть, дороги нет», от которого роль механика уже лечили. | Добавить в `SAFETY_ENGINEER` пункты меню на те же маршруты, что у механика (или хотя бы «Установки»/«Обслуживание»), по образцу `MECHANIC` (`:106-120`). |
| 3 | важно | `src/components/piling/icons/role-navigation.ts:29-32` против `:106-120` | Комментарий явно говорит: «сводка по всему парку — инструмент диспетчера и механика», но у MECHANIC пункта «Мониторинг» нет. | Механик не видит экран, который код объявляет его рабочим местом. При этом страница `/monitoring` ему технически доступна (`src/app/(app)/monitoring/page.tsx` без серверного гварда) — то есть дороги нет, а дверь открыта, только по прямой ссылке. | Добавить `{ label: 'Мониторинг', href: '/monitoring', ... }` в меню MECHANIC либо исправить комментарий, если мониторинг механику не положен. |
| 4 | важно | `src/services/auth/authorization-service.ts:66` + `src/app/api/reports/export/route.ts:24` + `src/components/piling/admin-reports/admin-reports.tsx:92` | Право `reports.export` есть только у ADMIN; диспетчеру кнопки CSV/Excel скрыты. | Диспетчер ведёт раздел «Отчёты» (`/admin/reports`, `reports.read_all`), печатает одиночные PDF (`reports.read_cross_user`), но **не может выгрузить период в CSV/Excel** — именно то, что уходит заказчику. Выгрузка журнала забивки ему при этом открыта (`piles.manage`, `src/app/api/pile-passports/export/route.ts:62`) — расхождение внутри одного рабочего места. | Выдать `reports.export` роли DISPATCHER (как минимум — диспетчеру, который и формирует отчётность), либо осознанно зафиксировать запрет в комментарии. |
| 5 | важно | `src/app/(app)/layout.tsx:288-294` против `:42` и `:155-156` | Оболочка (`AdminLayout`/`OperatorLayout`) выбирается по `currentUser.role` (своей роли), а пункты меню — по `resolveEffectiveRole` (исполняемой). | Администратор в режиме «Действую как оператор» видит навигацию оператора, но остаётся в админской раскладке (боковое меню, подпись «Панель администратора», `:159`). Смысл режима — «увидеть продукт чужими глазами» — подменяется: чужие глаза видят чужое меню в своей оболочке. | Считать оболочку по `resolveEffectiveRole(user.role, actingAs)` там же, где считается `navItems`. |
| 6 | важно | `src/components/piling/admin-equipment/admin-equipment.tsx:23`, `src/components/piling/admin-equipment/detail/equipment-detail.tsx:62`, `src/components/piling/admin-only.tsx:19`, `src/components/piling/monitoring/equipment-card.tsx:23` | UI-гейты завязаны на «сырую» роль (`role === 'ADMIN'`, `role === 'ADMIN' || role === 'DISPATCHER'`) и игнорируют `actingAs`. | Администратор в режиме «Действую как механик» всё ещё видит «Редактировать»/«Создать» на установках — но сервер считает право по исполняемой роли (`assertCan(user,'equipment.manage')`, `src/app/api/equipment/route.ts:37`) и ответит 403. Кнопка ведёт в отказ. Обратная сторона: там где гейт `ADMIN||DISPATCHER` (`equipment-card.tsx:23`), механик с `equipment.read` не может открыть карточку с мониторинга. | Сравнивать по `can(actor, 'equipment.manage')` / `useAbility(...)` с `actingAs` из стора, как это уже сделано в `admin-reports.tsx:91-92` и `admin-crews.tsx:56`. |
| 7 | важно | `src/services/auth/authorization-service.ts:82` | У MECHANIC нет `users.read` → `GET /api/users` (`src/app/api/users/route.ts:25`) для него 403, список работников недоступен. | Механик «возвращает машину бригаде после ремонта и обязан видеть, кому возвращает» (комментарий к `crews.read`, `:124-126`), но полного списка работников у него нет; он видит только состав бригад. Для сверки «кто сегодня за рулём» этого может не хватать. **ГИПОТЕЗА**: возможно, состава бригад достаточно — но тогда различие стоит зафиксировать, а не оставлять следствием умолчания. | Если список нужен — добавить MECHANIC в `users.read`; если нет — записать решение в комментарий к `:82`. |
| 8 | важно | `src/app/(app)/monitoring/page.tsx` (нет `layout.tsx`) + `src/app/api/monitoring/fleet/route.ts:26-28` | У страницы `/monitoring` нет серверного гварда по праву; API сужает выборку только для OPERATOR/ASSISTANT, всем остальным отдаёт парк целиком. | MECHANIC, SAFETY_ENGINEER и FOREMAN, открыв `/monitoring` по прямой ссылке, получают полный снимок парка. Пункта меню у них нет (кроме FOREMAN), то есть контроль фактически на «не найдёт адрес». Внутри одного тенанта это не утечка между организациями, но экран живёт без проверки. | Добавить раскладку с `requirePageAbility` (например, `sites.read_all` или отдельным правом) либо явно задокументировать, что мониторинг открыт всем аутентифицированным. |
| 9 | мелочь | `src/components/piling/icons/role-navigation.ts:154` + `src/components/piling/workspace-settings.tsx:99,163` | Диспетчеру добавлен пункт «Настройки», но всё редактирование в нём — только для ADMIN (`isAdmin`, `save()` возвращает false). | Диспетчер открывает «Настройки» и видит экран, где нельзя изменить ничего: «Редактировать» скрыта (`:237`), тумблеры уведомлений выключены (`:296`), вкладки Telegram/DLQ не отрисованы (`:222`). Пункт меню ведёт в почти пустой по смыслу экран. | Либо убрать `settingsNav` у DISPATCHER, либо дать диспетчеру право менять понятный ему минимум (например, часовой пояс/уведомления), либо подписать экран как «только просмотр». |
| 10 | мелочь | `src/components/piling/workspace-settings.tsx:26,274-279` | Список ролей для счётчиков — только 4 (`ADMIN','DISPATCHER','OPERATOR','ASSISTANT`). | Роли MECHANIC, FOREMAN, SAFETY_ENGINEER в «Доступ по ролям» не показываются вовсе — диспетчер/админ видит «0 пользователей» по ним, потому что строки нет, а не потому что людей нет. | Расширить `ROLE_ORDER` до всех `UserRole` из `src/lib/types.ts:5-12`. |
| 11 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:100` + `src/modules/readiness/application/bootstrap-query.ts:240` + `src/components/piling/to/readiness/settings/roles-section.tsx:89-95` | Вкладка «Настройки» контура готовности открыта роли с `readiness.audit.read` (диспетчер, инженер ОТ), но раздел «Роли и доступы» требует `readiness.rules.manage` (ADMIN) и на 403 показывает пустую таблицу. | Диспетчер в TO → «Настройки» → «Роли и доступы» видит раздел без данных (403 проглочен, `settings-workspace.tsx:100` рендерит `RolesSettings`). Экран не падает, но и не объясняет, почему пусто. | Прятать раздел «Роли и доступы» (и «Справочники») по `capabilities`, как уже сделано для «Правил» (`rulesUnavailable`, `settings-workspace.tsx:193`). |
| 12 | мелочь | `src/components/piling/admin-equipment/admin-equipment.tsx:23` + `src/services/auth/authorization-service.ts:104` | `equipment.manage` — только ADMIN; у диспетчера и механика карточка установки read-only. | Диспетчер заводит объекты и бригады, но добавить/отредактировать установку не может — это делает только админ. Для офисной работы диспетчера (приём новой техники) это ограничение может стать узким местом. | Решить владельцу: оставить (технику заводит админ) или выдать `equipment.manage` диспетчеру. |
| 13 | мелочь | `src/components/piling/admin-sites/index.tsx:84` + `src/components/piling/admin-crews/admin-crews.tsx:56` | Разные способы проверки права в двух соседних экранах: `useAbility('sites.manage')` против `useAbility('crews.manage')` — оба корректны, но соседствуют с гейтами по сырой роли (см. #6). | Не баг сам по себе, а источник будущих расхождений: единого способа «проверить право в UI» в проекте два — `useAbility` и `role === '...'`. Местами они дают разный ответ при `actingAs`. | Убрать гейты по сырой роли, оставить один `useAbility` (он учитывает `actingAs`, `src/lib/use-ability.ts:6-8`). |
| 14 | мелочь | `src/app/(app)/admin/layout.tsx:14` | Раскладка `/admin` пускает MECHANIC и SAFETY_ENGINEER в группу, хотя их домашние разделы лежат вне неё. | Механик/инженер ОТ, зашедшие на `/admin` (дашборд), получают `/no-access` (`src/app/(app)/admin/page.tsx:6` требует `analytics.read`, которого у них нет). Лишний шаг к отказу вместо честного редиректа на свой раздел. | Оставить только реально входящие в группу роли или добавить редирект на `roleHomeRoute` (`src/lib/routes.ts:29`). |
| 15 | мелочь | `src/lib/routes.ts:30` | FOREMAN при входе попадает на `/admin` (дашборд требует `analytics.read` — у мастера есть), но у мастера нет `equipment.read`. | Не относится к четырём аудируемым ролям напрямую, фиксируется как соседний факт: домашний экран не проверяет, что роль видит его содержимое. | ГИПОТЕЗА: проверить отдельно (вне рамок этой задачи). |
| 16 | мелочь | `src/modules/readiness/domain/capability-defaults.ts:106` | ASSISTANT имеет `readiness.defect.report`, но без `readiness.read` экраны контура для него закрыты. | Это уже задокументированный в коде «право есть, применить негде» (комментарий `:95-105`). Фиксируется как известный долг, не как новый дефект. | Решение владельца: отдельный экран помощнику либо снять право. |
| 17 | мелочь | `src/components/piling/to/readiness/screens/settings-workspace.tsx:143-148` | Матрица «Роли и доступы» в краткой форме показывает 4 роли (`OPERATOR','DISPATCHER','MECHANIC','ADMIN`). | Инженер ОТ и мастер в краткую сводку не попадают — при разборе «кто что может» их приходится искать в другом месте. | Добавить недостающие роли из `READINESS_ROLE_LIST` (`capability-defaults.ts:42-44`). |
| 18 | мелочь | `src/components/piling/to/readiness/settings/roles-section.tsx:105` + `src/services/auth/authorization-service.ts:82` | Раздел «Роли и доступы» грузит `/api/users` и рассчитывает на `users.read`. | Роли с `readiness.audit.read`, но без `users.read` получат здесь отказ. Сейчас все роли, кому открыт раздел (ADMIN, DISPATCHER, SAFETY_ENGINEER), `users.read` имеют — расхождение скрыто, но заложено. | Сверять доступность колонки с `can(actor,'users.read')` явно, а не полагаться на совпадение матриц. |
| 19 | мелочь | `src/modules/equipment/application/commands/meter-reading.ts:74-75` | «Снижать» моточасы может только ADMIN/MECHANIC (жёсткая проверка `role === 'ADMIN' \|\| 'MECHANIC'`), в обход `actingAs`. | Администратор в режиме «Действую как оператор» по этой проверке считается ADMIN (сырая роль) и сможет снизить счётчик, хотя `can()` считал бы его оператором. Мелкое расхождение двух моделей прав. | Считать по `resolveEffectiveRole` (как в `authorization-service.ts:158-160`). |
| 20 | мелочь | `src/app/api/maintenance/[id]/accept/route.ts:19,24` | Приёмка заявки: `maintenance.manage`, затем ещё `assertRole(user,'ADMIN')`. | Механик/инженер ОТ с `maintenance.manage` не могут выполнить приёмку — она админская. Если это осознанно (приёмку подписывает админ) — стоит комментарий у права; сейчас это скрытое сужение внутри маршрута. | Комментарий-обоснование или отдельное право `maintenance.accept`. |
| 21 | мелочь | `src/services/auth/authorization-service.ts:113` | `incidents.review` есть у DISPATCHER, но не у FOREMAN, хотя мастер читает происшествия (`incidents.read`, `:112`) и это его участок. | Мастер видит происшествие, но не может его разобрать; кнопка разбора у него скрыта экраном. Для аудируемых ролей не критично (диспетчер и инженер ОТ разбор имеют), фиксируется как соседний факт. | Подтвердить у владельца: разбор происшествий мастером — да/нет. |
| 22 | мелочь | `src/components/piling/icons/role-navigation.ts:39,56,119,139,149` | SAFETY_MODULE_ROUTE (`/admin/safety`) — единая точка входа, но содержимое вкладок зависит от `bootstrap.capabilities.screens` и потому у ролей разное. | Не дефект (комментарий `:44-58` объясняет), но важно для проверок: у механика в «ТБ и допуски» остаются «Мой допуск» и «Наряд-допуски», у диспетчера — «Сотрудники»/«Журнал инструктажей» и т. д. При описании первого дня роль-специфичность вкладок обязательна. | Зафиксировать в документации ролей карту вкладок (этот отчёт — черновик такой карты). |

## Сценарий первого дня: Диспетчер (DISPATCHER)

Домашний экран — `/admin` (`src/lib/routes.ts:30`), оболочка — админская раскладка (`src/app/(app)/layout.tsx:288-294`).

| # | Действие | Экран / маршрут | Право | Файл:строка | Чего не хватает |
|---|---|---|---|---|---|
| 1 | Открыть дашборд и увидеть ход работ по объектам | `/admin` (Дашборд) | `analytics.read` | `src/services/auth/authorization-service.ts:63`; гвард `src/app/(app)/admin/page.tsx:6` | — (экран доступен) |
| 2 | Управлять объектами (создать/править, иерархия, закрепление людей) | `/admin/sites` | `sites.read_all`, `sites.manage`, `sites.assign_users`, `sites.manage_hierarchy` | `src/services/auth/authorization-service.ts:72-75`; `src/app/(app)/admin/sites/layout.tsx:4`; `src/components/piling/admin-sites/index.tsx:84` | — |
| 3 | Допустить смену к пуску / принять передачу техники | `/admin/to` (вкладка «Смены») | `readiness.shift.authorize`, `readiness.handover.decide` | `src/modules/readiness/domain/capability-defaults.ts:65-74` | — |
| 4 | Вести бригады | `/admin/crews` | `crews.manage` | `src/services/auth/authorization-service.ts:127`; `src/app/(app)/admin/crews/layout.tsx:4` | — |
| 5 | Проверить/удалить отчёт смены | `/admin/reports` | `reports.read_all`, `reports.manage_all` | `src/services/auth/authorization-service.ts:64,67`; `src/app/(app)/admin/reports/layout.tsx:4` | **не может выгрузить** CSV/Excel (см. находку #4) |

Смысловые действия без права: выгрузка отчётов (`reports.export`, `:66`); правка справочников (`dictionary.manage`, `:129`); Telegram/DLQ/пересборка проекций (`:130,133,134`).

## Сценарий первого дня: Механик (MECHANIC)

Домашний экран — `/admin/to` (`src/lib/routes.ts:35`). Меню: `src/components/piling/icons/role-navigation.ts:106-120`.

| # | Действие | Экран / маршрут | Право | Файл:строка | Чего не хватает |
|---|---|---|---|---|---|
| 1 | Провести сменный осмотр / ЕО машины | `/inspections` или `/admin/to` | `inspection.perform` (+ `readiness.inspection.manage`) | `src/services/auth/authorization-service.ts:120`; `src/app/api/inspections/route.ts:38` | — |
| 2 | Взять в работу и закрыть дефект | `/admin/to` → «Обслуживание ТО» → «Замечания и дефекты» | `readiness.defect.report`, `readiness.defect.manage` | `src/modules/readiness/domain/capability-defaults.ts:114-115` | — |
| 3 | Закрыть наряд ТО / ремонт | `/admin/maintenance` | `maintenance.manage` | `src/services/auth/authorization-service.ts:108`; `src/app/(app)/admin/maintenance/layout.tsx:4` | — |
| 4 | Снять/заменить показание моточасов | карточка установки / журнал ТО | `meter.record` (+ спец-правило снижения) | `src/services/auth/authorization-service.ts:123`; `src/modules/equipment/application/commands/meter-reading.ts:74-75` | — |
| 5 | Посмотреть бригады, чтобы вернуть машину | `/admin/crews` | `crews.read` | `src/services/auth/authorization-service.ts:126`; `src/app/(app)/admin/crews/layout.tsx:4` | полный список работников закрыт (`users.read` нет — находка #7) |

Смысловые действия без права: список работников (`users.read`, `:82`); создание/правка карточки установки (`equipment.manage`, `:104`); мониторинг как явный пункт меню (находка #3).

## Сценарий первого дня: Инженер ОТ (SAFETY_ENGINEER)

Домашний экран — `/admin/safety` (`src/lib/routes.ts:34`). Меню: `src/components/piling/icons/role-navigation.ts:143-153`. Роли нет живых людей (доверенная модель AGENTS.md §3): работу исполняет администратор через `ACTING_ROLES` (`src/lib/types.ts:40-49`).

| # | Действие | Экран / маршрут | Право | Файл:строка | Чего не хватает |
|---|---|---|---|---|---|
| 1 | Выдать/отозвать допуск работника к технике | `/admin/safety` (карточки допусков) | `safety.permits.manage` | `src/services/auth/authorization-service.ts:96`; `src/app/api/safety/equipment-permits/route.ts:87` | — |
| 2 | Оформить наряд-допуск | `/admin/to` → «Наряд-допуски» | `readiness.permit.edit` | `src/modules/readiness/domain/capability-defaults.ts:130` | — |
| 3 | Провести осмотр и разобрать замечание | `/admin/to` / `/inspections` | `inspection.perform`, `readiness.inspection.manage`, `readiness.defect.manage` | `src/services/auth/authorization-service.ts:120`; `src/modules/readiness/domain/capability-defaults.ts:131,133` | — |
| 4 | Разобрать происшествие | `/admin/safety` → «Происшествия» | `incidents.read`, `incidents.review` | `src/services/auth/authorization-service.ts:112-113`; `src/app/api/admin/incidents/route.ts:29,106` | — |
| 5 | Проверить документы работника / сводку допусков | `/admin/safety` → «Сотрудники» / «Обзор» | `users.documents.read_all`, `users.read` | `src/services/auth/authorization-service.ts:82,90`; `src/modules/readiness/application/bootstrap-query.ts:228-232` | — |
| 6 | Читать отчёты по объекту | `/admin/reports` | `reports.read_all` | `src/services/auth/authorization-service.ts:64`; `src/app/(app)/admin/reports/layout.tsx:4` | журнал забивки (вкладка «Журнал») ему закрыт — `piles.manage` (`:71`), но экран это корректно скрывает (`src/components/piling/admin-reports/reports-module.tsx:45,55`) |

Смысловые действия без права: аналитика/дашборд (`analytics.read`, `:63`); управление установками (`equipment.manage`, `:104`); управление бригадами (`crews.manage`, `:127`); справочники (`dictionary.manage`, `:129`); **пункты меню** на «Установки»/«Обслуживание»/«Бригады», к которым права уже есть (находка #2).

## Сценарий первого дня: Администратор (ADMIN)

Меню: `src/components/piling/icons/role-navigation.ts:155-160`. Администратор — единственная роль с полным набором прав (`src/services/auth/authorization-service.ts:62-135`; `src/modules/readiness/domain/capability-defaults.ts:64` — все полномочия контура).

| # | Действие | Экран / маршрут | Право | Файл:строка | Чего не хватает |
|---|---|---|---|---|---|
| 1 | Завести/изменить работника и его роль | `/admin/users` | `users.manage` | `src/services/auth/authorization-service.ts:83`; `src/app/(app)/admin/users/layout.tsx:4`; `src/app/api/users/route.ts:46,95,129` | — |
| 2 | Вести справочники (марки свай, причины простоев, типы бурения) | `/admin/dictionaries` | `dictionary.manage` | `src/services/auth/authorization-service.ts:129`; `src/app/(app)/admin/dictionaries/layout.tsx:4` | — |
| 3 | Настроить правила готовности и матрицу доступов | `/admin/to` → «Настройки» | `readiness.rules.manage` | `src/modules/readiness/domain/capability-defaults.ts:64`; `src/app/api/readiness-rules/route.ts:25`; `src/app/api/readiness/access-matrix/route.ts:25` | — |
| 4 | Настроить рабочее пространство, Telegram, DLQ | `/admin/settings` | `system.read` + проверка `role==='ADMIN'` | `src/services/auth/authorization-service.ts:131`; `src/components/piling/workspace-settings.tsx:99,222`; `src/app/api/settings/route.ts:27` | — |
| 5 | Завести/править установку | `/admin/equipment` | `equipment.manage` | `src/services/auth/authorization-service.ts:104`; `src/components/piling/admin-equipment/admin-equipment.tsx:23` | — |
| 6 | Исполнить любую роль временно («Действую как») | баннер + весь UI | `canActAs` → `ACTING_ROLES` | `src/lib/types.ts:40-61` | оболочка не переключается на исполняемую роль (находка #5); UI-гейты по сырой роли (находка #6) |

Смысловые действия без права: отсутствуют — у администратора есть все права. Единственное ограничение — режим «Действую как» даёт права исполняемой роли (`src/modules/readiness/application/capabilities.ts:53-70`).

## Действия, которые роли должны уметь по смыслу, но права нет

| Роль | Действие по смыслу | Нет права | path:line |
|---|---|---|---|
| DISPATCHER | Выгрузить отчёт за период (CSV/Excel) | `reports.export` | `src/services/auth/authorization-service.ts:66` |
| DISPATCHER | Правка справочников (марки свай, причины простоев) | `dictionary.manage` | `src/services/auth/authorization-service.ts:129` |
| DISPATCHER | Настройка уведомлений/рабочего пространства | (только ADMIN в UI/API) | `src/components/piling/workspace-settings.tsx:99`; `src/app/api/settings/route.ts:27` |
| MECHANIC | Видеть список работников | `users.read` | `src/services/auth/authorization-service.ts:82` |
| MECHANIC | Создать/править карточку установки | `equipment.manage` | `src/services/auth/authorization-service.ts:104` |
| MECHANIC | Загрузить фото к осмотру, который вёл не он | спец-проверка владельца осмотра | `src/core/media/media-auth.ts:86-98` |
| SAFETY_ENGINEER | Открыть из меню «Установки»/«Обслуживание»/«Бригады» (права есть) | нет пунктов меню | `src/components/piling/icons/role-navigation.ts:143-153` |
| SAFETY_ENGINEER | Смотреть аналитику/дашборд | `analytics.read` | `src/services/auth/authorization-service.ts:63` |
| SAFETY_ENGINEER | Управлять установками и бригадами | `equipment.manage`, `crews.manage` | `src/services/auth/authorization-service.ts:104,127` |
| ADMIN | — (прав хватает) | — | — |

## Не проверено

- **Живое приложение не запускалось** (нет dev-сервера, БД, прод): выводы построены только на чтении кода. Реальная выдача экранов ролью не снималась ни скриншотами, ни запросами к API.
- **Не запускались проверки AGENTS.md §6** (`npx tsc --noEmit`, `npm run lint`, `npm run test:unit`, `npx playwright test --list`, `npm run build`): аудит только читающий, набор тестов не менялся. Exit-коды не снимались.
- **Правила RLS и реальные строки БД** не проверялись — вне области ролей (и вне разрешённых к чтению файлов); оценка доступа основана на коде гвардов, не на выполнении политик.
- **Находки #7, #12, #21** — предмет решения владельца, а не доказанный дефект: это места, где право отсутствует осознанно или случайно, и по коду это не различить. Помечены как ГИПОТЕЗА/вопрос.
- **Frozen-области** (варианты экрана оператора, сайт ORION) не читались и не оценивались (правило задания 3 и AGENTS.md §1).
- Существующие отчёты в `docs/audits/` (кроме этого файла) не открывались; пересечения с прошлыми аудитами не сверялись.
- Точное поведение `GET /api/readiness-rules` для диспетчера/механика подтверждено по коду (`src/app/api/readiness-rules/route.ts:13-19` — без `assertRole` на GET), но фактический ответ в рантайме не проверялся.
