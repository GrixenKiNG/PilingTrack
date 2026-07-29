# Frontend Design: production-модуль «Техготовность»

**Статус:** Approval-ready design; implementation is blocked until the contracts in §10.8 are resolved  
**Версия:** 1.0  
**Дата:** 2026-07-29  
**Основание:** [PRD](../product/tech-readiness-production-prd.md), [UI Specification](../ui-spec/tech-readiness-production-ui-spec.md), [Backend Design](./tech-readiness-production-backend-design.md)  
**ADR:** [workflow consistency](../adr/0041-tech-readiness-workflow-consistency.md), [RBAC/tenancy](../adr/0042-tech-readiness-rbac-and-tenancy.md), [audit hash-chain](../adr/0043-audit-hash-chain.md)  
**Целевая поверхность:** существующий `ToModule` внутри текущей оболочки PilingTrack  
**Timezone по умолчанию:** `Europe/Moscow`

## 1. Решение

`ToModule` остаётся единственной точкой входа модуля, но перестаёт загружать весь workspace и рассчитывать готовность в браузере. Новый `TechReadinessModuleController` валидирует URL, получает `/api/readiness/bootstrap`, монтирует только активную вкладку и передаёт ей типизированные query/mutation adapters. Все KPI, статусы, версии, blockers, actions, временные интервалы, согласования, workload, trend и audit приходят из серверных read models. Клиент отвечает только за presentation: форматирование в tenant timezone, геометрию полос по переданным timestamps, управление URL, focus, dialogs, pending и recovery.

Существующий `readiness-reference-ui.tsx` используется как визуальный источник, но не как production data/controller layer. Он декомпозируется по feature boundaries; локальный CSV, клиентские доменные расчёты, синтетические смены/допуски/trend/workload, статические permission-матрицы и правдоподобные fallback-значения удаляются из production entrypoint.

## 2. Неподвижный UI handoff 7+7

Сохраняются существующая глобальная оболочка, одно левое меню приложения и одна строка ровно из семи вкладок в порядке:

1. `Центр готовности` — `view=readiness`;
2. `Техника` — `view=fleet`;
3. `Смены` — `view=shifts`;
4. `Наряд-допуски` — `view=permits`;
5. `Обслуживание` — `view=maintenance`;
6. `Отчёты` — `view=reports`;
7. `Настройки` — `view=settings`.

В `Настройках` сохраняются ровно семь подразделов:

1. `Правила готовности` — `section=rules`;
2. `Чек-листы` — `section=checklists`;
3. `Роли и доступы` — `section=roles`;
4. `Справочники` — `section=dictionaries`;
5. `Уведомления` — `section=notifications`;
6. `Интеграции` — `section=integrations`;
7. `Аудит` — `section=audit`.

Запрещены восьмая вкладка/секция, второй product header/nav/logo, raster/hotspot UI и переименование handoff без нового product decision. Выключенный feature flag показывает scoped unavailable panel внутри соответствующей вкладки и не меняет структуру 7+7.

## 3. Текущее состояние и production gaps

Текущий контур:

```text
ToModule
  -> параллельно грузит equipment/crews/maintenance/fleet/rules
  -> для каждой единицы догружает journal/details
  -> deriveEquipmentReadiness()
  -> buildReadinessFacts()
  -> computeReadinessScore()
  -> ReadinessReferenceUi (один файл, все 7+7 экранов)
```

Наблюдаемые gaps:

- `ToModule` выполняет N+1 загрузку journal/details и не отменяет фоновые batches при смене вкладки/unmount;
- URL читается только при mount, обновляется через `replaceState`, поэтому back/forward и scoped filters/detail не являются полноценным состоянием;
- readiness/status/score/KPI рассчитываются из legacy journal в клиенте, что конфликтует с immutable server snapshot;
- смены строятся из `CrewSummary`; начало и ширина полос синтетические;
- наряды генерируются из equipment/readiness, включая локальные номера, статусы и approval journal;
- workload механиков вычисляется по количеству открытых записей в браузере;
- 30-дневный trend — статический SVG path;
- audit/report читается из journal, а не из hash-chained `AuditLog`;
- CSV собирается функцией `downloadCsv`, не имеет parity с API и server security guarantees;
- permissions/roles местами являются статической матрицей, а action buttons не связаны с server capability/state;
- `toLocaleString()` не получает явную tenant timezone;
- `aria-pressed` используется вместо `tablist/tab/tabpanel`;
- `xl:h-[calc(100vh-190px)]` в центре и внутренние `max-h` создают независимые scroll-контейнеры, обрезку и overlap при малой высоте/zoom;
- один большой client component смешивает запросы, домен, layout, dialogs, export и settings.

Production implementation не импортирует `deriveEquipmentReadiness`, `buildReadinessFacts`, `computeReadinessScore`, demo arrays или browser CSV helpers. Их допускается оставить только в изолированных legacy/test fixtures до удаления.

## 4. Целевая component hierarchy

