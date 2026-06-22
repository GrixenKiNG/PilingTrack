# PilingTrack Domain Glossary — full reference

Russian domain term ⇄ code identifier. Source of truth is `prisma/schema.prisma`
(richly commented in Russian) and `src/services/auth/authorization-service.ts`.
Verify names before relying on them — identifiers rarely change, line numbers do.

## Table of contents
- [Site hierarchy](#site-hierarchy)
- [Work records & dictionaries](#work-records--dictionaries)
- [Crews & people](#crews--people)
- [Roles & permissions](#roles--permissions)
- [Equipment park](#equipment-park)
- [Maintenance (ТО) & inspections](#maintenance-то--inspections)
- [Reports](#reports)
- [Status / enum value labels](#status--enum-value-labels)
- [Naming traps](#naming-traps)

## Site hierarchy
The geographic/structural breakdown of a construction site. Work is recorded at
the picket level (optionally) and always belongs to a report.

| RU term | Model | Notes |
|---|---|---|
| Объект / стройплощадка | `Site` | Top level. `plannedPiles`, `plannedDrilling`, `status`, `completionDate`. |
| Поле (свайное) | `PileField` | `Site` → many fields. |
| Куст | `Cluster` | `PileField` → many clusters. |
| Пикет | `Picket` | `Cluster` → many pickets. Leaf where work is logged. |
| План по сваям | `SitePilePlan` | grade → count × metersPerUnit. |
| План по бурению | `SiteDrillingPlan` | diameter → count × metersPerUnit. |

Chain: `Site → PileField → Cluster → Picket → {PileWork, LeaderDrilling}`.

## Work records & dictionaries
What an operator actually logs in a shift report.

| RU term | Model | Key fields |
|---|---|---|
| Свая (забитая) | `PileWork` | `pileGradeId`, `count`, optional `picketId`, `reportId` |
| Лидерное бурение | `LeaderDrilling` | `typeId`, `count`, `metersPerUnit`, `meters`, optional `picketId` |
| Простой | `ReportDowntime` | `reasonId`, `duration` (hours), `comment` |

Dictionaries (admin-managed reference lists, `dictionary.manage` = ADMIN):

| RU term | Model | Used by |
|---|---|---|
| Марка/тип сваи | `PileGrade` | `PileWork`, `SitePilePlan` |
| Тип бурения | `DrillingType` | `LeaderDrilling` |
| Причина простоя | `DowntimeReason` | `ReportDowntime` |

All three dictionaries have `name` + `isActive` — soft-disable via `isActive`, don't delete (FK `onDelete: Restrict`).

## Crews & people
| RU term | Model | Notes |
|---|---|---|
| Бригада / экипаж | `Crew` | `operatorId` (1:1 unique), `equipmentId`, `siteId` |
| Помощник (ФИО) | `CrewAssistant` | named assistants on a crew |
| Машинист / оператор | `User` with `role='OPERATOR'` | logs reports |
| Привязка пользователь↔объект | `UserSiteAssignment` | which sites a user may access |

## Roles & permissions
`Role = 'ADMIN' | 'DISPATCHER' | 'OPERATOR' | 'ASSISTANT'` (authorization-service.ts).

| RU term | Role | Privileged? |
|---|---|---|
| Администратор | `ADMIN` | yes |
| Диспетчер | `DISPATCHER` | yes |
| Машинист / оператор | `OPERATOR` | no |
| Помощник | `ASSISTANT` | no |

⚠️ `isPrivilegedRole()` returns true **only** for ADMIN and DISPATCHER. `ASSISTANT`
exists in the type union but has essentially no grants in the permission matrix —
don't assume it behaves like OPERATOR. Permissions live in the `PERMISSIONS` map
(e.g. `reports.read_all`, `equipment.manage`, `maintenance.manage`, `dictionary.manage`).

## Equipment park
`Equipment` (`tenantId` required — NOT nullable, unlike Report/Site). Russian-commented blocks:
- **A. Идентификация:** `inventoryNumber`, `registrationNumber` (госномер), `kind` (EquipmentKind), `baseVehicle` (носитель), `serialNumber`, `vin`, `manufactureYear`.
- **B. Тех. характеристики:** `weightTons`, габариты `heightMm/lengthMm/widthMm`, двигатель `engineBrand/enginePower` (кВт), свайные/буровые `maxPileLength`/`maxDrillingDepth` (м), молот `hammerType`/`hammerEnergyKj` (кДж), `hammerKind`, `isCombined` (есть вращатель).
- **C. Эксплуатация:** `engineHoursTotal` (моточасы), `nextMaintenanceAtHours`, `nextMaintenanceDate`, `homeBaseLocation`.

`EquipmentKind`: `PILE_DRIVER` (копёр с молотом) · `DRILLING_RIG` (буровая) · `VIBRO_HAMMER` (вибропогружатель) · `HYBRID` (и забивка, и бурение) · `OTHER`.
`HammerKind`: `HYDRAULIC` (гидро) · `DIESEL` (дизель) · `NONE` (нет молота).

⚠️ `heightMeters` and `maxPileDiameter` are **deprecated** legacy columns kept to avoid a destructive migration — UI doesn't show them; don't write to them.

`EquipmentDocument` — паспорт/ОТС/страховка/ТО etc. Files live in `Media` (`entityType='equipment'`); this table holds only metadata. `EquipmentDocumentType`: `PASSPORT`, `OTS`, `INSURANCE`, `INSPECTION`, `CERTIFICATE`, `MAINTENANCE_LOG`, `OTHER`.

## Maintenance (ТО) & inspections
**Two linked mechanisms (1:1 via `Inspection.maintenanceRecordId`):**
- `MaintenanceRecord` — журнал ТО и ремонтов (work order). Manual entry by dispatcher/admin. Stages: `faultCause` (диагностика) → `workDone` (выполнено). Lifecycle fields: `assigneeId`, `startedAt`, `closedById`, `acceptedById`/`acceptedAt`. `partsUsedText` is a text stub for a future parts module.
- `Inspection` — заполненный чек-лист (checklist engine). `healthScore`, `templateSnapshot` (frozen template JSON), `signedByName`/`signedAt`.

Checklist engine: `ChecklistTemplate` → `ChecklistSection` → `ChecklistItem`. Templates are assembled from **blocks** (`BlockType`): `BASE` (база установки по модели), `HAMMER` (блок молота по `HammerKind`), `ROTARY` (вращатель, для комбинированных).

`MaintenanceType`: `EO` (ежедневный осмотр) · `TO1`/`TO2`/`TO3` (плановое ТО) · `SEASONAL` (сезонное) · `REPAIR` (ремонт) · `FAULT` (неисправность). Deprecated: `SCHEDULED` (≈TO1), `INSPECTION` (≈EO) — don't create new records with these.
`MaintenanceStatus`: `PLANNED` · `ASSIGNED` · `IN_PROGRESS` · `ON_HOLD` · `DONE` · `CANCELLED`.
`MaintenancePriority`: `LOW` · `NORMAL` · `HIGH` · `CRITICAL`.
`ChecklistLevel`: `EO` · `TO1` · `TO2` · `TO3` · `SEASONAL` (subset of MaintenanceType — see trap below).
`AnswerType`: `YES_NO` · `STATUS4` · `DONE` · `MEASURE`. `InspectionStatus`: `DRAFT` · `COMPLETED`.

## Reports
`Report` — сменный отчёт. One per `(userId, siteId, date)`. `shiftType` `DAY`/`NIGHT`, `status` `draft`/`submitted`. For the full evidence/provenance/photo model see the **report-evidence-model** skill.

## Status / enum value labels
Operator-facing Russian labels are centralized, not inline:
- Report actions/status: `report-history.ts` — `ACTION_LABELS` (Создан/Изменён/Отправлен/Удалён), `STATUS_LABELS` (Черновик/Отправлен).
- When adding a new enum value that users see, add its RU label to the same label map rather than scattering translations in components.

## Naming traps
- **Two "ТО" meanings:** the **module** (CMMS/maintenance) vs the **maintenance level** `TO1/TO2/TO3`. Disambiguate in code comments.
- **ТО level lives in 3 enums:** `MaintenanceType`, `ChecklistLevel` (and historically `INSPECTION`/`SCHEDULED` aliases). Adding a level means updating each — they are not auto-synced.
- **`type` vs `kind`:** equipment uses `kind` (`EquipmentKind`); maintenance/documents use `type`. Drilling uses `typeId` → `DrillingType`. Don't mix.
- **`count` is overloaded:** piles = number of piles; drilling = number of units (default 1), with `meters` separate.
- **Picket is optional on work records** (`picketId String?`) — work can be logged without a picket. Don't assume it's present.
- **tenantId nullability differs by table:** nullable on `Report`/`Site`/`User`/`Media`; **required** on `Equipment`/`MaintenanceRecord`/`Inspection`/checklist tables. Still must equal `orion` on prod everywhere.
