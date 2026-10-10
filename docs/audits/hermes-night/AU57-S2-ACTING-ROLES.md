# AU57-S2-ACTING-ROLES — Роли без живых пользователей и режим «Действую как» (x-acting-as)

Версия рабочей папки: `git rev-parse HEAD` → `19c5e8c65197a7838b43555cc27ffe6b471ce0f0`
Ветка: `hermes/q4-0926`. Только чтение; код приложения не менялся.

## Итог

- Найдено 12 расхождений: критично — 0, важно — 8, мелочь — 4. Плюс 6 проверенных-корректных мест (ПРОЙДЕНО).
- ACTING_ROLES — единственный источник правды: `MECHANIC`, `FOREMAN`, `SAFETY_ENGINEER`, `DISPATCHER`, `OPERATOR` (`src/lib/types.ts:40-49`). Замещать их может **только** ADMIN и только на известную роль (`canActAs`, `src/lib/types.ts:58-61`).
- В основной матрице прав (`can()`/`assertRole`) права считаются по **исполняемой** роли — это исправлено и работает (`src/services/auth/authorization-service.ts:158-181`). Контур техготовности считает права по исполняемой роли без объединения со своими (`capabilities.ts:69`).
- НО в ряде маршрутов права/сужения решаются по **собственной** роли (`user.role`), из-за чего смысл «действую как» там теряется: телеметрия, настройки, раскладки, шаблон мониторинга, гварды страниц.
- Самое важное: режим подписывается в журнале **только** цепочечным аудитом техготовности (`append-audit.ts:34-39`); общая лента (`recordAuditEvent`) пишет настоящую роль из БД и не знает про `actingAs` (`src/services/audit/audit-service.ts:981-989`) — действия «в роли» там неотличимы от действий администратора.

## Методика

Поиск по коду (ридер `search_files`, точечные чтения `read_file`; существующие отчёты в `docs/audits/`, `CODEX-REPORT*`, `docs/strategy` не читались):

- `ACTING_ROLES` в `src/**` → 6 совпадений (3 файла).
- `x-acting-as` по всему репозиторию → 28 совпадений (в т.ч. тесты).
- `actingAs` в `src/**` → 182 совпадения.
- `resolveEffectiveRole|assertRole|assertAnyRole` в `src/**` → 42 совпадения.
- `.role ===` / `user.role` / `actor.role` в `src/app/api/**` → 45 совпадений (отобраны решающие права, не самосужающие чтения).

Прочитаны целиком/по фрагментам: `src/lib/types.ts`, `src/lib/auth.ts`, `src/services/auth/authorization-service.ts`, `src/core/api-wrapper.ts`, `src/lib/api.ts`, `src/lib/store.ts`, `src/lib/page-session.ts`, `src/lib/require-page-ability.ts`, `src/components/piling/acting-as-banner.tsx`, `src/components/piling/to/readiness/acting-role-switch.tsx`, `src/app/api/readiness/_shared/request-context.ts`, `src/app/api/readiness/bootstrap/route.ts`, `src/app/api/readiness/audit/route.ts`, `src/app/api/readiness/access-matrix/route.ts`, `src/modules/readiness/application/{capabilities,bootstrap-query,access-matrix-service}.ts`, `src/modules/readiness/domain/{capability-defaults,access-matrix}.ts`, `src/modules/readiness/infrastructure/audit/{append-audit,audit-repository,record-audit}.ts`, `src/core/media/media-auth.ts`, `src/services/audit/audit-service.ts`, `src/app/api/telemetry/route.ts`, `src/app/api/settings/route.ts`, `src/app/api/layout/[surfaceId]/route.ts`, `src/app/api/equipment/[id]/{fuel,meter-readings}/route.ts`, `src/app/api/readiness-rules/{route,publish/route}.ts`, `src/app/api/maintenance/[id]/accept/route.ts`, `src/app/(app)/layout.tsx`, `src/app/(app)/(readiness-admin)/layout.tsx`, тесты `src/services/auth/__tests__/authorization-service.test.ts`, `e2e/qa-ac/rbac-negative.spec.ts`.

Проверка существования строк: все ссылки вида `файл:строка` взяты из выводов `read_file` (нумерация строк присутствует в выводе), а не из памяти.

## Находки

### Таблица 1. Кто какую роль исполняет и какими правами

Режим замещения — единственный вход: ADMIN через заголовок `x-acting-as` (проверяется в `requireAuth`) либо query-параметр `?actingAs=` для bootstrap-контура. Ни одна другая роль замещать никого не может.