```text
ToModulePage
└─ AppShell (existing)
   └─ TechReadinessModule
      ├─ ReadinessLiveRegion
      ├─ ModuleTabList (exactly 7)
      ├─ BootstrapBoundary
      │  ├─ BootstrapLoading
      │  ├─ BootstrapError
      │  ├─ ScreenForbidden
      │  └─ FeatureUnavailable
      └─ ActiveViewBoundary (key=view)
         ├─ ReadinessCenterRoute
         │  ├─ EquipmentPickerQuery
         │  ├─ CurrentReadinessQuery
         │  │  ├─ SnapshotHeader
         │  │  ├─ ReadinessScore
         │  │  ├─ BlockersWarnings
         │  │  └─ EvidenceGrid
         │  ├─ ActiveWorkflowPanel
         │  ├─ SnapshotHistoryQuery
         │  └─ EntityCommandLauncher
         ├─ EquipmentRoute
         │  ├─ SharedListFilters
         │  ├─ EquipmentSummaryQuery
         │  ├─ EquipmentList
         │  └─ EquipmentDetailRoute
         ├─ ShiftsRoute
         │  ├─ SharedListFilters + ShiftTypeFilter
         │  ├─ ShiftSummaryQuery
         │  ├─ ShiftSchedule
         │  │  └─ ShiftBar (presentation geometry only)
         │  ├─ HandoverQueue
         │  ├─ ShiftDetailRoute
         │  └─ ShiftCommandDialogs
         ├─ WorkPermitsRoute
         │  ├─ SharedListFilters + RiskFilter
         │  ├─ PermitSummaryQuery
         │  ├─ PermitList
         │  ├─ PermitDetailRoute
         │  └─ PermitCommandDialogs
         ├─ MaintenanceRoute
         │  ├─ SharedListFilters
         │  ├─ MaintenanceSectionNav
         │  ├─ MaintenanceQueries
         │  └─ MechanicWorkloadQuery
         ├─ ReportsRoute
         │  ├─ SharedListFilters + AuditFilters
         │  ├─ ReadinessTrendQuery
         │  ├─ AuditEventList
         │  ├─ AuditEventDetailRoute
         │  └─ ServerCsvExport
         └─ SettingsRoute
            ├─ SettingsSectionList (exactly 7)
            └─ SettingsSectionBoundary
               ├─ RulesSettings
               ├─ ChecklistsSettings
               ├─ RolesAccessSettings
               ├─ DictionariesSettings
               ├─ NotificationsSettings
               ├─ IntegrationsSettings
               └─ AuditSettings
```

`ActiveViewBoundary` изолирует fatal render error активной вкладки, сохраняя module tabs и возможность перейти в другую вкладку. Query errors остаются scoped states, а не бросаются в общий boundary.

## 5. Декомпозиция `readiness-reference-ui.tsx`

Целевая структура:

```text
src/components/piling/to/readiness/
  tech-readiness-module.tsx
  module-tab-list.tsx
  live-region.tsx
  boundaries/
    bootstrap-boundary.tsx
    active-view-error-boundary.tsx
    query-state.tsx
  api/
    client.ts
    contracts.ts
    errors.ts
    idempotency.ts
    query-keys.ts
  url/
    schema.ts
    normalize.ts
    use-readiness-url-state.ts
  shared/
    shared-list-filters.tsx
    status-badge.tsx
    entity-action-gate.tsx
    command-dialog.tsx
    entity-detail-shell.tsx
    tenant-date.tsx
  center/
  equipment/
  shifts/
  permits/
  maintenance/
  reports/
  settings/
```

Mapping:

| Current symbol | Target |
|---|---|
| `ReadinessReferenceUi` | `TechReadinessModule` + `ModuleTabList` + boundaries |
| `ReadinessCentre` | `center/ReadinessCenterRoute` and leaf panels |
| `FleetScreen` | `equipment/EquipmentRoute` |
| `ShiftsScreen` | `shifts/ShiftsRoute`, `ShiftSchedule`, `HandoverQueue` |
| `PermitsScreen` | `permits/WorkPermitsRoute` |
| `MaintenanceScreen` | `maintenance/MaintenanceRoute`, `MechanicWorkload` |
| `ReportsScreen` | `reports/ReportsRoute`, `ReadinessTrend`, `AuditEventList` |
| `SettingsWorkspace` | `settings/SettingsRoute` |
| `RulesSettings` | `settings/rules/RulesSettings` |
| `downloadCsv` | удалить; `reports/ServerCsvExport` |
| `StatusPill`, `EvidenceState`, `ProcessRoleStrip` | shared/presentation components |
| local `VIEW_ITEMS/SETTINGS_ITEMS` | one immutable navigation contract with type-level and DOM tests |

Каждая route feature состоит из `route/controller`, `queries`, `read-model adapter`, `view`, `dialogs` и tests. Leaf components не выполняют `fetch` и не знают endpoint paths.

## 6. Типизированный API layer

### 6.1 Источник типов

OpenAPI `public/openapi.json` является контрактом. CI генерирует transport types/client в check mode. Поверх generated types создаётся тонкий adapter layer:

```ts
type ApiSuccess<T> = {
  data: T;
  meta: {
    timezone: string;
    correlationId: string;
    filters?: Readonly<Record<string, unknown>>;
    filterHash?: string; // required for GET /api/audit
  };
};

type ApiPage<T> = ApiSuccess<readonly T[]> & {
  page: { limit: number; nextCursor: string | null; hasMore: boolean; total: number };
};

type ApiErrorEnvelope = {
  error: {
    code: string;
    message: string;
    fieldErrors?: Readonly<Record<string, readonly string[]>>;
    blockers?: readonly Blocker[];
    conflict?: ConflictPayload;
    correlationId: string;
  };
};
```

