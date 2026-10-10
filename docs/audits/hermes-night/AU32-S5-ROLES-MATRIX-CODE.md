# AU32-S5: Матрица ролей PilingTrack — что разрешено каждой роли по коду

Версия (git rev-parse HEAD рабочей папки): `2b30454f8a79954a754f8833868c7105c5082484`
Ветка: `hermes/q4-0926`. Аудит только читающий: код приложения не менялся, создан только этот файл.

Источник правды — `src/services/auth/authorization-service.ts` (матрица `abilityRoles`,
строки 62–135). Числа получены командой разбора этой таблицы (скрипт приведён в «Методике»).

## Итог

- Всего прав (ability): **30**. Ролей в типе `Role`: **7** (ADMIN, DISPATCHER, OPERATOR,
  ASSISTANT, MECHANIC, FOREMAN, SAFETY_ENGINEER). Находок: **21** — критичных **0**,
  важных **5**, мелочь **16**.
- Прав, доступных нулю ролей, **нет** ни одного — «висячих» прав в матрице нет.
- **Оператор** (`OPERATOR`) в этой матрице имеет всего **3** права (`inspection.perform`,
  `meter.record`, `media.upload`); **помощник** (`ASSISTANT`) — **0** прав. Полевой контур
  (смена, отчёт, журнал забивки) правами этой матрицы не гейтится — он живёт в других
  проверках (владение/бригада), поэтому матрица описывает в основном офисный контур.
- Два права объявлены и расписаны по ролям, но **не проверяются нигде в коде**:
  `media.upload` и `crews.legacy_manage` (оба — только определение; поиск по всему репозиторию).
- **ASSISTANT** есть в типе `Role`, но отсутствует в таблице `abilityRoles` — для него
  `can()` всегда `false`; доступ помощника держится на строковых сравнениях `role === 'ASSISTANT'`
  в отдельных маршрутах, а не на этой матрице.
- Роли **FOREMAN и SAFETY_ENGINEER** не заводятся сидом (`prisma/seed.ts`) и названы в AGENTS.md
  как роли без живых пользователей; `MECHANIC` при этом сидируется. Права этих ролей сегодня
  достижимы только через режим «Действую как» (`ACTING_ROLES`).

Топ-5 по значимости:
1. `tests/integration/authorization-boundaries.spec.ts:42-61` — «снимок» матрицы, который
   обещает закрепить каждое право, на деле покрывает 18 из 30 прав и 4 из 7 ролей и вдобавок
   содержит устаревшие списки ролей: зелёный тест не ловит изменения в новых ролях.
2. `media.upload` (`authorization-service.ts:132`) — право-пустышка: назначено 5 ролям, не
   проверяется нигде; реальная защита загрузки — владение сущностью в `media-auth.ts`.
3. `crews.legacy_manage` (`authorization-service.ts:128`) — то же: ADMIN-only, но в коде не
   проверяется ни разу; в имени прямо стоит «legacy».
4. `safety.permits.manage` (`authorization-service.ts:96`) — его держат только ADMIN и
   SAFETY_ENGINEER (роль без живых пользователей), т.е. фактически право одного администратора.
5. ASSISTANT вне матрицы: `Role` его включает (`authorization-service.ts:20`), `abilityRoles`
   — нет; сервис помощника гейтится сравнением строки (`src/app/api/assistant/command/route.ts:39`).

## Методика

Прочитано (реально открыто, строки проверены):
- `AGENTS.md` (модель доверия, «выглядит мёртвым, но должно остаться»), `src/services/auth/authorization-service.ts`
  (полностью), `src/lib/types.ts` (полностью), `src/modules/readiness/domain/capability-defaults.ts`
  (вторая матрица — контур готовности).
- Потребители прав: `src/app/api/**` и компоненты — поиск `can(`, `assertCan(`, `requirePageAbility(`,
  `isPrivilegedRole`, `assertRole`/`assertAnyRole`, `resolveUserScope`.
- Заведены ли роли: `prisma/seed.ts`, `prisma/migrations/20260906090000_user_role_check_all_roles/migration.sql`.
- Точечно прочитаны: `src/app/api/telemetry/route.ts`, `src/core/media/media-auth.ts`,
  `src/modules/crews/application/queries/crew-query.service.ts`, `src/app/api/users/route.ts`,
  `src/app/(app)/admin/settings/layout.tsx`, `src/app/(app)/admin/users/layout.tsx`,
  `src/components/piling/icons/role-navigation.ts`, `src/lib/require-page-ability.ts`,
  `tests/integration/authorization-boundaries.spec.ts`, `src/services/auth/__tests__/authorization-service.test.ts`.

