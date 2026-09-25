# Кнопки интерфейса против прав API: где нажатие заканчивается 403

Дата: 2026-09-26. Ветка: `hermes/q3-0925`. Только чтение кода: приложение не запускалось,
запросы не отправлялись, база не читалась. Замороженные области (варианты операторского
экрана, ORION) не проверялись (AGENTS.md, §1).

## Итог

- Всего находок: **26** — критично **3**, важно **13**, мелочь **10**.
- Главная причина расхождений — не забытая проверка, а **две несовпадающие системы прав**
  плюс одна устаревшая привычка: часть интерфейса и часть сервера считают права из зашитой
  таблицы `authorization-service.ts`, часть контура готовности — из **публикуемой матрицы
  доступов** (`readiness/domain/access-matrix.ts`), а ряд маршрутов проверяет `user.role`
  напрямую, игнорируя режим «Действую как». Пока организация ничего не публиковала,
  обе матрицы совпадают — расхождение проявится на **первой же публикации** прав.
- Топ-5:
  1. `src/modules/readiness/application/defects/commands.ts:62` — разбор дефектов проверяет
     **зашитые** права и собственную роль, а экран (`defects-panel.tsx:74-76`) — опубликованную
     матрицу и исполняемую роль: после публикации прав кнопки «Взять в работу»/«Отклонить»
     появляются у роли, которой сервер откажет, и наоборот.
  2. `src/modules/readiness/domain/permits/approval-policy.ts:58` — согласование наряда
     решается по роли (`DISPATCHER`/`ADMIN`), а два полномочия
     `readiness.permit.approve_dispatcher/approve_admin`, которые владелец правит в «Роли
     и доступы», сервер не читает вовсе: интерфейс показывает кнопку «Согласовать» по флагу,
     которого сервер не знает.
  3. `src/components/piling/to/readiness/screens/shifts-screen.tsx:171` — «+ Создать смену»
     выключена через `disabled` у `Button asChild` (ссылка остаётся кликабельной): диспетчер
     жмёт и получает 403 при отправке формы.
  4. `maintenance-screen.tsx:94,117` — вкладка «Обслуживание ТО» открыта всякому с
     `readiness.read`, а ссылки ведут в раздел, требующий `maintenance.manage`: мастер
     набирает заявку и получает отказ на сохранении.
  5. `equipment-documents.tsx:162,191,199` — на карточке установки (её открывают по
     `equipment.read` диспетчер, механик, инженер ОТ) кнопки «Добавить документ»/правка/
     удаление ничем не закрыты, а API требует `equipment.manage` — только админ.
- Что, вопреки ожиданию, **сошлось**: «Провести инструктаж» (`briefings-screen.tsx:252,471`) —
  вкладка журнала открывается по тому же `users.documents.read_all`, что и `POST /api/briefings`
  (`briefing-commands.ts:55`); бригады, объекты, отчёты, происшествия, допуски к технике —
  здесь флаги интерфейса и проверки API совпадают по ролям (см. таблицу совпадений в «Методике»).

| Severity | Кол-во |
|---|---|
| критично | 3 |
| важно | 13 |
| мелочь | 10 |
| **Итого** | **26** |

## Методика

Работа воспроизводима из корня worktree (`D:\PillingR\wt-night`), команды — `rg` (без
`-r`, иначе MSYS подменяет шаблон).

1. Источники прав прочитаны целиком:
   `src/services/auth/authorization-service.ts` (таблица `abilityRoles`, 61-128),
   `src/lib/use-ability.ts:5-9`, `src/modules/readiness/domain/capability-defaults.ts`
   (значения по умолчанию матрицы), `src/modules/readiness/domain/access-matrix.ts`,
   `src/modules/readiness/application/capabilities.ts` (считает эффективные права:
   `effectiveReadinessCapabilities`, 53-70), `src/app/api/readiness/_shared/request-context.ts:90`,
   `src/modules/readiness/application/bootstrap-query.ts:187-254` (что экран получает как
   `capabilities.entities.*` и `capabilities.screens.*`).
2. Карта проверок API построена перечислением маршрутов с мутирующими методами:
   `rg -l "export const (POST|PUT|PATCH|DELETE) = with(Mutation|Api)" src/app/api --glob '!**/__tests__/**'`
   → для каждого файла выписаны `assertCan`/`assertRole`/`assertAnyRole` и проверки
   `capabilities.has(...)`; отдельно отмечены маршруты, где проверки в файле нет вовсе
   (тогда она искалась в сервисе/команде: `rg -n "resp_no_check" …`).
