# Monitoring server-side persistence — tile template + equipment photos

**Date:** 2026-07-09
**Status:** Design (approved for planning)
**Author:** engineering (AI-assisted)

## Problem

The `/monitoring` fleet dashboard has a per-browser tile editor. The tile
**template** (card layout / blocks) is saved in `localStorage`
(`monitoring-equipment-tile-template-v1`), and uploaded **equipment photos**
are saved as blobs in `IndexedDB` (`monitoring-equipment-tile-assets-v1`).
Neither is sent to the server (verified 2026-07-09: the only monitoring API is
`GET /api/monitoring/fleet`, which carries no template or photo).

Consequence: a layout + photos configured on one origin/browser (e.g.
`localhost:3000`) do **not** appear on prod (`orionpiling.ru` — a different
origin with separate browser storage), nor for other users/devices. This is
by-design today, but the desired behaviour is: an admin configures the
dashboard once and **everyone in the tenant sees the same cards + photos on
every device**.

This is a feature (server persistence), not a bug fix.

## Decisions (locked 2026-07-09)

1. **Template scope:** one shared template **per tenant**. Admin edits;
   everyone reads.
2. **Photos:** **one photo per equipment**, stored via the existing `Media`
   infrastructure (`entityType='equipment'`). No schema change for photos.
3. **Edit permissions:** template write + equipment photo upload are
   **ADMIN-only**. All authenticated users read.
4. **Photo change mode (v1):** **manual replace only** — newest completed
   photo wins. No auto-rotation (model stays compatible with adding it later).
5. **Existing-data migration:** **once, via the editor** — the editor seeds
   from the current `localStorage` template when the server is empty; one
   "Save" (admin) pushes it to the server. Photos are re-uploaded once per
   equipment.

## Out of scope (v1)

- Auto-rotating / multi-photo carousels per equipment.
- Arbitrary multi-image blocks with independent uploaded images (the current
  local `image`-block-with-`assetId` model). v1 renders **one** equipment
  photo in the card's photo slot; free-form image blocks remain local-only
  until a future iteration.
- Photo gallery / history UI (only "current photo" is surfaced).
- Per-user template overrides.

## Architecture

### Data

- **New table `MonitoringTileTemplate`** (tenant-scoped, one row per tenant):
  - `id String @id @default(cuid())`
  - `tenantId String @unique`
  - `template Json`
  - `updatedBy String`
  - `updatedAt DateTime @updatedAt @db.Timestamptz(3)`
  - `createdAt DateTime @default(now()) @db.Timestamptz(3)`
  - Tenant-scoped + **FORCE RLS** consistent with the project's other
    tenant tables (add to the RLS table list; policy keyed on
    `app.current_tenant`). → **one migration, one logical change.**
- **Photos: no schema change.** Reuse `Media` with `entityType='equipment'`,
  `entityId=<equipmentId>`, `tenantId`. "Current photo" for an equipment =
  the most recent `Media` where `entityType='equipment'` AND
  `entityId=<id>` AND `uploadStatus='completed'` AND `isDeleted=false`,
  ordered by `createdAt desc`.

### API (all wrapped with `withApi`/`withMutation`)

- `GET /api/monitoring/template` — `withApi`, any authenticated user.
  Returns the tenant's template JSON, or the default template when no row
  exists. Tenant from the authenticated user (fail closed on missing tenant,
  matching `getFleetSnapshot`).
- `PUT /api/monitoring/template` — `withMutation`, **ADMIN-only** (server-side
  role assertion). Body validated by the existing pure
  `validateEquipmentTileTemplate` (imported server-side — it has no DOM deps).
  Upserts the tenant row, sets `updatedBy`.
- **Photos reuse the existing media flow — no new media routes:**
  `POST /api/media` (create pending + presigned PUT) with
  `entityType='equipment'`, `entityId`; client uploads to S3/MinIO;
  `POST /api/media/[id]/confirm`. The equipment-photo upload control (ADMIN)
  calls these. Confirm that `POST /api/media` accepts/permits
  `entityType='equipment'` and enforces tenant + ADMIN for this entity type;
  tighten if needed (that guard change, if any, is in scope).
- `getFleetSnapshot` gains **`photoUrl: string | null`** per `FleetCard`:
  one extra query loads the latest completed, non-deleted `Media` for the
  in-scope equipment ids and maps id → served URL (`cdnUrl` if present, else
  the existing `/api/media/[id]/download` route). One home for the fact; the
  dashboard already consumes this snapshot.

### Client

