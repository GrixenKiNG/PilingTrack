# AU12-S5-ROUTE-AUTH-MATRIX: матрица прав всех маршрутов API

Версия (git rev-parse HEAD рабочей папки): `ba2e2f0723db25087681ddce5390f93b4c662ec9`
Ветка: `hermes/q4-0926`. Только чтение: код приложения не менялся.

## Итог

- Всего файлов маршрутов: **141** (`find src/app/api -name route.ts | wc -l` → 141).
- По входу: **131** требуют сессию (requireAuth напрямую, readiness-контекст или device-key), **9** открыты без сессии намеренно (пробы живости, вход, вебхук Alertmanager, публичная форма ORION), **1** — по ключу устройства.
- Право проверяется явно (`assertCan`/`can`/`caps.has`): **≈95** маршрутов. Ещё ≈15 проверяют право **внутри сервиса** (не в файле маршрута). Остальные — только факт сессии и/или роли-скоуп (личные разделы).
- **Организация действительно нигде не проверяется** у 9 открытых маршрутов (по замыслу) и у `admin/projections/rebuild`; во всех остальных организация берётся из сессии, `requireTenantId`, `ensureTenantAccess` или `context.tenantId`.
- **Право сравнением роли напрямую** (`user.role === …` / список ролей) вместо `can(...)` — **17 файлов**; из них 6 — запись под `ADMIN`/роли, где сравнение собственной роли обходит режим «Действую как» (главная находка).
- Критичных (доказуемая утечка данных/межтенантный доступ) в этом проходе **не найдено**: тенантность закрывается по принципу fail-closed. Наиболее значимое — обход режима «Действую как» там, где право проверено прямой ролью (см. находки №1–6).

## Методика

1. Инвентаризация: `find src/app/api -name route.ts` → 141 файл; методы — по `export const GET|POST|PUT|PATCH|DELETE`.
2. Автоматический разбор всех 141 файлов (node-скрипт) по маркерам: `requireAuth(`, `resolveReadinessRequestContext(`, `withReadinessCommand(`, `withApi`, `withMutation`, `assertCan(…,'…')`, `can(…,'…')`, `capabilities.has('…')`, `assertRole/assertAnyRole`, `.role === '…'`, `requireTenantId(`, `ensureTenantAccess`, `context.tenantId`, `user.tenantId`. Команда повторяема, скрипт лежит вне репозитория (scratch).
3. Точечное чтение вручную ≈55 файлов маршрутов и общих обвязок (`src/core/api-wrapper.ts`, `src/lib/auth.ts`, `src/lib/tenant-scope.ts`, `src/services/auth/authorization-service.ts`, `src/app/api/readiness/_shared/request-context.ts`, `_shared/route-adapter.ts`, `src/modules/readiness/application/capabilities.ts`, `src/core/media/media-auth.ts`), чтобы проверить, что право/тенант реально проверяются, а не просто объявлены.
4. Важная оговорка по методике: почти все маршруты `/api/readiness/*` получают сессию и организацию **косвенно** — через `resolveReadinessRequestContext` (вызывается из `withReadinessCommand`), а само право контура готовности проверяется **внутри команд** (`modules/readiness/application/**/commands.ts`), а не строкой `capabilities.has` в файле маршрута. Поэтому у таких маршрутов в таблице «Право» стоит `(в команде)`.

## Полная матрица маршрутов

Колонка «Вход»: `сессия` = requireAuth; `readiness` = resolveReadinessRequestContext (напрямую или через withReadinessCommand); `dev-key` = ключ устройства; `нет` = открытый. Колонка «Организация»: откуда берётся tenantId.