3. Сторона интерфейса: `rg -n "can\(|useAbility|hasPermission|canManage|canRead|role ===|isAdmin|isPrivileged" src/components/piling --glob '!**/operator*/**' -g '*.tsx' -g '*.ts'`
   → 117 мутирующих вызовов (`method: 'POST'|'PUT'|'PATCH'|'DELETE'`) в 48 файлах; для каждой
   кнопки искался гейт в том же компоненте и в его родителе (кто рендерит).
4. Проверялось также, **чем** закрыт вход: `src/app/(app)/admin/layout.tsx:12`,
   `src/app/(app)/(readiness-admin)/layout.tsx:5-16`, `src/app/(app)/layout.tsx:270-289`,
   `src/components/piling/admin-only.tsx:15-25`, наборы вкладок
   `src/components/piling/to/readiness/module-tab-list.tsx:29-62` и их гейт по
   `capabilities.screens` (`module-tab-list.tsx:92`, `to-module.tsx:356-363`,
   `readiness-reference-ui.tsx:101`).
5. Для каждой находки читались обе стороны: строка кнопки (`read_file` или `rg -n` с
   окрестностью) и строка проверки в маршруте/команде.
6. Роли сверялись по AGENTS.md §3: ADMIN и DISPATCHER видят все тенанты по устройству;
   «Мастер» и «Инженер ОТ» живых пользователей не имеют, но их роль реальна в режиме
   «Действую как» и в матрице — расхождения по ним отмечены отдельно.

Полные наборы прав, по которым считались расхождения (из `authorization-service.ts`):
`piles.manage` 70 (ADMIN, DISPATCHER, FOREMAN), `sites.manage`/`assign_users`/`manage_hierarchy`
72-74 (ADMIN, DISPATCHER), `users.read` 81 / `users.manage` 82 (ADMIN),
`users.documents.read_all` 89 (ADMIN, DISPATCHER, SAFETY_ENGINEER), `equipment.read` 96 /
`equipment.manage` 97 (ADMIN), `maintenance.manage` 101 (ADMIN, DISPATCHER, MECHANIC,
SAFETY_ENGINEER), `incidents.read` 105 / `incidents.review` 106, `inspection.perform` 113,
`meter.record` 116, `crews.read` 119 / `crews.manage` 120, `dictionary.manage` 122,
`telegram.manage` 123, `system.read` 124, `analytics.read` 62, `reports.read_all` 63,
`reports.export` 65, `reports.manage_all` 66.

