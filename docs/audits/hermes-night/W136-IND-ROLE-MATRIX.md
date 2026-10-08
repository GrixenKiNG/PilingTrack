# W136-IND-ROLE-MATRIX: матрица роль → действие → разрешение (независимый аудит)

Аудируемая версия: код в `D:/PillingR/wt-audit-0f53`, **SHA `0f53cd01`** (`0f53cd01a264ffae97e3eaa7fea7582d90bf657d`).
Отчёт: только чтение, ничего не запускалось, база и `.env` не читались. Замороженные области
(варианты операторского экрана, ORION) не разбирались, кроме пометок, где маршрут лежит в списке.
Первый проход сделан **без чтения прочих отчётов** `docs/audits/`; сравнение — только в приложении.

## Итог

- Всего находок: **20** — критично **0**, важно **6**, мелочь **14**.
- Роли в коде (`src/lib/types.ts:5-12`): `ADMIN`, `DISPATCHER`, `OPERATOR`, `ASSISTANT`, `MECHANIC`,
  `FOREMAN`, `SAFETY_ENGINEER`. Права — две системы: карта способностей `authorization-service.ts:62-135`
  и публикуемая матрица готовности `readiness/domain/access-matrix.ts`. Замещение (`x-acting-as`,
  `ACTING_ROLES`, `types.ts:40-49`) учитывает `can()` (`authorization-service.ts:158-160`), но **не**
  прямые проверки `user.role`.
- Проверено **141** файл `route.ts` в `src/app/api/**`. Почти все читающие/пишущие маршруты бизнес-API
  закрыты `assertCan`/`assertRole`/`capabilities.has` внутри обработчика либо в вызываемой команде/сервисе.
- Топ-5:
  1. `GET /api/equipment` (`src/app/api/equipment/route.ts:13-28`) — проверки способности нет вовсе;
     `FOREMAN`/`ASSISTANT` (у которых нет `equipment.read`, `authorization-service.ts:103`) получают
     весь парк организации. Сужение до своей установки есть только для `OPERATOR` (`:23`).
  2. `GET /api/equipment/[id]` (`src/app/api/equipment/[id]/route.ts:45-54`) — проверки нет ни на какую
     роль; любую карточку парка тенанта читает любая аутентифицированная роль, включая `ASSISTANT`.
     Тот же домен по соседнему маршруту требует `equipment.read` (`.../[id]/details/route.ts:30`).
  3. Класс прямых `user!.role !== 'ADMIN'` вместо `assertCan`/`assertRole`: `settings/route.ts:27`,
     `monitoring/template/route.ts:29`, `layout/[surfaceId]/route.ts:55,82` — игнорируют замещение,
     «админ в роли механика» всё равно правит настройки, шаблон плиток и раскладку.
  4. Список парка для `ASSISTANT` не сужается: `equipment/route.ts:23` сужает только `OPERATOR`, тогда
     как живой дашборд сужает `OPERATOR` и `ASSISTANT` (`monitoring/fleet/route.ts:28`). Помощник видит
     парк целиком.
  5. `GET /api/reports/[id]/history` (`reports/[id]/history/route.ts:13,15`) закрыт только
     `reports.read_all` и передаёт `id` без тенанта; тенант берётся из самого отчёта
     (`report-history-service.ts:32-37`), поэтому `FOREMAN`/`SAFETY_ENGINEER` (роли с `read_all`, но без
     живых людей) читали бы историю чужого отчёта по угаданному id.

## Методика

Воспроизводимо из `D:/PillingR/wt-audit-0f53`; поиск — `search_files`/`read_file` (без `rg -r`, иначе MSYS
подменяет шаблон). Все пути ниже — относительно `wt-audit-0f53/src`.

1. Определения ролей: `lib/types.ts:5-12` (`UserRole`), `lib/types.ts:15-23` (`ROLE_LABELS`),
   `lib/types.ts:40-49` (`ACTING_ROLES`), `lib/types.ts:58-61` (`canActAs`),
   `services/auth/authorization-service.ts:20` (`Role`), `:22-52` (`Ability`), `:62-135` (`abilityRoles`),
   `:137-139` (`isPrivilegedRole`), `:158-181` (`can`/`assertCan`/`assertRole`/`assertAnyRole`),
   `modules/readiness/domain/capability-defaults.ts`, `modules/readiness/domain/access-matrix.ts`.
2. Обёртки и аутентификация: `core/api-wrapper.ts:62-147` (`withApi`), `:178-223` (`withMutation`,
   CSRF+лимиты, роли не проверяет), `lib/auth.ts:158-212` (`requireAuth`: сессия + `actingAs` через
   `canActAs`), `lib/tenant.ts:25-31` (`requireTenantId`).
3. Перечень маршрутов: `search_files` по `src/app/api` на `route.ts` → 141 файл. Для каждого файла снят
   дамп строк по регулярному выражению (`export ... GET|POST|PUT|PATCH|DELETE`, `withApi|withMutation`,
   `requireAuth|assertCan|assertRole|assertAnyRole|can(`, `tenantId|requireTenantId|actingAs|.role`);
   дамп прочитан построчно и сверен с открытыми файлами.
4. Маршруты без явной проверки — читались вызываемые функции, куда передан `user`/`tenantId`:
   `services/users/user-documents.ts`, `services/users/user-document-types.ts`,
   `services/users/user-document-access.ts`, `modules/reports/application/queries/report-query.service.ts`,
   `modules/sites/application/queries/site-query.service.ts`, `modules/safety/**`,
   `modules/readiness/application/**` (включая `bootstrap-query.ts`, `shifts/commands.ts:48-52`,
   `permits/commands.ts:63-67`, `defects/commands.ts:54-64`).
