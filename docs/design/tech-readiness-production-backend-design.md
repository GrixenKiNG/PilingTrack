# Backend Design: production-модуль «Техготовность»

**Статус:** Ready for implementation  
**Версия:** 1.0  
**Дата:** 2026-07-29  
**Источники:** [PRD](../product/tech-readiness-production-prd.md), [UI Spec](../ui-spec/tech-readiness-production-ui-spec.md)  
**ADR:** [workflow/consistency](../adr/0041-tech-readiness-workflow-consistency.md), [RBAC/tenancy](../adr/0042-tech-readiness-rbac-and-tenancy.md), [audit chain](../adr/0043-audit-hash-chain.md)

## 1. Решение в одном абзаце

Модуль добавляется как набор tenant-scoped агрегатов `Shift`, `ShiftHandover`, `WorkPermit` и неизменяемых `ReadinessScoreSnapshot`, переиспользуя `ReadinessRuleSet`, `Inspection`, `MaintenanceRecord`, `MeterReading` и оборудование. Команды выполняются транзакционно, защищены RBAC, idempotency и integer optimistic version. Решение о старте смены рассчитывается синхронно по опубликованным правилам и authoritative-данным; остальные snapshots создаются через transactional outbox с SLO до 5 секунд. Все значимые команды атомарно добавляют маскированное событие в tenant hash-chain `AuditLog`.

## 2. Текущее состояние и границы изменения

Проверенная реализация на 2026-07-29:

- PostgreSQL + Prisma; timestamps уже используют `TIMESTAMPTZ(3)`.
- `User.role` — строка; application union содержит `ADMIN | DISPATCHER | OPERATOR | ASSISTANT`. `MECHANIC` и readiness abilities отсутствуют.
- `requireAuth` возвращает tenant из активной session/user записи. В части текущих readiness routes есть fallback на `DEFAULT_TENANT_ID`; для новых endpoints он запрещён.
- `withMutation` уже обеспечивает CSRF и общий rate limit; approve/accept/export получат более строгие buckets.
- `ReadinessRuleSet` и draft/publish service существуют. Миграция уже имеет partial unique index для одного `DRAFT`/`PUBLISHED`, но status/version строковые, публикация не создаёт outbox/snapshots.
- `computeReadinessScore` и `buildReadinessFacts` существуют, но latter использует process-local date и UI-shaped inputs. Production evaluator переносится в backend domain и получает явные `now`, timezone, rule snapshot и repository facts.
- `Inspection`, `MaintenanceRecord`, `MeterReading` и checklist engine переиспользуются. Текущий «дефект» представлен открытым `MaintenanceRecord` типа `FAULT|REPAIR`; отдельная параллельная таблица дефектов не создаётся.
- `OutboxEvent` существует, но не имеет `tenantId`, dedupe key и readiness-specific delivery identity.
- `IdempotencyKey` существует, но не tenant-scoped и не сравнивает request payload.
- `AuditLog` существует без sequence/hash/masking DB guard; `/api/audit` читает `FeedbackEvent`, поэтому должен быть переключён.
- Некоторые составные parent keys отсутствуют; они добавляются до tenant-composite FK.

Не меняются в рамках backend реализации: утверждённая оболочка UI, семь вкладок, checklist engine и смысл существующих maintenance/inspection записей.

## 3. Архитектура и поток данных

```text
Next route
  -> requireAuth + tenant context (no fallback)
  -> capability/state validation + Zod
  -> idempotency acquire(requestHash)
  -> SERIALIZABLE/READ COMMITTED transaction
       -> tenant-scoped aggregate read/update (state + expectedVersion)
       -> authoritative readiness evaluation where required
       -> AuditLog append under TenantAuditChain row lock
       -> OutboxEvent insert
       -> idempotency completed response
  -> response with version, actions[] and correlationId

Outbox worker
  -> claim by SKIP LOCKED
  -> load tenant-scoped authoritative facts
  -> immutable ReadinessScoreSnapshot insert (dedupe trigger identity)
  -> mark projected
  -> UI refetch/current query
```

Command-side и projection-side используют один `ReadinessEvaluator`; snapshot никогда не является источником разрешения safety-команды. Read models возвращают `actions[]` с `{id, allowed, reasonCode?}`; UI не выводит permissions из роли самостоятельно.

## 4. Prisma target schema

Ниже нормативный фрагмент. Имена полей и индексов должны совпасть с миграцией. Optimistic-lock поля `Shift.version`, `ShiftHandover.version`, `WorkPermit.version` и `ReadinessRuleSet.revision` — `Int`, начинаются с `1` и увеличиваются на каждую содержательную мутацию. Существующий `ReadinessRuleSet.version` остаётся неизменяемой business-версией формата `v<major>.<minor>`; смешивать её с optimistic revision запрещено.

