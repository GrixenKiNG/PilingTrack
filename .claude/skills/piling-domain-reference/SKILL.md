---
name: piling-domain-reference
description: >-
  Use when modeling or validating piling quantities, downtime, maintenance
  intervals, reliability KPIs, or interpreting отчёт fields. Covers domain
  semantics, relationships and math — the work hierarchy
  (Site→PileField→Cluster→Picket), shift-report lifecycle, downtime unit
  invariants (HOURS), pile-length (м.п.) resolution via PileGrade.lengthMm,
  leader drilling, CMMS theory (ЕО/ТО, PM plans, work orders, MTBF/MTTR),
  crew↔equipment rules, and sanity magnitudes.
---

# Piling Domain Reference (PilingTrack)

Domain-theory pack: what the entities MEAN, how they RELATE, and the MATH the
code enforces. Verified against `prisma/schema.prisma` and the live code on
2026-07-07 (branch `chore/project-skills`, commit `e79c5da`). Every model,
field and enum name below exists in the schema or cited source file.

Vocabulary (RU term → code identifier) is owned by the **domain-glossary**
skill — this file assumes you can look names up there and explains semantics
only. Russian terms are defined once on first use.

## When NOT to use

- **RU↔code vocabulary lookup** (what is "куст" called in code?) → `domain-glossary`.
- **Where a new entity belongs** (module vs dictionary vs enum) → `module-vs-dictionary`.
- **Product scope / roadmap / "should we build this"** → `product-bible`.
- **Report photos, versions, audit-diff internals** → `report-evidence-model`.
- Debugging a live symptom, deploy mechanics, or change-risk questions →
  `pilingtrack-debugging-playbook`, `pilingtrack-run-and-operate`,
  `pilingtrack-change-control` respectively.

## 1. The physical world in 60 seconds

PilingTrack tracks **свайные работы** (svaynye raboty — piling works): crews
drive precast concrete piles into the ground with rigs (pile drivers, drilling
rigs, vibro hammers) to form building foundations. A crew works a day or night
shift on a construction site, drives N piles of specific grades, may pre-drill
guide holes (leader drilling), loses time to breakdowns/weather (downtime),
and files a shift report at the end. Maintenance keeps the rigs alive: daily
inspections, periodic services, repairs — classic CMMS territory.

## 2. Work hierarchy: Site → PileField → Cluster → Picket

```
Site (объект / obyekt — "the construction project/site")
 └── PileField (поле / pole — a geographic area of the site holding piles)
      └── Cluster (куст / kust — lit. "bush": a tight group of piles,
           │        typically supporting one foundation element)
           └── Picket (пикет / piket — a surveyed stake/point; the finest
                │       named location work is reported against)
                ├── PileWork rows       (piles driven, via picketId)
                └── LeaderDrilling rows (holes pre-drilled, via picketId)
```

Schema facts (all in `prisma/schema.prisma`):

| Level | Model | Parent FK | onDelete | Notes |
|---|---|---|---|---|
| 1 | `Site` | `tenantId` (nullable) | — | carries `plannedPiles`, `plannedDrilling`, `status`, `isActive` |
| 2 | `PileField` | `siteId` | Cascade | name only |
| 3 | `Cluster` | `fieldId` | Cascade | name only |
| 4 | `Picket` | `clusterId` | Cascade | name only |

- Levels 2–4 are pure location containers (id + name + parent). All work
  quantities live on report child rows, never on the hierarchy.
- **`picketId` is OPTIONAL on `PileWork` and `LeaderDrilling`** — work is often
  reported without a picket. Never assume every work row has a location.
- When a picket IS given, `validatePicketsBelongToSite` (in
  `src/modules/reports/application/commands/report-validation.service.ts`)
  walks Picket → Cluster → PileField → Site and rejects pickets from another
  site (a stale picket from a previously selected site would otherwise pollute
  per-picket stats).
- Managed by ADMIN/DISPATCHER via the sites screens (`sites.manage_hierarchy`
  ability); operators only *pick* pickets in the report form.

Plans hang off Site: `SitePilePlan` (per pile grade: `count`,
`metersPerUnit`) and `SiteDrillingPlan` (per diameter). These are planning
figures — see §5 for why `SitePilePlan.metersPerUnit` must NOT be used as a
pile length.

