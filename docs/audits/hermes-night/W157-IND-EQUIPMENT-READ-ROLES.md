# W157-IND-EQUIPMENT-READ-ROLES: кто читает список техники и какое право для этого нужно

SHA на момент проверки: `fd10b112bef65b03d6af548218f91db51418b28d` (ветка `hermes/q4-0926`).
Задача только на чтение: код не менялся, проверен `git status` — в дереве только этот файл.

## Итог

- Критично — 1, важно — 4, мелочь — 5. Всего 10 находок.
- `GET /api/equipment` работает вообще без проверки права (`route.ts:13-27`): любой вошедший пользователь своей организации видит список техники; сужение сделано только для роли `OPERATOR` (по бригаде), а `ASSISTANT` список НЕ сужается — в отличие от `GET /api/monitoring/fleet`, где помощник сужается (`fleet/route.ts:26-28`). Это и есть суть находки 1 из W136 — подтверждена.
- Право `equipment.read` выдано только `ADMIN`, `DISPATCHER`, `MECHANIC`, `SAFETY_ENGINEER` (`authorization-service.ts:103`). У `OPERATOR`, `ASSISTANT` и `FOREMAN` его нет, поэтому простой `assertCan(user, 'equipment.read')` в GET сломает 4 живых экрана: `/report` и `/inspections/new` у машиниста, `/admin/reports`, `/admin/crews`, `/admin/to` у мастера.
- `GET /api/equipment/[id]` (`[id]/route.ts:45-57`) тоже без `assertCan`: любой вошедший пользователь организации читает карточку любой установки по id. Изоляция только по тенанту.
- Попутно: в мониторинге парка (`fleet/route.ts:26-28`) сужаются только `OPERATOR` и `ASSISTANT`; `FOREMAN` НЕ сужается (вопреки формулировке задачи). Операторская роль на боевом экране (`operator-mobile`) `GET /api/equipment` не вызывает вовсе — идёт через `/api/operator/mobile/state`; поэтому для машиниста риск варианта A сосредоточен в `/report` и `/inspections/new`.
- Кэш `GET /api/equipment` (60 с) ключуется по хешу сессионного токена (`api-wrapper.ts:44-50,93-100`) — межпользовательской утечки нет, это проверено.

## Методика

Что искал и как (воспроизводимо):

1. Вызовы клиента: `grep -rn "api/equipment" src --include=*.tsx --include=*.ts` (плюс `e2e`, `tests`). Отобраны именно `GET /api/equipment` и `GET /api/equipment/[id]`; вызовы подресурсов (`/details`, `/maintenance`, `/meter-readings`, `/fuel`, `/documents`) отмечены отдельно.
2. Права: прочитан `src/services/auth/authorization-service.ts` целиком (таблица `abilityRoles`, строки 62-135; `equipment.read` — 103, `equipment.manage` — 104).
3. Роли: `src/lib/types.ts` — `UserRole` (5-12), `ROLE_LABELS` (15-23), `ACTING_ROLES` (40-49), `resolveEffectiveRole` (74-76).
4. Гварды экранов: `src/lib/require-page-ability.ts`; раскладки `src/app/(app)/admin/equipment/layout.tsx`, `admin/crews/layout.tsx`, `admin/maintenance/layout.tsx`, `admin/reports/layout.tsx`, `(readiness-admin)/layout.tsx`, `(safety)/layout.tsx`, `admin/layout.tsx`, `(app)/layout.tsx`.
5. Навигация по ролям: `src/components/piling/icons/role-navigation.ts` (`ROLE_NAVIGATION`).
6. Серверная выборка: `src/modules/equipment/application/queries/equipment-query.service.ts` — `listAllEquipment` (502-535), `getEquipmentById`/`getEquipmentByIdOrThrow` (18-42).
7. Сравнение: `src/app/api/monitoring/fleet/route.ts` (26-35) и `src/modules/monitoring/application/queries/fleet-monitoring.service.ts` (106-157).
8. Кэш: `src/core/api-wrapper.ts` (86-106, `getSessionCacheScope` 44-50).
9. Существующие тесты: `src/app/api/equipment/__tests__/route.test.ts` (POST only), `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts` (operator scope), `e2e/`.

Найденные вызовы `GET /api/equipment` (список) и `GET /api/equipment/[id]` (карточка):