5. Матрица готовности: `app/api/readiness/_shared/request-context.ts:66-92` (контекст + `capabilities`),
   `_shared/route-adapter.ts:13-30` (`withReadinessCommand`), проверки `capabilities.has(...)` в 12 маршрутах.
6. Роли сверялись по `AGENTS.md §3`: `ADMIN`/`DISPATCHER` — платформенные, видят все тенанты по решению
   владельца; `FOREMAN`/`SAFETY_ENGINEER` живых пользователей не имеют (в расхождениях отмечено отдельно);
   `MECHANIC` и `ASSISTANT` — реальные, но `ASSISTANT` не знает **ни одной** способности
   (`authorization-service.ts:152-156`), поэтому попадает только в маршруты без `assertCan`.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | как править |
|---|---|---|---|---|---|
| 1 | важно | `src/app/api/equipment/route.ts:13-28` (право: `src/services/auth/authorization-service.ts:103`) | `GET /api/equipment` не вызывает `assertCan`; сужение до «своей» установки есть только для `OPERATOR` (`:23`), для всех прочих `operatorUserId = null` | `FOREMAN` и `ASSISTANT` не имеют `equipment.read` (карта: ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER), но получают весь парк тенанта. Роль без права читает раздел, который ей закрыт в меню | `assertCan(user, 'equipment.read')` перед выборкой либо явно записать в карту, что чтение парка положено всем, и убрать право |
| 2 | важно | `src/app/api/equipment/[id]/route.ts:45-54` (ср. `src/app/api/equipment/[id]/details/route.ts:30`) | `GET /api/equipment/[id]` — только `requireAuth` + `requireTenantId`, проверки роли нет ни на какую способность | Любая аутентифицированная роль тенанта читает любую карточку установки по id, тогда как детальная карточка (`details`) требует `equipment.read`. Один домен отвечает по-разному | Добавить `assertCan(user!, 'equipment.read')` (либо единый помощник чтения установки) |
| 3 | важно | `src/app/api/settings/route.ts:27`; `src/app/api/monitoring/template/route.ts:29`; `src/app/api/layout/[surfaceId]/route.ts:55,82` | Четыре маршрута правят по `user!.role !== 'ADMIN'` — по собственной роли, игнорируя `actingAs`; `can()`/`assertRole` считают исполняемую роль (`authorization-service.ts:158-181`) | Режим «Действую как» здесь не ограничивает: админ в роли механика меняет настройки организации, шаблон плиток мониторинга и раскладку. В журнале при этом стоит «действует как механик» — подпись расходится с действием | `assertRole(user, 'ADMIN')` (исполняемая роль) единым помощником на все четыре маршрута |
| 4 | важно | `src/app/api/equipment/route.ts:23` против `src/app/api/monitoring/fleet/route.ts:28` | Список парка сужается только для `OPERATOR`; дашборд парка сужает `OPERATOR` **и** `ASSISTANT` | `ASSISTANT` (помощник машиниста) на `/api/equipment` видит парк всей организации, хотя рядом живой экран показывает ему только его установки | Согласовать условие сужения с `monitoring/fleet/route.ts:28` (`OPERATOR`/`ASSISTANT`) |
| 5 | важно | `src/app/api/reports/[id]/history/route.ts:13,15`; `src/services/reports/report-history-service.ts:32-37` | GET закрыт только `reports.read_all`, `getReportHistory(id)` вызывается без тенанта; тенант выводится из самого отчёта, `ensureTenantAccess` не вызывается | Для `FOREMAN`/`SAFETY_ENGINEER` (`reports.read_all`, `authorization-service.ts:64`) угаданный id отчёта другой организации вернул бы его историю и подписи. Для ADMIN/DISPATCHER это по устройству, для остальных — нет. Сейчас прикрыто лишь тем, что живых людей у этих ролей нет | Перед выборкой: `await ensureTenantAccess(user!, report.tenantId, 'Report')` (как в `single-pdf`) |
| 6 | важно | `src/app/api/telemetry/route.ts:111,366-372`; `src/app/api/telemetry/batch/route.ts:86` | Роль проверяется локальной функцией `assertAnyRole` (`:366`), а не импортируемой из `authorization-service`; в `batch` — inline-массив `['ADMIN','DISPATCHER','OPERATOR']` (`:86`). Обе проверки читают `user.role` и **не** учитывают `actingAs` | Администратор в режиме «Действую как механик» продолжает принимать телеметрию с полными правами, тогда как весь остальной API в этом режиме его ограничивает. Плюс две копии одного правила вместо одной | Использовать `assertAnyRole`/`assertCan` из `authorization-service` (`:177-181`) — тогда замещение учитывается само |

### Мелочи (согласованность и чтение)