Generated transport objects не передаются напрямую в JSX. Adapter:

- runtime-проверяет critical discriminants/enums;
- сохраняет `null` и отсутствие поля, не подставляет правдоподобный доменный default;
- преобразует только transport naming и presentation-safe URLs;
- возвращает branded IDs и immutable read models;
- сохраняет `ETag`, `version`, `actions` и `meta.filters`;
- выбрасывает типизированный `ReadinessApiError`, не string/unknown.

### 6.2 UI read models

```ts
type ActionCapability<TAction extends string = string> = {
  action: TAction;
  allowed: boolean;
  hidden?: boolean;
  reason?: string;
  routeId?: string;
};

type ReadinessCurrentVm = {
  equipment: EquipmentRefVm;
  snapshotId: string;
  status: ReadinessStatus;
  score: number | null;
  calculatedAt: string;
  timezone: string;
  ruleSetVersion: number;
  blockers: readonly BlockerVm[];
  warnings: readonly WarningVm[];
  evidence: readonly EvidenceVm[];
  activeShift: ShiftSummaryVm | null;
  activePermit: PermitSummaryVm | null;
  handover: HandoverSummaryVm | null;
  actions: readonly ActionCapability[];
};

type ShiftSummaryVm = {
  id: string;
  equipment: EquipmentRefVm;
  type: 'DAY' | 'NIGHT';
  state: ShiftState;
  productionDate: string;
  timezone: string;
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  startedAt: string | null;
  handoverSubmittedAt: string | null;
  closedAt: string | null;
  version: number;
  updatedAt: string;
  actions: readonly ActionCapability<ShiftAction>[];
};

type PermitSummaryVm = {
  id: string;
  displayNumber: string;
  equipment: EquipmentRefVm;
  shift: ShiftRefVm | null;
  risk: 'NORMAL' | 'ELEVATED';
  state: PermitState;
  scope: string;
  validFrom: string;
  validTo: string;
  timezone: string;
  approvals: readonly PermitApprovalVm[];
  version: number;
  updatedAt: string;
  actions: readonly ActionCapability<PermitAction>[];
};
```

`displayNumber`, status labels и approval progress должны приходить из сервера либо строиться только как локализованное представление строгого enum. Нельзя генерировать производственный номер из list index/year.

## 7. Server, query и local state

### 7.1 Владение состоянием

| Состояние | Владелец |
|---|---|
| tenant, actor, flags, screen capabilities, selectors | `/api/readiness/bootstrap`, query cache |
| lists/details/current snapshot/audit/trend/workload | query cache |
| active view, section, filters, selection, sort, cursor/detail ID | URL |
| draft form values, open dialog, expanded disclosure | component/form state |
| pending/error/result/idempotency key | mutation state scoped by entity+action |
| focus return target | ref/local state |

Дублировать server entity в `useState` запрещено. Form draft создаётся из snapshot при открытии и больше не синхронизируется автоматически; server update показывает conflict/refetch, а не молча перезаписывает введённое.

### 7.2 Query keys

```text
['readiness','bootstrap']
['readiness','equipment',normalizedFilters]
['readiness','current',equipmentId]
['readiness','snapshots',equipmentId,normalizedFilters]
['readiness','shifts',normalizedFilters]
['readiness','shift',shiftId]
['readiness','permits',normalizedFilters]
['readiness','permit',permitId]
['readiness','maintenance',maintenanceSection,normalizedFilters]
['readiness','mechanic-workload',normalizedFilters]
['readiness','trend',normalizedFilters,grain]
['readiness','audit',normalizedFilters]
['readiness','audit-event',eventId]
['readiness','rules']
```

Canonical production contract использует backend opaque `cursor` и не вычисляет page offset. Это осознанно уточняет UI Spec §5, где пока указан `page`: перед implementation UI Spec/OpenAPI должны быть синхронно обновлены на `cursor`. Cursor сериализуется в URL, поэтому reload, back/forward и прямой deep-link загружают ровно соответствующую страницу при тех же canonical filters. Смена filters/sort удаляет cursor. `400 CURSOR_FILTER_MISMATCH` удаляет только cursor через `replace`, сохраняет filters/sort и один раз загружает первую страницу; повторный `400` показывается как scoped error. Не допускаются клиентский cursor stack, числовой `page`, page-to-cursor эмуляция или загрузка всех предыдущих страниц.

### 7.3 Refresh/invalidation

Успешная команда сначала записывает authoritative response в detail cache, затем invalidates минимальный набор:

| Команда | Invalidations |
|---|---|
| shift create/edit/start/cancel | shift list/detail, equipment current, bootstrap counts |
| handover/rework/accept | shift list/detail, handover queue, equipment current/snapshots |
| permit create/edit/submit/approve/revoke | permit list/detail, equipment current/snapshots, affected shift detail |
| rules save/publish | rules; после publish current/snapshots/list summaries marked stale and refetched |
| maintenance/source mutation | maintenance list/detail, mechanic workload, equipment current; snapshot may be delayed |

Если command response содержит snapshot, он записывается сразу. Если projection asynchronous, UI показывает `Обновляем готовность…` и повторяет conditional refetch до нового `snapshotId`/`calculatedAt`, максимум 5 секунд; после этого оставляет non-blocking stale banner и кнопку retry. Старый snapshot не мутируется.