| Файл:строка | Вызов | Экран | Роли на экране (по гварду/меню) |
|---|---|---|---|
| `src/app/api/equipment/route.ts:13-27` | GET (сервер) | — | право не проверяется |
| `src/app/api/equipment/[id]/route.ts:45-57` | GET [id] (сервер) | — | право не проверяется |
| `src/components/piling/report-form/use-report-form.ts:182` | GET список | `/report` (ReportForm) | OPERATOR (по URL; пункта меню нет), плюс замороженные operator-варианты |
| `src/components/piling/inspections/start-inspection-form.tsx:78` | GET список | `/inspections/new` | любой вошедший (своего гварда у раздела нет) |
| `src/components/piling/admin-equipment/use-equipment-list.ts:28` | GET список | `/admin/equipment` | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER (`equipment.read`) |
| `src/components/piling/admin-equipment/use-equipment-list.ts:77` | GET [id] | `/admin/equipment` | те же |
| `src/components/piling/admin-crews/use-crews-data.ts:83` | GET список | `/admin/crews` | ADMIN, DISPATCHER, MECHANIC, FOREMAN, SAFETY_ENGINEER (`crews.read`) |
| `src/components/piling/admin-reports/use-reports-data.ts:121` | GET список | `/admin/reports` | ADMIN, DISPATCHER, FOREMAN, SAFETY_ENGINEER (`reports.read_all`) |
| `src/components/piling/maintenance/maintenance-board.tsx:129` | GET список | `/admin/maintenance` | ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER (`maintenance.manage`) |
| `src/components/piling/maintenance/maintenance-request-form.tsx:87` | GET список | `/admin/maintenance/new` | те же |
| `src/components/piling/maintenance/work-order-form-dialog.tsx:148` | GET список | `/admin/maintenance` | те же |
| `src/components/piling/to/to-module.tsx:443` | GET список | `/admin/to` | ADMIN, DISPATCHER, MECHANIC, OPERATOR, FOREMAN, SAFETY_ENGINEER (кроме OPERATOR — `usesParkWideData`, `to-module.tsx:424`) |
| `src/components/piling/to/readiness/shift-create-form.tsx:109` | GET список | `/admin/to` | те же |

Примечание: `use-report-form.ts:182` и `start-inspection-form.tsx:78` читают список без `?limit=`, остальные — с `?limit=100`. Все они попадают в один и тот же обработчик GET.

Таблица «роль | читает список | есть ли `equipment.read` | что сломается при `assertCan('equipment.read')`»:

| Роль | Читает список (где) | `equipment.read` | Что сломается при безусловном `assertCan` |
|---|---|---|---|
| ADMIN | да: `/admin/equipment`, `/admin/crews`, `/admin/reports`, `/admin/maintenance`, `/admin/to`, `/inspections/new`, `/report` | да (`:103`) | ничего |
| DISPATCHER | да: те же админские экраны | да (`:103`) | ничего |
| MECHANIC | да: `/admin/equipment`, `/admin/crews`, `/admin/maintenance`, `/admin/to`, `/inspections/new` | да (`:103`) | ничего |
| SAFETY_ENGINEER | да: `/admin/equipment`, `/admin/crews`, `/admin/reports`, `/admin/maintenance`, `/admin/to`, `/inspections/new` | да (`:103`) | ничего |
| FOREMAN | да: `/admin/crews`, `/admin/reports`, `/admin/to` | нет | 403 в фильтрах трёх экранов: `use-crews-data.ts:83`, `use-reports-data.ts:121`, `to-module.tsx:443` |
| OPERATOR | да: `/report`, `/inspections/new` (сужен до своей техники, `route.ts:23`) | нет | 403 в выборе установки: `use-report-form.ts:182`, `start-inspection-form.tsx:78` |
| ASSISTANT | живого вызова нет (его модуль — только `/admin/safety`); при прямом запросе список НЕ сужен | нет | прямых поломок нет, но появится 403 на возможных будущих вызовах |

## Находки