```prisma
enum ShiftType { DAY NIGHT }
enum ShiftState { PLANNED STARTED HANDOVER_PENDING CLOSED CANCELLED }
enum ShiftHandoverState { DRAFT SUBMITTED ACCEPTED REWORK_REQUIRED }
enum WorkPermitRisk { NORMAL ELEVATED }
enum WorkPermitState { DRAFT PENDING_APPROVAL APPROVED EXPIRED REVOKED }
enum WorkPermitApprovalRole { DISPATCHER ADMIN }
enum ReadinessRuleSetStatus { DRAFT PUBLISHED ARCHIVED }
enum ReadinessStatus { READY WARNING BLOCKED UNKNOWN }
enum ReadinessTriggerType {
  INSPECTION_COMPLETED
  DEFECT_CHANGED
  METER_RECORDED
  MAINTENANCE_CHANGED
  WORK_PERMIT_CHANGED
  SHIFT_HANDOVER_ACCEPTED
  RULE_SET_PUBLISHED
  SHIFT_START_DECISION
  MIGRATION
}

model Shift {
  id                    String     @id @default(cuid())
  tenantId              String
  equipmentId           String
  type                  ShiftType
  state                 ShiftState @default(PLANNED)
  productionDate        DateTime   @db.Date
  timezone              String
  plannedStartAt        DateTime?  @db.Timestamptz(3)
  startedAt             DateTime?  @db.Timestamptz(3)
  startedById           String?
  startSnapshotId       String?
  closedAt              DateTime?  @db.Timestamptz(3)
  closedById            String?
  cancelledAt           DateTime?  @db.Timestamptz(3)
  cancelledById         String?
  cancelReason          String?
  version               Int        @default(1)
  createdById           String
  createdAt             DateTime   @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime   @updatedAt @db.Timestamptz(3)

  tenant                 Tenant     @relation(fields: [tenantId], references: [id], onDelete: Restrict)
  equipment              Equipment  @relation(fields: [tenantId, equipmentId], references: [tenantId, id], onDelete: Restrict)
  handovers              ShiftHandover[]
  permits                WorkPermit[]
  snapshots              ReadinessScoreSnapshot[]

  @@unique([tenantId, id])
  @@index([tenantId, equipmentId, productionDate(sort: Desc)])
  @@index([tenantId, state, productionDate(sort: Desc)])
  @@index([tenantId, type, productionDate(sort: Desc)])
}

model ShiftHandover {
  id                    String                 @id @default(cuid())
  tenantId              String
  shiftId               String
  state                 ShiftHandoverState     @default(DRAFT)
  summary               String                 @db.Text
  defectRefs            Json                   @default("[]")
  meterReadingRefs      Json                   @default("[]")
  submittedById         String?
  submittedAt           DateTime?              @db.Timestamptz(3)
  acceptedById          String?
  acceptedAt            DateTime?              @db.Timestamptz(3)
  reworkRequiredById    String?
  reworkRequiredAt      DateTime?              @db.Timestamptz(3)
  reworkReason          String?
  version               Int                    @default(1)
  createdById           String
  createdAt             DateTime               @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime               @updatedAt @db.Timestamptz(3)

  shift                 Shift @relation(fields: [tenantId, shiftId], references: [tenantId, id], onDelete: Restrict)

  @@unique([tenantId, id])
  @@index([tenantId, shiftId, createdAt(sort: Desc)])
  @@index([tenantId, state, updatedAt(sort: Desc)])
}

model WorkPermit {
  id                    String          @id @default(cuid())
  tenantId              String
  equipmentId           String
  shiftId               String?
  risk                  WorkPermitRisk
  state                 WorkPermitState @default(DRAFT)
  scope                 String          @db.Text
  validFrom             DateTime        @db.Timestamptz(3)
  validTo               DateTime        @db.Timestamptz(3)
  timezone              String
  authorId              String
  lastEditedById        String
  submittedAt           DateTime?       @db.Timestamptz(3)
  approvedAt            DateTime?       @db.Timestamptz(3)
  revokedAt             DateTime?       @db.Timestamptz(3)
  revokedById           String?
  revokeReason          String?
  expiredAt             DateTime?       @db.Timestamptz(3)
  version               Int             @default(1)
  createdAt             DateTime        @default(now()) @db.Timestamptz(3)
  updatedAt             DateTime        @updatedAt @db.Timestamptz(3)

  equipment             Equipment @relation(fields: [tenantId, equipmentId], references: [tenantId, id], onDelete: Restrict)
  shift                 Shift? @relation(fields: [tenantId, shiftId], references: [tenantId, id], onDelete: Restrict)
  approvals             WorkPermitApproval[]

  @@unique([tenantId, id])
  @@index([tenantId, equipmentId, state, validTo])
  @@index([tenantId, state, updatedAt(sort: Desc)])
  @@index([tenantId, risk, updatedAt(sort: Desc)])
  @@index([tenantId, shiftId])
}

model WorkPermitApproval {
  id                    String                     @id @default(cuid())
  tenantId              String
  permitId              String
  permitVersion         Int
  role                  WorkPermitApprovalRole
  approvedById          String
  approvedAt            DateTime                   @default(now()) @db.Timestamptz(3)
  valid                 Boolean                    @default(true)
  invalidatedAt         DateTime?                  @db.Timestamptz(3)
  invalidationReason    String?

  permit                WorkPermit @relation(fields: [tenantId, permitId], references: [tenantId, id], onDelete: Restrict)

  @@unique([tenantId, permitId, permitVersion, role])
  @@index([tenantId, permitId, permitVersion, valid])
  @@index([tenantId, approvedById, approvedAt(sort: Desc)])
}

model ReadinessScoreSnapshot {
  id                    String               @id @default(cuid())
  tenantId              String
  equipmentId           String
  shiftId               String?
  ruleSetId             String
  ruleSetVersion        String
  triggerType           ReadinessTriggerType
  triggerId             String
  status                ReadinessStatus
  score                 Int
  blockers              Json
  warnings              Json
  evidence              Json
  factsHash             Bytes                @db.ByteA
  calculatedAt          DateTime             @default(now()) @db.Timestamptz(3)

  equipment             Equipment @relation(fields: [tenantId, equipmentId], references: [tenantId, id], onDelete: Restrict)
  shift                 Shift? @relation(fields: [tenantId, shiftId], references: [tenantId, id], onDelete: Restrict)
  ruleSet               ReadinessRuleSet @relation(fields: [tenantId, ruleSetId], references: [tenantId, id], onDelete: Restrict)

  @@unique([tenantId, equipmentId, triggerType, triggerId])
  @@unique([tenantId, id])
  @@index([tenantId, equipmentId, calculatedAt(sort: Desc)])
  @@index([tenantId, status, calculatedAt(sort: Desc)])
  @@index([tenantId, shiftId, calculatedAt(sort: Desc)])
}

model TenantAuditChain {
  tenantId              String   @id
  lastSequence          BigInt   @default(0)
  headHash              Bytes?   @db.ByteA
  updatedAt             DateTime @updatedAt @db.Timestamptz(3)
  tenant                Tenant   @relation(fields: [tenantId], references: [id], onDelete: Restrict)
}

model AuditLog {
  id                    String   @id @default(cuid())
  tenantId              String
  sequence              BigInt
  occurredAt            DateTime @default(now()) @db.Timestamptz(3)
  recordedAt            DateTime @default(now()) @db.Timestamptz(3)
  actorId               String?
  actorName             String?
  actorRole             String?
  actingAs              String?
  action                String
  entityType            String
  entityId              String
  entityVersion         Int?
  requestId             String?
  correlationId         String?
  idempotencyKeyHash    Bytes?   @db.ByteA
  before                Json?
  after                 Json?
  metadata              Json?
  prevHash              Bytes?   @db.ByteA
  hash                  Bytes    @db.ByteA

  @@unique([tenantId, sequence])
  @@unique([tenantId, hash])
  @@index([tenantId, occurredAt(sort: Desc), id])
  @@index([tenantId, entityType, entityId, occurredAt(sort: Desc)])
  @@index([tenantId, actorId, occurredAt(sort: Desc)])
  @@index([tenantId, action, occurredAt(sort: Desc)])
}
```

