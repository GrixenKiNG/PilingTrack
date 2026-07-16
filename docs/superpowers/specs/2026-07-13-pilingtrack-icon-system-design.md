# PilingTrack Icon System — Design Specification

## Status

Approved concept: hybrid icon system based on the selected duotone industrial reference.

## Objective

Replace inconsistent text-only navigation, emoji, and generic icons across PilingTrack with a coherent, accessible icon system for operators, dispatchers, and administrators. The visual language must remain recognizable at small sizes, preserve existing behavior, and clearly distinguish production, maintenance, warning, and completion states.

## Scope

The icon system applies to the entire application:

- operator dashboard, report workflow, history, and mobile navigation;
- production sections for piles, driving, drilling, meters, and downtime;
- inspections, engine hours, defects, maintenance readiness, and work orders;
- dispatcher and administrator navigation;
- sites, equipment, crews, users, documents, dictionaries, Telegram, and DLQ;
- monitoring, reports, analytics, risks, notifications, settings, and feedback;
- shared actions such as add, edit, delete, save, search, filter, back, close, print, and export;
- loading, empty, warning, error, success, and unavailable states.

## Non-goals

- The project does not redesign page layouts or business workflows.
- The generated PNG reference is not shipped as a UI asset.
- Equipment brand logos and equipment photographs are not replaced.
- Existing button text is not removed when text is needed for comprehension.
- The implementation does not introduce a second general-purpose icon dependency.

## Chosen approach

Use a hybrid system:

1. Custom SVG/React icons for PilingTrack-specific concepts.
2. Lucide icons for conventional interface actions.
3. A single typed facade that gives both sources the same sizing, color, accessibility, and naming rules.

This approach keeps the distinctive industrial character of the selected reference without recreating common interface symbols or increasing maintenance cost unnecessarily.

## Visual language

### Geometry

- Base canvas: `24 × 24`.
- Default optical stroke: `2`.
- Rounded caps and joins.
- Consistent internal spacing and optical weight.
- Custom icons remain recognizable at `16`, `20`, `24`, `32`, `48`, and `64` pixels.
- Small icons omit secondary details that would collapse below `20` pixels.

### Duotone treatment

- Primary contour uses graphite.
- A secondary semantic layer provides the accent color.
- Large action tiles may use a softly tinted background.
- Compact navigation and table icons do not receive individual tile backgrounds.
- Gradients, photorealistic effects, heavy shadows, and embedded raster artwork are prohibited.

### Semantic colors

| Meaning | Token | Intended usage |
| --- | --- | --- |
| Neutral/navigation | `icon-neutral` | navigation, settings, passive information |
| Primary action | `icon-primary` | start shift, add, send, active operator action |
| Information/process | `icon-info` | monitoring, reports, engine hours, dispatch flow |
| Success/ready | `icon-success` | ready, accepted, completed, closed |
| Warning/maintenance | `icon-warning` | downtime, maintenance due, attention |
| Danger/defect | `icon-danger` | defect, error, overdue, destructive action |

Colors complement the icon metaphor and visible label; color is never the sole carrier of meaning.

## Icon catalog

### Domain icons — custom SVG

| Icon name | Meaning | Primary locations |
| --- | --- | --- |
| `shift-start` | start or resume shift | operator dashboard, report entry |
| `inspection` | pre-shift or technical inspection | inspections, equipment detail |
| `engine-hours` | meter reading / engine hours | report form, technical readiness |
| `pile-group` | pile production | reports, dashboard, plans |
| `pile-driving` | pile installation/driving | production and monitoring |
| `drilling-auger` | leader drilling | reports, plans, analytics |
| `linear-meters` | produced length | production totals and KPI |
| `downtime` | equipment downtime | report form, analytics, risks |
| `downtime-reason` | downtime explanation | report details and filters |
| `technical-readiness` | equipment readiness | technical readiness dashboard |
| `maintenance-due` | scheduled maintenance required | equipment status and maintenance plans |
| `repair` | repair in progress | work orders, equipment status |
| `defect` | detected fault | inspections, work orders, notifications |
| `work-order` | maintenance work order | maintenance board and details |
| `spare-parts` | required or used parts | work-order details |
| `handoff` | sent to dispatcher | report/defect workflow and audit trail |
| `accepted` | accepted by dispatcher | dispatch workflow and notifications |
| `equipment-rig` | piling equipment | equipment navigation and cards |

### Standard icons — Lucide through the facade