| Маршрут (`src/app/api/…`) | Методы | Вход | Право | Организация |
| --- | --- | --- | --- | --- |
| admin/analytics/overview | GET | сессия | assertCan analytics.read | сессия |
| admin/analytics/site-weekly-trend | GET | сессия | assertCan analytics.read | сессия |
| admin/dlq | GET/POST | сессия | assertCan dlq.manage | requireTenantId |
| admin/equipment-analytics | GET | сессия | assertCan analytics.read | сессия |
| admin/incidents | GET/POST | сессия | assertCan incidents.read / incidents.review | сессия |
| admin/projections/rebuild | POST | сессия | assertCan projections.rebuild | **нет** |
| alerts/webhook | POST | нет (Bearer-секрет) | секрет вебхука | **нет** (env DEFAULT_TENANT_ID) |
| analytics/sites | GET | сессия | assertCan sites.read_all | requireTenantId |
| assistant/command | POST | сессия | role==ASSISTANT | requireTenantId |
| assistant/state | GET | сессия | role==ASSISTANT | requireTenantId |
| audit | GET | сессия | assertCan system.read | сессия |
| auth/login | POST | нет | — | сессия(тенант запроса) |
| auth/logout | POST | сессия | — | **нет** |
| auth/me | GET | сессия | — | ensureTenantAccess |
| briefings/[id]/sign | POST | сессия | (в сервисе signBriefingRecord) | requireTenantId |
| briefings/journal | GET | сессия | can users.documents.read_all | requireTenantId |
| briefings | POST | сессия | can users.documents.read_all | requireTenantId |
| checklist-templates/[id] | GET/PUT/DELETE | сессия | assertCan maintenance.manage | requireTenantId |
| checklist-templates | GET/POST | сессия | assertCan maintenance.manage | requireTenantId |
| crews/[id] | GET/PUT/DELETE | сессия | assertCan crews.read / crews.manage | requireTenantId+ensureTenantAccess |
| crews/all | GET | сессия | assertCan crews.read | requireTenantId |
| crews/my | GET | сессия | — (сессия) | ensureTenantAccess |
| crews | GET/POST | сессия | assertCan crews.read / crews.manage | requireTenantId |
| dictionary/all | GET | сессия | — | сессия |
| dictionary/manage | GET/POST/PATCH/DELETE | сессия | assertCan dictionary.manage | context.tenantId |
| equipment/[id]/details | GET | сессия | assertCan equipment.read | requireTenantId |
| equipment/[id]/device-keys | GET/POST/DELETE | сессия | assertCan equipment.manage | requireTenantId |
| equipment/[id]/documents/[docId] | PUT/DELETE | сессия | assertCan equipment.manage | requireTenantId |
| equipment/[id]/documents | POST | сессия | assertCan equipment.manage | requireTenantId |
| equipment/[id]/fuel/[entryId] | DELETE | сессия | assertCan maintenance.manage | requireTenantId |
| equipment/[id]/fuel | GET/POST | сессия | assertCan meter.record + role==OPERATOR | requireTenantId |
| equipment/[id]/maintenance/[recordId] | PUT/DELETE | сессия | assertCan maintenance.manage | requireTenantId |
| equipment/[id]/maintenance | GET/POST | сессия | assertCan maintenance.manage | requireTenantId |
| equipment/[id]/meter-readings/[readingId] | DELETE | сессия | assertCan maintenance.manage | requireTenantId |
| equipment/[id]/meter-readings | GET/POST | сессия | assertCan meter.record + role==OPERATOR | requireTenantId |
| equipment/[id] | GET/PUT/DELETE | сессия | GET: **—**; PUT/DELETE assertCan equipment.manage | requireTenantId |
| equipment | GET/POST | сессия | GET: **—**(role==OPERATOR скоуп); POST assertCan equipment.manage | requireTenantId |
| feedback/events | GET/POST/PATCH | сессия | role==ADMIN/DISPATCHER (ack, audience) | **нет** |
| feedback/stream | GET | сессия | — | **нет** |
| health/deep | GET | нет | — | **нет** |
| health | GET | нет | — | **нет** |
| inspections/[id]/complete | POST | сессия | assertCan inspection.perform + role==OPERATOR | requireTenantId |
| inspections/[id] | GET/PUT | сессия | assertCan inspection.perform + role==OPERATOR | requireTenantId |
| inspections | GET/POST | сессия | assertCan inspection.perform + role==OPERATOR | requireTenantId |
| layout/[surfaceId] | GET/PUT/DELETE | сессия | GET: сессия; PUT/DELETE role==ADMIN | requireTenantId |
| liveness | GET | нет | — | **нет** |
| maintenance-plans/[id] | PATCH/DELETE | сессия | assertCan maintenance.manage | requireTenantId |
| maintenance-plans | GET/POST | сессия | assertCan maintenance.manage | requireTenantId |
| maintenance-plans/run | POST | сессия | assertCan maintenance.manage | requireTenantId |
| maintenance/[id]/accept | POST | сессия | assertCan maintenance.manage + assertRole ADMIN | requireTenantId |
| maintenance/[id] | GET | сессия | assertCan maintenance.manage | requireTenantId |
| maintenance/assignees | GET | сессия | assertCan maintenance.manage | requireTenantId |
| maintenance/kpi | GET | сессия | assertCan maintenance.manage | requireTenantId |
| maintenance | GET | сессия | assertCan maintenance.manage | requireTenantId |
| media/[id]/confirm | POST | сессия | assertCanAccessMedia (в media-auth) | (в media-auth) |
| media/[id]/download | GET | сессия | assertCanAccessMedia (в media-auth) | (в media-auth) |
| media/[id] | DELETE | сессия | assertCanAccessMedia (в media-auth) | (в media-auth) |
| media/download-batch | GET | сессия | filterReadableMedia (в media-auth) | (в media-auth) |
| media | GET/POST | сессия | assertCanAccessMediaEntity (media.upload нет) | requireTenantId |
| metrics | GET | сессия (или scrape-токен) | assertCan system.read | **нет** |
| monitoring/fleet | GET | сессия | role==OPERATOR/ASSISTANT (скоуп) | requireTenantId |
| monitoring/template | GET/PUT | сессия | GET: сессия; PUT role==ADMIN | requireTenantId |
| notifications/telegram/test | POST | сессия | assertCan reports.read_all | requireTenantId |
| operator/knowledge-attempt | GET | сессия | role==OPERATOR/ASSISTANT | сессия |
| operator/mobile/command | POST | сессия | role==OPERATOR | сессия |
| operator/mobile/state | GET | сессия | role==OPERATOR | сессия |
| operator/shift | GET | сессия | — (личная смена из сессии) | requireTenantId |
| orion/lead | POST | нет | — | **нет** (заморожено) |
| pile-passports/[id]/decide | POST | сессия | assertCan piles.manage | requireTenantId |
| pile-passports/export | GET | сессия | assertCan piles.manage | requireTenantId |
| pile-passports | GET | сессия | assertCan piles.manage | requireTenantId |
| readiness-rules/publish | POST | сессия | assertRole ADMIN | requireTenantId |
| readiness-rules | GET/PUT | сессия | GET: сессия; PUT assertRole ADMIN | requireTenantId |
| readiness/access-matrix | GET/POST/PUT | readiness | caps readiness.rules.manage | context.tenantId |
| readiness/audit | GET | readiness | caps readiness.audit.read | context.tenantId |
| readiness/bootstrap | GET | сессия | can users.documents.read_all / incidents.read | сессия |
| readiness/current | GET | readiness | caps readiness.read | context.tenantId |
| readiness/defects/[id]/reject | POST | readiness | (в команде: canManageDefects) | context.tenantId |
| readiness/defects/[id]/resolve | POST | readiness | (в команде: canManageDefects) | context.tenantId |
| readiness/defects/[id]/triage | POST | readiness | (в команде: canManageDefects) | context.tenantId |
| readiness/defects | GET/POST | readiness | caps readiness.read / canReportDefects | context.tenantId |
| readiness/export | GET | readiness | caps readiness.read / readiness.audit.export | context.tenantId |
| readiness/handovers/[id]/accept | POST | readiness | (в команде: readiness.handover.decide) | context.tenantId |
| readiness/handovers/[id]/rework | POST | readiness | (в команде: readiness.handover.prepare) | context.tenantId |
| readiness/handovers/[id] | GET | readiness | caps readiness.read | context.tenantId |
| readiness/history | GET | readiness | caps readiness.read | context.tenantId |
| readiness/permit-form-options | GET | readiness | caps readiness.permit.edit | context.tenantId |
| readiness/place-presets | POST/DELETE | readiness | — (личные подсказки, по сессии) | context.tenantId |
| readiness | GET | нет | — (deprecated проба) | **нет** |
| readiness/shifts/[id]/cancel | POST | readiness | (в команде: readiness.shift.manage) | context.tenantId |
| readiness/shifts/[id]/decline | POST | readiness | (в команде: readiness.shift.authorize) | context.tenantId |
| readiness/shifts/[id]/handover | POST | readiness | (в команде: readiness.handover.decide) | context.tenantId |
| readiness/shifts/[id]/request-acceptance | POST | readiness | (в команде: readiness.shift.manage) | context.tenantId |
| readiness/shifts/[id] | GET/PATCH | readiness | caps readiness.read / (в команде) | context.tenantId |
| readiness/shifts/[id]/start | POST | readiness | (в команде: readiness.shift.manage) | context.tenantId |
| readiness/shifts/[id]/waiver | POST | readiness | (в команде: readiness.shift.waive) | context.tenantId |
| readiness/shifts | GET/POST | readiness | caps readiness.read / (в команде) | context.tenantId |
| readiness/work-permits/[id]/approve | POST | readiness | (в команде: permit.approve_*) | context.tenantId |
| readiness/work-permits/[id]/revoke | POST | readiness | (в команде: permit.edit/approve) | context.tenantId |
| readiness/work-permits/[id] | GET/PATCH | readiness | caps readiness.read / (в команде) | context.tenantId |
| readiness/work-permits/[id]/submit | POST | readiness | (в команде: permit.edit) | context.tenantId |
| readiness/work-permits | GET/POST | readiness | caps readiness.read / (в команде) | context.tenantId |
| ready | GET | нет | — | **нет** |
| reports/[id]/history | GET | сессия | assertCan reports.read_all | (в сервисе, объект user) |
| reports/admin-upsert | POST | сессия | assertCan reports.manage_all | requireTenantId |
| reports/all | GET | сессия | assertCan reports.read_all | (в сервисе, объект user) |
| reports/delete | DELETE | сессия | assertCan reports.manage_all | requireTenantId |
| reports/edit | GET | сессия | — (в сервисе getEditableReport) | (в сервисе, объект user) |
| reports/export | GET | сессия | assertCan reports.export | requireTenantId |
| reports/my | GET | сессия | — (скоуп user в сервисе) | (в сервисе, объект user) |
| reports/pdf | GET/POST | сессия | assertCan reports.read_all | сессия |
| reports/period | GET | сессия | assertCan reports.read_all | сессия |
| reports/recent | GET | сессия | assertCan reports.read_all | (в сервисе, объект user) |
| reports/single-pdf | GET/POST | сессия | assertCan reports.read_cross_user | ensureTenantAccess |
| reports/upsert | POST | сессия | assertCanActForUser (в сервисе) | requireTenantId |
| route (корень /api) | GET | нет | — | **нет** |
| safety/clearance | GET | сессия | can users.documents.read_all | requireTenantId |
| safety/equipment-permits/[id] | DELETE | сессия | can safety.permits.manage | requireTenantId |
| safety/equipment-permits | GET/POST | сессия | can users.documents.read_all / safety.permits.manage | requireTenantId |
| safety/my-clearance | GET | сессия | — (личный раздел по сессии) | requireTenantId |
| settings | GET/PUT | сессия | GET: сессия; PUT role==ADMIN | requireTenantId |
| sites/[id]/assign | POST/DELETE | сессия | assertCan sites.assign_users | requireTenantId |
| sites/[id]/hierarchy | POST/DELETE | сессия | assertCan sites.manage_hierarchy | requireTenantId |
| sites/[id] | GET/PUT/DELETE | сессия | GET: сессия(scoped); PUT/DELETE assertCan sites.manage | requireTenantId |
| sites/all | GET | сессия | assertCan sites.read_all | requireTenantId |
| sites/create | POST | сессия | assertCan sites.manage | requireTenantId |
| sites | GET | сессия | — (getAccessibleSites) | requireTenantId |
| system | GET | сессия | assertCan users.manage | **нет** |
| system/status | GET | сессия | assertCan system.read | **нет** |
| telegram/configs | GET/POST/PUT/DELETE | сессия | assertCan telegram.manage | requireTenantId |
| telemetry/batch | POST | сессия | roleList ADMIN/DISPATCHER/OPERATOR | requireTenantId |
| telemetry/ingest | GET/POST/PATCH | dev-key | ключ устройства | dev-key (identity.tenantId) |
| telemetry | GET/POST | сессия | assertCan analytics.read + assertAnyRole | requireTenantId |
| to/journal | GET | сессия | assertCan maintenance.manage | requireTenantId |
| user-document-types/[id] | PATCH/DELETE | сессия | (в сервисе update/deleteUserDocumentType) | requireTenantId |
| user-document-types | GET/POST | сессия | (в сервисе, scope=all → users.manage) | requireTenantId |
| user-documents/control | GET | сессия | (в сервисе listDocumentsNeedingAttention) | requireTenantId |
| users/[id]/documents/[docId] | PUT/DELETE | сессия | (в сервисе update/deleteUserDocument) | requireTenantId |
| users/[id]/documents | GET/POST | сессия | (в сервисе list/createUserDocument) | requireTenantId |
| users | GET/POST/PUT/DELETE | сессия | assertCan users.read / users.manage | сессия |
| weather | GET | сессия | — | **нет** |