Обязательные изменения существующих моделей:

```prisma
// Parent composite keys
Equipment       @@unique([tenantId, id])
User            @@unique([tenantId, id])
Inspection      @@unique([tenantId, id])
MaintenanceRecord @@unique([tenantId, id])
MeterReading    @@unique([tenantId, id])
ReadinessRuleSet:
  status ReadinessRuleSetStatus
  version String
  revision Int @default(1)
  @@unique([tenantId, id])
  @@unique([tenantId, version])
  snapshots ReadinessScoreSnapshot[]

OutboxEvent:
  tenantId String
  dedupeKey String
  @@unique([tenantId, dedupeKey])
  @@index([tenantId, projected, createdAt])

IdempotencyKey:
  tenantId String
  actorId String
  requestHash Bytes @db.ByteA
  result Json?
  statusCode Int?
  responseHeaders Json?
  @@unique([tenantId, scope, key])
```

Prisma schema не выражает partial indexes/check constraints/triggers; они обязательны в SQL:

```sql
CREATE UNIQUE INDEX "Shift_one_active_per_equipment"
ON "Shift" ("tenantId", "equipmentId")
WHERE state IN ('STARTED', 'HANDOVER_PENDING');

CREATE UNIQUE INDEX "ShiftHandover_one_live_per_shift"
ON "ShiftHandover" ("tenantId", "shiftId")
WHERE state IN ('DRAFT', 'SUBMITTED', 'REWORK_REQUIRED');

ALTER TABLE "WorkPermit"
  ADD CONSTRAINT "WorkPermit_valid_window" CHECK ("validTo" > "validFrom");
ALTER TABLE "ReadinessScoreSnapshot"
  ADD CONSTRAINT "ReadinessScoreSnapshot_score_range" CHECK (score BETWEEN 0 AND 100);

CREATE FUNCTION reject_audit_mutation() RETURNS trigger ...;
CREATE TRIGGER "AuditLog_append_only"
BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION reject_audit_mutation();
```

`Shift.startSnapshotId` получает tenant-composite FK `(tenantId,startSnapshotId) -> ReadinessScoreSnapshot(tenantId,id)` второй миграцией после обеих таблиц либо как raw SQL `DEFERRABLE INITIALLY DEFERRED`, чтобы избежать migration cycle. Actor IDs хранятся как immutable attribution fields; они tenant-проверяются при команде, но не получают `ON DELETE CASCADE`, чтобы удаление/деактивация пользователя не уничтожало историю.

## 5. State machines и инварианты

### 5.1 Shift

| From | Command | To | Actor | Guards |
|---|---|---|---|---|
| — | create | `PLANNED` | DISPATCHER/ADMIN capability | valid equipment/type/date/timezone |
| `PLANNED` | start | `STARTED` | DISPATCHER | no active shift; published rules; authoritative blockers pass |
| `STARTED` | handover | `HANDOVER_PENDING` | MECHANIC/ADMIN-as-mechanic | submitted handover same version |
| `HANDOVER_PENDING` | accept | `CLOSED` | DISPATCHER | handover `SUBMITTED`, expected versions match |
| `HANDOVER_PENDING` | rework | `STARTED` | DISPATCHER | reason required |
| `PLANNED|STARTED` | cancel | `CANCELLED` | server capability | reason required |

`CLOSED`/`CANCELLED` терминальны. Accept обновляет `ShiftHandover` и `Shift` в одной транзакции.

### 5.2 ShiftHandover

`DRAFT -> SUBMITTED -> ACCEPTED` или `SUBMITTED -> REWORK_REQUIRED -> DRAFT`.

- `ACCEPTED` терминален.
- Rework создаёт новую содержательную версию при следующем сохранении/submit.
- `defectRefs` и `meterReadingRefs` валидируются как tenant-scoped ссылки; snapshot содержит ID и минимальное неизменяемое описание, чтобы последующее редактирование источника не меняло историю.
- Первый conditional accept выигрывает. Нулевой `updateMany.count` означает refetch и `409 HANDOVER_VERSION_CONFLICT`/`HANDOVER_ALREADY_ACCEPTED`.

### 5.3 WorkPermit

`DRAFT -> PENDING_APPROVAL -> APPROVED -> EXPIRED|REVOKED`.