| Роль | Кто исполняет | Права замещающего считаются по | Файл:строка |
|---|---|---|---|
| ADMIN | своя роль (замещение запрещено) | own | `src/lib/types.ts:60`; `src/services/auth/authorization-service.ts:83-84` |
| MECHANIC | только ADMIN | исполняемой (мех.) | `src/lib/types.ts:41`; `authorization-service.ts:103,108,120,123,126` |
| FOREMAN (Мастер) | только ADMIN | исполняемой (мастера) | `src/lib/types.ts:41`; `authorization-service.ts:63-64,71-72,82,112,126` |
| SAFETY_ENGINEER (Инженер ОТ) | только ADMIN | исполняемой (инж. ОТ) | `src/lib/types.ts:41`; `authorization-service.ts:64-65,72,90,96,103,108,113` |
| DISPATCHER | только ADMIN | исполняемой (дисп.) | `src/lib/types.ts:48`; `authorization-service.ts:63-64,67,73-75,82,112,127` |
| OPERATOR | только ADMIN | исполняемой (опер.) | `src/lib/types.ts:48`; `authorization-service.ts:120,123,132` |
| ASSISTANT | никто (нет в ACTING_ROLES) — отказ по умолчанию | — | `src/lib/types.ts:40-49`; `authorization-service.ts:152-156` |

Проверка замещения: `canActAs(role, actingAs)` → `true` только для `role==='ADMIN'` и известной роли (`src/lib/types.ts:58-61`); в `requireAuth` заголовок гасится в `null`, если проверка не прошла (`src/lib/auth.ts:192-193`). Bootstrap дополнительно валидирует query-параметр (`src/app/api/readiness/bootstrap/route.ts:30-39`) и повторно зовёт `canActAs` (`bootstrap-query.ts:79-81`).

Что пишется в журнал при входе в режим (только контур техготовности): одна строка `acting_as_mechanic` на смену режима, актор = `{role: 'ADMIN', actingAs: <роль>}`, `after = {actualRole, actingAs}` (`bootstrap-query.ts:94-130`), через цепочечный писатель (`append-audit.ts:34-39`, `audit-repository.ts:53-57`). Дедуп — по последней такой строке того же человека (`bootstrap-query.ts:94-106`).

### Таблица 2. Где права решаются по СОБСТВЕННОЙ роли вместо исполняемой