## 3. Shift-report lifecycle

**Who files:** the `OPERATOR` role — **машинист** (mashinist — rig operator).
A **бригада** (brigada — crew, model `Crew`) = one operator
(`operatorId @unique` — a user can head at most one crew) + one rig
(`equipmentId`) + one site (`siteId`) + named assistants (`CrewAssistant`,
**помощник** / pomoshchnik).

**Report identity:** `Report` is unique per `(userId, siteId, date)`
(`unique_user_site_date`). `date` is a `YYYY-MM-DD` **string** (lexicographic
compare == chronological — code relies on this). `shiftType` is `DAY | NIGHT`;
the form defaults shift to 08:00–20:00 (`use-report-form.ts`); shift length
math wraps past midnight (`+= 24` when negative).

**What it carries** (validated by `reportUpsertSchema` in
`src/lib/validation-schemas.ts` and again by `validateReportInput`):

| Child | Meaning | Fields |
|---|---|---|
| `PileWork[]` | свая (svaya — pile) driven | `pileGradeId`, `count`, `picketId?` |
| `LeaderDrilling[]` | leader-drilled holes | `typeId`→`DrillingType`, `count`, `metersPerUnit`, `meters` (total), `picketId?` |
| `ReportDowntime[]` | простой (prostoy — downtime) | `reasonId`→`DowntimeReason`, `duration` (HOURS, §4), `comment?` |
| `engineHours` (scalar) | end-of-shift meter reading | optional int 0..500 000; feeds `MeterReading` (§7) |

**Plan enforcement on save** (`validateAgainstSitePlans`): if the site has
`SitePilePlan` rows, (1) every submitted grade must be planned for that site,
and (2) cumulative piles per grade across all the site's reports must not
exceed the plan `count` — the save fails with a Russian error otherwise.

**Status flow:** `draft` → `submitted` (only these two, zod-enforced).
Optimistic concurrency via `version`; offline clients sync with vector clocks
and conflicts land in `ConflictAudit` — strategy (LWW per-field vs. merge-by-id
for collections) is `docs/adr/0003-sync-conflict-strategy.md`, summarized in
`pilingtrack-architecture-contract`'s ADR table; not re-derived here.

**After save**, the write path (`/api/reports/upsert` →
`report-command.service.ts` → `ReportAggregate`) emits domain events through
the transactional outbox (`OutboxEvent`). Canonical types in
`src/modules/reports/domain/report-event-types.ts`: `ReportCreated`,
`ReportUpdated`, `ReportSubmitted`, `ReportDeleted`, `ReportVersionCreated`
(+ item-level aliases like `downtime.added`). Consumers:

- `src/services/reports/event-handlers.ts` — maintains `ReportAnalytics` and
  recomputes `SiteDailySummary`; the downtime **Telegram alert** (thresholds
  in hours: >2 warn, >4 high — set by commit `e79c5da`); the audit handler.
- `src/modules/reports/application/projections/projection-worker.ts` —
  `ReportStats`, `OperatorPerformance`, `DowntimeSummary`, `SiteWeeklyTrend`.
- On `ReportSubmitted`, `registerTelegramReportHandler` renders the PDF
  (`loadSingleReportPdfContext` → `generateSinglePdf`) and sends it to the
  configured Telegram chat as a document; it skips outdated events when a
  newer `ReportSubmitted` for the same report is still pending in the outbox
  (anti-spam after outbox downtime).
- Deleting a report triggers best-effort reprojection of
  `ReportAnalytics`/`SiteDailySummary`/`OperatorPerformance` for the site+date
  (`e79c5da`); the nightly rebuild is the backstop.

Version snapshots (`ReportVersion`), audit diffs (`ReportAudit`), and photo
evidence are covered by the **report-evidence-model** skill.

## 4. Downtime (простой) accounting — the unit invariant

**Invariant (2026-07-07): downtime `duration` is HOURS at every layer.**