| # | Severity | path:line | Проблема | Сценарий / почему это важно | Предлагаемое исправление |
|---|---|---|---|---|---|
| 1 | критично | `src/app/api/equipment/route.ts:13-27` | `GET` не вызывает `assertCan`; право `equipment.read` только у 4 ролей, а доступ открыт любому вошедшему; сужение (`:23`) только для `OPERATOR` | Помощник (`ASSISTANT`) обращается к `GET /api/equipment` (например, скриптом или через сломанный UI) и получает ВЕСЬ парк организации — в отличие от мониторинга, где он сужен. Отказ по умолчанию для `ASSISTANT` в матрице (`authorization-service.ts:152-156`) здесь не работает, т.к. права вообще не спрашивают | Ввести проверку чтения (вариант A или B ниже); как минимум — не отдавать полный список ролям без `equipment.read` |
| 2 | важно | `src/app/api/equipment/[id]/route.ts:45-57` | `GET` карточки: нет `assertCan` и нет ролевой проверки доступа к конкретной установке. Есть только изоляция по тенанту в `getEquipmentByIdOrThrow` (`equipment-query.service.ts:26-42`) | Любой вошедший пользователь организации читает по id карточку любой установки (паспорт, характеристики, состав бригад) — включая не связанную с ним. `ASSISTANT`/`OPERATOR` получают то же, что механик | Добавить проверку права на чтение и/или проверку «эта установка доступна роли» (для `OPERATOR`/`ASSISTANT` — по активной бригаде) |
| 3 | важно | `src/services/auth/authorization-service.ts:103` | `equipment.read` выдан только `ADMIN`, `DISPATCHER`, `MECHANIC`, `SAFETY_ENGINEER`; `OPERATOR`, `ASSISTANT`, `FOREMAN` отсутствуют | Именно поэтому «просто добавить `assertCan`» нельзя: машинист (`use-report-form.ts:182`, `start-inspection-form.tsx:78`) и мастер (`use-reports-data.ts:121`, `use-crews-data.ts:83`, `to-module.tsx:443`) получат 403 и увидят не «нет техники», а отказ. Это ответ на вопрос задачи: сначала аналитика, потом право | Заводить право на чтение — но вместе с расширением списка ролей либо с альтернативным сужением (варианты ниже) |
| 4 | важно | `src/app/api/equipment/route.ts:23` | Сужение списка сделано только для `OPERATOR` (`user.role === 'OPERATOR'`), `ASSISTANT` не сужается | Помощник получает весь парк; для сравнения `GET /api/monitoring/fleet` (`src/app/api/monitoring/fleet/route.ts:26-28`) сужает и `OPERATOR`, и `ASSISTANT`. Две ветки одного и того же правила расходятся | При сужении учесть `ASSISTANT` так же, как в fleet (или принять решение владельца, что помощнику список не положен) |
| 5 | важно | `src/modules/equipment/application/queries/equipment-query.service.ts:512-520` | Сужение только по активной бригаде (`crews.some.operatorId`); `siteId` учитывается лишь при непустом `siteId`; ссылка на активную бригаду обязательна | У машиниста без активной бригады список пуст (это нормально), но если бригада есть на другом объекте, установка всё равно покажется (комментарий `use-report-form.ts:177-180`). Поведение осознанное, но при расширении сужения на `ASSISTANT`/`FOREMAN` его нужно определить явно | Явно описать правило сужения по роли (бригада/объект), чтобы не разошлось с fleet |
| 6 | мелочь | `src/components/piling/report-form/use-report-form.ts:177-180` | Комментарий «операторам показываем закреплённую за ними технику» описывает только `OPERATOR`, а `ASSISTANT` сужением не покрыт | Документация отстаёт от кода: следующая правка сужения будет опираться на неверный комментарий | Обновить комментарий вместе с правкой сужения |
| 7 | мелочь | `src/app/(app)/report/page.tsx`, `src/app/(app)/inspections/new/page.tsx` | У экранов нет серверного гварда `requirePageAbility` (в отличие от `/admin/*`); раздел открывается любой ролью, а данные тянет `GET /api/equipment` | Пока право на чтение не заведено на API, экран доступен по URL всем вошедшим. Это и есть скрытый канал раскрытия списка из находки 1 | Либо серверный гвард экрана, либо проверка на API (варианты ниже) |
| 8 | мелочь | `src/app/api/equipment/__tests__/route.test.ts:1-38` | Существующий тест роута проверяет только POST (и мокает `assertCan`); GET-авторизация тестами не покрыта | Ничто не поймает регрессию «GET снова открыт всем» или «GET снова закрыт для машиниста» | Добавить тест GET: роль без права → 403 (вариант A) или «машинист видит только свою технику» (вариант B) |
| 9 | мелочь | `src/app/api/equipment/route.ts:28` | Ответ списка кэшируется 60 с (`cache: true, cacheTTL: 60_000`) | Ключ кэша — хеш сессионного токена + `actingAs` (`api-wrapper.ts:44-50,93-100`), поэтому межпользовательской утечки через кэш нет. Отмечено как проверенный факт, а не проблема: при смене модели сужения кэш надо пересчитать | Пересмотреть TTL/ключ, если сужение станет ролевым, а не персональным |
| 10 | мелочь | `src/app/api/monitoring/fleet/route.ts:26-28` (сравнение), `fleet-monitoring.service.ts:119-133` | Вопреки формулировке задачи, в fleet сужаются только `OPERATOR` и `ASSISTANT`; `FOREMAN` не сужается и видит весь парк мониторинга | Расхождение формулировки и кода: `FOREMAN` в мониторинге видит всё, а в `/admin/to` — тот же парк, что диспетчер. Если ожидалось сужение мастера, оно не сделано | Уточнить у владельца ожидаемое правило для `FOREMAN` в мониторинге |