## 8. URL filter schema

Один pure schema/parser используется для чтения URL, query keys и server request:

```ts
type ReadinessUrlState = {
  view: 'readiness' | 'fleet' | 'shifts' | 'permits' |
        'maintenance' | 'reports' | 'settings';
  section?: 'rules' | 'checklists' | 'roles' | 'dictionaries' |
            'notifications' | 'integrations' | 'audit';
  maintenanceSection?: 'orders' | 'journal' | 'meters' | 'plans';
  equipmentId?: string;
  status?: string;
  from?: string; // YYYY-MM-DD, tenant-local production date
  to?: string;
  shiftType?: 'DAY' | 'NIGHT';
  risk?: 'NORMAL' | 'ELEVATED';
  eventType?: string;
  actorId?: string;
  entityType?: string;
  entityId?: string;
  sort?: string;
  cursor?: string; // opaque backend cursor; canonical replacement for UI Spec `page`
  shiftId?: string;
  permitId?: string;
  eventId?: string;
};
```

Правила:

- default `view=readiness` отсутствует в canonical URL;
- `section` допустим только для settings; `maintenanceSection` — только maintenance;
- detail ID допустим только на своей вкладке;
- при переходе на другую вкладку router удаляет только несовместимые context/detail params; допустимые для target endpoint common filters сохраняются, а back возвращает точный предыдущий URL;
- unknown enum удаляется через router `replace`;
- `from > to` остаётся в input/URL, показывает inline error и не запускает query/export;
- select/date применяются через `push` сразу, text search — debounce 300 ms;
- смена filter/sort сбрасывает cursor/detail;
- back/forward полностью восстанавливает view, filters и selection;
- reset удаляет scoped filters/cursor/detail, но сохраняет view и section;
- request builder принимает только результат `normalizeFilters(schemaResult)`;
- `meta.filters` ответа сравнивается с отправленным normalized object в development/test; mismatch телеметрируется;
- CSV использует тот же serialized normalized object, без client post-filter.

## 9. Mutations и async states

### 9.1 Общий command pipeline

```text
open dialog
  -> snapshot entity version + capability
  -> validate fields locally for immediate feedback
  -> create Idempotency-Key for action+payload
  -> disable only same entity/action trigger
  -> send expectedVersion and If-Match when contract exposes ETag
  -> classify response
  -> reconcile caches/refetch capability
  -> announce one result in shared live region
  -> restore deterministic focus
```

Double click создаёт один promise. Retry того же payload после network/5xx использует тот же key. Любое изменение payload, expected version или action создаёт новый key. Key живёт только в mutation attempt; не сохраняется в URL/localStorage/analytics.

### 9.2 State matrix

| Состояние | UI и recovery |
|---|---|
| pending | spinner в trigger/submit; fields locked; Escape и backdrop не закрывают dialog; остальная вкладка читаема |
| success | authoritative response в cache; dialog закрывается; list/detail/current согласуются; одно polite announcement; focus на trigger или list heading |
| `400` | invalid filter/header показывает scoped error; `CURSOR_FILTER_MISMATCH` один раз удаляет только cursor через `replace` и повторяет первую страницу с теми же filters/sort |
| `403` | dialog закрывается либо становится read-only; bootstrap/capabilities refetch; scoped alert без утечки; запрещённое действие исчезает/disabled с server reason |
| `409` | dialog сохраняет безопасный draft; detail/list refetch; conflict panel показывает actor/time/submitted/current version и current state; focus на heading; primary action `Открыть актуальное` |
| `422` | dialog остаётся открыт; error summary + field errors + blockers/correcting route actions; focus summary, затем первое invalid field |
| `428` | refetch entity/ETag; сообщение о необходимости актуальной версии; повтор только как новая attempt |
| `429` | показать `Retry-After`, временно disable submit, сохранить draft |
| `503`/5xx | сохранить dialog/draft; retry same payload/key; correlation ID доступен в details |
| network abort | если вызван navigation/unmount — без toast; если пользовательский timeout/offline — scoped retry |
| `401` | передать существующему session-expired flow; не показывать `403` |

### 9.3 Conflict specifics

- `ACTIVE_SHIFT_EXISTS`: открыть текущую active shift из `conflict.current`;
- `HANDOVER_ALREADY_ACCEPTED`/`HANDOVER_VERSION_CONFLICT`: показать `acceptedBy/acceptedAt`, открыть closed shift;
- `IDEMPOTENCY_KEY_REUSED`: не retry; сформировать новую attempt только после явного подтверждения и нового key;
- `COMMAND_IN_PROGRESS`: уважать `Retry-After`; автоматический single retry допустим один раз с тем же key и abortable timer;
- permit edit/approval conflict: показать current approval progress/version; substantive edit не merge’ится автоматически.

UI никогда не применяет optimistic domain state. Допустим optimistic presentation только для раскрытия/selection. Командные статусы подтверждаются response/refetch.

## 10. Backend integration points

### 10.1 Bootstrap

| UI | Endpoint | Fields |
|---|---|---|
| module bootstrap | `GET /api/readiness/bootstrap` | tenant timezone, actor/actingAs, feature flags, screen capabilities, equipment/actor selectors, authoritative counts |

Bootstrap загружается один раз на module entry, refetch после `403`, session version change и window focus с разумным stale time. Tenant/actor не берутся из body mutation.