Совпало (расхождения не найдены, перечислено для того, чтобы это не искали заново):
бригады (`admin-crews.tsx:53` ↔ `api/crews/route.ts:42`), объекты и иерархия
(`admin-sites/index.tsx:78` ↔ `api/sites/create/route.ts:20`, `api/sites/[id]/hierarchy/route.ts:19,50`),
пользователи и их документы (`AdminOnly` + `admin-users/**` ↔ `api/users/route.ts:46,96,130`),
отчёты и журнал забивки (`admin-reports.tsx:43-44,221-352` ↔ `api/reports/admin-upsert/route.ts:22`,
`api/reports/delete/route.ts:19`, `reports-module.tsx:43` ↔ `api/pile-passports/[id]/decide/route.ts:23`),
происшествия (`admin-incidents.tsx:72,77` ↔ `api/admin/incidents/route.ts:105`),
инструктажи (`briefings-screen.tsx:252,471` ↔ `briefing-commands.ts:55`),
допуски к технике (`equipment-permit-matrix.tsx:151,158,267` ↔ `api/safety/equipment-permits/route.ts:87`),
наряды-допуски (`permits-screen.tsx:163,242,260` ↔ `permits/commands.ts:64`),
дефекты в части фиксации, смены в части приёмки/передачи передачи
(`shifts-screen.tsx:237` ↔ `shifts/commands.ts:392`), приёмка работ админом
(кроме режима замещения, см. находку 9).

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как править |
|---|---|---|---|---|---|
| 1 | критично | `src/modules/readiness/application/defects/commands.ts:55,62-64` (UI: `src/components/piling/to/readiness/screens/defects-panel.tsx:74-76,231,241`) | Сервер проверяет **зашитую** матрицу и **собственную** роль (`resolveReadinessCapabilities(context.actorRole)` — без `accessMatrix` и без `actingAs`), а экран — опубликованную матрицу и исполняемую роль (`bootstrap.capabilities.entities.defect.manage` из `bootstrap-query.ts:227`, который считается по `effectiveReadinessCapabilities`, `request-context.ts:90`) | После публикации матрицы, где `readiness.defect.manage` выдан роли без него по умолчанию (например, оператору), кнопки «Взять в работу»/«Отклонить»/«Устранён» появятся, а команда ответит 403 (`defects-panel.tsx:231,241` → `/api/readiness/defects/[id]/triage`). Обратная сторона: снятие права у диспетчера матрица не применяет — сервер продолжает пускать, а экран кнопку прячет. Строка 63 (`adminAsMechanic`) вдобавок пускает администратора в режиме любой не-механиковой роли | Заменить на `effectiveReadinessCapabilities(context.actorRole, context.actingAs, context.accessMatrix).has('readiness.defect.report' \| 'readiness.defect.manage')`, как в `shifts/commands.ts:49` и `permits/commands.ts:64`; зашитый случай `adminAsMechanic` убрать |
| 2 | критично | `src/modules/readiness/domain/permits/approval-policy.ts:58` (флаги: `bootstrap-query.ts:242-243`; UI: `permits-screen.tsx:242,255,270-271,284`) | Согласование наряда сервер решает по роли (`input.role === 'DISPATCHER' \|\| 'ADMIN'`), а кнопки «Согласовать» интерфейс показывает по полномочиям `readiness.permit.approve_dispatcher`/`approve_admin`. В серверном коде эти полномочия не встречаются ни разу (`rg` по `src` вне тестов даёт только `capability-defaults.ts`, `bootstrap-query.ts`, UI-контракты и подписи в `roles-section.tsx:44-45`) | Раздел «Роли и доступы» предлагает выдать «Согласовывать наряд» любой роли — выдача не даёт ничего (кнопка появится, сервер откажет), а снятие у диспетчера не отнимает ничего (кнопки нет, согласовать можно). Владелец правит полномочие, которое никуда не подключено | Либо добавить проверку этих полномочий в `assertCanApprovePermit` (роль из матрицы → `WorkPermitApprovalRole`), либо убрать полномочия из матрицы и из экрана, оставив правилом роли. Промежуточный вариант — в `roles-section.tsx` рядом с ними написать, что они не действуют, пока наряд не в расчёте (сейчас этого нет) |
| 3 | критично | `src/components/piling/to/readiness/screens/shifts-screen.tsx:171` (API: `src/modules/readiness/application/shifts/commands.ts:100`) | `Button asChild disabled={!capabilities.entities.shift.manage}` — при `asChild` проп `disabled` уезжает в `<a>` (`components/ui/button.tsx:5,42-50`: класс `disabled:pointer-events-none` работает только через псевдокласс `:disabled`, а его у ссылки не бывает) | Диспетчер — роль без `readiness.shift.manage` (значения по умолчанию: полномочие у ADMIN и OPERATOR, `capability-defaults.ts:64,77`) — видит на вкладке «Смены» живую кнопку «+ Создать смену», открывает форму `/admin/to/shifts/new`, заполняет и получает 403 на `POST /api/readiness/shifts`. Это ежедневный экран диспетчера, а кнопку задумывали скрыть | Не рендерить ссылку при отсутствии права: `{canCreateShift ? <Button asChild><Link …/></Button> : null}`; при желании показать причину — отключённый `Button` без `asChild` |
| 4 | важно | `src/components/piling/to/readiness/screens/maintenance-screen.tsx:94,117,166` (API: `src/app/api/equipment/[id]/maintenance/route.ts:42`, `src/app/api/maintenance/[id]/route.ts:16`, `src/app/api/maintenance/route.ts:15`) | Ссылки «+ Создать заявку» → `/admin/maintenance/new`, «Открыть заявку» → `/admin/maintenance/[id]`, «Открыть календарь» → `/admin/maintenance` не проверяют вообще ничего, а вкладка «Обслуживание ТО» открыта каждому с `readiness.read` (`bootstrap-query.ts:194`); сам раздел обслуживания прав не проверяет нигде (`maintenance-request-form.tsx`, `maintenance-board.tsx`, `work-order-detail.tsx` — 0 совпадений по `can(`/`useAbility`) | Мастер (`readiness.read` есть, `maintenance.manage` нет, `authorization-service.ts:101`) набирает заявку и получает 403 на сохранении; «Открыть заявку» показывает ему экран с ошибкой загрузки. Оператора спасает только редирект раздела `/admin` (`src/app/(app)/admin/layout.tsx:12`) — то есть везение, а не проверка | Гейт по `props.bootstrap?.capabilities.entities.maintenance.manage` перед ссылками (и такой же гейт внутри `maintenance-board`/`work-order-detail`), по образцу `shifts-screen.tsx:202` |
| 5 | важно | `src/components/piling/to/readiness/settings/checklists-section.tsx:200,247,268,355` → `src/components/piling/inspections/template-list.tsx:72,106` (API: `src/app/api/checklist-templates/route.ts:48,63`) | Из настроек контура ссылки ведут в раздел чек-листов, а сам раздел — сплошной CRUD без единой проверки прав и без обёртки `AdminOnly` (`template-list.tsx`, `/admin/checklists`) | Настройки готовности открыты ролям с `readiness.rules.manage` **или** `readiness.audit.read` (`bootstrap-query.ts:213`) — это диспетчер, мастер, инженер ОТ. Мастер не имеет `maintenance.manage`: он видит «Создать чек-лист» на видном месте, приходит в раздел (список грузится только у тех, кому можно, — вместо списка ошибка) и получает 403 на каждой кнопке | Ссылки закрыть флагом `capabilities.entities.maintenance.manage`; в `TemplateList` добавить тот же гейт (шаблоны осмотра — раздел обслуживания, `maintenance.manage`) |
| 6 | важно | `src/components/piling/to/readiness/settings/dictionaries-section.tsx:112,162` → `src/components/piling/admin-dictionaries.tsx:420,548,650` (API: `src/app/api/dictionary/manage/route.ts:63,87,102,125`) | «Открыть все справочники» и «Добавить запись» ведут в разделы, доступные только админу (`dictionary.manage`, `equipment.manage`), а экран справочников не проверяет права ни на одной кнопке — при этом `GET /api/dictionary/all` проверки не имеет (`src/app/api/dictionary/all/route.ts:11`), поэтому раздел у не-админа **успешно загружается** и выглядит рабочим | Диспетчер и инженер ОТ приходят в справочники из настроек контура и нажимают «Добавить»/«Сохранить»/«Архивировать» — 403 на каждое действие (то есть экран не «закрыт», а обманчиво открыт) | Тот же приём, что в `admin-only.tsx`, для `/admin/dictionaries`; ссылки в настройках — по флагу `dictionary.manage`; заодно закрыть чтение справочника правом |
| 7 | важно | `src/components/piling/to/readiness/settings/roles-section.tsx:200,338,360`; `src/components/piling/to/readiness/screens/safety-screen.tsx:302` (API: `src/app/api/users/route.ts:46,96,130`; `admin-only.tsx:18`) | «Управление пользователями», «Добавить пользователя», ссылка «Карточка» ведут на `/admin/users`, где стоит `AdminOnly` (редирект не-админа), а создание/правка требуют `users.manage`. Роли и доступы при этом открыты всем с `readiness.audit.read` — мастеру и инженеру ОТ | Мастер (роль с `readiness.audit.read`) видит кнопку управления пользователями, жмёт и его выбрасывает на дашборд — действие, которое система заведомо не выполнит. Для роли без `users.manage` это тупик, которого не должно быть в меню | Ссылки на `/admin/users` показывать по `capabilities.entities.rules.manage === true` (или по `users.manage`) |
| 8 | важно | `src/components/piling/to/readiness/settings/notifications-section.tsx:130,151,197`; `integrations-section.tsx:78,117` (API: `src/app/api/telegram/configs/route.ts:28`; `admin-only.tsx:18`) | «Настроить Telegram» и «Журнал доставки» отрисованы всегда — `isAdmin` здесь гасит только переключатели правил (`notifications-section.tsx:177`) и подпись (`:149`). Экран интеграций вдобавок сам читает `/api/telegram/configs` (`integrations-section.tsx:39`) и на 403 показывает тост «Не удалось сохранить настройку» (`:42,48`) | Инженер ОТ и мастер (вкладка «Настройки» доступна им по `readiness.audit.read`) видят кнопки в админский Telegram-раздел, попадают на редирект, а на экране интеграций получают ошибку с неверным текстом («сохранить» вместо «загрузить») | Ссылки на `/admin/telegram` — под `isAdmin`; в `integrations-section` различать 403 и сбой сети и не выдавать отказ доступа за ошибку сохранения |
| 9 | важно | `src/components/piling/maintenance/work-order-detail.tsx:105,419` (API: `src/app/api/maintenance/[id]/accept/route.ts:22`) | API переведён на `assertRole(user, 'ADMIN')` — то есть на **исполняемую** роль, и комментарий на `:18-20` прямо объясняет зачем; интерфейс остался на собственной роли (`isAdmin = currentUser?.role === 'ADMIN'`) | Администратор в режиме «Действую как механик» видит «Принять» (приёмка работы — то самое разделение исполнителя и приёмщика, ради которого проверку и меняли) и получает 403 | Взять `resolveEffectiveRole(currentUser?.role, actingAs) === 'ADMIN'`, как в `admin-incidents.tsx:77` |
| 10 | важно | `src/components/piling/admin-equipment/detail/equipment-documents.tsx:162,191,199` (рендер: `detail/equipment-detail.tsx:318,464`; API: `src/app/api/equipment/[id]/documents/route.ts:32`, `.../[docId]/route.ts:33,63`) | Кнопки «Добавить документ», правка и удаление документа не проверяют ничего: `canManage` в карточке (`equipment-detail.tsx:58`) закрывает только «Редактировать» и диалог правки установки. Карточку открывают все с `equipment.read` — ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER | Диспетчер, механик и инженер ОТ (карточка установки для них рабочая) получают на вкладке «Документы» кнопки, каждая из которых отвечает 403: правку документов установки сервер отдал только админу (`equipment.manage`) | Пробрасывать в `EquipmentDocuments` флаг `equipment.manage` (лучше `useAbility('equipment.manage')`) и прятать три кнопки; либо, если документы установки — работа механика, расширить право на API, но не оставлять расхождения |
| 11 | важно | `src/app/(app)/monitoring/page.tsx:11` (API: `src/app/api/admin/equipment-analytics/route.ts:14`; право: `authorization-service.ts:62`) | Аналитика скрыта по собственным ролям (`role === 'ADMIN' \|\| 'DISPATCHER'`), а `analytics.read` выдан ещё и мастеру; в меню мастера «Мониторинг» есть (`icons/role-navigation.ts:109`) | Мастер приходит на мониторинг, видит парк и не видит аналитику за период, хотя и право, и маршрут ему её разрешают: интерфейс **прячет то, что API отдаёт** | Считать по `can({role, actingAs}, 'analytics.read')` — тем же `useAbility`, что и остальные экраны |
| 12 | важно | `src/app/api/settings/route.ts:26`, `src/app/api/monitoring/template/route.ts:29`, `src/app/api/layout/[surfaceId]/route.ts:55,82` (UI: `workspace-settings.tsx:65,171,230,291,328`, `monitoring/equipment-tile-editor.tsx:45,55`) | Четыре маршрута правят настройки организации и раскладки по `user!.role !== 'ADMIN'` — по **собственной** роли, тогда как всё остальное приложение считает права через `can()`/`assertCan()` и уважает замещение (`authorization-service.ts:151-153`, пояснение `:134-149`) | Режим «Действую как» здесь бессмысленен: администратор в роли механика (и в интерфейсе тоже — `isAdmin` там считается так же) меняет название компании, часовой пояс, правила уведомлений, шаблон плиток и раскладку мониторинга. В журнале при этом стоит «действует как механик» — подпись расходится с тем, что человек мог. Интерфейс и сервер здесь согласованы, поэтому 403 после нажатия не будет: расходятся они с осмыслением режима, и это тот же класс дефекта, который уже чинили в готовности (`request-context.ts:51-64`) | `assertCan(user, ability)` (`dictionary.manage`-подобное право или `system.read`+`system.manage`) либо явная проверка `resolveEffectiveRole(...) === 'ADMIN'`, единым помощником на все четыре маршрута и на потребителей в интерфейсе |
| 13 | важно | `src/app/api/equipment/route.ts:12-28`, `src/app/api/dictionary/all/route.ts:11` (право: `authorization-service.ts:96`) | У `GET /api/equipment` проверки нет вообще (только сужение до своей установки для оператора, `:22`), а право `equipment.read` существует и выдано не всем: у мастера и помощника его нет. Аналогично справочники: `dictionary.all` — без проверки | Мастер (меню без «Установок», `role-navigation.ts:107-120`) и помощник машиниста получают полный список парка через API, хотя интерфейс эту область им не показывает, а карточку установки (`GET /api/equipment/[id]/details`, право `equipment.read`) сервер им откажет — то есть API противоречит сам себе внутри одного раздела | `assertCan(user!, 'equipment.read')` в `GET /api/equipment` и `assertCan(user!, 'dictionary.manage' \| 'system.read')` в `GET /api/dictionary/all`; либо, если чтение парка положено всем, убрать `equipment.read` из карты и назвать это решением |
| 14 | важно | `src/components/piling/to/readiness/screens/settings-workspace.tsx:159` (и подпись-комментарий `:142-143`) | `ROLE_MATRIX_ABILITIES` собирается **на уровне модуля** из `resolveReadinessCapabilities(role)` — значения по умолчанию из кода; опубликованная матрица не читается. Комментарий при этом утверждает, что источник тот же, «по которому сервер пропускает команду» | Вкладка «Правила готовности» показывает владельцу сводку прав, которая после первой публикации матрицы становится неверной — и тем опаснее, что именно по ней он сверяет, что выдал. Правильный источник есть рядом: `roles-section.tsx:151` берёт `state.draft/published.grants` | Считать сводку из тех же `grants`, что и «Роли и доступы» (или из `bootstrap.capabilities.entities.*`), а не из `capabilities.ts` по умолчанию |
| 15 | важно | `src/components/piling/to/readiness/screens/shifts-screen.tsx:202,223,237` (API: `src/modules/readiness/application/shifts/commands.ts:161,284`) | Кнопки «Допустить» и «Отказать» показаны по флагу `entities.shift.decideHandover` (`readiness.handover.decide`), а сервер для этих же действий требует `readiness.shift.authorize` (`startShiftCommand`, `declineShiftCommand`). Экрану отдаются оба полномочия (`bootstrap-query.ts:236-238`), берётся не то | По умолчанию наборы ролей у этих двух полномочий совпадают (диспетчер, оператор, администратор), поэтому дефект спит. Матрица доступов правится и публикуется на ходу: сняв у диспетчера только `shift.authorize`, владелец получит кнопку «Допустить», которая гарантированно отвечает 403 | Гейт по `entities.shift.authorize` для «Допустить»/«Отказать», `decideHandover` — только для приёмки передачи (`:237`, что верно) |
| 16 | важно | `src/app/(app)/admin/layout.tsx:12` против `src/components/piling/admin-only.tsx:15-25` | Раздел `/admin/**` пускает пять ролей, а «закрыт только админу» объявлено ровно на трёх страницах (`admin/users`, `admin/telegram`, `admin/dlq`); остальные страницы (`dictionaries`, `checklists`, `maintenance`, `equipment`, `sites`, `crews`, `settings`) должны закрываться сами, и половина из них этого не делает (находки 5, 6, 10) | Один и тот же человек по одному и тому же праву получает то редирект с понятным текстом, то экран, который грузится и отказывает на каждой кнопке. Это не отдельный баг, а источник всех «важных» находок выше | Сделать проверку прав свойством страницы (декларативный список `path → ability` в layout или общий `<RequireAbility>`), чтобы новый экран нельзя было добавить без гейта |