- Submit проверяет scope, окно действия, equipment/optional shift и меняет state.
- `NORMAL`: одно valid approval роли `DISPATCHER`.
- `ELEVATED`: valid approvals `DISPATCHER` + `ADMIN`, два разных user ID, любой порядок.
- Автор или `lastEditedById` не может одобрить текущую версию.
- Content fields: `equipmentId`, `shiftId`, `risk`, `scope`, `validFrom`, `validTo`, `timezone`. Их изменение после любого approval: `version + 1`, все approvals текущей версии `valid=false`, state=`DRAFT`, `approvedAt=null`.
- Revoke разрешён только для `APPROVED`, причина обязательна.
- Expire — идемпотентная worker-команда по `validTo <= now`; валидность при старте всё равно вычисляется по времени, поэтому задержка worker не продлевает допуск.

### 5.4 Published rule gating

В tenant ровно один `PUBLISHED`. Если его нет, shift start fail-closed с `422 READINESS_RULES_NOT_PUBLISHED`; default rules допустимы только для pre-production preview/backfill, не для разрешения старта.

Evaluator получает:

- latest completed inspection in tenant production-day window;
- открытые `MaintenanceRecord(type in FAULT, REPAIR)` как defects;
- latest `MeterReading`;
- maintenance due/overdue из records/plans;
- действующий permit только если соответствующий blocker включён;
- текущий handover/acceptance state;
- immutable rule set JSON and numeric version.

Если blocker `VALID_WORK_PERMIT_REQUIRED` выключен, отсутствие permit становится warning и не меняет `canStart`; если включён — blocker. Текущий domain enum blockers должен быть расширен этим condition, иначе PRD невозможно выполнить.

## 6. Tenant isolation и timezone

### Tenant

- `tenantId` извлекается из session user ровно один раз и передаётся в `CommandContext`.
- Body/query `tenantId` отклоняется `400 UNKNOWN_FIELD`, а не игнорируется.
- Все reads используют `where: {tenantId, ...}`; `findUnique({id})` запрещён в readiness repositories.
- Все дочерние связи имеют composite FK `(tenantId, foreignId)`.
- Возвращать `404 RESOURCE_NOT_FOUND` и для отсутствующего, и для чужого ID.
- RLS policy: `tenantId = current_setting('app.current_tenant', false)`; никаких `IS NULL OR ''` bypass. Prisma transaction wrapper выполняет `SET LOCAL`.

### Timezone

- Canonical tenant timezone берётся только из `TenantSettings.timezone`; `User.timezone` остаётся персональной display-настройкой и не участвует в production date, permit validity или readiness gates. `UTC+3` мигрирует в `Europe/Moscow`; invalid/missing -> `Europe/Moscow`.
- DB хранит instants в UTC (`TIMESTAMPTZ`) и timezone, использованную при вычислении workflow.
- `productionDate` — local calendar date (`DATE`), вычисленная сервером через Temporal/polyfill или Luxon; `new Date().getDate()` запрещён.
- API принимает RFC 3339 timestamps с offset. Timestamp без offset — `422 TIMEZONE_OFFSET_REQUIRED`.
- `from/to` — local dates tenant timezone; `from` inclusive 00:00, `to` inclusive UI превращается в exclusive start of next local day. DST границы вычисляются timezone library, не `+24h`.
- DAY/NIGHT — тип, не выводимый автоматически из времени в v1. Если расписание смен позже появится, оно не изменяет сохранённый type.

## 7. Concurrency, idempotency и транзакции

### Optimistic concurrency

- GET/detail возвращает optimistic `version` и **strong** `ETag: "<aggregate-kind>-<id>-v<version>"`. Weak ETag (`W/`) запрещён: HTTP `If-Match` использует strong comparison.
- Versioned mutation принимает один strong `If-Match` или integer `expectedVersion`; если переданы оба, они обязаны обозначать одну версию. Отсутствует — `428 PRECONDITION_REQUIRED`, malformed/weak/mismatch-between-fields — `400 INVALID_PRECONDITION`.
- Для rules read model возвращает business `version` (`v1.0`) и optimistic `revision`; rules ETag/`expectedRevision` используют только `revision`.
- Conditional mutation: `updateMany({where:{tenantId,id,state,version:expected}, data:{...,version:{increment:1}}})`.
- После `count=0` сервер tenant-scoped перечитывает объект и формирует `409` с `submittedVersion`, `currentVersion`, current state, actor/time последней команды, безопасным current resource и `actions`.

### Idempotency

- Header обязателен для POST/PUT/PATCH command endpoints: 16–128 visible ASCII chars (`0x21..0x7E`).
- Scope = method + route template + aggregate ID + actor ID; key unique внутри tenant.
- `requestHash = SHA-256(canonical JSON({method, routeTemplate, pathIds, normalizedBody, expectedVersion, actorId}))`.
- Existing completed + same hash: исходный status/body/headers; same key + other hash: `409 IDEMPOTENCY_KEY_REUSED`.
- Claim выполняется `INSERT` внутри той же transaction, что aggregate/audit/outbox и completed response. Конкурентный `INSERT` ожидает unique-key winner до короткого DB lock timeout: после commit winner loser читает completed response и replay-ит его; после rollback winner loser получает claim и выполняет команду.
- Если ожидание winner превысило lock timeout, вернуть `409 COMMAND_IN_PROGRESS` + `Retry-After: 1`; request thread не polling/sleep. Отдельный заранее committed `processing` row и «stale reset» запрещены, потому что они разрывают атомарность и допускают двойное выполнение.
- 5xx/serialization failure до commit откатывает claim вместе с aggregate; committed aggregate всегда имеет committed replayable status/body/allowlisted headers.
- Retention минимум 7 дней, cleanup только completed/failed expired keys.

### Transaction boundaries