### 10.2 Центр и техника

| UI | Endpoint | Contract |
|---|---|---|
| current center | `GET /api/readiness/equipment/{id}/current` | latest immutable snapshot, active shift/permit/handover, evidence, actions |
| snapshot history | `GET /api/readiness/equipment/{id}/snapshots` | `cursor,limit,from,to,status,triggerType` |
| equipment list | existing tenant equipment list, затем целевой readiness summary projection | list row already includes current snapshot summary and actions; no per-row N+1 |
| equipment detail | existing `/api/equipment/{id}/details` | identity/documents only; readiness comes from `/current` |

Frontend не объединяет legacy journal в readiness decision. До появления equipment list с readiness summary допускается отдельный batch endpoint, но не fan-out одного `/current` на каждую строку.

### 10.3 Смены

| UI/command | Endpoint |
|---|---|
| list/schedule/handover queue | `GET /api/readiness/shifts` |
| detail | `GET /api/readiness/shifts/{id}` |
| create | `POST /api/readiness/shifts` |
| edit | `PATCH /api/readiness/shifts/{id}` |
| start | `POST /api/readiness/shifts/{id}/start` |
| submit handover | `POST /api/readiness/shifts/{id}/handover` |
| cancel | `POST /api/readiness/shifts/{id}/cancel` |
| accept | `POST /api/readiness/handovers/{id}/accept` |
| rework | `POST /api/readiness/handovers/{id}/rework` |

`ShiftBar` получает `plannedStartAt/plannedEndAt/startedAt/closedAt/timezone`. Клиент может вычислить CSS `inset-inline-start` и `inline-size` относительно server-provided visible window — это presentation geometry, не status/readiness calculation. При отсутствующем end bar отображается как ongoing до `windowEnd`, с явным label; значения не выдумываются. На 1024/390 те же данные переходят в вертикальные cards.

### 10.4 Наряд-допуски

| UI/command | Endpoint |
|---|---|
| list | `GET /api/readiness/work-permits` |
| detail | `GET /api/readiness/work-permits/{id}` |
| create | `POST /api/readiness/work-permits` |
| edit | `PATCH /api/readiness/work-permits/{id}` |
| submit | `POST /api/readiness/work-permits/{id}/submit` |
| approve | `POST /api/readiness/work-permits/{id}/approve` |
| revoke | `POST /api/readiness/work-permits/{id}/revoke` |

Approval progress отображается из version-scoped `approvals`; UI не выводит роль approval из текущего actor и не считает permit approved. NORMAL/ELEVATED labels — presentation строгого `risk`; итоговый state всегда серверный.

### 10.5 Обслуживание и workload

Существующие `/api/maintenance`, `/api/maintenance/{id}`, `/api/maintenance/kpi`, `/api/maintenance/assignees`, equipment meter/maintenance и `/api/maintenance-plans` используются только для своих исходных сущностей. Готовность после их mutations читается из нового snapshot.

`MechanicWorkload` требует серверного read model:

```ts
type MechanicWorkloadVm = {
  mechanic: ActorRefVm;
  assignedOpen: number;
  criticalOpen: number;
  dueToday: number;
  overdue: number;
  capacityUnits: number | null;
  utilizationPercent: number | null;
  calculatedAt: string;
};
```

Если backend не владеет capacity, UI показывает counts и `Нагрузка не настроена`; он не делит open records на произвольную норму. Целевой endpoint описан в §10.8.

### 10.6 Reports, trend и audit

| UI | Endpoint |
|---|---|
| audit list/detail payload | `GET /api/audit` with canonical filters |
| CSV | `GET /api/audit/export.csv` with identical filters |
| readiness trend/Pareto/status distribution | target aggregate endpoint in §10.8 |

Audit показывает actor, actual role, `actingAs`, entity/version, timestamps in UTC and tenant timezone, correlation, masked metadata and chain fields. UI не пересчитывает/не заявляет `Цепочка цела`: отображается только server verification state с `verifiedAt` либо нейтральное `Проверка не выполнена`. Hash-chain не называется электронной подписью.

Trend получает ordered points с `bucketStart`, `bucketEnd`, `timezone`, `readyCount`, `blockedCount`, `totalCount`, `readinessPercent|null`. SVG path строится из этих точек только как geometry. Pareto получает server buckets/counts. Пустая series не заменяется декоративной линией.

### 10.7 Rules/settings

| UI/command | Endpoint |
|---|---|
| published/draft | `GET /api/readiness-rules` |
| save draft | `PUT /api/readiness-rules` with expectedVersion |
| publish | `POST /api/readiness-rules/publish` with draftId/expectedVersion |

Role/capability presentation берётся из bootstrap/server policy projection. UI не хранит редактируемую статическую матрицу, если backend не предоставляет command contract. Остальные settings sections подключаются к существующим специализированным endpoints; до интеграции показывают честный unavailable state, а не статические рабочие controls. Definition of Done запрещает placeholders, поэтому каждая секция требует отдельного accepted integration slice.

### 10.8 Required backend contract additions/clarifications

До production frontend implementation backend owners должны добавить в OpenAPI:

1. `GET /api/readiness/equipment` либо расширение tenant equipment list серверным current snapshot summary/actions, чтобы убрать N+1;
2. `plannedEndAt`/effective display interval в `ShiftSummary`, иначе реальные shift bars невозможны;
3. `GET /api/readiness/mechanics/workload` с common filters и model §10.5 либо явное решение показывать только `/api/maintenance` counts без utilization;
4. `GET /api/readiness/reports/trend?from&to&grain=DAY|WEEK&equipmentId...` с trend, blocker Pareto и status distribution;
5. audit event detail contract (`eventId` в `GET /api/audit` либо `GET /api/audit/{id}`) и chain verification status;
6. screen-level capability/read reason shape в `/api/readiness/bootstrap`;
7. endpoint-supported status/sort enum metadata для URL validation, либо generated static enums in OpenAPI.

Canonical pagination (`cursor` в URL/API без client cursor stack), exact `page.total`, strong `ETag`/`If-Match` и audit `meta.filterHash` уже зафиксированы в UI Spec/backend design и должны быть перенесены в generated OpenAPI без изменения формы.

Эти additions являются read-contract work, не разрешением считать данные на клиенте.

## 11. Capabilities и permission UX

Capability precedence:

1. screen capability из bootstrap определяет доступ к query/view;
2. entity `actions[]` определяет visibility/availability конкретной команды;
3. server response остаётся окончательным решением.

`EntityActionGate`:

- `hidden=true` или capability отсутствует для sensitive action — control не рендерится;
- `allowed=false` с безопасной `reason` — disabled control с постоянно доступной причиной (`aria-describedby`, не hover-only);
- `allowed=true` — control активен до начала pending;
- role checks используются только для текста (`actingAs=MECHANIC` badge), не для создания permission;
- direct/deep-link 403 показывает scoped panel, не redirect на unrelated screen;
- cross-tenant safe 404 не раскрывает, существует ли ID.

ADMIN mechanic command требует server-advertised capability/context. Dialog явно показывает «Действие будет записано: ADMIN, actingAs MECHANIC».

## 12. CSV parity и download

`ServerCsvExport`:

1. блокирует export при invalid filters;
2. сериализует тот же normalized filter object, что query;
3. вызывает `/api/audit/export.csv` через authenticated fetch с `AbortSignal`;
4. проверяет `Content-Type`, обрабатывает JSON error envelope до Blob;
5. использует server `Content-Disposition`; fallback filename не содержит tenant/user data;
6. сравнивает `X-Filter-Hash` с обязательным list `meta.filterHash`; UI не вычисляет и не имитирует server filter hash;
7. показывает timezone и export scope до запуска;
8. на `413 EXPORT_TOO_LARGE` предлагает сузить период, сохраняя filters;
9. отменяет stream при navigation/unmount/user cancel;
10. не открывает/не преобразует CSV в JavaScript.

Server отвечает за UTF-8 BOM, RFC 4180, CRLF, formula-injection escaping, masking, audit event и 100,000-row limit. UI count/list/CSV parity проверяется одной fixture и одинаковым filter hash.

## 13. Layout и устранение fixed-height overlap

Удаляются page-level `h-[calc(100vh-...)]`, `min-h-screen` внутри AppShell и произвольные `max-h` у production lists. Layout следует natural document flow:

```css
.techReadinessModule {
  inline-size: 100%;
  min-inline-size: 0;
  min-block-size: 100%;
  overflow-x: clip;
}

.readinessCenterGrid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr) 320px;
  align-items: start;
}
```

Только module tabs и settings row могут быть sticky. Их `top` приходит из shared shell CSS variable, а не hardcoded `0/48px`. Lists растут по контенту; pagination заменяет nested vertical scrolling. Внутренний vertical scroll допустим только dialog/sheet body с измеренным footer, но не центральным рабочим экраном.

Sticky footer:

- имеет measured CSS variable `--command-footer-height`;
- scroll body получает `padding-block-end: calc(var(--command-footer-height) + env(safe-area-inset-bottom))`;
- последний focusable после `scrollIntoView` остаётся выше footer;
- при `visualViewport` resize focused field прокручивается в видимую часть.

Grid children получают `min-width:0`; длинные IDs — `overflow-wrap:anywhere`. Horizontal overflow разрешён только allowlisted containers `module-tabs`, `settings-sections`, `data-table`.

## 14. Responsive geometry

| Viewport | Geometry |
|---|---|
| 1440 | center `300 / minmax(0,1fr) / 320`; shifts/permits main + `300–320` aside; settings `180 + 1fr` |
| 1280 | center `260 / minmax(0,1fr) / 300`; right panel moves below main when center <480; detail may move below list |
| 1024 | one content column; filters two-row/sheet; detail inline/sheet; shift cards replace horizontal timeline; settings sections one horizontal row |
| 390 | one column; 12px page padding; full-width action; cards replace tables; filters/dialog as sheet; controls min-height 44px |

Module tabs всегда остаются одной строкой, `flex:none`; active tab scrolls into view. DOM order остаётся tabs → heading/actions → filters → primary → detail → footer независимо от CSS rearrangement. На 200% zoom не появляется page-level X-scroll.

Shift geometry:

- desktop window boundaries и tick labels приходят с response/meta или детерминированно выбираются из requested date range;
- bars are clipped inside labelled schedule region, not page;
- 1024/390 show start/end as text and status; workflow не требует horizontal swipe;
- missing timestamps render `Не указано`, not fabricated coordinates.