### Мелочи (согласованность и следы)

| # | severity | path:line | проблема | почему стоит поправить | как править |
|---|---|---|---|---|---|
| 17 | мелочь | `src/components/piling/admin-only.tsx:17-18`, `workspace-settings.tsx:65,303`, `admin-equipment.tsx:21`, `equipment-detail.tsx:58`, `equipment-card-grid.tsx:112`, `monitoring/equipment-tile-editor.tsx:45`, `monitoring/equipment-card.tsx:23`, `src/app/(app)/layout.tsx:271` | Все эти гейты смотрят `currentUser?.role`, а не исполняемую роль, тогда как `useAbility`/`can` — исполняемую. В режиме «Действую как» половина экранов ведёт себя как админ | Именно эта разница дала находку 9 и делает поведение режима непредсказуемым; единый помощник убирает целый класс расхождений | Перейти на `resolveEffectiveRole`/`useAbility` (для админского минимума — `can(actor, 'system.read')` и т. п.) |
| 18 | мелочь | `src/components/piling/admin-incidents/admin-incidents.tsx:72` | `REVIEWERS = new Set(['ADMIN','DISPATCHER','SAFETY_ENGINEER'])` — копия карты `incidents.review` из `authorization-service.ts:106`, руками | Второй список прав на одно действие разъедется при правке первого (ровно то, что уже случилось с правами механика) | `can(actor, 'incidents.review')` |
| 19 | мелочь | `src/components/piling/feedback-center.tsx:72` | `isPrivileged = role === 'ADMIN' \|\| role === 'DISPATCHER'` — дубль `isPrivilegedRole` (`authorization-service.ts:130`) и снова по собственной роли | Тот же довод, что в 18 | `isPrivilegedRole(resolveEffectiveRole(...))` |
| 20 | мелочь | `src/components/piling/to/readiness/screens/safety-screen.tsx:86-89` | Роль резолвится дважды: в объект кладётся уже исполняемая роль (`role: resolveEffectiveRole(...)`) и тут же `...(currentUser)` со всеми полями, включая `actingAs`. Работает, но читается как ошибка | Читающий не может отличить замысел от опечатки; при правке `resolveEffectiveRole` поведение изменится незаметно | `const actor = { role: currentUser?.role ?? '', actingAs }; can(actor, 'users.manage')` — как в `admin-reports.tsx:42-43` |
| 21 | мелочь | `src/components/piling/inspections/start-inspection-form.tsx:307` | Тот же приём, что в находке 3: `Button variant="outline" asChild disabled={busy}` вокруг ссылки «Отмена» — ссылка не отключается | На экране осмотра во время сохранения можно уйти по «Отмене»; это же место вводит в заблуждение при чтении кода (`disabled` выглядит как работающая защита) | Не рендерить ссылку при `busy` либо убрать `asChild` |
| 22 | мелочь | `src/app/(app)/admin/piles/page.tsx:10` | Редирект ведёт на `/admin/reports?view=piles`, а `ReportsModule` при отсутствии `piles.manage` молча показывает отчёты смен (`reports-module.tsx:43,53`) — роль без `reports.read_all` (механик) попадает на экран, который ей читать нечем | Старая закладка на журнал забивки приводит не туда, куда ведёт, и без объяснения | Редирект на `roleHomeRoute`/дашборд при отсутствии `piles.manage` |
| 23 | мелочь | `src/components/piling/admin-sites/index.tsx:78,241,274,387,416` | Один флаг `sites.manage` закрывает сразу три API-права: `sites.manage`, `sites.assign_users`, `sites.manage_hierarchy` (`api/sites/[id]/assign/route.ts:19`, `api/sites/[id]/hierarchy/route.ts:19`) | Сегодня наборы ролей совпадают, поэтому 403 не будет; при первом же разделении (например, «закреплять людей — только диспетчер») экран начнёт показывать чужое | Отдельные флаги на три действия (`useAbility('sites.assign_users')`, `useAbility('sites.manage_hierarchy')`) |
| 24 | мелочь | `src/components/piling/icons/role-navigation.ts:100-131` | У механика и инженера ОТ есть `equipment.read` и `crews.read` (`authorization-service.ts:96,119`), но пунктов «Установки»/«Бригады» в меню нет; у мастера наоборот — «Мониторинг» есть, а `equipment.read` нет | Права есть, дороги нет: разделы открываются только ссылками из других модулей, и никто — ни человек, ни ревьюер — не может по меню сверить, что кому положено | Либо добавить пункты, либо записать в комментарии, что доступ сознательно только по ссылкам (сейчас этого объяснения нет) |
| 25 | мелочь | `src/components/piling/maintenance/maintenance-board.tsx:335`, `maintenance-request-form.tsx:108` | Раздел обслуживания не имеет ни одного гейта — ни на кнопке «Задача ТО», ни на отправке формы; единственная проверка во всём модуле — `isAdmin` для приёмки (`work-order-detail.tsx:105`) | Тот же дефект, что в находке 4, но в самом разделе: он держится на редиректе `/admin` и на том, что в меню его нет | `useAbility('maintenance.manage')` на кнопки создания/правки, `AdminOnly`-подобная обёртка — по решению владельца |
| 26 | мелочь | `src/components/piling/to/to-module.tsx:390-402,432-443,514-520` | На одном экране сходятся **три** источника прав: вкладки — по матрице готовности (`capabilities.screens`), запросы данных — по карте `authorization-service` (`can(actor, 'crews.read' \| 'maintenance.manage' \| 'equipment.read')`), а часть ответов гасится «мягким» `readOptionalJson` | Само по себе это осознанный компромисс (запросы к другим доменам), но именно на стыке двух карт и рождаются расхождения вида «вкладка есть — данные недоступны»; стоит держать в голове при любой правке матрицы | Никаких действий не требуется сверх находок 1, 2, 14; при случае — вынести в модуль один `canRead*`, чтобы расчёт был в одном месте |