| # | severity | path:line | проблема | почему стоит поправить | как править |
|---|---|---|---|---|---|
| 7 | мелочь | `src/app/api/dictionary/all/route.ts:14-17` | `GET /api/dictionary/all` без способности: любой аутентифицированный получает все справочники тенанта (марки свай, типы бурения, причины простоев) | Справочники — не персональные данные, но чтение отдано всем, а правка — `dictionary.manage`. Кода, объясняющего это решение, в файле нет | Решить явно: либо `assertCan(user, 'system.read')`/`'dictionary.manage'`, либо комментарий-обоснование |
| 8 | мелочь | `src/app/api/checklist-templates/route.ts:48`; `src/app/api/checklist-templates/[id]/route.ts:48` | Чтение (`GET`) шаблонов осмотра закрыто «управляющим» правом `maintenance.manage` — отдельного права на чтение нет | Мастер (`authorization-service.ts:108` даёт ему `maintenance.manage`? — нет: карта включает ADMIN, DISPATCHER, MECHANIC, SAFETY_ENGINEER) не видит список чёт-листов, хотя читал бы. «Нет права на чтение» выглядит для экрана как «списка нет» | Ввести `maintenance.read` или явно расширить `maintenance.manage`, если список положено читать шире |
| 9 | мелочь | `src/app/api/maintenance/route.ts:15`; `src/app/api/maintenance/[id]/route.ts:16`; `.../assignees/route.ts:15`; `.../kpi/route.ts:45`; `src/app/api/maintenance-plans/route.ts:32` | Все чтения обслуживания (список, карточка, исполнители, KPI, планы ТО) закрыты `maintenance.manage` — права на чтение нет | Тот же класс, что №8: отказ доступа к списку неотличим от «заявок нет». См. `AGENTS.md`/историю: чтение, закрытое на «управлять», уже давало ложные нули | Отдельное `maintenance.read` или явное решение владельца |
| 10 | мелочь | `src/app/api/dictionary/manage/route.ts:69`; `src/app/api/telegram/configs/route.ts:46`; `src/app/api/admin/dlq/route.ts:55`; `src/app/api/equipment/[id]/device-keys/route.ts:102`; `src/app/api/system/route.ts:18`; `src/app/api/to/journal/route.ts:16`; `src/app/api/pile-passports/route.ts:34`; `src/app/api/notification.../telegram/test/route.ts:29` | Ряд чтений закрыт «управляющими» правами: `dictionary.manage`, `telegram.manage`, `dlq.manage`, `equipment.manage`, `users.manage`, `maintenance.manage`, `piles.manage`; тест Telegram закрыт `reports.read_all` | Права на чтение для этих доменов в карте отсутствуют, а `reports.read_all` на POST-тест связи — постороннее право (почему тест Telegram открыт чтецу отчётов, не объяснено) | Ввести `*.read` там, где чтение положено шире правки; для Telegram-теста — `telegram.manage` |
| 11 | мелочь | `src/app/api/readiness/access-matrix/route.ts:25`; `src/app/api/readiness/permit-form-options/route.ts:30` | Чтение закрыто на «управлять»: `capabilities.has('readiness.rules.manage')` на GET матрицы доступов; `'readiness.permit.edit'` на GET опций формы наряда | Отказ на чтение выглядит как пустой экран настроек; при этом пишущие PUT/POST тех же маршрутов проверяются теми же способностями (логика согласована, но «чтение = управление») | Разделять `readiness.rules.read` / `readiness.permit.read`, если настройки/формы положено открывать на просмотр |
| 12 | мелочь | `src/app/api/feedback/events/route.ts:147-155` | `POST` — создание события. Роль влияет только на `audience` (`:154`), а `level`, `priority`, `scope`, `action`, `targetId`, `metadata` берутся из тела как есть; в допустимых `level` есть `'audit'` (`:15`) | Непривилегированный пользователь создаёт событие с `level:'audit'` и произвольным `action`, попадающее в ленту обратной связи с его подписью. `audience` сужен до `USER`, поэтому вред ограничен, но подделка «аудиторского» уровня возможна | Ограничить `level`: непривилегированным — только `info/success/warn/error`, `'audit'` — при `ADMIN`/`DISPATCHER` |
| 13 | мелочь | `src/app/api/readiness/place-presets/route.ts:32,67-77` | `POST`/`DELETE` личных подсказок места не проверяют ни одной способности готовности (только `requireAuth` в резолвере контекста) | Список личный (обе операции фильтруют `context.actorId`), расхождения с интерфейсом нет, но запись доступна любому аутентифицированному, даже без `readiness.read` | Добавить `capabilities.has('readiness.read')` хотя бы на POST/DELETE или комментарий-обоснование |
| 14 | мелочь | `src/app/api/assistant/state/route.ts:22`; `src/app/api/assistant/command/route.ts:39` | Роль проверяется прямым `user.role !== 'ASSISTANT'` — по собственной роли, замещение не учитывается | Админ в режиме «Действую как механик» этот контур не откроет и не закроет предсказуемо; правило живёт третьим способом (после `can()` и `capabilities`) | `resolveEffectiveRole`/`assertRole`-совместимая проверка |
| 15 | мелочь | `src/app/api/operator/knowledge-attempt/route.ts:9`; `src/app/api/operator/mobile/state/route.ts:22`; `src/app/api/operator/mobile/command/route.ts:192` | Роли `OPERATOR`/`ASSISTANT` проверяются прямыми сравнениями `user.role`, замещение не учитывается | Тот же класс, что №14; в операторском контуре замещение пока не используется, поэтому спит | Единый помощник на все прямые проверки роли |
| 16 | мелочь | `src/app/api/equipment/[id]/fuel/route.ts:22`; `src/app/api/equipment/[id]/meter-readings/route.ts:26` | `assertOperatorOwnsEquipment` сужает машину только для `OPERATOR`; для остальных ролей с `meter.record` (MECHANIC, SAFETY_ENGINEER, DISPATCHER, ADMIN) — любая установка тенанта | Это осознанно (офис вправе писать по любой машине, комментарий в файле), но `ASSISTANT` не ограничен и при этом не имеет `meter.record` — то есть защита держится только на карте способностей | Оставить, но при расширении `meter.record` на помощника сужение надо будет пересмотреть |
| 17 | мелочь | `src/app/api/health/route.ts:24`; `src/app/api/health/deep/route.ts:34`; `src/app/api/liveness/route.ts:13`; `src/app/api/ready/route.ts:27`; `src/app/api/readiness/route.ts:26`; `src/app/api/route.ts:13` | Шесть публичных GET без аутентификации (пробы живости/готовности, корневой статус). `/api/health/deep` и `/api/readiness` не отдают `details` (санитизация), но доступны анонимно | Это пробы для балансировщика — по замыслу публичны. Отмечено, чтобы «нет проверки» не читалось как дефект | Ничего, если политика допускает; иначе — token/IP-фильтр на `/health/deep` |
| 18 | мелочь | `src/app/api/alerts/webhook/route.ts:88` | `POST` без сессии — авторизация общим секретом `ALERTMANAGER_WEBHOOK_TOKEN` (constant-time сравнение) | Секрет в query-параметре (`?token=`) попадает в логи прокси; тенант — `DEFAULT_TENANT_ID` (`:123`). Для однократного деплоя приемлемо | Предпочесть заголовок `Authorization` и запретить `token` в query |
| 19 | мелочь | `src/app/api/telemetry/ingest/route.ts:95,141,341` | `POST`/`PATCH`/`GET` не проходят `requireAuth` — устройство предъявляет ключ (`:302`), тенант берётся из ключа; строки без тенанта отсекаются (`:296-305`) | Осознанный канал «контроллер телеметрии». Маршрут прочитан частично (см. «Не проверено») | Ничего; при ревизии — перечитать целиком |
| 20 | мелочь | `src/app/api/media/download-batch/route.ts:31-64` | `GET` начинается с `requireAuth`; проверка доступа к каждому файлу (`assertCanAccessMedia(..., 'read')`) в дампе не подтверждена построчно | Пакетная выгрузка файлов — место, где одна ошибка открывает чужие документы. Точную строку не сверял (см. «Не проверено») | Перечитать маршрут и убедиться, что доступ проверяется на каждый `id` до отдачи |