- **`useEquipmentTileTemplate`**: source of truth becomes the server
  (`GET /api/monitoring/template`). Migration seed: if the server returns the
  default (no saved row) **and** a local `localStorage` template exists, the
  editor initializes from the local one so the admin's current layout appears
  and a single "Save" persists it server-side. After a server template
  exists, the server value wins. `PUT` on save (ADMIN only; the Save control
  is hidden/disabled for non-admins).
- **Image rendering**: the card photo slot (`photo` data block, and any image
  block mapped to the equipment photo) renders `card.photoUrl` (a normal
  `<img src>` to a same-origin media URL) instead of an IndexedDB object URL.
  `EquipmentTileImageBlock`'s IndexedDB path is replaced by the server URL for
  the equipment photo; the local IndexedDB asset store is no longer the
  source for equipment photos (kept only if free-form image blocks remain,
  which are out of v1 scope).
- **Photo upload (ADMIN)** in the editor: pick a file → validate
  (reuse `validateEquipmentTileImageFile`: JPG/PNG/WebP, ≤12 MB) →
  `POST /api/media` (equipment entity) → upload → confirm → refetch fleet →
  new `photoUrl` shows.

### Permissions & tenant safety

- Template `PUT` and equipment-photo upload: ADMIN role asserted server-side
  (not just hidden in UI).
- `MonitoringTileTemplate` tenant-scoped + FORCE RLS.
- Media already tenant-scoped; `getFleetSnapshot` already tenant-scoped and
  fail-closed on missing tenant.

## Error handling

- `GET template`: no row → return default template (200), never 500.
- `PUT template`: invalid body → 400 with validation detail (pattern from
  CLAUDE.md); non-admin → 403; missing tenant → fail closed.
- Photo upload failures surface via the existing media flow's error paths and
  a toast; a missing/failed photo renders the existing "Фото не загружено"
  placeholder (no crash).
- `photoUrl` resolution: an equipment with no completed media → `photoUrl:
  null` → placeholder, page still renders (mirrors today's behaviour).

## Testing (lean — per the keep-tests-lean rule)

- Reuse existing `validateEquipmentTileTemplate` /
  `validateEquipmentTileImageFile` unit tests (no duplication).
- Add focused tests only where behaviour is new and safety-relevant:
  - Template API contract: `GET` returns default when empty; `PUT` rejects a
    non-ADMIN (403) and an invalid template (400); round-trips a valid one.
  - `getFleetSnapshot` photo resolution: picks the latest completed,
    non-deleted media per equipment; `null` when none.
- Prefer extending existing `__tests__` files over new ones.

## Slices (implementation order)

1. **Backend — template:** migration for `MonitoringTileTemplate` (+ RLS);
   `GET`/`PUT /api/monitoring/template` (ADMIN-gated PUT, server-side
   validation reuse). Verify: contract tests + `npm run verify`.
2. **Backend — photos:** add `photoUrl` to `getFleetSnapshot`; confirm/adjust
   `POST /api/media` for `entityType='equipment'` (tenant + ADMIN). Verify:
   snapshot test + manual media round-trip locally.
3. **Client:** switch `useEquipmentTileTemplate` to the server (with the
   localStorage migration seed); render `card.photoUrl`; wire the ADMIN photo
   upload to the media API; hide Save/upload for non-admins.
4. **Verify + migrate + deploy:** `npm run verify`; local browser check
   (admin saves template + uploads photos → reload → persists → second
   browser/incognito sees the same); then deploy **operator-driven** (per
   `pilingtrack-run-and-operate`) — this includes a new migration, so build
   `migrate` too (per `deploy` skill / runbook 008); post-deploy the admin
   does the one-time save + photo re-upload on prod.

## Estimate

Medium. ~2 backend slices + 1 client slice + verify/deploy. 1–2 focused
sessions. One new migration (non-destructive, additive table).

## Gates (per pilingtrack-change-control)

- New migration → `create-migration` skill rules (one logical change,
  destructive-statement guard, rebuild `migrate` image on deploy).
- New API routes → `withApi`/`withMutation`, no inline CSRF/rate-limit.
- ADMIN gating asserted server-side.
- `npm run verify` + `qa-checklist` before commit; deploy is operator-driven.

## Provenance

- Local storage mechanism verified 2026-07-09:
  `src/components/piling/monitoring/equipment-tile-storage.ts` (localStorage),
  `equipment-tile-asset-storage.ts` (IndexedDB).
- `Media` model + `entityType='equipment'` support verified in
  `prisma/schema.prisma`; media API at `src/app/api/media/**`.
- `getFleetSnapshot` at
  `src/modules/monitoring/application/queries/fleet-monitoring.service.ts`.