Команды (числа взяты из их вывода):
- `git rev-parse HEAD` → `2b30454f8a79954a754f8833868c7105c5082484`.
- Разбор таблицы `abilityRoles` через `node -e` (чтение файла + regex по блоку `const abilityRoles`
  … `export function isPrivilegedRole`): 30 прав; права по ролям — ADMIN 30, DISPATCHER 21,
  OPERATOR 3, ASSISTANT 0, MECHANIC 5, FOREMAN 9, SAFETY_ENGINEER 14; прав с нулём ролей — 0;
  группы прав с одинаковым составом ролей — 7 групп.
- `grep` по каждому из 30 прав по `src` **без** `authorization-service.ts` → `crews.legacy_manage: 0`,
  `media.upload: 0` (остальные ≥1). Тот же поиск по всему репозиторию (`search_files`): оба права
  встречаются только в `tests/integration/authorization-boundaries.spec.ts` и в документации.
- `grep -rn "role: '" prisma/seed.ts` → заданы ADMIN, DISPATCHER, OPERATOR, ASSISTANT; MECHANIC
  выставляется через `updateUser` (`prisma/seed.ts:262`); FOREMAN/SAFETY_ENGINEER в сиде нет.
- `node node_modules/vitest/vitest.mjs run tests/integration/authorization-boundaries.spec.ts`
  → «Test Files 1 passed (1), Tests 86 passed (86)», exit 0 (спека без БД, поэтому прошла).
- `cat prisma/migrations/20260906090000_user_role_check_all_roles/migration.sql` → CHECK-ограничение
  перечисляет все 7 ролей.

Статусы в таблице находок: **ПРОЙДЕНО** — подтверждено чтением/командой; **ГИПОТЕЗА** — вывод по
косвенным данным; **НЕ ПРОВЕРЕНО** — см. отдельный раздел.

## Матрица право × роль

Данные из `src/services/auth/authorization-service.ts:62-135` (✅ — рольHold, · — нет).
Колонки: ADMIN, DISPATCHER, OPERATOR, ASSISTANT, MECHANIC, FOREMAN, SAFETY_ENGINEER.

| Право (строка в authorization-service.ts) | ADM | DIS | OPE | ASS | MEC | FOR | SAF |
|---|---|---|---|---|---|---|---|
| analytics.read (63) | ✅ | ✅ | · | · | · | ✅ | · |
| reports.read_all (64) | ✅ | ✅ | · | · | · | ✅ | ✅ |
| reports.read_cross_user (65) | ✅ | ✅ | · | · | · | ✅ | ✅ |
| reports.export (66) | ✅ | · | · | · | · | · | · |
| reports.manage_all (67) | ✅ | ✅ | · | · | · | · | · |
| piles.manage (71) | ✅ | ✅ | · | · | · | ✅ | · |
| sites.read_all (72) | ✅ | ✅ | · | · | · | ✅ | ✅ |
| sites.manage (73) | ✅ | ✅ | · | · | · | · | · |
| sites.assign_users (74) | ✅ | ✅ | · | · | · | · | · |
| sites.manage_hierarchy (75) | ✅ | ✅ | · | · | · | · | · |
| users.read (82) | ✅ | ✅ | · | · | · | ✅ | ✅ |
| users.manage (83) | ✅ | · | · | · | · | · | · |
| users.documents.read_all (90) | ✅ | ✅ | · | · | · | · | ✅ |
| safety.permits.manage (96) | ✅ | · | · | · | · | · | ✅ |
| equipment.read (103) | ✅ | ✅ | · | · | ✅ | · | ✅ |
| equipment.manage (104) | ✅ | · | · | · | · | · | · |
| maintenance.manage (108) | ✅ | ✅ | · | · | ✅ | · | ✅ |
| incidents.read (112) | ✅ | ✅ | · | · | · | ✅ | ✅ |
| incidents.review (113) | ✅ | ✅ | · | · | · | · | ✅ |
| inspection.perform (120) | ✅ | ✅ | ✅ | · | ✅ | · | ✅ |
| meter.record (123) | ✅ | ✅ | ✅ | · | ✅ | · | ✅ |
| crews.read (126) | ✅ | ✅ | · | · | ✅ | ✅ | ✅ |
| crews.manage (127) | ✅ | ✅ | · | · | · | · | · |
| crews.legacy_manage (128) | ✅ | · | · | · | · | · | · |
| dictionary.manage (129) | ✅ | · | · | · | · | · | · |
| telegram.manage (130) | ✅ | · | · | · | · | · | · |
| system.read (131) | ✅ | ✅ | · | · | · | · | · |
| media.upload (132) | ✅ | ✅ | ✅ | · | · | ✅ | ✅ |
| dlq.manage (133) | ✅ | · | · | · | · | · | · |
| projections.rebuild (134) | ✅ | · | · | · | · | · | · |