| Command | Isolation | Atomic writes |
|---|---|---|
| create/edit/submit/approve/revoke permit | `SERIALIZABLE` for approve/edit; otherwise `READ COMMITTED` conditional | permit + approvals invalidation/create + audit + outbox + idempotency |
| create/start/cancel shift | `SERIALIZABLE` | shift + start decision snapshot (start only) + audit + outbox + idempotency |
| handover submit/rework/accept | `SERIALIZABLE` | handover + shift + audit + outbox + idempotency |
| publish rules | `SERIALIZABLE` | archive old + publish draft + audit + fanout root outbox |
| inspection complete/meter/maintenance mutation | existing transaction upgraded | source write + readiness outbox + audit |

Retry `40001`/deadlock максимум 3 раза с jitter повторяет всю transaction, включая idempotency claim; после исчерпания `503 RETRYABLE_TRANSACTION_FAILURE`.

## 8. Readiness snapshots и outbox

### Trigger matrix

| Source event | triggerType | triggerId |
|---|---|---|
| Inspection becomes `COMPLETED` | `INSPECTION_COMPLETED` | inspection ID + version/update timestamp |
| FAULT/REPAIR create/status/content change | `DEFECT_CHANGED` | maintenance record ID + update revision |
| Meter reading create/delete | `METER_RECORDED` | reading ID or tombstone event ID |
| Maintenance create/status/accept/delete | `MAINTENANCE_CHANGED` | record/event ID |
| Permit edit/submit/approve/revoke/expire | `WORK_PERMIT_CHANGED` | permit ID + version + state revision |
| Handover accept | `SHIFT_HANDOVER_ACCEPTED` | handover ID + accepted version |
| Rules publish | `RULE_SET_PUBLISHED` | ruleSet ID + equipment ID |
| Shift start | `SHIFT_START_DECISION` | command ID |
| Backfill | `MIGRATION` | migration version + equipment ID |

Каждая source-команда пишет outbox в той же транзакции. Dedupe key равен `readiness.snapshot:<tenant>:<equipment>:<triggerType>:<triggerId>`. Payload содержит trigger identity, `triggerOccurredAt`, equipment/shift IDs и, для publish fanout, pinned `ruleSetId/version`; он не содержит full aggregate или PII. Worker:

1. claims rows `FOR UPDATE SKIP LOCKED`;
2. validates tenant/equipment;
3. фиксирует один server `calculationNow`, загружает latest authoritative facts на этот момент и latest published rules; publish fanout использует pinned newly-published rule set;
4. canonicalizes фактически использованные facts вместе с source revisions/watermark, `triggerOccurredAt` и `calculationNow`, затем stores `factsHash`;
5. inserts snapshot with unique trigger identity;
6. marks event projected; duplicate insert is successful idempotent completion.

Шаги 1–6 для одного event выполняются в одной DB transaction: snapshot insert не может commit без `projected=true`, и наоборот. Event `occurredAt` не используется как readiness clock вместе с более новыми mutable rows: без temporal source history такая смесь создала бы невоспроизводимый ложный snapshot.

Rule publication emits `ReadinessRuleSetPublished`; fanout worker pages active equipment by stable `(tenantId,id)` cursor and writes per-equipment outbox rows. It does not hold a transaction over the whole fleet. Root-event checkpoint и per-equipment dedupe делают fanout resumable; completion count сравнивается с pinned eligible-equipment count. Metrics: projection lag, failures, DLQ count, snapshot compute duration, missing-current ratio.

Snapshot JSON schema:

```json
{
  "blockers": [{"code":"VALID_WORK_PERMIT_REQUIRED","ruleKey":"...","sourceRefs":[],"action":"..."}],
  "warnings": [{"code":"WORK_PERMIT_MISSING_OPTIONAL","sourceRefs":[]}],
  "evidence": {
    "inspectionId": "…",
    "defectIds": ["…"],
    "meterReadingId": "…",
    "maintenanceRecordIds": ["…"],
    "workPermitId": null,
    "handoverId": null
  }
}
```

Snapshots are never updated/deleted by application code.

## 9. Audit chain

### Append algorithm

Within the caller transaction:

1. recursively mask `before`, `after`, `metadata`;
2. `INSERT ... ON CONFLICT DO NOTHING` `TenantAuditChain(tenantId)`;
3. lock the row `SELECT ... FOR UPDATE`;
4. construct immutable event with next sequence, server-created `recordedAt` and domain `occurredAt` (для native command они равны одному captured transaction clock);
5. canonicalize using RFC 8785 JCS, UTF-8; `sequence` сериализуется decimal string, timestamps — UTC RFC 3339 with milliseconds; reject non-JSON values, non-finite numbers and duplicate semantic keys;
6. compute SHA-256 per ADR-0043;
7. insert `AuditLog`, then update chain head.

Masking is recursive, case-insensitive, applied to keys matching:

```text
password, passphrase, pin, token, accessToken, refreshToken, secret,
apiKey, cookie, set-cookie, authorization, proxy-authorization,
email, phone, mobile, address, postalAddress
```

Replacement is `"[REDACTED]"`; arrays and nested objects are traversed; depth max 32, payload max 256 KiB after masking. Idempotency keys are never stored raw, only SHA-256. `userAgent` and IP move to masked metadata only if retention policy allows them.

Verifier recomputes sequence/hash from genesis, compares final hash/sequence with `TenantAuditChain`, records result in security metrics/alerts, and never «repairs» the chain. CSV exposes hashes as lowercase hex and BigInt sequence as decimal string. DB chain detects mutation/gap/reorder while trusted chain head remains; periodic signed/WORM external head anchoring is a separate compliance control and must be enabled before claiming protection from a privileged database owner who can rewrite both log and head.

## 10. API contract

### Common envelope

Success list:

```json
{
  "data": [],
  "page": {"limit":50,"nextCursor":null,"hasMore":false,"total":0},
  "meta": {"timezone":"Europe/Moscow","correlationId":"…","filters":{},"filterHash":"…"}
}
```

Success entity: `{"data": {...}, "meta": {...}}`. Command response returns updated aggregate, affected current snapshot when synchronous, `actions[]` and `version`; the strong `ETag` is returned as an HTTP response header.