Navigation and utility concepts continue to use Lucide equivalents: home, map/site, users/crew, user, headset, shield/key, radar/activity, file/chart, history, analytics, risk, bell, books, settings, folder, send, logout, add, edit, delete, save, search, filter, back, close, print, download, refresh, loading, and external link.

## Component architecture

### `PilingIcon`

The public component accepts a closed icon-name union and a small set of presentation props:

```ts
type PilingIconName =
  | 'shift-start'
  | 'inspection'
  | 'engine-hours'
  | 'pile-group'
  | 'pile-driving'
  | 'drilling-auger'
  | 'linear-meters'
  | 'downtime'
  | 'downtime-reason'
  | 'technical-readiness'
  | 'maintenance-due'
  | 'repair'
  | 'defect'
  | 'work-order'
  | 'spare-parts'
  | 'handoff'
  | 'accepted'
  | 'equipment-rig';
```

Required props:

- `name`: one of the supported icon names;
- `size`: semantic size or numeric pixel size;
- `tone`: neutral, primary, info, success, warning, or danger;
- `decorative`: hides the icon from assistive technology when visible text already names it;
- `label`: required for a standalone meaningful icon;
- `className`: layout composition only.

Custom icon components remain internal. Consumers do not import individual SVG files directly.

### `IconTile`

Large operator actions and major status cards use an optional tile wrapper:

- minimum touch target `48 × 48`;
- icon size `32–64` depending on hierarchy;
- softly tinted semantic background;
- visible text label remains mandatory;
- hover, active, focus, disabled, loading, and reduced-motion states are supported.

### Navigation configuration

Role navigation entries gain a typed `icon` field. The same configuration drives desktop sidebar and mobile navigation so icon-to-route mappings cannot diverge.

## Placement rules

| Context | Icon size | Tile treatment |
| --- | --- | --- |
| Operator primary action | `48–64` | tinted rounded tile or integrated hero area |
| Operator mobile navigation | `24` | active item only |
| Admin/dispatcher sidebar | `20` | none |
| Card and section heading | `18–20` | none |
| Table row and compact button | `16` | none |
| Empty/error state | `32–48` | optional |
| Status badge | `16–20` | semantic shape/background |

## Accessibility

- Icon-only buttons receive an accessible name.
- Decorative icons use `aria-hidden="true"`.
- Visible labels remain next to navigation and domain actions.
- Contrast is at least `3:1` for non-text icon graphics against adjacent colors.
- Focus indicators remain visible and are not replaced by color changes alone.
- Statuses combine icon, text, color, and when practical shape.
- All touch actions remain at least `44 × 44` pixels; operator primary actions use `48 × 48` or larger.

## Migration strategy

1. Add icon tokens and the typed icon facade.
2. Add custom domain SVG components and catalog tests.
3. Migrate global role navigation and application chrome.
4. Migrate the operator dashboard and report workflow.
5. Migrate inspections, technical readiness, equipment, and maintenance.
6. Migrate administration, monitoring, reports, analytics, and settings.
7. Replace remaining emoji and text-only navigation markers.
8. Remove obsolete icon imports and verify bundle output.

Migration proceeds in bounded groups so each group can be verified before continuing. Existing behavior, routes, and API interactions remain unchanged.

## Error handling and fallbacks

- The icon-name type prevents unknown icons at compile time.
- The facade throws no runtime errors for presentation props.
- Development tests fail if the icon catalog and implementation map diverge.
- Loading and unavailable states use explicit standard symbols and visible text.
- Broken equipment brand images continue to use the existing equipment placeholder and are outside this migration.

## Testing and acceptance criteria

### Automated

- Catalog test proves every icon name resolves to a renderable SVG.
- Accessibility tests verify standalone icons require a label and decorative icons are hidden.
- Navigation tests verify every role route has the intended icon.
- Existing unit and integration suites remain green.
- Type checking, lint, and production build succeed.
- GitNexus change detection shows only expected UI symbols and flows.

### Visual and interaction

- Operator, dispatcher, and administrator navigation is checked at mobile and desktop widths.
- Key sizes `16`, `20`, `24`, `32`, `48`, and `64` remain legible.
- Default, hover, active, focus, disabled, loading, warning, danger, and success states are reviewed.
- No emoji remain in application navigation.
- No icon-only interactive control lacks an accessible name.
- Production, drilling, downtime, maintenance, and defect icons are visually distinguishable without reading their captions.

## Rollout and compatibility

The migration is a presentation-layer change. No database migration, API change, permission change, or data backfill is required. The existing `lucide-react` dependency remains; custom icons add no runtime dependency and are tree-shakeable React components.