Сводка по ролям (из команды): ADMIN 30, DISPATCHER 21, OPERATOR 3, ASSISTANT 0, MECHANIC 5, FOREMAN 9,
SAFETY_ENGINEER 14.

### Отдельные срезы

- Права с **нулём ролей**: **нет** (команда вывела пустой список) — ПРОЙДЕНО.
- Права **только у ADMIN** (8): `reports.export`, `users.manage`, `equipment.manage`,
  `crews.legacy_manage`, `dictionary.manage`, `telegram.manage`, `dlq.manage`, `projections.rebuild` — ПРОЙДЕНО.
- Права, единственный держатель которых кроме ADMIN — **роль без живых пользователей** (FOREMAN/SAFETY_ENGINEER):
  `safety.permits.manage` (ADMIN + SAFETY_ENGINEER) — ПРОЙДЕНО.
- Права, которые держит **FOREMAN** (без живых пользователей), 9 шт.: `analytics.read`,
  `reports.read_all`, `reports.read_cross_user`, `piles.manage`, `sites.read_all`, `users.read`,
  `incidents.read`, `crews.read`, `media.upload` — ПРОЙДЕНО.
- Права, которые держит **SAFETY_ENGINEER** (без живых пользователей), 14 шт.: `reports.read_all`,
  `reports.read_cross_user`, `sites.read_all`, `users.read`, `users.documents.read_all`,
  `safety.permits.manage`, `equipment.read`, `maintenance.manage`, `incidents.read`,
  `incidents.review`, `inspection.perform`, `meter.record`, `crews.read`, `media.upload` — ПРОЙДЕНО.
- Права **MECHANIC** (сидованный демо-аккаунт `mechanic@piling.ru`, `prisma/seed.ts:245-263`), 5 шт.:
  `equipment.read`, `maintenance.manage`, `inspection.perform`, `meter.record`, `crews.read` — ПРОЙДЕНО.
- Группы прав с **одинаковым составом ролей** (потенциальная избыточность), 7 групп:
  - `reports.read_all` = `reports.read_cross_user` = `sites.read_all` = `users.read` = `incidents.read`
    (ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER);
  - `analytics.read` = `piles.manage` (ADMIN, DISPATCHER, FOREMAN) — разный смысл, один состав;
  - `users.documents.read_all` = `incidents.review` (ADMIN, DISPATCHER, SAFETY_ENGINEER);
  - `equipment.read` = `maintenance.manage` (ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER);
  - `inspection.perform` = `meter.record` (ADMIN, DISPATCHER, OPERATOR, MECHANIC, SAFETY_ENGINEER);
  - ADMIN-only группа из 8 прав выше; ADMIN+DISPATCHER группа из 6
    (`reports.manage_all`, `sites.manage`, `sites.assign_users`, `sites.manage_hierarchy`, `crews.manage`, `system.read`).
- `inspection.perform` = `meter.record`; `media.upload` отличается от них только тем, что у него
  нет MECHANIC, но есть FOREMAN.

## Находки