Error:

```json
{
  "error": {
    "code": "HANDOVER_VERSION_CONFLICT",
    "message": "Данные уже изменились",
    "fieldErrors": {},
    "blockers": [],
    "conflict": {
      "submittedVersion": 3,
      "currentVersion": 4,
      "currentState": "ACCEPTED",
      "changedBy": {"id":"…","name":"…"},
      "changedAt": "2026-07-29T18:21:00Z",
      "current": {}
    },
    "correlationId": "…"
  }
}
```

Status policy: `400` syntax/query/header, `401` session, `403` known tenant resource but forbidden command, safe `404` missing/cross-tenant, `409` concurrency/idempotency/unique active shift, `413` bounded export overflow, `422` domain/field validation, `428` missing version precondition, `429`, `503`.

### Endpoints

| Method/path | Request | Response |
|---|---|---|
| `GET /api/readiness/bootstrap` | — | tenant timezone, feature flags, capabilities, selectors, counts |
| `GET /api/readiness/shifts` | filters/page below | shift summaries |
| `POST /api/readiness/shifts` | equipmentId,type,productionDate,plannedStartAt?; timezone server-owned | `201 Shift` |
| `GET /api/readiness/shifts/{id}` | — | shift + handover + current decision |
| `PATCH /api/readiness/shifts/{id}` | expectedVersion, editable planned fields | Shift |
| `POST .../{id}/start` | expectedVersion, confirmation? | started Shift + decision snapshot |
| `POST .../{id}/handover` | expectedVersion, summary, defectRefs, meterReadingRefs | Shift + Handover |
| `POST .../{id}/cancel` | expectedVersion, reason | cancelled Shift |
| `POST /api/readiness/handovers/{id}/accept` | expectedVersion, expectedShiftVersion | accepted Handover + closed Shift |
| `POST .../{id}/rework` | expectedVersion, expectedShiftVersion, reason | rework Handover + started Shift |
| `GET /api/readiness/work-permits` | filters/page | permit summaries |
| `POST /api/readiness/work-permits` | equipmentId,shiftId?,risk,scope,validFrom,validTo; timezone server-owned | `201 Permit` |
| `GET/PATCH /api/readiness/work-permits/{id}` | PATCH includes expectedVersion | Permit + approvals |
| `POST .../{id}/submit` | expectedVersion | pending Permit |
| `POST .../{id}/approve` | expectedVersion | Permit + approval progress |
| `POST .../{id}/revoke` | expectedVersion, reason | revoked Permit |
| `GET /api/readiness/equipment/{id}/current` | — | latest snapshot + active shift/permit/workflow + actions |
| `GET /api/readiness/equipment/{id}/snapshots` | cursor,limit,from,to,status,triggerType | immutable history |
| `GET/PUT /api/readiness-rules` | PUT expectedRevision | business version + optimistic revision |
| `POST /api/readiness-rules/publish` | draftId,expectedRevision | published rules + affectedEquipmentCount |
| `GET /api/audit` | filters/page | `AuditLog` only |
| `GET /api/audit/export.csv` | identical normalized filters | streamed UTF-8 CSV |

Все mutations требуют `Idempotency-Key`; body не содержит actor/tenant/timezone/approval role — сервер выводит их из session, `TenantSettings` and capability. `productionDate` принимается как local `YYYY-MM-DD`; при наличии `plannedStartAt` сервер проверяет, что он попадает в эту дату в tenant timezone.

### Filters, sort, pagination

- Common: `equipmentId`, `status`, `from`, `to`, `sort`, `cursor`, `limit`.
- Shifts: `shiftType=DAY|NIGHT`; permits: `risk=NORMAL|ELEVATED`; audit: `eventType`, `actorId`, `entityType`, `entityId`.
- `eventType` — public filter name, нормализуемый в `AuditLog.action`; transport не раскрывает legacy field names.
- `limit` default 50, max 200.
- Cursor — opaque base64url of canonical JSON `{sortValue,id,filterHash}`, HMAC-signed server key. Cursor with other filters => `400 CURSOR_FILTER_MISMATCH`.
- Allowed sorts: shifts `productionDate.desc|asc`, `updatedAt.desc|asc`; permits/audit/snapshots `updatedAt/occurredAt/calculatedAt.desc|asc`. Always append `id` tie-breaker.
- Unknown filter/sort/status => `400 INVALID_FILTER`; `from > to` => `422 INVALID_DATE_RANGE`.
- Response `meta.filters` is the canonical normalized object used by CSV; `GET /api/audit` additionally returns `meta.filterHash`, calculated by the same server canonicalizer as export header `X-Filter-Hash`. `page.total` is exact and distinguishes true-empty from filtered-empty; it is calculated with the same tenant/filter predicate and does not mean the current page length.

### CSV

- Same filter parser/repository query as JSON; no client-side post-filtering.
- Columns: `sequence,occurredAtUtc,recordedAtUtc,occurredAtLocal,timezone,action,entityType,entityId,entityVersion,actorId,actorName,actorRole,actingAs,correlationId,prevHash,hash,metadataJson`.
- UTF-8 BOM; RFC 4180 quoting; CRLF. Any cell whose first non-whitespace char is `= + - @` is prefixed with `'`.
- `Content-Disposition` filename includes tenant-local date; `X-Filter-Hash`, `X-Timezone`, `X-Correlation-Id`.
- Stream in pages; max synchronous export 100,000 rows. Larger -> `413 EXPORT_TOO_LARGE` with narrower-filter action.
- Export command itself appends `audit.exported` with filter hash/count, not raw potentially sensitive filters.

## 11. OpenAPI

Extend `scripts/generate-openapi.ts`; generated `public/openapi.json` remains source artifact served by `/api/openapi`.

Required reusable components:

- security scheme `cookieAuth`;
- schemas for all enums, aggregate/read models, `ActionCapability`, `PageMeta`, `ErrorEnvelope`, `Blocker`, `Conflict`;
- parameters `Idempotency-Key` (required mutations), `If-Match`, `cursor`, `limit`, common filters;
- response components `Unauthorized`, `Forbidden`, `NotFound`, `Conflict`, `ValidationError`, `PreconditionRequired`, `RateLimited`;
- explicit examples for blocked shift, active-shift conflict, accepted-handover conflict, elevated approval progress and idempotency mismatch;
- CSV response `text/csv`, binary/string schema, headers documented.

Contract CI:

1. regenerate spec and fail on diff;
2. validate OpenAPI 3.0.3;
3. lint operationId uniqueness and security on every readiness/audit operation;
4. generate types/client in check mode;
5. run request/response conformance tests against route handlers.

## 12. Security

- Session auth plus server abilities on every route; role assignment ADMIN-only and increments `sessionVersion`.
- CSRF through `withMutation`; approve/accept: 20/min/user+entity, export: 5/10 min/user, other commands current mutation policy.
- Object IDs are opaque; errors and timing should not reveal cross-tenant existence.
- Zod `.strict()`, length bounds (`summary/scope/reason`), JSON ref count/size caps.
- Internal action URLs in blockers use server allowlist route IDs, not arbitrary URLs.
- Audit/log masking happens before logger, Sentry breadcrumbs and DB persistence; no raw request bodies in logs.
- CSV injection protection and `Content-Type: text/csv; charset=utf-8`, `X-Content-Type-Options: nosniff`.
- DB application role: no audit update/delete/truncate, no bypass RLS; migration role separate.
- Outbox payload contains IDs/revisions, not full PII-bearing aggregates.
- Hash verifier alert is sent to security telemetry, avoiding recursive audit append.
- Retention is configuration/policy dependent; no delete job ships until owners define legal retention and chain checkpoint procedure.

## 13. Migration, seed, rollout, rollback

### Ordered migrations

1. `readiness_parent_tenant_keys`: add composite unique keys to parent tables; validate duplicate assumptions.
2. `readiness_roles_timezone`: normalize missing/`UTC+3` `TenantSettings.timezone` to `Europe/Moscow`; paired code release adds the `MECHANIC` union/abilities before any assignment. No users auto-assigned `MECHANIC`.
3. `readiness_workflows`: enums, Shift/Handover/Permit/Approval and raw partial indexes/checks.
4. `readiness_snapshots_outbox_idempotency`: snapshot table; additive outbox/idempotency columns initially nullable, backfill tenant/request hashes where possible, then `NOT NULL`; new composite uniques.
5. `audit_chain_v1`: additive AuditLog v2 columns nullable, `TenantAuditChain`, then deterministic backfill ordered by `(timestamp,id)`. Mappable tenant rows become `LEGACY_IMPORT` canonical events with original timestamp in `occurredAt`, import clock in `recordedAt` and original action/provenance in masked metadata. Rows with `tenantId IS NULL` must be explicitly mapped by an approved manifest or moved unchanged to a restricted `LegacyAuditLogUnscoped` archive excluded from tenant API; they are never assigned to a default tenant. Only then make v2 tenant/sequence/hash columns `NOT NULL` and enable append-only grants/trigger.
6. `readiness_rules_typed`: validate status and semantic version strings against `^v[0-9]+\.[0-9]+$`, add integer `revision` for optimistic locking and enum status, retain string `version` and the partial unique live-rule index. Do not cast `v1.0` to integer.
7. `readiness_rls_enforce`: only after every request/worker path uses the tenant transaction wrapper; replace fail-open policies and `FORCE ROW LEVEL SECURITY` for new workflow/audit tables and all reused readiness source tables (`Equipment`, `Inspection`/checklist tables, `MaintenanceRecord`, `MeterReading`, `ReadinessRuleSet`, `TenantSettings`). Application/worker roles are non-owner and have no `BYPASSRLS`; migration owner is separate.
8. `readiness_start_snapshot_fk`: deferred FK after data structures exist.

Each migration runs a preflight query and aborts on invalid timezone, duplicate live rules/business versions, malformed semantic rule versions, orphan tenant links, unmapped nullable legacy audit rows or missing tenant wrappers. Use `CREATE INDEX CONCURRENTLY` in an operational no-transaction migration for large existing tables.

### Backfill

- Stable cursor over active equipment `(tenantId,id)`, batch 200.
- For each equipment, load existing Inspection, `FAULT|REPAIR`, MeterReading, MaintenanceRecord and published rules; write `MIGRATION` snapshot with provenance and backfill version.
- No synthetic permits/shifts/approvals.
- Idempotent unique trigger identity; progress table/checkpoint; counts by tenant.
- Completion gate: every active equipment has exactly one current backfill/newer snapshot or an explicit error row.

### Seed

Development/test seed adds:

- one tenant timezone `Europe/Moscow`;
- distinct ADMIN, DISPATCHER, MECHANIC users, assigned through the same role service that increments `sessionVersion`;
- two equipment items;
- published rule set and draft;
- NORMAL and ELEVATED permits covering approval stages;
- DAY planned and NIGHT closed shift/handover;
- snapshots and audit events created through services, never direct fake hashes.

Production seed only creates missing tenant timezone/default draft under an explicit migration command; it never assigns users or publishes safety rules automatically.

### Feature rollout

1. `readiness_audit_chain_v1` shadow writes + verification.
2. `readiness_snapshots_v1` backfill/read-only center.
3. `readiness_permits_v1`.
4. `readiness_shifts_v1` for pilot tenant allowlist.
5. audit API/CSV switch after parity comparison.

Observe p95 query/command, snapshot lag, `409/422`, outbox/DLQ, chain failures and tenant denial metrics.