## Таблица маршрутов

Формат: маршрут (`src/app/api/...`) | методы | доступ | проверка (файл:строка) | статус.
«OK» — роль/право проверяется явно; «без способности» — аутентификация есть, роли нет; «в сервисе/команде» —
проверка в вызываемой функции (строки в этой же таблице).

### admin

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| admin/analytics/overview | GET | `analytics.read` (ADMIN,DISPATCHER,FOREMAN) | `:156`, tenant `:157` | OK |
| admin/analytics/site-weekly-trend | GET | `analytics.read` | `:14`, tenant `:16` | OK |
| admin/dlq | GET, POST | `dlq.manage` (ADMIN) | `:55`,`:110`; tenant `:57` | OK (чтение под «управлять») |
| admin/equipment-analytics | GET | `analytics.read` | `:14`, tenant `:26` | OK |
| admin/incidents | GET, POST | `incidents.read` / `incidents.review` | `:28`,`:105`; tenant `:29`,`:106` | OK |
| admin/projections/rebuild | POST | `projections.rebuild` (ADMIN) | `:42` | OK |

### alerts / analytics / assistant / audit / auth

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| alerts/webhook | POST | общий секрет (ALERTMANAGER_WEBHOOK_TOKEN) | `:76-90` | OK (без сессии, по замыслу) |
| analytics/sites | GET | `sites.read_all` | `:18`; tenant `:21` | OK |
| assistant/command | POST | только `ASSISTANT` | `user.role!==` `:39`; tenant `:52` | прям. роль (№14) |
| assistant/state | GET | только `ASSISTANT` | `user.role!==` `:22`; tenant `:27` | прям. роль (№14) |
| audit | GET | `system.read` | `:17`; tenant из user `:30` | OK |
| auth/login | POST | публичный (сессии ещё нет), свой CSRF | `:17`, `:21-22` | OK |
| auth/logout | POST | requireAuth (роль не нужна) | `:15` | OK |
| auth/me | GET | `reports.read_cross_user` при `?userId` | `resolveAccessibleUserId` `:26`, `ensureTenantAccess` `:43` | OK |

### briefings / checklist-templates / crews / dictionary

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| briefings | POST | `users.documents.read_all` | `can` `:52` → `briefing-commands.ts:55` | OK |
| briefings/journal | GET | `users.documents.read_all` | `can` `:60` | OK |
| briefings/[id]/sign | POST | участие в записи (сверка id сессии) | `signBriefingRecord` | OK |
| checklist-templates | GET, POST | `maintenance.manage` | `:48`,`:63` | OK (чтение под «управлять», №8) |
| checklist-templates/[id] | GET, PUT, DELETE | `maintenance.manage` | `:48`,`:68`,`:96` | OK (№8) |
| crews | GET, POST | `crews.read` / `crews.manage` | `:23`,`:42` | OK |
| crews/all | GET | `crews.read` | `:24`; фильтр по tenant `:28` | OK |
| crews/my | GET | requireAuth; id из сессии | `getCrewForOperator` (scoping) | OK |
| crews/[id] | GET, PUT, DELETE | `crews.read` / `crews.manage` | `:23`+`ensureTenantAccess` `:28`; `:40`,`:80` | OK |
| dictionary/all | GET | requireAuth | нет | без способности (№7) |
| dictionary/manage | GET, POST, PATCH, DELETE | `dictionary.manage` (ADMIN) | `:69`,`:93`,`:108`,`:131` | OK (чтение под «управлять», №10) |