## Список A. Право проверено сравнением роли напрямую (вместо `can(...)`)

Файл:строка — проверка — что обходит.

1. `src/app/api/settings/route.ts:27` — `user!.role !== 'ADMIN'` (PUT).
2. `src/app/api/layout/[surfaceId]/route.ts:54` и `:80` — `user!.role !== 'ADMIN'` (PUT, DELETE).
3. `src/app/api/monitoring/template/route.ts:29` — `user!.role !== 'ADMIN'` (PUT).
4. `src/app/api/feedback/events/route.ts:116` — `user?.role !== 'ADMIN' && user?.role !== 'DISPATCHER'` (acknowledge); `:154` — та же пара для `audience`.
5. `src/app/api/telemetry/batch/route.ts:86` — `['ADMIN','DISPATCHER','OPERATOR'].includes(user!.role)`.
6. `src/app/api/equipment/[id]/fuel/route.ts:23` и `src/app/api/equipment/[id]/meter-readings/route.ts:26` — `if (user.role !== 'OPERATOR') return;` (помощник `assertOperatorOwnsEquipment`).
7. `src/app/api/equipment/route.ts:23` — `user!.role === 'OPERATOR'` (скоуп выборки, не право).
8. `src/app/api/inspections/route.ts:46`, `src/app/api/inspections/[id]/route.ts:37,65`, `src/app/api/inspections/[id]/complete/route.ts:32` — `user!.role === 'OPERATOR'` (скоуп «свои осмотры»).
9. `src/app/api/monitoring/fleet/route.ts:28` — `user!.role === 'OPERATOR' || user!.role === 'ASSISTANT'` (скоуп).
10. `src/app/api/operator/mobile/state/route.ts:22`, `src/app/api/operator/mobile/command/route.ts:192`, `src/app/api/operator/knowledge-attempt/route.ts:9` — `user.role !== 'OPERATOR'` (+ASSISTANT).
11. `src/app/api/assistant/state/route.ts:22`, `src/app/api/assistant/command/route.ts:39` — `user.role !== 'ASSISTANT'`.