| Layer | Unit | Evidence |
|---|---|---|
| Report form UI | hours, 0.5 h step | comment in `validation-schemas.ts` |
| zod `reportUpsertSchema.downtimes[].duration` | hours, `min(0).max(24)` | `src/lib/validation-schemas.ts` (~line 248) |
| `validateDowntimeWithinShift` | hours vs shift hours | `report-validation.service.ts` |
| DB `ReportDowntime.duration` (Float) | hours | schema + all consumers |
| Projections `totalDowntime` (ReportAnalytics/ReportStats/SiteDailySummary/OperatorPerformance/DowntimeSummary/SiteWeeklyTrend) | hours | projection code sums `duration` |
| `OperatorPerformance.downtimeRatio` | hours ÷ shift hours (dimensionless 0..1) | fixed in `e79c5da` |
| Telegram downtime alert thresholds | hours (>2 warn, >4 high) | `e79c5da` |
| Fleet tile / downtime table rendering | hours ("ч") | `e79c5da` |

**History (why this table exists):** before commit `e79c5da` (2026-07-07)
three consumers silently disagreed: the alert treated hours as **minutes**
(≤120 never fired), `downtimeRatio` divided hours by shift **minutes** (~60×
too small), and the fleet tile rendered hours as **days** (`ceil(h/24)` — 11 h
showed as "1 дн"). All fixed to hours in one commit. When adding any new
downtime consumer, state the unit in a comment and compare hours to hours.

**Residual trap:** `ReportAggregate.addDowntime`
(`src/modules/reports/domain/report.aggregate.ts`, on the live write path) still
contains minutes-era bounds: `MAX_DOWNTIME_PER_SHIFT = 1440 // minutes` and a
`totalDowntime > shiftHours * 60` check. Because real values are hours ≤ 24,
these bounds are 60× too lax and never fire — they are dead, not dangerous.
Do NOT read them as the unit spec and do not copy the `* 60`; the binding
checks are the zod schema and `validateDowntimeWithinShift`.

**Downtime ratio math:** `downtimeRatio = Σ duration_hours / shift_hours`.
Shift hours derive from `shiftStart`/`shiftEnd` `HH:MM` strings with midnight
wrap. Total downtime > shift length is rejected at save time.

Note the two unrelated "downtimes": report downtime above (production lost
during a shift, `ReportDowntime`) vs **maintenance downtime** in fleet KPIs
(§8, rig-in-repair time from work orders). Same Russian word, different
tables and math.

## 5. Pile length integrity — м.п. comes from ONE resolver

**м.п.** (metry pogonnye / погонные метры — linear meters) = the headline
production KPI: total meters of pile driven = Σ (`PileWork.count` ×
length-per-pile).

- **Single source of truth:** `PileGrade.lengthMm` (Int?, millimetres).
- **Single resolver:** `pileLengthMeters({ gradeLengthMm })` in
  **`src/lib/pile-length.ts`** — returns `lengthMm / 1000`, or **0 when null**
  (unknown length counts as 0 m; it never re-parses the name).
- `lengthMmFromGradeName(name)` in the same file parses the FIRST 3-digit run
  of a grade name as decimetres (`"С300"` → 30 000 mm = 30 m; `"СВ 120-35"` →
  12 000 mm = 12 m). It is used ONLY to seed `lengthMm` on grade creation and
  the one-time backfill migration (`20260621010000_pile_grade_length_mm`);
  after that the stored, admin-editable value is authoritative.
- **`SitePilePlan.metersPerUnit` is a planning figure, NOT a length source**
  — it held unreliable values (e.g. 123 m/pile) and is deliberately ignored
  by the resolver.

History: length used to be parsed from `PileGrade.name` with
`name.match(/\d{3}/)/10` in **seven diverging copies** (reports screen,
dashboard, PDF and others could disagree on the same report). This is a
settled battle — every м.п. computation must call `pileLengthMeters`. Guard
test: `src/lib/__tests__/pile-meters-invariant.test.ts`.

## 6. Leader drilling (лидерное бурение)

**Лидерное бурение** (lidernoye bureniye — leader drilling): pre-drilling a
narrower guide hole before driving a pile, used in dense/frozen soils to
reduce driving resistance and keep the pile on position. It is auxiliary work
— it produces drilled meters, not piles.