| # | severity | path:line | проблема | сценарий / чем важно | предлагаемая правка |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/telemetry/route.ts:366-372` (вызов `:111`) | Локальная `assertAnyRole(user, ['ADMIN','DISPATCHER','OPERATOR'])` смотрит `user.role`, а не исполняемую роль | ADMIN в режиме «Действую как MECHANIC» проходит проверку по своей роли ADMIN и пишет телеметрию; эффективная роль (механик) в списке отсутствует и должна была бы отказать | Заменить на `assertAnyRole(user!, [...])` из `authorization-service` (он считает по исполняемой роли) |
| 2 | важно | `src/services/audit/audit-service.ts:981-989, 999-1021` | Общая лента берёт роль из БД (`db.user.role`) и не имеет поля `actingAs` | Действия «в роли» подписываются настоящей ролью ADMIN без пометки о замещении; журнал только техготовности различает замещение | Прокинуть `actingAs` в `AuditEvent.metadata`/поля и показывать его в ленте |
| 3 | важно | `src/app/api/settings/route.ts:27` | PUT настроек — гейт по `user.role !== 'ADMIN'` | ADMIN в режиме MECHANIC всё ещё меняет настройки организации (вопреки «вижу как механик»), хотя соседний `readiness-rules/publish` использует `assertRole` по исполняемой роли (`publish/route.ts:14`) | Заменить на `assertRole(user!, 'ADMIN')` |
| 4 | важно | `src/app/api/layout/[surfaceId]/route.ts:54,80` | PUT/DELETE раскладок — гейт по `user.role !== 'ADMIN'` | ADMIN в любой исполняемой роли правит/удаляет раскладки экранов | Заменить на `assertRole(user!, 'ADMIN')` |
| 5 | важно | `src/app/api/monitoring/template/route.ts:29` | Гейт по `user.role !== 'ADMIN'` | То же: правка шаблона мониторинга доступна из любой исполняемой роли | Заменить на `assertRole(user!, 'ADMIN')` |
| 6 | важно | `src/lib/require-page-ability.ts:22`; `src/lib/page-session.ts:73` | `readPageSessionUser` возвращает только собственную роль (без `actingAs`), `can(user, ability)` считает по ней | ADMIN в режиме OPERATOR по прямому адресу открывает все разделы `/admin/*` (гвард видит ADMIN); экран пустой/403 внутри — расхождение оболочки и запросов | Либо читать `x-acting-as` и в раскладках, либо явно документировать «вход по своей роли» (как в `bootstrap-query.ts:134-139`) |
| 7 | важно | `src/app/(app)/(readiness-admin)/layout.tsx:16` | `ALLOWED.has(user.role)` — по собственной роли | ADMIN в любой роли проходит раскладку раздела готовности; остальные роли посторонних не выпускают | Согласовать с п.6: либо исполняемая роль, либо документировать |
| 8 | важно | `src/app/api/equipment/[id]/fuel/route.ts:23`; `src/app/api/equipment/[id]/meter-readings/route.ts:26,103` | `assertOperatorOwnsEquipment` делает `if (user.role !== 'OPERATOR') return;` (по своей роли), а `canDecreaseMeter(user!.role)` — тоже по своей | ADMIN в режиме OPERATOR минует проверку «установка закреплена за экипажем» и может писать топливо/моточасы по любой технике, а также отматывать счётчик назад — того оператор не может | Считать по исполняемой роли (`resolveEffectiveRole`) |
| 9 | мелочь | `src/app/api/equipment/route.ts:23`; `src/app/api/inspections/route.ts:46`; `src/app/api/inspections/[id]/route.ts:37,65`; `src/app/api/inspections/[id]/complete/route.ts:32`; `src/app/api/monitoring/fleet/route.ts:28` | Самосужающие выборки по `user.role === 'OPERATOR' ? user.id : null` — по собственной роли | ADMIN в режиме OPERATOR видит парк/осмотры без сужения до своего id — «чужими глазами» не получается | Прокидывать исполняемую роль в сужение (или признать сужение «по своей роли» осознанным) |
| 10 | мелочь | `src/app/(app)/layout.tsx:159, 288-294` | `AppLayoutContent` выбирает оболочку (Admin/Operator) и подпись `isDispatcher` по собственной роли, а `navItems` — по исполняемой (`:42-43,155-156`) | ADMIN в режиме OPERATOR получает админскую оболочку с операторским набором ссылок — смешение оболочки и навигации | Выбирать оболочку по `resolveEffectiveRole` |
| 11 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:98,116` | Действие аудита всегда названо `'acting_as_mechanic'`, независимо от исполняемой роли | По имени действия нельзя отфильтровать «кто работал мастером/инженером ОТ»; роль есть только в `after.actingAs` | Переименовать действие в нейтральное (`acting_as`) либо включать роль в имя |
| 12 | мелочь | `src/modules/readiness/application/bootstrap-query.ts:104-106` | Возврат к своей роли (`actingAs === null`) не пишет строку аудита | Выход из режима не оставляет следа — видно только входы в режим, не факт возврата | Писать событие и на снятие замещения |

### Таблица 3. Проверенные места, где замещение учтено верно (ПРОЙДЕНО)

| # | статус | path:line | что проверено |
|---|---|---|---|
| A | ПРОЙДЕНО | `src/lib/types.ts:58-61` | `canActAs`: замещает только ADMIN и только известную роль; подставить чужую роль нельзя |
| B | ПРОЙДЕНО | `src/services/auth/authorization-service.ts:158-181` | `can`/`assertCan`/`assertRole`/`assertAnyRole` считают по `resolveEffectiveRole`, а не по `user.role` |
| C | ПРОЙДЕНО | `src/app/api/readiness/_shared/request-context.ts:78,90` | Контур берёт `actingAs` из проверенного `requireAuth`, а не из «своего» заголовка; capabilities считаются с замещением |
| D | ПРОЙДЕНО | `src/modules/readiness/application/capabilities.ts:53-70` | Права замещающего = права исполняемой роли, без объединения со своими (нельзя повысить доступ) |
| E | ПРОЙДЕНО | `src/core/media/media-auth.ts:38,42,189,193` | Проверки медиа считают по `resolveEffectiveRole` |
| F | ПРОЙДЕНО | `e2e/qa-ac/rbac-negative.spec.ts:166-186` | Сквозной негативный тест: тот же запрос с `x-acting-as: OPERATOR` даёт 401/403, возврат к ADMIN восстанавливает доступ и не берёт чужой кэш (кэш разделён заголовком, `src/core/api-wrapper.ts:44-50`) |

## Не проверено

- **Исполнение в рантайме не запускалось** (задача read-only, БД/сервер не поднимались). Все выводы — из чтения кода; сквозной проверки пунктов важности 1, 3–8 не делалось. Классификация их как «важно» — по чтению кода, не по наблюдению.
- **Достижимость п.6/п.7 в бою** (откроется ли раздел `/admin` под ADMIN в режиме OPERATOR) не проверена сквозным запросом; опирается на чтение `readPageSessionUser`/`requirePageAbility`.
- **Число вызовов `requirePageAbility`** (по комментарию теста — 15) не пересчитывал сам; в отчёте это число не утверждается как факт.
- Не проверял, есть ли у ролей `MECHANIC/FOREMAN/SAFETY_ENGINEER` живые пользователи в базе (задача — по коду; это состояние данных). По коду эти роли равноправны остальным в `abilityRoles`.
- Замороженные области (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`, ORION) не анализировались по существу; найденные совпадения `user.role` в `src/app/api/operator/**` и `src/app/api/assistant/**` оставлены без оценки.
- ГИПОТЕЗА (не проверено): п.2 предполагает, что действия из режима замещения действительно попадают в общую ленту, а не только в цепочечный аудит — подтверждено чтением `resolveActor`, но не наблюдением реальной записи.