## 15. Focus, keyboard и ARIA

- `ModuleTabList`: `role=tablist`; tabs имеют `role=tab`, `aria-selected`, roving `tabIndex`, Left/Right/Home/End, Enter/Space; panel имеет `role=tabpanel`, `aria-labelledby`;
- settings uses links/buttons in one navigation sequence; no nested duplicate module tab semantics;
- one module-level `aria-live=polite` region announces loading completion/success; `role=alert` handles validation/conflict/error without duplicate toast;
- status always icon + visible text; decorative icon `aria-hidden`;
- table headers use button + `aria-sort`; mobile cards preserve labels via `<dl>`;
- dialogs have labelled title/description, focus trap, inert background and deterministic return focus;
- pending dialog ignores Escape; non-pending dialog closes with Escape;
- validation focuses error summary; 409 focuses conflict heading;
- mobile sheet close button is first in Tab order and swipe is optional;
- disabled reason is connected through `aria-describedby` and reachable without hover;
- async replacement preserves scroll and focus; filtered-empty does not move focus;
- after reset focus returns to filter heading/button and announces result count;
- minimum target: 36×36 desktop, 44×44 at 390; visible focus ring at least 2px.

## 16. Loading, empty and error boundaries

Three levels:

1. `BootstrapBoundary`: module cannot establish authenticated tenant/context; shows retry/session action while tabs remain structurally stable where safe.
2. `ActiveViewBoundary`: catches render/code-split failure of one view; tabs remain usable; logs correlation/component stack without request bodies.
3. Query boundary: list/detail/widget-specific loading/error/empty.

Rules:

- initial list uses structural skeleton with stable dimensions;
- filter refetch keeps old rows with `aria-busy`, never replaces list by full spinner;
- true-empty requires successful total `0` and no active filter;
- filtered-empty requires total `0` and active filters, shows chips/reset;
- partial widgets show `Данные недоступны`, not zero;
- detail 404 removes invalid detail ID through URL replace and preserves list;
- screen 403 contains no entity data;
- offline/network errors preserve current stale data with retry;
- error UI shows correlation ID in expandable technical details, not raw body/stack.

## 17. Performance, cancellation и observability

- active view is code-split; inactive 7+7 screens do not mount/query;
- bootstrap and list/detail requests share query deduplication;
- equipment readiness list is one server projection query, no N+1;
- all GET/mutation/export adapters accept `AbortSignal`;
- route/filter change aborts obsolete request; aborted request cannot commit cache/error toast;
- text filters debounce 300 ms; select/date immediate;
- detail prefetch only on intent (focus/hover) and only if capability permits;
- trend/chart rendering is memoized by immutable points; large tables use cursor pagination, not load-all;
- no long polling. Snapshot convergence uses capped refetch (5 seconds) and respects page visibility;
- Blob CSV is not buffered twice; object URL is revoked after download;
- protected images retain existing authenticated resolution/cache path and cancel stale resolves;
- telemetry: endpoint, duration, status/code, correlationId, view, retry/abort reason; no raw filters, payloads, names, IDs or secrets;
- Web Vitals/interaction spans cover module bootstrap, filter-to-content, command-to-reconciled-state and export start;
- target aligns with backend SLO: center p95 <1s, command excluding fanout <1.5s, 95% snapshots visible <5s.

## 18. Test strategy

### 18.1 Unit

- URL parse/normalize/serialize, opaque cursor, scoped reset и one-shot recovery после `CURSOR_FILTER_MISMATCH`;
- filter schema: enums, dates, `from > to`, detail scoping;
- transport-to-VM adapters preserve null/unknown and reject invalid enums;
- action gate hidden/disabled/allowed;
- idempotency lifecycle: same payload retry/safe new key;
- API error classifier for `400/401/403/404/409/413/422/428/429/503/network/abort`;
- ShiftBar geometry from real timestamps, timezone boundaries and missing end;
- date formatter always receives tenant timezone;
- no readiness/permit/workload/trend domain computation in frontend modules.

### 18.2 Component

- exact 7 tabs and exact 7 settings sections/order;
- tab keyboard semantics and panel linkage;
- list loading/stale/true-empty/filtered-empty/partial/fatal;
- command dialog pending/success/403/409/422/retry and focus return;
- NORMAL/ELEVATED approval progress from fixtures;
- workload without capacity shows counts/no percent;
- trend empty/partial/real points; audit verification unknown/verified/broken;
- mobile cards contain every critical table action;
- CSV action forwards the same normalized filters and handles `413`.

### 18.3 Contract/API

- generated client/types match OpenAPI with no diff;
- every adapter tested against backend examples and error envelopes;
- roles ADMIN/MECHANIC/DISPATCHER/other for each query/command;
- `actions[]` after command agree with refetched entity;
- `meta.filters` and `X-Filter-Hash` parity;
- safe 404 cross-tenant and scoped 403;
- missing/invalid Idempotency-Key and If-Match;
- audit UI reads only `/api/audit`, never FeedbackEvent/journal.

### 18.4 Integration

- router reload/back/forward/reset and direct cursor deep-link across each list view;
- cursor/filter mismatch removes only cursor, preserves filters/sort and retries at most once;
- selection/detail deep-links and invalid ID cleanup;
- mutation updates list/detail/current snapshot;
- abort stale filters/navigation and suppress abort toast;
- async snapshot convergence/stale banner;
- feature flags preserve 7+7;
- source maintenance mutation causes new server snapshot without client recompute.