## Список B. Организация не проверяется нигде в маршруте

1. `src/app/api/health/route.ts`, `src/app/api/health/deep/route.ts`, `src/app/api/liveness/route.ts`, `src/app/api/ready/route.ts`, `src/app/api/readiness/route.ts` — публичные пробы, данных организации не отдают.
2. `src/app/api/route.ts` — корневой ping.
3. `src/app/api/auth/login/route.ts` — вход (тенант определяется по запросу, не из сессии).
4. `src/app/api/auth/logout/route.ts` — выход (тенант не нужен).
5. `src/app/api/feedback/stream/route.ts` — SSE-поток, отдаёт только собственный «connected/sync».
6. `src/app/api/alerts/webhook/route.ts` — вебхук Alertmanager, тенант = `DEFAULT_TENANT_ID`.
7. `src/app/api/telemetry/ingest/route.ts` — контекст по ключу устройства (не сессия).
8. `src/app/api/orion/lead/route.ts` — публичная форма (замороженная зона).
9. `src/app/api/admin/projections/rebuild/route.ts` — пересборка витрин глобальная, право `projections.rebuild` (ADMIN).

## Список C. Только вход, отдельного права в файле маршрута нет

`auth/me`, `auth/logout`, `crews/my`, `dictionary/all`, `equipment/[id]` (GET), `equipment` (GET), `feedback/events` (GET), `feedback/stream`, `media/route` (GET/POST), `media/[id]/*`, `operator/shift`, `readiness/place-presets`, `reports/edit`, `reports/my`, `safety/my-clearance`, `sites` (GET), `sites/[id]` (GET), `weather`. Часть из них — личные разделы (скоуп по идентификатору из сессии) или доступ через `assertCanAccessMedia*`; см. находки.