Recorded as `LeaderDrilling` rows on the report: `typeId` → `DrillingType`
dictionary, `count` (holes), `metersPerUnit`, and `meters` — **`meters` is the
authoritative total** (zod: 0..99 999); `count`/`metersPerUnit` are the
operator's way of entering it. Drilling meters roll into projections as
`totalDrilling` and compare against `SiteDrillingPlan` / `Site.plannedDrilling`
for progress, not against pile plans.

## 7. Maintenance (ТО) — CMMS semantics as implemented

**Two meanings of "ТО"** (tekhnicheskoye obsluzhivaniye — technical
maintenance): (a) the whole maintenance *module/screen* ("журнал ТО"), and
(b) a specific periodic *service level* `TO1/TO2/TO3`. Always disambiguate.

### 7.1 Record types and lifecycle

`MaintenanceRecord` is both the service-journal entry and the **наряд**
(naryad — work order). `MaintenanceType`:

- Checklist-backed levels: `EO` (**ЕО** — ezhednevnoye obsluzhivaniye, daily
  inspection), `TO1`, `TO2`, `TO3`, `SEASONAL`.
- Free-form: `REPAIR` (ремонт), `FAULT` (неисправность — a logged breakdown).
- Deprecated, kept for non-destructive migration, never create: `SCHEDULED`
  (≈TO1), `INSPECTION` (≈EO).

Status lifecycle (`MaintenanceStatus`):
`PLANNED → ASSIGNED → IN_PROGRESS → ON_HOLD ⇄ … → DONE | CANCELLED`.
Work-order fields: `priority` (LOW/NORMAL/HIGH/CRITICAL), `assigneeId`,
`startedAt` (start of work — the MTTR clock), `laborHours`, two-stage
narrative (`faultCause` = diagnosis, `workDone` = what was done,
`partsUsedText` = parts as free text, a hook for a future inventory), and
**two-stage acceptance**: `closedById` (who finished/checked) then
`acceptedById`/`acceptedAt` (admin acceptance — added by the R3 design,
migration `20260606140000_to_module_r3_two_stage_accept`).

Classification used by the ТО screen (`src/components/piling/to/to-stats.ts`):
inspection-like = `{EO, TO1, TO2, TO3, SEASONAL, INSPECTION}`; everything else
counts as repair; open = `{PLANNED, ASSIGNED, IN_PROGRESS, ON_HOLD}`.

### 7.2 Engine hours: MeterReading journal

**Source of truth for наработка (narabotka — accumulated engine hours) is the
`MeterReading` history**, not a scalar: `equipmentId`, `recordedAt`,
`engineHours` (Int), `source` (`MANUAL | TELEMETRY`).
`Equipment.engineHoursTotal` is a **denormalized cache of the latest reading**
(the schema comment says exactly this) — never treat it as independent data.

Cross-validation from shift reports: the report form's optional `engineHours`
is written through `addMeterReading` (from `@/modules/equipment`) in
`src/app/api/reports/upsert/route.ts` — **non-fatal by design** (a failed
meter write must never lose a shift report; monotonicity violations only
warn). So operators feed PM planning as a side effect of daily reporting.

### 7.3 PM scheduling: MaintenancePlan

`MaintenancePlan` = the recurrence rule "service every N engine-hours or every
N days". `triggerType` (`PmTriggerType`): `HOURS` (uses `intervalHours` +
`lastDoneHours` vs the latest `MeterReading`) or `CALENDAR` (`intervalDays` +
`lastDoneAt`). `leadTimeDays` (default 7) is the early-warning window. Pure
due math in `src/lib/pm-due.ts` (`evaluatePlanDue` → `ok | due_soon |
overdue`; HOURS plans also flag "due soon" within 50 engine-hours —
`SOON_HOURS = 50`; missing data = `ok`, no false alarms). A daily worker
creates the work order (`MaintenanceRecord`, `status=PLANNED`) inside the
window, deduplicating against the rig's open orders; closing a plan-generated
order writes back `lastDoneHours`/`lastDoneAt`, closing the cycle
(schema comment on `MaintenancePlan`).

### 7.4 Inspections: the checklist engine