| # | severity | path:line | проблема | сценарий / чем важно | предлагаемая правка | статус |
|---|---|---|---|---|---|---|
| 1 | важно | tests/integration/authorization-boundaries.spec.ts:42-61 | «Снимок» матрицы объявлен как закрепление **каждого** права (комментарий :6-7), но покрывает 18 из 30 прав и 4 из 7 ролей (`allRoles`, :63). Списки ролей устарели: `analytics.read` закреплён как `['ADMIN','DISPATCHER']`, а в коде — ещё и FOREMAN (:63 authorization-service) | Тест зелёный (86 passed) и создаёт ложную уверенность: измени право у FOREMAN/MECHANIC/SAFETY_ENGINEER или задень одно из 12 непокрытых прав (`piles.manage`, `users.read`, `users.documents.read_all`, `safety.permits.manage`, `equipment.read`, `maintenance.manage`, `incidents.read`, `incidents.review`, `inspection.perform`, `meter.record`, `dlq.manage`, `projections.rebuild`) — регрессии не увидишь | Дописать оставшиеся 12 прав и роли FOREMAN/MECHANIC/SAFETY_ENGINEER в `matrix` и `allRoles`, либо генерировать снимок из матрицы | ПРОЙДЕНО |
| 2 | важно | src/services/auth/authorization-service.ts:132 | Право `media.upload` назначено 5 ролям, но `grep` по всему репозиторию не находит ни одной его проверки в коде | Мёртвое право: читатель матрицы думает, что загрузка гейтится им, а защита держится на владении сущностью в `media-auth.ts:37,55,80,95` | Либо начать проверять, либо удалить с доказательством неиспользования (поиск уже сделан) | ПРОЙДЕНО |
| 3 | важно | src/services/auth/authorization-service.ts:128 | Право `crews.legacy_manage` (имя само содержит «legacy») назначено только ADMIN и **не проверяется нигде в коде** (0 совпадений вне определения; в спеках — лишь в комментарии) | Мёртвое право, дублирует `crews.manage`; «legacy» в имени без пояснения — заявка на удаление | Удалить право и строку из типа `Ability` (доказательство: repo-wide grep = 0) | ПРОЙДЕНО |
| 4 | важно | src/services/auth/authorization-service.ts:20; src/app/api/assistant/command/route.ts:39 | `ASSISTANT` объявлен в типе `Role`, но в `abilityRoles` его нет ни в одном праве; для него `can()` всегда false. Доступ помощника держится на прямом сравнении `if (user.role !== 'ASSISTANT')` | Роль есть в типе и в БД/сиде, но «невидима» матрице: любая новая секция, повешенная на матрицу, молча закроется помощнику; вторая точка правды вместо одной | Либо вынести помощника в `abilityRoles` (свой набор), либо явно задокументировать «ASSISTANT вне этой матрицы» рядом с `Role` | ПРОЙДЕНО |
| 5 | важно | src/services/auth/authorization-service.ts:96 | `safety.permits.manage` держат только ADMIN и SAFETY_ENGINEER. Если у SAFETY_ENGINEER нет живых пользователей, право фактически ADMIN-only («допуск к технике выдаёт инженер ОТ», :91-95) | Право заведено ради роли, которой пока нет как пользователя; получить его иначе некому, кроме ADMIN | Оставить (осознанно), но зафиксировать: до появления человека право не выполняет заявленную функцию | ГИПОТЕЗА |
| 6 | мелочь | src/lib/types.ts:40-49 | `ACTING_ROLES` = MECHANIC, FOREMAN, SAFETY_ENGINEER, DISPATCHER, OPERATOR. Права FOREMAN/SAFETY_ENGINEER/MECHANIC достижимы только через «Действую как» (и права считаются по `actingAs`, `resolveEffectiveRole`, types.ts:74-76) | «Роль без живых пользователей» не равна «права недостижимы»: администратор под ними получает ровно их набор — это осознано и видно в журнале | Оставить; учесть при оценке п.5 | ПРОЙДЕНО |
| 7 | мелочь | src/services/auth/authorization-service.ts:64-65 | `reports.read_all` и `reports.read_cross_user` имеют **идентичный** состав ролей (ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER) | Два имени, один смысл по составу — читателю неясно, чем отличаются; риск, что позже их разведут по-разному незаметно | Проверить различие по потребителям (`read_all` — список, `read_cross_user` — доступ к чужому scope) и, если разницы нет, объединить/переименовать | ПРОЙДЕНО |
| 8 | мелочь | src/services/auth/authorization-service.ts:63,71 | `analytics.read` и `piles.manage` имеют одинаковый состав (ADMIN, DISPATCHER, FOREMAN), но разный смысл (аналитика vs решение по забивке) | Совпадение состава маскирует семантику: правка одной роли «на аналитику» неожиданно откроет/закроет журнал забивки | Оставить (смыслы разные), отметить связь в комментарии | ПРОЙДЕНО |
| 9 | мелочь | src/app/(app)/admin/settings/layout.tsx:4 | Страница «Настройки» гейтится правом `system.read` (диагностика системы), которое есть и у DISPATCHER | Диспетчер открывает «Настройки», хотя вкладки Telegram/DLQ закрыты `telegram.manage`/`dlq.manage` (ADMIN-only) — раздел открывается, а половина вкладок откажет | Дать «Настройкам» отдельное право или сузить до ADMIN | ПРОЙДЕНО |
| 10 | мелочь | src/services/auth/authorization-service.ts:108; src/components/piling/to/to-module.tsx:417,632; src/core/media/media-auth.ts:80,95,196 | Право с именем `maintenance.manage` используется как гейт **чтения** (чтение журнала ТО, карточки, чтение медиа осмотров) | Имя «manage» на пути чтения вводит в заблуждение; ломается привычка «manage = запись» (известная ловушка проекта: manage на чтении даёт 403/ложные нули) | Ввести отдельное `maintenance.read` и оставить `manage` на запись | ПРОЙДЕНО |
| 11 | мелочь | src/services/auth/authorization-service.ts:66 | `reports.export` — только ADMIN, тогда как `reports.read_all`/`read_cross_user` есть у FOREMAN и SAFETY_ENGINEER | Роль, которой разрешено читать все отчёты, не может выгрузить их — неочевидная асимметрия «читать можно, экспортировать нельзя» | Подтвердить решение владельца; при необходимости дать экспорт FOREMAN/SAFETY_ENGINEER | ПРОЙДЕНО |
| 12 | мелочь | src/services/auth/authorization-service.ts:131; src/app/api/audit/route.ts:17; src/app/api/metrics/route.ts:53; src/app/api/system/status/route.ts:30 | `system.read` покрывает и аудит, и метрики, и статус, и страницу «Настройки» — имя не описывает ни одного из этих предметов по отдельности | Один «зонтичный» ability на разнородные вещи: сузить доступ к аудиту отдельно от метрик нельзя | Разбить на `audit.read`/`system.read` по предмету | ПРОЙДЕНО |
| 13 | мелочь | src/app/api/telemetry/route.ts:111,289-292,366 | Маршрут телеметрии заводит **свою** функцию `assertAnyRole` (:366) с жёстким списком ролей `['ADMIN','DISPATCHER','OPERATOR']` (:111) вместо матрицы; на чтении ветка «иначе» проверяет `analytics.read` (:291) | Комментарий :269 говорит «DISPATCHER / ADMIN keep analytics.read gate», но по факту гейт `analytics.read` пропускает и FOREMAN, а MECHANIC/SAFETY_ENGINEER получают 403; вторая точка правды расходится с матрицей | Использовать матрицу (`can`) или `assertCan` с осмысленным правом; поправить комментарий | ПРОЙДЕНО |
| 14 | мелочь | src/core/media/media-auth.ts:38,189 | Управление фото установок гейтится **литералом** `resolveEffectiveRole(...) !== 'ADMIN'`, а не правом `equipment.manage` (ADMIN-only, :104) | Ещё одна точка правды: изменение `equipment.manage` не изменит правило для медиа | Заменить литерал на `can(actor, 'equipment.manage')` | ПРОЙДЕНО |
| 15 | мелочь | src/services/auth/authorization-service.ts:137-139 | `isPrivilegedRole` = ADMIN|DISPATCHER, т.е. «привилегированный» = «офисные две роли». Но «видеть всё» (`reports.read_cross_user`, `sites.read_all`) дано и FOREMAN/SAFETY_ENGINEER | Слово «privileged» имеет два разных объёма: в `media-auth.ts:42,193` и `feedback-event-service.ts:84` ADMIN/DISPATCHER обходят проверки владения, а FOREMAN/SAFETY_ENGINEER — нет, хотя «видят всё» по отчётам | Переименовать в `isOfficeRole`/`bypassesOwnership` либо не смешивать с «видит всё» | ПРОЙДЕНО |
| 16 | мелочь | src/lib/types.ts:26-33; prisma/seed.ts:245-263 | Комментарий говорит «„Механика“, „Мастера“ и „Инженера ОТ“ в организации физически нет», но сид **создаёт** пользователя-механика `mechanic@piling.ru` (роль MECHANIC через `updateUser`, :262) | Расхождение комментария и данных: механик как демо-аккаунт есть, мастер и инженер ОТ — нет. Читатель кода делает неверный вывод о «живости» ролей | Уточнить комментарий: сид заводит демо-механика; мастер/инженер ОТ — без пользователей | ПРОЙДЕНО |
| 17 | мелочь | src/services/auth/authorization-service.ts:62-135 | ADMIN перечислен вручную во всех 30 правах, тогда как в контуре готовности ADMIN получает все права автоматически (`capability-defaults.ts:64`, `ADMIN: READINESS_ABILITIES`) | Разная политика у двух матриц: здесь новое право, забытое у ADMIN, молча отнимет его у администратора | Сделать ADMIN производным (все права) либо закрепить тестом «ADMIN держит все ability» | ПРОЙДЕНО |
| 18 | мелочь | src/services/auth/authorization-service.ts:112-113 | `incidents.read` есть у ADMIN/DISPATCHER/FOREMAN/SAFETY_ENGINEER, но не у OPERATOR/MECHANIC; `incidents.review` — ADMIN/DISPATCHER/SAFETY_ENGINEER | Оператор, фиксирующий происшествие на смене, читать их через эту матрицу не может: его путь — отдельная команда/контур | Подтвердить намеренность; иначе отметить, чем гейтится создание происшествия оператором | ГИПОТЕЗА |
| 19 | мелочь | src/app/api/users/route.ts:25; src/app/(app)/admin/users/layout.tsx:4 | Чтение списка — `users.read` (DISPATCHER/FOREMAN/SAFETY_ENGINEER), но сама страница `/admin/users` гейтится `users.manage` (только ADMIN) | Список для ролей реализован только на API (потребляется `admin-crews`, `admin-sites`), а раздел «Пользователи» остаётся ADMIN-only — несоответствие «право есть, экрана нет»; ожидаемо, но стоит подтвердить | Если раздел не нужен этим ролям — оставить и зафиксировать; иначе развести чтение/управление на странице | ПРОЙДЕНО |
| 20 | мелочь | src/components/piling/icons/role-navigation.ts:97-160 | Меню (вторая витрина прав) задано отдельным словарём; например, у DISPATCHER нет пункта «Справочники/Пользователи» (ADMIN-only), у MECHANIC нет «Объектов/Отчётов/Аналитики» — согласуется с матрицей | Навигация — ручная копия матрицы; расхождение возможно (в файле уже есть комментарии о «дорогах» к разделам, добавленных вручную). Явных противоречий с `abilityRoles` на глаз не найдено | Сверять меню с матрицей автотестом (`e2e/qa-ac/roles-map`) | ПРОЙДЕНО |
| 21 | мелочь | src/services/auth/authorization-service.ts:22-52 | Тип `Ability` (30 значений) и таблица `abilityRoles` дублируются вручную; прав с нулём ролей сейчас нет, но соответствие «тип ↔ таблица» ничем не проверяется | Забыть добавить право в таблицу = право, которое всегда false у всех (нулевой ущерб), но забыть убрать = «висячее» имя в типе | Тест «каждое значение Ability присутствует в abilityRoles и наоборот» | ПРОЙДЕНО |

