---
name: domain-glossary
description: >-
  PilingTrack piling/construction domain vocabulary — maps Russian field terms
  (объект, поле, куст, пикет, свая, лидерное бурение, простой, бригада, машинист,
  установка/копёр, молот, ЕО/ТО, наряд) to their exact code identifiers (Site,
  PileField, Cluster, Picket, PileWork, LeaderDrilling, ReportDowntime, Crew,
  Equipment, MaintenanceRecord, Inspection, roles). Use when naming a new model/
  field/variable, translating between operator-facing Russian and code, writing UI
  copy or labels, designing schema, or when unsure what a domain word maps to.
  Prevents inventing inconsistent names, confusing the two "ТО" meanings, or
  misjudging role privileges.
---

# Domain Glossary (PilingTrack)

PilingTrack tracks pile-driving and drilling work on construction sites. The team
speaks Russian; the code is English. This skill is the term ⇄ identifier bridge so
new code reuses the established vocabulary instead of inventing synonyms.

## Use this when
Naming a model/field/variable, writing UI copy or operator-facing labels,
translating a Russian request into code terms, or designing schema. When in doubt
about what a domain word maps to, check here before guessing.

## Full lookup
The complete bilingual table (every model, enum, role, and field) is in
[references/terms.md](references/terms.md). Read it when you need an exact
identifier or enum value. The essentials below cover the structure and the traps.

## Core vocabulary (quick)

**Site hierarchy:** `Site` (объект) → `PileField` (поле) → `Cluster` (куст) →
`Picket` (пикет) → work records.

**Work records (in a shift report):**
- `PileWork` — свая (забитая): `pileGradeId` + `count`
- `LeaderDrilling` — лидерное бурение: `typeId` + `count` + `meters`
- `ReportDowntime` — простой: `reasonId` + `duration` (часы)

**Dictionaries (ADMIN-managed):** `PileGrade` (марка сваи), `DrillingType`
(тип бурения), `DowntimeReason` (причина простоя). Soft-disable via `isActive`.

**People:** `Crew` (бригада), `CrewAssistant` (помощник), `User` (with `role`).
Roles: `ADMIN` (администратор), `DISPATCHER` (диспетчер), `OPERATOR` (машинист),
`ASSISTANT` (помощник).

**Equipment & service:** `Equipment` (установка/копёр; `kind`=EquipmentKind),
`MaintenanceRecord` (наряд/журнал ТО), `Inspection` (чек-лист ЕО/ТО).

## Naming traps (read before adding terms)

1. **Two "ТО":** the maintenance *module* (CMMS) vs the maintenance *level*
   `TO1/TO2/TO3`. Always disambiguate.
2. **ТО level lives in multiple enums** (`MaintenanceType`, `ChecklistLevel`) —
   not auto-synced. Adding a level = update each.
3. **`kind` vs `type`:** equipment uses `kind` (`EquipmentKind`); maintenance and
   documents use `type`; drilling uses `typeId`→`DrillingType`. Don't mix.
4. **Role privileges:** `isPrivilegedRole()` = ADMIN + DISPATCHER only. `ASSISTANT`
   exists in the type but has almost no grants — don't treat it like OPERATOR.
5. **RU labels are centralized**, not inline. Report action/status labels live in
   `report-history.ts`. Add a new visible enum value's label there, not in components.
6. **`picketId` is optional** on work records — don't assume work is tied to a picket.

## Picking a name for new code
1. Find the closest existing term in [references/terms.md](references/terms.md) and
   reuse its identifier exactly.
2. No existing term? Match the established style: English `PascalCase` model,
   `camelCase` field; keep the Russian meaning in a `//` comment as the schema does.
3. For anything operator-facing, add the Russian label to the central label map.

## Related skills
- **report-evidence-model** — the report/photo/audit data model in depth.