`ChecklistTemplate` (per `ChecklistLevel`: EO/TO1/TO2/TO3/SEASONAL) →
`ChecklistSection` → `ChecklistItem` (`answerType`: `YES_NO`, `STATUS4`,
`DONE`, `MEASURE`; plus `unit`, `norm`, `photoRequired`, `required`).
Templates compose per rig via `BlockType`: `BASE` (matched by
`appliesToModel`), `HAMMER` (matched by the rig's `hammerKind`), `ROTARY`
(included when `Equipment.isCombined`).

A filled checklist is an `Inspection`: `DRAFT → COMPLETED`
(`InspectionStatus`), optional 1:1 link to its `MaintenanceRecord`
(`maintenanceRecordId @unique`), **`templateSnapshot` Json** (the template as
it was at fill time — later template edits don't rewrite history),
`healthScore` (Int?, no schema-level range constraint), `engineHours`,
signature fields (`signedByName`, `signedAt`), answers in `InspectionAnswer`.

## 8. Reliability KPIs — honest math (MTBF/MTTR/availability)

Computed purely in **`src/lib/fleet-kpi.ts`** (`computeFleetKpi`) from
`MaintenanceRecord` rows over a period; no DB inside, unit-tested. Definitions
as implemented (P5 feature, hardened by `fe0a2c4` on 2026-07-02):

- **Failure** = a `REPAIR` or `FAULT` work order.
- **Maintenance downtime (hours)** = Σ (`completedAt − startedAt`) over closed
  failures **PLUS the still-running time of OPEN failures**
  (`startedAt ?? createdAt` → now, clamped to the period). Before `fe0a2c4`
  an unclosed repair contributed zero downtime, so availability showed 100%
  during a live repair.
- **Fleet hours** = period length × equipment count.
  **Operating hours** = fleet hours − downtime.
- **MTBF** = operating hours / failure count (null when no failures).
- **MTTR** = mean duration of CLOSED repairs only (open ones excluded; null
  when no repair has both timestamps).
- **Availability** = operating hours / fleet hours (0..1).
- **PM compliance** = scheduled orders closed / scheduled orders **with a
  planned date** (`scheduledAt != null`); undated zombie orders used to drag
  the denominator toward zero.

**"Open fault counts as in-repair"** (commit `19cf9c3`): the fleet snapshot
(`src/modules/monitoring/application/queries/fleet-monitoring.service.ts`)
marks a rig as needing repair on ANY open `REPAIR`/`FAULT`
(`status notIn [DONE, CANCELLED]`) — not just `IN_PROGRESS`. Previously a
logged-but-not-started CRITICAL fault was invisible on the fleet card while
the KPIs counted it as a failure. Keep card logic and KPI logic consistent:
both treat "open failure" the same way.

## 9. Equipment (установка) and the crew rule

**Установка** (ustanovka — the rig); **копёр** (kopyor — pile driver);
**молот** (molot — the hammer). `EquipmentKind`: `PILE_DRIVER` (забивные
копры), `DRILLING_RIG` (буровые установки), `VIBRO_HAMMER`
(вибропогружатели), `HYBRID` (drives AND drills, e.g. Liebherr LRH), `OTHER`.
`HammerKind` (`HYDRAULIC`/`DIESEL`/`NONE`) + `isCombined` drive checklist
block selection (§7.4). `heightMeters` and `maxPileDiameter` are deprecated
leftovers kept to avoid a destructive migration — don't write to them.

There is no `Equipment.status` column; "rig state" on fleet screens is
DERIVED: open failure ⇒ in-repair (§8), recent reports ⇒ active;
`Equipment.isActive` is the administrative soft-disable flag.

**Crew↔equipment rule: one ACTIVE crew per rig.** Enforced twice:
- App level: `assertEquipmentNotDoubleBooked` (not race-safe alone).
- DB level: partial unique index `Crew_equipmentId_active_unique` —
  `ON "Crew"("equipmentId") WHERE "isActive" = true` (migration
  `20260624000000_crew_equipment_active_unique`). Partial indexes aren't
  representable in Prisma schema language, so **you will not find this
  constraint in `schema.prisma`** — only in the migration SQL.
- Inactive crews are history rows; many inactive crews per rig is fine.
- **Deploy lesson (2026-06-30):** applying this migration on prod failed
  because live data already had two active crews on one rig. Any new partial
  unique index needs a pre-flight duplicate check on prod data first.

Also unique: `Crew.operatorId` — an operator heads at most one crew.

## 10. Roles at domain level

Defined in `src/services/auth/authorization-service.ts` (`abilityRoles` map;
this section summarizes intent — for exact checks read that file and the
security docs, don't trust prose).

| Role | Field meaning | May decide (domain level) |
|---|---|---|
| `ADMIN` | администратор | everything below + users, equipment records, dictionaries, Telegram config, report CSV export, DLQ/projection ops |
| `DISPATCHER` | диспетчер (office dispatcher) | sites + hierarchy, site-user assignment, crews, maintenance management, cross-user report read/manage, analytics |
| `OPERATOR` | машинист (rig operator) | file/edit OWN shift reports on assigned sites, upload media, submit meter readings via the report |
| `ASSISTANT` | помощник (crew assistant) | exists as a role and as `CrewAssistant` links; almost no ability grants — never treat as OPERATOR |

`isPrivilegedRole()` = ADMIN or DISPATCHER, nothing else. Dictionary
management (`PileGrade`, `DrillingType`, `DowntimeReason`) is ADMIN-only.

## 11. Numbers sanity table

Derived ONLY from code validation bounds and `prisma/seed.ts` — use to spot
absurd values in data or generated test fixtures.

| Quantity | Enforced bound (source) | Seed/typical magnitude |
|---|---|---|
| Piles per report entry (`PileWork.count`) | 1..9 999 (`validatePileEntries`) | plan caps: 60–120 piles per grade per SITE (seed) — tens per shift is plausible, thousands is not |
| Pile entries per report | ≤100 (zod) | a handful |
| Pile length | `lengthMm` seeded from name: first 3-digit run × 100 mm | seed grades 12–20 m/pile (СВ 120-35 ≈ 12 m) |
| Drilling meters per entry | 0..99 999 (zod + validator) | seed plans: 8–10 m per hole |
| Drilling count / metersPerUnit / diameter | ≤9 999 / ≤9 999 / ≤999 (zod) | — |
| Downtime per entry | 0..24 h (zod), Σ ≤ shift hours | alert at >2 h (warn), >4 h (high) |
| Downtime entries per report | ≤50 (zod) | — |
| Shift length | HH:MM pair; wraps midnight | default 08:00–20:00 (12 h) |
| Engine-hours reading | int 0..500 000 (zod) | — |
| PM "due soon" window | 50 engine-hours / `leadTimeDays` (default 7) | `pm-due.ts` |
| `healthScore` | **no verified bounds** (Int?, unconstrained in schema) | do not assert a 0–100 range from the schema alone |
| Piles-per-shift throughput | **no verified bounds** (nothing enforces a per-shift cap below 9 999/entry) | judge via site plan caps instead |

## Provenance and maintenance

Written 2026-07-07 against commit `e79c5da` on `chore/project-skills`.
Facts date fastest in §4 (a data-flow audit was fixed the same day) and §8.
Re-verify before trusting, one line each:

```bash
# Pile-length resolver still the single source:
grep -n "pileLengthMeters\|lengthMm" src/lib/pile-length.ts prisma/schema.prisma | head
# Downtime is still hours (zod comment + 0..24 cap):
grep -n -A4 "measured in HOURS" src/lib/validation-schemas.ts
# KPI definitions unchanged:
sed -n '1,25p' src/lib/fleet-kpi.ts
# One-active-crew DB invariant still present:
cat prisma/migrations/20260624000000_crew_equipment_active_unique/migration.sql
# Maintenance enums (levels, deprecated members):
grep -n -A14 "enum MaintenanceType" prisma/schema.prisma
# Engine hours from reports still feed MeterReading:
grep -n "addMeterReading" src/app/api/reports/upsert/route.ts
# Open fault still counts as in-repair on fleet cards:
grep -n -B2 "notIn: \['DONE', 'CANCELLED'\]" src/modules/monitoring/application/queries/fleet-monitoring.service.ts
```

If any command comes back empty, the corresponding section is stale — fix the
skill in the same PR that changed the code. Sibling skills referenced by name
only: `pilingtrack-change-control`, `pilingtrack-debugging-playbook`,
`pilingtrack-failure-archaeology`, `pilingtrack-architecture-contract`,
`pilingtrack-run-and-operate`, `pilingtrack-testing-and-evidence`.