### equipment

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| equipment | GET | requireAuth; сужение только OPERATOR | нет (`:23`) | **без способности (№1, №4)** |
| equipment | POST | `equipment.manage` | `:37` | OK |
| equipment/[id] | GET | requireAuth + tenant | нет | **без способности (№2)** |
| equipment/[id] | PUT, DELETE | `equipment.manage` | `:65`,`:131` | OK |
| equipment/[id]/details | GET | `equipment.read` | `:30` | OK |
| equipment/[id]/documents | POST | `equipment.manage` | `:32` | OK |
| equipment/[id]/documents/[docId] | PUT, DELETE | `equipment.manage` | `:36`,`:66` | OK |
| equipment/[id]/device-keys | GET, POST, DELETE | `equipment.manage` | `:102`,`:70`,`:132` | OK (чтение под «управлять», №10) |
| equipment/[id]/fuel | GET, POST | `meter.record`; оператор — своя машина | `:48`,`:84`; `:22-26` | OK |
| equipment/[id]/fuel/[entryId] | DELETE | `maintenance.manage` | `:19` | OK |
| equipment/[id]/maintenance | GET, POST | `maintenance.manage` | `:44`,`:60` | OK (№9) |
| equipment/[id]/maintenance/[recordId] | PUT, DELETE | `maintenance.manage` | `:46`,`:120` | OK |
| equipment/[id]/meter-readings | GET, POST | `meter.record` | `:47`,`:70`; `:26-30` | OK |
| equipment/[id]/meter-readings/[readingId] | DELETE | `maintenance.manage` | `:18` | OK |

### feedback / health / inspections / layout / liveness / maintenance

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| feedback/events | GET | requireAuth (свои) | — | OK |
| feedback/events | POST, PATCH | requireAuth; `acknowledge` — ADMIN/DISPATCHER | `:116`,`:154` | OK (№12) |
| feedback/stream | GET | requireAuth | `:17` | OK |
| health, health/deep, liveness | GET | публичные пробы | — | OK (№17) |
| inspections | GET, POST | `inspection.perform`; OPERATOR — свои | `:38`,`:58`; self `:46` | OK |
| inspections/[id] | GET, PUT | `inspection.perform` | `:29`,`:51` | OK |
| inspections/[id]/complete | POST | `inspection.perform` | `:22` | OK |
| layout/[surfaceId] | GET | requireAuth + tenant | tenant `:36` | OK |
| layout/[surfaceId] | PUT, DELETE | `user.role==='ADMIN'` | `:55`,`:82` | прям. роль (№3) |
| maintenance | GET | `maintenance.manage` | `:15` | OK (№9) |
| maintenance/[id] | GET | `maintenance.manage` | `:16` | OK (№9) |
| maintenance/[id]/accept | POST | `maintenance.manage` + `assertRole ADMIN` | `:19`,`:24` | OK |
| maintenance/assignees | GET | `maintenance.manage` | `:15` | OK (№9) |
| maintenance/kpi | GET | `maintenance.manage` | `:45` | OK (№9) |
| maintenance-plans | GET, POST | `maintenance.manage` | `:32`,`:56` | OK (№9) |
| maintenance-plans/[id] | PATCH, DELETE | `maintenance.manage` | `:34`,`:64` | OK |
| maintenance-plans/run | POST | `maintenance.manage` | `:18` | OK |

### media / metrics / monitoring / notifications / operator

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| media | POST, GET | доступ к сущности | `assertCanAccessMediaEntity` `:41`,`:78` | OK |
| media/[id] | DELETE | доступ к медиа | `assertCanAccessMedia` `:27` | OK |
| media/[id]/confirm | POST | доступ к медиа | `assertCanAccessMedia` `:26` | OK |
| media/[id]/download | GET | доступ к медиа (`read`) | `assertCanAccessMedia` `:28` | OK |
| media/download-batch | GET | requireAuth | подтверждение не сверено | не проверено (№20) |
| metrics | GET | `system.read` | `:53` | OK |
| monitoring/fleet | GET | requireAuth; OPERATOR/ASSISTANT сужены | `:28` | без способности, но сужение по роли |
| monitoring/template | GET | requireAuth | нет | без способности |
| monitoring/template | PUT | `user.role==='ADMIN'` | `:29` | прям. роль (№3) |
| notifications/telegram/test | POST | `reports.read_all` | `:29` | постороннее право (№10) |
| operator/knowledge-attempt | GET | OPERATOR/ASSISTANT | `:9` | прям. роль (№15) |
| operator/mobile/command | POST | только OPERATOR | `:192`, tenant `:195` | прям. роль (№15) |
| operator/mobile/state | GET | только OPERATOR | `:22`, tenant `:25` | прям. роль (№15) |
| operator/shift | GET | requireAuth; id из сессии | `getOperatorShiftFacts(id)` `:22` | OK |