## Находки

| # | severity | path:line | проблема | сценарий / почему важно | предлагаемое исправление |
| --- | --- | --- | --- | --- | --- |
| 1 | важно | src/app/api/settings/route.ts:27 | PUT проверяет `user!.role !== 'ADMIN'`, а не `assertCan(...)` | `user.role` — собственная роль. Администратор в режиме «Действую как механик» меняет настройки организации, хотя режим должен ограничивать. Прямая роль обходит замещение. | Проверять через `assertRole(user, 'ADMIN')` из `authorization-service` (учитывает `actingAs`). |
| 2 | важно | src/app/api/layout/[surfaceId]/route.ts:54,80 | PUT/DELETE — `user!.role !== 'ADMIN'` | То же: правка/удаление раскладки доступна администратору в режиме механика. | `assertRole(user, 'ADMIN')` вместо сравнения `user.role`. |
| 3 | важно | src/app/api/monitoring/template/route.ts:29 | PUT — `user!.role !== 'ADMIN'` | То же для шаблона плитки мониторинга. | `assertRole(user, 'ADMIN')`. |
| 4 | важно | src/app/api/feedback/events/route.ts:116,154 | Проверка `ADMIN`/`DISPATCHER` сравнением роли | Подтверждение событий и выбор `audience` — администратор в режиме механика сохраняет эти полномочия. | Перенести на `can(user, …)` с отдельным правом (напр. `feedback.manage`). |
| 5 | важно | src/app/api/telemetry/batch/route.ts:86 | Список ролей `['ADMIN','DISPATCHER','OPERATOR'].includes(user!.role)` | Обходит замещение и не покрыто матрицей прав; при добавлении роли придётся править маршрут. | Ввести право (напр. `telemetry.ingest`) и проверять через `assertCan`. |
| 6 | мелочь | src/app/api/equipment/[id]/fuel/route.ts:23; src/app/api/equipment/[id]/meter-readings/route.ts:26 | `if (user.role !== 'OPERATOR') return;` в `assertOperatorOwnsEquipment` | Сравнение собственной роли: администратор в режиме оператора не сужается до «своей машины». Направление безопасное (скоуп ослабляется только у не-оператора, а у него роль и так над-ролевая), но поведение расходится с замещением. | Использовать `resolveEffectiveRole(user.role, user.actingAs)`. |
| 7 | мелочь | src/app/api/assistant/state/route.ts:22; src/app/api/assistant/command/route.ts:39; src/app/api/operator/mobile/state/route.ts:22; src/app/api/operator/mobile/command/route.ts:192; src/app/api/operator/knowledge-attempt/route.ts:9 | Экраны ограничены прямой ролью `OPERATOR`/`ASSISTANT` | Администратор в режиме «Действую как машинист/помощник» отлучается 403 — обратная сторона обхода замещения (экран недоступен). | Решить, должен ли режим «Действую как» работать для этих экранов; если да — считать эффективную роль. |
| 8 | мелочь | src/app/api/equipment/[id]/route.ts:45–54 | GET карточки установки не требует `equipment.read`, только сессию | Любой аутентифицированный в организации (в т.ч. оператор чужой бригады) читает карточку любой установки тенанта. Данные не персональные, но доступ шире, чем у остальных маршрутов установки. | Добавить `assertCan(user, 'equipment.read')` в GET. |
| 9 | мелочь | src/app/api/media/route.ts:16,19 | POST/GET выдаёт/список медиа без проверки права `media.upload` | Доступ ограничен `assertCanAccessMediaEntity` (владелец сущности/роль), но право `media.upload` из матрицы нигде не проверяется — фактически оно мёртвое. | Либо проверять `media.upload`, либо признать право недействующим и убрать (с доказательством). |
| 10 | мелочь | src/app/api/weather/route.ts:42 | Только сессия, без права и без организации | Маршрут проксирует внешний погодный сервис; организация не нужна, но любой пользователь может генерировать запросы к внешнему API. | При необходимости ограничить частоту/правом, иначе оставить как есть (осознанно). |
| 11 | мелочь | src/app/api/readiness/place-presets/route.ts:32,67 | POST/DELETE без проверки возможности (`capabilities`) | Подсказки мест личные (фильтр по `userId` из сессии), поэтому отказа нет намеренно; но маршрут лишь формально в контуре готовности. | Оставить; отметить в документации, что право не требуется осознанно. |
| 12 | мелочь | src/app/api/equipment/route.ts:23; src/app/api/inspections/route.ts:46; src/app/api/inspections/[id]/route.ts:37,65; src/app/api/inspections/[id]/complete/route.ts:32; src/app/api/monitoring/fleet/route.ts:28 | Скоуп выборки задаётся сравнением роли | Не право, а сужение видимости; сравнение собственной роли расходится с `actingAs`. Неясно, намеренно ли игнорируется замещение в этих скоупах. | Задокументировать решение; при необходимости — `resolveEffectiveRole`. |
| 13 | мелочь | src/app/api/admin/projections/rebuild/route.ts:42 | Пересборка витрин без тенанта | Глобальная операция под правом `projections.rebuild` (только ADMIN). При появлении второй организации пересоберёт витрины всех. | Сейчас безопасно (ADMIN+одна организация); при мультитенанте — ограничить тенантом. |