### Rollback

Rollback is feature-flag and route rollback, not destructive schema down-migration:

- disable command flags; retain read/audit data;
- stop readiness projection consumer without stopping unrelated outbox consumers;
- revert `/api/audit` reader only if the security owner accepts temporary legacy semantics;
- deploy previous code compatible with additive nullable columns;
- never delete workflow/snapshot/audit rows or reverse the hash chain.

Forward-fix is required after data-writing rollout. Destructive `DROP TYPE/TABLE` is prohibited in production rollback.

## 14. Test plan

### Unit

- every legal/illegal transition and terminal state;
- NORMAL/ELEVATED approval order, distinct users, self-approval, edit invalidation;
- published blocker on/off and no-published-rules fail-closed behavior;
- Europe/Moscow and DST timezone cases from another IANA tenant; local date range boundaries;
- canonical JSON golden vectors, nested masking, Unicode, numeric edge rejection, hash chain vectors;
- request hash/idempotency scopes; strong ETag parsing; semantic rules version vs optimistic revision; cursor HMAC/filter hash;
- CSV quote/newline/formula injection.

### Contract/API

- each endpoint for ADMIN/MECHANIC/DISPATCHER/other;
- ADMIN-as-mechanic audit fields;
- missing/invalid idempotency and If-Match;
- weak ETag rejection, header/body precondition mismatch and rules `expectedRevision`;
- exact `404/409/413/422/428/429` envelopes and correlation ID;
- URL filters equal API normalized filters and CSV filter hash;
- `/api/audit` repository test proves only `AuditLog` is queried;
- OpenAPI examples/schema conformance.

### DB/integration

- 20 parallel shift starts => one active row, losers stable `409`;
- two dispatchers accept same handover => one accepted/closed transaction;
- approval vs edit race => either approval on old version invalidated or edit wins; never approved mutated content;
- same/different idempotency payload under concurrency;
- winner commit/rollback/lock-timeout idempotency races prove no double execution and replay exact status/body/headers;
- composite FK cross-tenant attach failures for every relation;
- source write and outbox rollback together;
- duplicate outbox delivery creates one snapshot and atomically marks projection; delayed events use one captured calculation clock with matching latest facts;
- audit concurrent append has contiguous tenant sequence; update/delete DB role rejected;
- hash verifier detects mutation, deletion and sequence gap;
- rule publish creates one published version and fanout coverage.

### Migration/security/performance

- production-like upgrade twice; `v1.0` rule migration; nullable legacy audit mapping/quarantine; preflight failures; backfill resume and counts; old code compatibility;
- IDOR body/query/path attempts, tenant spoofing, RLS unset/wrong tenant, CSRF and rate limits;
- secret/contact values absent from AuditLog, application logs, Sentry fixture and outbox;
- p95 center <1s, command excluding fanout <1.5s, 95% snapshots visible <5s at production-like volume;
- large CSV memory remains bounded and cancels on client disconnect.

### End-to-end acceptance support

Backend fixtures support the UI Spec scenarios at 1440/1280/1024/390: seven tabs, URL reload/back/reset, true/filtered empty, role/state actions, NORMAL/ELEVATED approval, blocker on/off start, two-dispatcher accept conflict, snapshot refresh, safe CSV and keyboard/a11y states.

## 15. Implementation slices and ownership

1. **Foundation:** tenant transaction wrapper, roles/abilities, timezone, error envelope, idempotency v2.
2. **Audit:** canonical masker/hash-chain, AuditLog API/CSV, verifier.
3. **Snapshots:** production evaluator, source adapters, outbox consumer, backfill/current reads.
4. **Permits:** models/state machine/routes/approvals.
5. **Shifts:** models/start gate/handover/concurrency.
6. **Rules/OpenAPI/rollout:** typed rule lifecycle, fanout, spec, flags, observability.

No slice is complete without tenant negative tests, audit append, outbox behavior and OpenAPI contract for its commands.

## 16. Known risks and decisions still requiring owners

| Risk/open item | Impact | Required decision/mitigation |
|---|---|---|
| Current readiness blocker vocabulary lacks explicit valid-permit condition | Shift gate cannot meet PRD unchanged | Add versioned `VALID_WORK_PERMIT_REQUIRED` rule condition and migration adapter |
| Existing RLS policy permits all rows when tenant setting is absent | Defense-in-depth is currently fail-open | Ship/verify Prisma tenant transaction wrapper before fail-closed migration |
| Existing source commands are not uniformly transaction-injectable | Source write could commit without readiness outbox | Refactor command services to accept transaction client before enabling triggers |
| `AuditLog` switch changes semantics from FeedbackEvent history | UI/report compatibility | Parallel-read parity period and explicit schema adapter |
| PRD does not define industrial score weights/window durations | Different owners may expect different readiness | Product/safety owner publishes initial rules; backend only enforces versioned lifecycle |
| Shift clock boundaries are unspecified | Cannot auto-derive DAY/NIGHT | Keep required explicit type in v1; decide schedule later |
| Audit retention, external chain-head anchoring and dispatcher audit permission are unresolved | Compliance/storage/access | Security owner must approve policy before general rollout; do not overclaim privileged-DB tamper resistance |
| Dirty worktree contains in-progress Prisma/readiness/OpenAPI changes | Merge/overwrite risk | Implement from a fresh reviewed diff; never overwrite current uncommitted files blindly |

## 17. Definition of Done backend

Backend готов к пилоту, когда migrations/backfill проходят на production-like копии; все tenant/RBAC/concurrency/audit tests зелёные; опубликованные rules дают объяснимое решение старта; snapshots укладываются в SLO; `/api/audit`/CSV читают только hash-chained `AuditLog`; OpenAPI воспроизводимо генерируется; feature flags позволяют остановить writes без удаления данных; ни один тест не обнаруживает cross-tenant read/write/link.
