# Module layout editor — universal engine, stage 0+1

**Date:** 2026-07-10
**Status:** Design (approved for planning)
**Author:** engineering (AI-assisted)

## Problem

The `/monitoring` tile editor (canvas + block library + inspector + undo/redo +
server-persisted template) is hard-wired to one surface: the fleet monitoring
equipment tile. The user wants the same editing capability across modules —
"any module, from dashboard to DLQ" — i.e. an admin should be able to visually
arrange tiles/blocks on module screens, not just on `/monitoring`.

Building a separate editor per module would duplicate a large, subtle component
(drag/resize grid, history, persistence, permissions). Instead we generalize
the existing editor into **one engine + a registry of editable surfaces**, so a
module opts in by registering a descriptor, not by getting its own editor.

## Decisions (locked 2026-07-10)

1. **One engine, many surfaces.** Extract the monitoring editor into a shared
   `layout-editor` module. A **surface registry** declares what is editable and
   how. Editing any surface reuses the same full-screen editor UI.
2. **Three surface kinds** (union of the A/B/C options discussed):
   - `card-blocks` (A): blocks inside a repeated card (photo, logo, metrics…).
   - `page-layout` (B): whole tiles/widgets arranged on a module page.
   - `table-columns` (C): visible columns/KPIs and their order in ops modules.
   **Stage 0+1 implements only `card-blocks`.** B and C are later stages; the
   registry and storage are designed so they slot in without schema changes.
3. **Staged delivery.** Stage 0 = foundation (engine extraction, storage
   generalization, registry) with `/monitoring` migrated onto it (no visible
   change). Stage 1 = first new surface: **equipment card** on
   `/admin/equipment`.
4. **Equipment module: separate tile view, old list untouched.** Stage 1 adds a
   template-driven tile view **alongside** the existing `EquipmentTile` list
   (view toggle on the page). The current hand-built card is NOT replaced or
   rendered through the engine. No risk to the working screen; the old list
   can be retired later only by explicit decision.
5. **Scope per tenant, ADMIN-only writes.** Same model as monitoring: one
   shared layout per `(tenant, surface)`; all authenticated tenant users read.
6. **Only registered surfaces are editable.** Infrastructure/security screens
   (DLQ, auth, admin-security) are deliberately NOT registered in this stage.
   The foundation permits adding them later, but each is an explicit decision,
   never a default.

## Storage

Generalize the existing `MonitoringTileTemplate` (one row per tenant) into
`ModuleLayoutTemplate` (one row per tenant **per surface**):

```prisma
model ModuleLayoutTemplate {
  id        String   @id @default(cuid())
  tenantId  String
  surfaceId String            // e.g. 'monitoring-equipment-tile', 'equipment-card'
  template  Json
  updatedBy String
  createdAt DateTime @default(now()) @db.Timestamptz(3)
  updatedAt DateTime @updatedAt @db.Timestamptz(3)

  @@unique([tenantId, surfaceId])
  @@index([tenantId])
}
```

Migration (one logical change): rename table, add `surfaceId` with backfill
`'monitoring-equipment-tile'` for existing rows, replace the unique constraint
`tenantId` → `(tenantId, surfaceId)`. Keep the FORCE-RLS fail-open policy
exactly as the current table has (project pattern). Prod has at most one row
(the orion monitoring template) — backfill is trivial; verify after deploy.

## API

Generalize `GET/PUT /api/monitoring/template` → `GET/PUT
/api/layout/[surfaceId]`:

- `GET` (withApi): any authenticated role; returns saved template or the
  surface's registered default. 404 for unknown `surfaceId` (not in registry).
- `PUT` (withMutation): ADMIN-only; validates via the surface's validator;
  tenant fail-closed (same as today).
- The old `/api/monitoring/template` route stays as a thin alias to
  `surfaceId='monitoring-equipment-tile'` for one release (deployed clients may
  still call it), then is removed.

## Engine + registry (Stage 0)

Move (not copy) from `components/piling/monitoring/` into
`components/piling/layout-editor/`:

- `equipment-tile-canvas/inspector/block-library/renderer/editor` → generic
  `layout-canvas/inspector/block-library/renderer/editor` (12-col grid model,
  history, mobile panels — unchanged behavior).
- `equipment-tile-template.ts` (types + validator) → generic
  `layout-template.ts` parameterized by the surface's **block catalog** (the
  set of `dataKey`s and how each renders).
- `use-equipment-tile-template.ts` → `use-layout-template(surfaceId)` (loads
  `/api/layout/[surfaceId]`, one-time localStorage seed logic kept only for the
  monitoring surface).

Registry (`layout-editor/registry.ts`):

```ts
interface LayoutSurface<TCardData> {
  id: string;                       // 'equipment-card'
  kind: 'card-blocks';              // 'page-layout' | 'table-columns' later
  title: string;                    // 'Карточка установки'
  blockCatalog: BlockDef<TCardData>[]; // dataKey → label + render(card)
  defaultTemplate: LayoutTemplate;
}
```

Monitoring registers `monitoring-equipment-tile` with its existing block
catalog — after Stage 0, `/monitoring` behaves identically (same template row,
same editor, same rendering), just through the shared engine.

## Equipment tile view (Stage 1)

- Register surface `equipment-card`: block catalog = brand logo, name+model,
  status badge, site, operator, engine hours, today's metrics (piles/drilling/
  downtime), maintenance flag, quick links. Renderers reuse the existing
  fleet-card data (`FleetCard`) the page already loads.
- `defaultTemplate` mirrors the current card visually (logo centered on top,
  then name row, meta, metrics grid) so the new view looks familiar out of the
  box.
- `/admin/equipment` gets a **view toggle**: «Список» (old `EquipmentTile`,
  default, untouched) / «Плитки» (new template-driven view). Toggle choice is
  a local UI preference (localStorage), not part of the template.
- ADMIN sees «Редактировать раскладку» in the tile view → same full-screen
  editor; save → PUT `/api/layout/equipment-card`.

## Security

- PUT is ADMIN-only, tenant fail-closed (throw on missing tenantId).
- Unknown/unregistered `surfaceId` → 404 on GET and PUT; the registry is the
  allow-list. No surface for DLQ/auth/security screens in this stage.
- Template validator caps sizes (same limits as monitoring: ≤200 blocks,
  bounded string lengths) to keep the JSONB row small.

## Testing / acceptance

- Existing monitoring tests keep passing after the move (imports updated).
- Contract tests for `/api/layout/[surfaceId]`: GET default, PUT+GET roundtrip,
  403 for non-ADMIN, 404 for unregistered surface.
- Migration verified: existing monitoring template row survives with
  `surfaceId='monitoring-equipment-tile'`.
- Manual: `/monitoring` unchanged; `/admin/equipment` toggle shows tile view,
  ADMIN edits + saves + reloads → layout persists; OPERATOR sees tiles, no
  editor button; old list identical to today.

## Out of scope (this stage)

- `page-layout` (B) and `table-columns` (C) surface kinds — later stages on
  this foundation.
- Editing dashboard, ops modules, DLQ, or any other screen.
- Per-user layouts, layout versioning/rollback, template import/export.
- Retiring the old equipment list view.