### 18.5 E2E

At `1440×900`, `1280×800`, `1024×768`, `390×844`, plus 200% desktop zoom:

- all seven views and seven settings sections;
- real shift bars and vertical mobile shift cards;
- permit create/edit/submit/NORMAL/ELEVATED approval/revoke;
- two concurrent shift starts: one success, one current active-shift 409;
- two dispatchers accept handover: loser sees actor/time/current state;
- blocker on/off start flow with 422/warning;
- mechanic workload/trend/audit loaded from server fixtures;
- CSV filters/hash/timezone parity;
- keyboard-only command flows, focus trap/return, single screen-reader announcement;
- no page-level X-scroll, panel intersections or sticky overlap.

Geometry assertions follow UI Spec §13 for every visible interactive element and sibling panel. Automated WCAG scan must have no critical/serious findings.

## 19. Implementation slices

1. **Contracts/foundation:** OpenAPI additions, generated types, adapters/errors, bootstrap, URL schema, query keys, live region/boundaries.
2. **Shell/center/equipment:** exact 7 tabs, production center/current/snapshots, batch equipment summary, remove client readiness derivation.
3. **Permits:** list/detail, dialogs, approval progression/conflicts; этот slice предшествует shift start, потому что опубликованное правило может требовать действующий допуск.
4. **Shifts:** list/detail, real bars/cards, all commands, handover conflicts.
5. **Maintenance:** existing source endpoints, workload projection, snapshot convergence.
6. **Reports/audit:** trend projection, hash-chained audit, server CSV parity.
7. **Settings 7:** rules lifecycle and honest endpoint integration for all sections.
8. **Hardening:** responsive geometry, a11y, cancellation/performance, full E2E and visual review.

Каждый slice проходит role/state contract tests и viewport smoke. Старый component удаляется/отключается только после parity на соответствующей вкладке; нельзя одновременно массово переписать dirty files и потерять текущий handoff.

## 20. Dirty worktree и безопасная интеграция

На момент Design Doc worktree содержит незакоммиченные изменения в `ToModule`, `readiness-reference-ui.tsx`, readiness domain/routes, Prisma/OpenAPI и общих UI components. Implementation должна:

- начать с reviewed `git status`/diff и определить владельца каждого readiness change;
- не перезаписывать текущие untracked/modified files генерацией scaffold;
- отделить contract/schema work от frontend decomposition небольшими commits;
- перед редактированием каждого symbol выполнить GitNexus impact analysis;
- при HIGH/CRITICAL blast radius остановиться и согласовать sequence;
- после slice выполнить GitNexus `detect_changes()` и проверить ожидаемые flows;
- не использовать destructive reset/checkout для очистки worktree;
- генерировать OpenAPI/client только после сохранения/ревью текущих schema changes.

Этот документ добавляет только design artifact и не меняет product code.

## 21. Риски и решения

| Риск | Влияние | Решение |
|---|---|---|
| Backend design не содержит equipment summary/workload/trend endpoints | без них UI вернётся к N+1/клиентским расчётам | закрыть §10.8 до slices 2/5/6 |
| OpenAPI ещё должен материализовать cursor/total/ETag/filterHash, уже согласованные в design docs | generated client может отстать от canonical контракта | contract CI генерирует spec/types и падает на diff до frontend implementation |
| `plannedEndAt` не определён в Shift contract | реальная ширина shift bar не определена | добавить display interval в read model |
| dispatcher audit permission/retention не решены | неизвестно, кому показывать reports/export | security owner decision; capability remains authoritative |
| audit verification status не описан | UI может неверно заявить целостность | neutral unknown until server verification projection exists |
| settings sections не имеют единого backend contract | риск статических controls/placeholders | отдельные endpoint slices; no fake enabled controls |
| existing shared UI components dirty | merge/regression risk | isolate feature components; review before reuse/edit |
| projection lag | stale center after successful command | response cache + bounded convergence refetch/stale banner |
| mobile table dependence | critical workflow inaccessible | card presentation by 1024/390; actions outside scroll |

## 22. Definition of Done frontend

Frontend готов к пилоту, когда:

1. структура exact 7+7, shell/navigation не дублируются;
2. `readiness-reference-ui.tsx` декомпозирован, production entrypoint не содержит client domain recompute/mocks;
3. все visible значения имеют server read-model/query-metadata source;
4. shift bars, permits, workload, trend и audit работают на production endpoints;
5. все команды используют server capabilities, version/ETag, idempotency и state-specific recovery;
6. URL/reload/back/reset и list/detail deep-links проходят;
7. UI/API/CSV используют одинаковые canonical filters/filter hash;
8. current/list/detail/snapshot согласуются после mutations без ручного reload;
9. fixed-height overlap отсутствует на всех целевых viewport/zoom;
10. keyboard/focus/ARIA/screen-reader acceptance зелёные;
11. stale requests/export отменяются, N+1 и load-all отсутствуют;
12. past snapshots/audit не мутируются клиентом;
13. UI не заявляет неподтверждённую готовность, approval, audit integrity или электронную подпись;
14. contract/component/integration/E2E/geometry suites зелёные;
15. visual review подтверждает утверждённую композицию и production-ready states.