## Не проверено

- **Ничего не воспроизведено запуском.** Ни `npm run build`, ни тесты, ни запросы не
  выполнялись: задача поставлена как read-only разбор кода, а сборка требует env и базы.
  Все выводы — чтение исходников. Exit-коды §6 AGENTS.md в отчёте не приводятся, потому что
  соответствующие команды не запускались.
- **Поведение `Button asChild disabled` в браузере не проверено** (находка 3, мелочь 21).
  Вывод сделан из кода: `button.tsx:5` описывает отключение классом `disabled:pointer-events-none`
  (псевдокласс `:disabled` у `<a>` не срабатывает), а `Slot` переносит проп на ребёнка-ссылку.
  Проверять стоит в браузере под диспетчером: кнопка должна быть либо невидима, либо не нажиматься.
- **Публикации матрицы доступов в живом тенанте нет в поле зрения** (база не читалась).
  Находки 1, 2, 14, 15 материализуются только после того, как организация опубликует
  свою матрицу; при значениях по умолчанию расхождений по ним не будет. Если в ОРИОН матрицу
  уже публиковали, 1 и 2 — не «спящие», а действующие.
- **Не открывались**: замороженные области (`src/app/operator/**`, `src/app/(app)/operator/**`,
  `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION), а также
  `src/components/piling/assistant/**` и `operator-mobile/api.ts` — контур помощника машиниста
  в этом аудите не разбирался (у него свои вызовы `/api/assistant/command`,
  `src/app/api/assistant/command/route.ts` — проверка прав внутри не читалась).
- **Маршруты без проверок, не относящиеся к интерфейсу**, отмечены, но не разбирались:
  `/api/telemetry/ingest`, `/api/telemetry/batch`, `/api/media/*` (там своя проверка
  `assertCanAccessMedia` — читалась только сигнатура), `/api/feedback/events`.
  `/api/readiness/place-presets` прочитан целиком: проверки полномочий там нет ни на POST,
  ни на DELETE — но и расхождения с интерфейсом нет: список личный, обе операции фильтруют
  по `context.actorId` (`route.ts:46,53,77`), а форма наряда (`permit-form.tsx:193`) зовёт
  его лишь для собственных подсказок места. Отдельный вопрос (не про интерфейс) — что запись
  доступна любому аутентифицированному пользователю, даже без `readiness.read`.
- **Полнота по кнопкам**: проверены все 48 файлов с мутирующими вызовами в
  `src/components/piling` вне заморозки, но глубина разная — часть файлов прочитана целиком
  (`maintenance-screen.tsx`, `permits-screen.tsx`, `equipment-permit-matrix.tsx`,
  `integrations-section.tsx`, `reports-module.tsx`, `admin-reports.tsx`), часть — по строкам
  кнопок и гейтов (`admin-dictionaries.tsx`, `template-list.tsx`, `equipment-documents.tsx`,
  `roles-section.tsx`, `checklists-section.tsx`, `dictionaries-section.tsx`,
  `notifications-section.tsx`). Для последних отдельно проверено, что во всём файле нет
  ни `can(`, ни `useAbility`, ни `hasPermission` (0 совпадений) — то есть гейта нет не в
  строке кнопки, а вообще.
- **Диалог `confirm-action-dialog`, тосты и обработка 403 в интерфейсе** не разбирались;
  в одном месте замечено, что 403 выдаётся за ошибку сохранения (находка 8) — возможно,
  это не единственный такой текст, но системно я это не проверял.
- **Роли «Мастер» и «Инженер ОТ»** проверялись как роли матрицы и как исполнители в режиме
  «Действую как» (живых пользователей у них нет — AGENTS.md §3). Если владелец заведёт им
  людей, находки 4-8, 15 станут ежедневными, а не редкими.