## Варианты минимального исправления (выбор за владельцем)

### Вариант A — выдать `equipment.read` нужным ролям и проверять на GET

Что менять:

- `src/services/auth/authorization-service.ts:103`: добавить в `abilityRoles['equipment.read']` роли `OPERATOR`, `FOREMAN` (и, при решении владельца, `ASSISTANT`). Это только чтение — расширять безопасно, в отличие от `equipment.manage` (`:104`, остаётся только `ADMIN`).
- `src/app/api/equipment/route.ts:13-27`: добавить `assertCan(user!, 'equipment.read')` до выборки; сужение по `operatorUserId` для `OPERATOR` (и `ASSISTANT`) оставить.
- `src/app/api/equipment/[id]/route.ts:45-57`: добавить `assertCan(user!, 'equipment.read')`; по желанию — дополнительно ограничить `OPERATOR`/`ASSISTANT` своей установкой.

Тесты:

- `src/app/api/equipment/__tests__/route.test.ts`: GET от роли без права (например, произвольной) → 403; от `OPERATOR`/`FOREMAN` → 200.
- `src/app/api/equipment/[id]/__tests__/`: GET без права → 403.
- Проверить, что сужение `OPERATOR` сохранилось (`equipment-query.service.test.ts:59-110` уже это покрывает).

Плюсы: одно право, единая точка отказа, закрывает и список, и карточку. Минусы: `FOREMAN`/`ASSISTANT` получают доступ к полному парку — если это нежелательно, нужен вариант B.

### Вариант B — не вводить право на чтение, но сузить список по роли

Что менять:

- `src/app/api/equipment/route.ts:23`: расширить сужение — не только `OPERATOR`, но и `ASSISTANT`, по образцу `fleet/route.ts:26-28`; `FOREMAN` — либо как диспетчер (весь парк), либо по объектам участка (решение владельца).
- `src/app/api/equipment/[id]/route.ts:45-57`: проверять, что установка доступна роли (для `OPERATOR`/`ASSISTANT` — есть активная бригада с этим человеком), иначе 404/403.
- `listAllEquipment` (`equipment-query.service.ts:502-535`) — при ролевом сужении добавить параметр/правило явно.

Тесты:

- `equipment-query.service.test.ts`: `ASSISTANT`/`OPERATOR` видят только свою технику, `FOREMAN`/`ADMIN` — весь парк.
- Роут-тест `[id]`: чужой id → 404/403 для `OPERATOR`.

Плюсы: не трогаем матрицу прав, поведение совпадает с мониторингом. Минусы: правило сужения живёт в маршруте (а не в правах), легко разойтись с другими читателями списка; придётся явно решить правило для `FOREMAN`.

Общее для обоих: комментарии `use-report-form.ts:177-180` и `role-navigation.ts` (записи у `MECHANIC` про `equipment.read`) обновить, если поведение меняется.

## Не проверено

- Не проверено, вызывает ли `GET /api/equipment`/`[id]` кто-либо за пределами найденных `src` и `e2e` файлов (внешние интеграции, скрипты вне репозитория) — доступен только grep по репозиторию.
- Не проверено фактическое поведение в проде: у `ASSISTANT` и `OPERATOR` реальных пользователей может не быть; выводы о поломках основаны на коде и раскладках, не на живом прогоне.
- Не проверено, требуется ли помощнику `ASSISTANT` список установок по бизнес-логике (решение владельца) — поэтому оба варианта оставляют этот пункт открытым.
- Не проверено, есть ли у `FOREMAN` ожидаемое сужение в мониторинге (находка 10) — код сужения мастера не содержит, но намерение владельца в задаче сформулировано иначе.
- Проверка типов/линт/тесты не запускались: задача только на чтение, код не менялся.