### orion (заморозка) / pile-passports / readiness

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| orion/lead | POST | публичный (`DEFAULT_TENANT_ID`) | `:79-92` | заморозка, не разбирался |
| pile-passports | GET | `piles.manage` | `:34` | OK (чтение под «управлять», №10) |
| pile-passports/export | GET | `piles.manage` | `:60` | OK (№10) |
| pile-passports/[id]/decide | POST | `piles.manage` | `:29` | OK |
| readiness/bootstrap | GET | `readiness.read` (своя роль для входа) | `bootstrap-query.ts:140` | OK |
| readiness/current | GET | `readiness.read` | `:16` | OK |
| readiness/shifts, shifts/[id] | GET | `readiness.read` | `:21` / `[id]:17` | OK |
| readiness/shifts/* (POST/PATCH) | POST/PATCH | команда сверяет способность | `shifts/commands.ts:48-52` | OK |
| readiness/handovers/[id], [id]/accept, [id]/rework | GET/POST | `readiness.read` / команда | `handovers/[id]:11` | OK |
| readiness/work-permits, [id] | GET/POST/PATCH | `readiness.read` / `readiness.permit.edit` | `work-permits:25`; `[id]:19`; `permits/commands.ts:63-67` | OK |
| readiness/work-permits/[id]/{submit,approve,revoke} | POST | команда сверяет способность | `permits/commands.ts:212` | OK |
| readiness/defects, defects/[id]/{triage,resolve,reject} | GET/POST | `readiness.read` / `readiness.defect.*` | `defects/route.ts:30`; `defects/commands.ts:54-64` | OK |
| readiness/history | GET | `readiness.read` | `:16` | OK |
| readiness/export | GET | `readiness.read` / `readiness.audit.export` | `:28-29` | OK |
| readiness/audit | GET | `readiness.audit.read` | `:18` | OK |
| readiness/access-matrix | GET/PUT/POST | `readiness.rules.manage` | `:25`,`:32`,`:46` | OK (чтение под «управлять», №11) |
| readiness/permit-form-options | GET | `readiness.permit.edit` | `:30` | OK (№11) |
| readiness/place-presets | POST, DELETE | requireAuth (личный список) | нет способности | без способности (№13) |
| readiness/route.ts (alias) | GET | публичная проба | — | OK (№17) |

### ready / reports / safety / settings / sites / system / telegram / telemetry

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| ready | GET | публичная проба | — | OK (№17) |
| reports/[id]/history | GET | `reports.read_all`, без tenant | `:13`,`:15` | **без tenant (№5)** |
| reports/admin-upsert | POST | `reports.manage_all` | `:23` | OK |
| reports/all | GET | `reports.read_all` | `:19` | OK |
| reports/delete | DELETE | `reports.manage_all` | `:47` | OK |
| reports/edit | GET | requireAuth; scope в сервисе | `report-query.service.ts:51` | OK |
| reports/export | GET | `reports.export` (ADMIN) | `:22` | OK |
| reports/my | GET | requireAuth; scope в сервисе | `listReportsForUserScope` | OK |
| reports/pdf | POST, GET | `reports.read_all` | `:80`,`:223`,`:253` | OK |
| reports/period | GET | `reports.read_all` | `:36` | OK |
| reports/recent | GET | `reports.read_all` | `:22` | OK |
| reports/single-pdf | POST, GET | `ensureTenantAccess` + `assertCanAccessReportOwner` | `:80-82`,`:193-196`,`:239-241` | OK |
| reports/upsert | POST | `assertCanActForUser` | `:59` | OK |
| route.ts (корень) | GET | публичный статус | — | OK (№17) |
| safety/clearance | GET | `users.documents.read_all` | `can` `:34` → `clearance-overview-query.ts:139` | OK |
| safety/my-clearance | GET | requireAuth; id из сессии | `:28` | OK |
| safety/equipment-permits | GET, POST | `users.documents.read_all` / `safety.permits.manage` | `:46`,`:87` → `equipment-permits.ts:61,113` | OK |
| safety/equipment-permits/[id] | DELETE | `safety.permits.manage` | `:27` | OK |
| settings | GET | requireAuth + tenant | tenant `:19` | без способности |
| settings | PUT | `user.role==='ADMIN'` | `:27` | прям. роль (№3) |
| sites | GET | requireAuth; scope в сервисе | `site-query.service.ts:51-83` | OK |
| sites/all | GET | `sites.read_all` | `:17` | OK |
| sites/create | POST | `sites.manage` | `:20` | OK |
| sites/[id] | GET | `assertCanAccessSite` | `site-query.service.ts:91` | OK |
| sites/[id] | PUT, DELETE | `sites.manage` | `:37`,`:114` | OK |
| sites/[id]/assign | POST, DELETE | `sites.assign_users` | `:19`,`:42` | OK |
| sites/[id]/hierarchy | POST, DELETE | `sites.manage_hierarchy` | `:55`,`:105` | OK |
| system | GET | `users.manage` (ADMIN) | `:18` | OK (чтение под «управлять», №10) |
| system/status | GET | `system.read` | `:30` | OK |
| telegram/configs | GET, POST, PUT, DELETE | `telegram.manage` | `:46`,`:61`,`:99`,`:137` | OK (№10) |
| telemetry | POST | `ADMIN/DISPATCHER/OPERATOR` | лок. `assertAnyRole` `:111`,`:366` | прям. роль (№6) |
| telemetry | GET | `analytics.read` | `:252`,`:291` | OK |
| telemetry/batch | POST | `ADMIN/DISPATCHER/OPERATOR` (inline) | `:86` | прям. роль (№6) |
| telemetry/ingest | POST, PATCH, GET | ключ устройства (без сессии) | `:296-305` | OK (№19) |
| to/journal | GET | `maintenance.manage` | `:16` | OK (№10) |

### user-document-types / user-documents / users / weather

| маршрут | методы | доступ | проверка | статус |
|---|---|---|---|---|
| user-document-types | GET | requireAuth (справочник) | — | OK (публичный справочник) |
| user-document-types | POST | `users.manage` | сервис `assertCanManageTypes` (`user-document-access.ts:73`) | OK |
| user-document-types/[id] | PATCH, DELETE | `users.manage` | сервис `:96`,`:138` | OK |
| user-documents/control | GET | `users.documents.read_all` | `user-documents.ts:115` | OK |
| users | GET | `users.read` | `:25` | OK |
| users | POST, PUT, DELETE | `users.manage` | `:46`,`:95`,`:129` | OK |
| users/[id]/documents | GET, POST | свои или `read_all`/`manage` | `user-document-access.ts:20,26` | OK |
| users/[id]/documents/[docId] | PUT, DELETE | свои или `manage` | `user-document-access.ts:26` | OK |
| weather | GET | requireAuth | — | OK |

## Маршруты без явной проверки роли

Для каждого указано, есть ли проверка в вызываемой функции или нет.

| маршрут | метод | проверка в вызываемой функции | статус |
|---|---|---|---|
| `src/app/api/equipment/route.ts:13-28` | GET | нет — `listAllEquipment` (`equipment-query.service.ts:502-535`) сужает только по `operatorUserId`, ролей не знает | **проверки нет (№1)** |
| `src/app/api/equipment/[id]/route.ts:45-54` | GET | нет — `getEquipmentByIdOrThrow(id, tenantId)` ролей не знает | **проверки нет (№2)** |
| `src/app/api/dictionary/all/route.ts:9-21` | GET | нет — `getCachedAllDictionaries(tenantId)` | проверки нет (№7) |
| `src/app/api/monitoring/fleet/route.ts:21-36` | GET | нет способности; сужение по `user.role` внутри обработчика `:28` | проверки нет, сужение по роли |
| `src/app/api/monitoring/template/route.ts:17-23` | GET | нет | проверки нет |
| `src/app/api/settings/route.ts:15-21` | GET | нет | проверки нет |
| `src/app/api/weather/route.ts:40-73` | GET | нет | by design (погода) |
| `src/app/api/operator/shift/route.ts:15-25` | GET | нет; id из сессии (`getOperatorShiftFacts(tenantId, user.id)`) | сужено до себя |
| `src/app/api/feedback/events/route.ts:57-75` | GET | нет; `listFeedbackEventsForUser(sessionUser, limit)` | сужено в сервисе |
| `src/app/api/feedback/stream/route.ts:9-72` | GET | нет (`requireAuth` вручную, данные не читаются) | проверки нет, вреда нет |
| `src/app/api/auth/me/route.ts:17-48` | GET | `resolveAccessibleUserId(reports.read_cross_user)` `:26` + `ensureTenantAccess` `:43` | есть в функции |
| `src/app/api/reports/edit/route.ts:12-28` | GET | `getEditableReport` → `resolveReportUserId` (`report-query.service.ts:34-68`) | есть в функции |
| `src/app/api/reports/my/route.ts:13-27` | GET | `listReportsForUserScope` (scope по `resolveAccessibleUserId`) | есть в функции |
| `src/app/api/reports/[id]/history/route.ts:9-17` | GET | `reports.read_all` есть, тенант — нет (`report-history-service.ts:32-37`) | **нет тенант-проверки (№5)** |
| `src/app/api/sites/route.ts:11-26` | GET | `getAccessibleSites` (`site-query.service.ts:51-83`) | есть в функции |
| `src/app/api/sites/[id]/route.ts:15-29` | GET | `getSiteWithHierarchy` → `assertCanAccessSite` (`:91`) | есть в функции |
| `src/app/api/crews/my/route.ts:13-29` | GET | `getCrewForOperator` (`crew-query.service.ts:54-60`) | есть в функции |
| `src/app/api/briefings/route.ts:30-65` | POST | `conductBriefing` → `mayManageBriefings` (`briefing-commands.ts:55`) | есть в функции |
| `src/app/api/briefings/journal/route.ts:27-78` | GET | `can(actor,'users.documents.read_all')` `:60` (передан аргументом) | есть в обработчике |
| `src/app/api/briefings/[id]/sign/route.ts:19-38` | POST | `signBriefingRecord` (проверка участия) | есть в функции |
| `src/app/api/safety/clearance/route.ts:19-43` | GET | `querySafetyClearanceOverview` → `:139` 403 | есть в функции |
| `src/app/api/safety/my-clearance/route.ts:18-35` | GET | нет; id из сессии | сужено до себя |
| `src/app/api/safety/equipment-permits/route.ts:31-55` | GET | `listEquipmentPermits` → `mayRead` (`:61`) | есть в функции |
| `src/app/api/safety/equipment-permits/route.ts:64-105` | POST | `upsertEquipmentPermit` → `mayManage` (`:113`) | есть в функции |
| `src/app/api/safety/equipment-permits/[id]/route.ts:13-43` | DELETE | `deleteEquipmentPermit` → `mayManage` | есть в функции |
| `src/app/api/user-document-types/route.ts:16-61` | GET, POST | `assertCanManageTypes` (`user-document-access.ts:73`) | есть в сервисе |
| `src/app/api/user-document-types/[id]/route.ts:14-54` | PATCH, DELETE | `assertCanManageTypes` | есть в сервисе |
| `src/app/api/user-documents/control/route.ts:15-39` | GET | `listDocumentsNeedingAttention` → `users.documents.read_all` (`user-documents.ts:115`) | есть в сервисе |
| `src/app/api/users/[id]/documents/route.ts:34-82` | GET, POST | `assertCanRead`/`assertCanWrite` (`user-document-access.ts:20,26`) | есть в сервисе |
| `src/app/api/users/[id]/documents/[docId]/route.ts:27-75` | PUT, DELETE | `assertCanWrite`/`assertCanRead` | есть в сервисе |
| `src/app/api/media/download-batch/route.ts:31-64` | GET | `assertCanAccessMedia(...,'read')` — строка не подтверждена | не проверено (№20) |
| `src/app/api/readiness/place-presets/route.ts:32-91` | POST, DELETE | нет; фильтр по `context.actorId` | проверки нет (№13) |
| `src/app/api/health*`, `liveness`, `ready`, `readiness/route.ts`, `route.ts` | GET | публичные пробы | by design (№17) |
| `src/app/api/alerts/webhook/route.ts:87-179` | POST | общий секрет `:88` | by design (№18) |
| `src/app/api/telemetry/ingest/route.ts:95,141,341` | POST, PATCH, GET | ключ устройства | by design (№19) |

Прямые проверки роли (не через `can`; замещение не учитывается): `assistant/*` (`:22`,`:39`),
`operator/knowledge-attempt:9`, `operator/mobile/*` (`:22`,`:192`), `telemetry/route.ts:366`,
`telemetry/batch/route.ts:86`, `settings/route.ts:27`, `monitoring/template/route.ts:29`,
`layout/[surfaceId]/route.ts:55,82`, `feedback/events/route.ts:116,154`.

## Не проверено

- **Ничего не запускалось.** Ни `npm run build`, ни тесты, ни запросы, ни чтение базы: задача —
  read-only разбор кода. Все выводы — чтение исходников; exit-коды §6 AGENTS.md не приводятся.
- **Живых пользователей у ролей `FOREMAN`/`SAFETY_ENGINEER` нет** (AGENTS.md §3), поэтому находка №5
  (тенант в истории отчёта) и находки по этим ролям — «спящие» до появления людей. Проверить наличие
  пользователей в базе не мог (база не читалась).
- **`media/download-batch`** прочитан только по дампу строк: не сверял, что `assertCanAccessMedia(...,'read')`
  вызывается на каждый файл пакета до отдачи (находка №20).
- **`telemetry/ingest`** прочитан частично (валидация ключа и выборка): не разбирал целиком, как именно
  ключ сопоставляется с машиной и тенантом за пределами строк `:296-305`.
- **Поведение `withMutation` при отсутствии сессии** отдельно не проверял: CSRF и лимиты
  (`api-wrapper.ts:183-219`) к ролям отношения не имеют, но подделка `x-acting-as` без сессии не
  воспроизводилась (`canActAs` в `requireAuth:192-193` вернула бы `null`).
- **Публикуемая матрица готовности** (`readiness/domain/access-matrix.ts`) не читалась построчно: проверял
  только, что маршруты и команды готовности зовут `capabilities`/`effectiveReadinessCapabilities`
  (`request-context.ts:90`, `shifts/commands.ts:49`, `permits/commands.ts:64`, `defects/commands.ts:55,62`).
  Расхождение «значения по умолчанию против опубликованной матрицы» в этом аудите не измерял.
- **Замороженные области** (`src/app/operator/**`, `src/app/(app)/operator/**`, `src/components/piling/operator*/**`,
  `src/modules/operator-mobile/**`, ORION) не разбирались; `orion/lead` отмечен как заморозка и пропущен.
- **`module-vs-dictionary` и `pilingtrack-*`-скиллы** использовались как ориентир, но выводы построены
  только на прочитанном коде; ссылки на скиллы в отчёт не переносились.

## Приложение: сравнение

Первый проход сделан независимо. После его завершения прочитан один пересекающийся отчёт —
`docs/audits/hermes-night/18-ui-vs-api-permissions.md` (ветка `hermes/q3-0925`; другой SHA, чем
аудируемый `0f53cd01`). Это **не** тот же коммит, поэтому «совпало/не совпало» — про устойчивость класса
дефекта, а не про один и тот же снимок.

- **Находка №1** (`GET /api/equipment` без `equipment.read`) пересекается с п.13 того отчёта
  (`15-ui-vs-api-permissions`, строка про `api/equipment/route.ts:12-28` и `dictionary/all`). То есть класс
  дефекта пережил как минимум один цикл аудита и не исправлен на `0f53cd01` — это результат
  «переподтверждено», а не новое.
- **Находка №7** (`dictionary/all` без способности) совпадает с тем же п.13.
- **Находка №3** (прямые `user.role !== 'ADMIN'` в settings/template/layout) совпадает с п.12 того отчёта.
- **Находки №2, №4, №5, №6** в прочитанном отчёте по строкам не встречаются: `equipment/[id]` GET без
  проверки, сужение `ASSISTANT` в списке парка, тенант-проверка в `reports/[id]/history` и локальный
  `assertAnyRole` в телеметрии. Считаю их новыми для этого класса аудита (в пределах прочитанного одного отчёта).
- Критичных находок нет ни в моём отчёте, ни в п.13/12 прочитанного: общий сюжет — «роль проверяется
  третьим способом либо не проверяется» и «чтение закрыто на управлять».