## Не проверено

- **Право в сервисах** для маршрутов из Списка C (например `reports/edit`, `reports/my`, `reports/upsert` (`assertCanActForUser`), `briefings/[id]/sign`, `user-document-types`, `users/[id]/documents`, `user-documents/control`): я подтвердил по комментариям и вызову, что проверка живёт в сервисе, но **саму реализацию этих функций не читал построчно** — вывод «право проверяется» основан на имени функции и комментарии, поэтому статус ГИПОТЕЗА, не ПРОЙДЕНО.
- **Внутренние проверки команд контура готовности** (`modules/readiness/application/**/commands.ts`): проверено наличие `requireAbility(...)` и `canManageDefects/canReportDefects` точечно (`shifts/commands.ts:48`, `permits/commands.ts:63–64,212`, `defects/commands.ts:55,62`), но связь «конкретный маршрут → конкретная возможность» для всех 27 readiness-маршрутов построчно не сверял.
- **Реальное поведение `resolveEffectiveRole`/`canActAs`** (что именно возвращается при некорректном `x-acting-as`) — читал `src/lib/types` только по использованиям, не по реализации.
- **Матрица доступов организации** (`getPublishedAccessMatrix`) — как влияет опубликованная матрица на каждый readiness-маршрут, не проверял (значения по умолчанию из `capability-defaults.ts` видел, применённую организацией — нет).
- **Файлы замороженных зон** (`src/app/orion/**`, `src/app/operator/**`, `src/components/piling/operator*/**`, `src/modules/operator-mobile/**`) не аудировались; маршрут `src/app/api/orion/lead/route.ts` упомянут только как открытый.
- **Проверки прав на уровне БД (RLS-политики)** — не проверялись; выводы о тенантности сделаны по коду приложения.
- **Тесты** (`src/app/api/**/__tests__`) не запускались: задача только на чтение кода.