## Не проверено

- **Живое состояние БД.** Что у FOREMAN/SAFETY_ENGINEER/MECHANIC действительно нет (или есть)
  пользователей — вывод сделан по `prisma/seed.ts` и по AGENTS.md, а не по запросу к базе. Класть
  запросы к прод-БД запрещено правилами. Статус ПРОЙДЕНО относится к сиду, не к проду.
- **Не запускал Playwright/сборку** (`npx playwright test --list`, `npm run build`) — аудит
  читающий, код не менялся. Соответствие меню и прав на живом стенде — только по коду
  (`role-navigation.ts`), e2e-прогон `roles-map` не воспроизводился.
- **Вторую матрицу (контур готовности, `capability-defaults.ts`) прочитал, но полного построчного
  сравнения двух систем «право готовности ↔ ability» не делал** — задача просила матрицу по
  `authorization-service.ts`; отмечу лишь, что системы отвечают на разные вопросы и ADMIN у них
  задан по-разному (п.17).
- **Все 30 прав по потребителям не трассировал до конца**: число ссылок получено `grep`-ом,
  для прав с ненулевым счётчиком (кроме прочитанных `analytics.read`, `maintenance.manage`,
  `inspection.perform`, `equipment.read`, `reports.*`, `users.*`, `safety.permits.manage`) я не
  открывал все места вызова — возможно, где-то право используется как гейт чтения, как найдено
  для `maintenance.manage` (п.10).
- **Файлы в `docs/audits/` (кроме этого), `CODEX-REPORT*`, `docs/strategy` не читались** по условию
  независимости; совпадения с более ранними выводами, если они есть, здесь не сверялись.
- **Замороженные области** (варианты экрана оператора, сайт ORION) не открывались.
- **`media.upload` и `crews.legacy_manage`**: «мёртвость» подтверждена текстовым поиском по всему
  репозиторию; динамических импортов/строковых вызовов по имени права не нашлось, но косвенная
  (через переменную) проверка теоретически возможна — не проверял.
