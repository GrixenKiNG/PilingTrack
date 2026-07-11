# Stage B — page-layout editor (arrange whole tiles on a page)

**Date:** 2026-07-11
**Status:** Design (awaiting approval)
**Author:** engineering (AI-assisted)
**Builds on:** `2026-07-10-module-layout-editor-design.md` (stages 0+1, shipped)

## Problem

Stage 0+1 gave a **`card-blocks`** editor: rearranging blocks *inside one repeated
card* (equipment tile, monitoring tile), with a base layout plus per-tile
overrides. The user now wants **Stage B**: an editor for *the whole page* — which
tiles/widgets appear, their order, size and visibility — **for every module**,
configured from **Settings → «Шаблоны плиток»** («Редактирование рабочего
пространства» in the approved mockup).

This is a second **surface kind** on the same foundation, not a new engine.

## Decisions (proposed)

1. **New surface kind `page-layout`** alongside `card-blocks`. Reuses the shipped
   foundation unchanged: `ModuleLayoutTemplate` storage, the surface registry,
   `GET/PUT /api/layout/[surfaceId]`, ADMIN-only writes, per-tenant base scope.
2. **Different template shape** for this kind (a widget list, not a 12-col block
   grid), with its own validator and its own editor/renderer. The `card-blocks`
   engine is untouched.
3. **First surface: `analytics-dashboard`** — matches the approved visualization.
   Other module pages (equipment, sites, crews, …) register their own
   `page-layout` surface later; the foundation already supports that. This spec +
   its plan deliver `analytics-dashboard` end-to-end.
4. **Editor lives in Settings → «Шаблоны плиток»** (per the user): a list of
   editable surfaces; picking one opens its page-layout editor.
5. **Per-tenant base layout only** for now (entityId=''); no per-user dashboards,
   no per-entity overrides for page-layout (YAGNI).

## Template model

```ts
interface PageLayoutTemplate {
  version: 1;
  widgets: {
    id: string;                    // must exist in the surface's widget catalog
    visible: boolean;
    size: 'sm' | 'md' | 'lg';      // column span; clamped to the widget's allowedSizes
    order: number;                 // ascending render order
    settings?: Record<string, unknown>; // per-widget options (validated by the widget)
  }[];
}
```

Stored in the existing `ModuleLayoutTemplate.template` (Json) at
`(tenantId, surfaceId, entityId='')`. No migration — the column is already Json.

## Widget catalog (per surface, client side)

Each `page-layout` surface supplies a catalog: the widgets a page can show and
how to render each. The catalog is the allow-list for widget ids.

```ts
interface PageWidgetDef<Ctx> {
  id: string;                       // 'kpi-piles', 'chart-operators', …
  title: string;                    // shown in the configurator
  allowedSizes: ('sm'|'md'|'lg')[];
  defaultSize: 'sm'|'md'|'lg';
  render: (ctx: Ctx, settings: Record<string, unknown>) => React.ReactNode;
  settingsSchema?: WidgetSettingField[]; // optional per-widget options (e.g. chart line colour)
}
```

`analytics-dashboard` catalog (first cut): individual KPI tiles
(`kpi-equipment`, `kpi-sites`, `kpi-piles`, `kpi-pile-meters`, `kpi-drilling`,
`kpi-downtime`, `kpi-crews`, `kpi-operators`) + section cards
(`chart-operators`, `table-operators`, `chart-trends`, `kpi-maintenance`,
`table-problem-rigs`). The current hard-coded page becomes the `defaultTemplate`
(same look out of the box).

## Server

- Registry: register `analytics-dashboard` with `kind: 'page-layout'`, its
  `defaultTemplate` and a `validatePageLayout(catalogIds)` validator (widget id ∈
  catalog, size ∈ enum, unique ids, ≤100 widgets).
- `getSurfaceConfig` already returns `{ defaultTemplate, validate }`; add an
  optional `kind` field so the client picks the right editor/renderer. No API
  change — `GET/PUT /api/layout/analytics-dashboard` just works.

## Client

- `PageLayoutRenderer`: reads the saved template (via `useLayoutTemplate` at base
  scope), renders visible widgets sorted by `order`, each in a grid cell spanning
  its `size`, calling the catalog's `render`. Unknown/removed widget ids are
  skipped defensively.
- `PageLayoutEditor` (the «Редактирование рабочего пространства» configurator):
  the widget list with a visibility toggle, size select and drag-reorder, plus a
  per-widget settings panel with live preview. Save → `PUT /api/layout/
  analytics-dashboard` (ADMIN); reset → `DELETE` (falls back to default).
- `/admin/analytics` renders through `PageLayoutRenderer` using the saved
  template; the current sections become widget `render`s (thin wrappers around
  the existing KPI/chart/table code — no logic rewrite).
- Settings → «Шаблоны плиток»: list editable surfaces (currently «Дашборд
  аналитики» + the two `card-blocks` ones) and open the matching editor.

## Security

- PUT/DELETE ADMIN-only, tenant fail-closed (unchanged wrapper).
- Widget-id allow-list = the catalog; unknown ids rejected on save and skipped on
  render. Only registered surfaces are servable (404 otherwise) — unchanged.

## Testing / acceptance

- Contract: `validatePageLayout` rejects unknown widget id / bad size / dup ids;
  `getLayout('analytics-dashboard')` returns the default widget list.
- Unit: `PageLayoutRenderer` renders only visible widgets in `order`; skips
  unknown ids.
- Manual: `/admin/analytics` unchanged out of the box; ADMIN reorders/hides/
  resizes a widget in Settings, saves, reload persists; non-admin sees the saved
  layout, no editor; reset returns to default.

## Out of scope (this stage)

- Registering page-layout for other modules (equipment/sites/crews/…) — follows
  once analytics-dashboard proves the pattern.
- Per-user dashboards, per-entity page overrides, drag-on-canvas free positioning
  (this is an ordered responsive grid, not absolute x/y).
- Pile-meters in the Operators/Trends projections (separate analytics follow-up).
