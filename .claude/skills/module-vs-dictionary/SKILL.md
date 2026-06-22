---
name: module-vs-dictionary
description: >-
  Decision rule for where a PilingTrack entity belongs — an operational module
  (screen where work is decided/controlled) vs a dictionary (stable list you pick
  in forms) vs a code enum (stays in code). Use when adding or classifying an
  entity/table, deciding whether something goes in admin-dictionaries vs its own
  module screen, scoping "move X to dictionaries", or reviewing where new code
  should live. Includes the enum trap: half of what looks like a "dictionary" is
  a compile-time enum that cannot be moved without an enum→table migration.
---

# Module vs Dictionary (PilingTrack)

Where does an entity belong? This is the project's classification rule, grounded
in the actual schema shape.

> **Dictionary = what you can pick in forms. Module = where work is decided and
> controlled.** Enum in code = a system rule, not data.

## The decision rule

Look at the table in `prisma/schema.prisma`:

1. **Dictionary** — shape is `{ id, name, isActive }` and it is only *referenced*
   by FK with `onDelete: Restrict`. People choose from it; they don't act on it.
   → Lives as a tab in `src/components/piling/admin-dictionaries.tsx`, managed via
   `POST/PATCH /api/dictionary/manage`. Examples: `PileGrade`, `DrillingType`,
   `DowntimeReason`.

2. **Operational module** — has state / lifecycle / history / child rows / owned
   relations (`onDelete: Cascade` or `SetNull`). People *act* on it.
   → Lives in `src/modules/<name>` (DDD) with a screen built on
   `src/components/piling/ops-shell`. Examples: `Site`, `Crew`, `Report`,
   `MaintenanceRecord`, `Inspection`.

3. **Code enum** — a fixed set defined as a Prisma `enum` or a TS union.
   → **Stays in code.** It encodes a system rule, not editable data.

Quick test: *"Does a dispatcher add to this list, or does someone work on each row?"*
Add to a list → dictionary. Work on a row → module.

## The enum trap (read before "move X to dictionaries")

"Move it to dictionaries" means two completely different things:

- Target is already a **table** → cheap: add a tab to `admin-dictionaries`.
- Target is a **code enum** → it is NOT data. Making it editable is an
  **enum → table migration** (new table, FK, backfill, RLS if tenant-scoped, UI) —
  a feature with risk, not a cleanup. Default: **leave enums in code** unless the
  business has proven the set actually changes over time.

Current classification (verify against schema before relying on it):

| Concept | Reality | Editable dictionary? |
|---|---|---|
| Марки свай / типы бурения / причины простоев | tables `PileGrade` / `DrillingType` / `DowntimeReason` | ✅ already in `admin-dictionaries` |
| Шаблоны чек-листов | table `ChecklistTemplate` | ✅ data (managed in inspections, not the dictionaries screen) |
| Классы установок | `enum EquipmentKind` | ⛔ code — migration needed |
| Уровни / нормативы ТО | `enum MaintenanceType`, `enum ChecklistLevel` | ⛔ code |
| Статусы (ТО, проверок) | `enum MaintenanceStatus`, `enum InspectionStatus` | ⛔ code |
| Роли / права | TS union `Role` + `PERMISSIONS` map (authorization-service.ts) | ⛔ code |

## Operational modules: the four

Kept as modules (not dictionaries), each to be strengthened into a real screen
(KPI + filters + dense table + right detail panel + risk statuses + links to
reports/photos/PDF/history) via `ops-shell`:

1. **Объекты (`Site`)** — the system's spine: план/факт, sections, rigs, crews,
   reports, progress, downtime, photos, PDF, customer. Never demote to a dictionary.
2. **Бригады (`Crew`)** — dispatch board: who works today, where, which rig, report
   yet?, downtime?, assistants, changes. ⚠️ History gap: crews don't emit
   `recordAuditEvent` yet — "history of assignments" needs event-writing added.
3. **Пользователи (`User`)** — access & activity admin: roles, sites, crew, reports,
   actions, audit. "Last login" derives from `AuditLog` (`auth.login.succeeded`) —
   no `lastLogin` column exists or is needed.
4. **Чек-листы (`Inspection`)** — only a module when it's *real checks* (object/rig/
   shift, owner, status, photos, findings, history). The *templates* are the dictionary.

## Shared building blocks (don't reinvent per module)
- UI skeleton: `src/components/piling/ops-shell` (OpsPage/Header/KpiBar/FilterBar/
  Table/DetailPanel/RiskBadge).
- History feed: `AuditLog` via `recordAuditEvent` (scopes `users`/`sites`/`auth`
  exist; `crews` missing). Feed normalized entries into `OpsHistoryList`.
- Dictionary delete-guard ("используется — удаление недоступно") is the same
  `onDelete: Restrict` boundary that marks a table as a dictionary.

## Related
`domain-glossary` (terms/roles) · `report-evidence-model` (evidence/history model)
· CLAUDE.md "Module vs Dictionary rule" (the one-line version).
