# Sites — Delete & Completion Lifecycle

**Date:** 2026-06-23
**Module:** Objects (Sites)

## Goal

Let admins **permanently delete** sites that were created by mistake (no crews, no
execution), and mark worked sites as **completed** — separately from deactivation.

## Lifecycle model — two independent axes

The `Site` table already has both fields; we keep them orthogonal:

- **`completionDate`** = the "Выполнен" marker. Set → object shows as completed but
  **stays active** (per product decision). Cleared → not completed. Independent of `isActive`,
  so a completed site can also be deactivated later without losing the mark.
- **`isActive`** = on/off (deactivate / activate). Unchanged behaviour.

We do **not** use the string `status` column for completion (avoids "active but status=INACTIVE" drift).

## Actions in the site card (all always visible)

1. **Выполнен / Снять отметку** — toggles `completionDate`. Object stays active.
2. **Деактивировать / Активировать** — existing soft toggle (`isActive`).
3. **Удалить навсегда** — irreversible delete (guarded, see below).

## Hard delete — rules

- **Eligibility (fail-closed, server-side):** delete only if the site has **0 crews AND 0 reports**.
  DB backstop: `Crew.site` is `onDelete: Restrict`.
- **Cascade removes only setup data:** pile/drilling plans, hierarchy (fields→clusters→pickets),
  user assignments (all `onDelete: Cascade` from `Site`). No execution data exists by definition.
- **Not eligible →** server returns **409** with a plain message
  (`Нельзя удалить: N бригад, M отчётов. Деактивируйте объект.`). The dialog shows it and offers a
  **«Деактивировать вместо удаления»** button.
- **Access:** `sites.manage` (admin). Dialog requires explicit confirmation (it is irreversible).

## API changes

- **`DELETE /api/sites/[id]`** → now performs the **hard delete** (was a redundant soft-deactivate).
- **Deactivation** stays on **`PUT /api/sites/[id]` `{ isActive: false }`** (already wired).
- **Completion** via **`PUT /api/sites/[id]` `{ completed: boolean }`** → sets/clears `completionDate`.

## Backend (sites module, tenant-scoped via `requireTenantSite`, fail-closed)

- `hardDeleteSite(siteId, ctx)` — count crews + reports; throw `ServiceError(409)` if either > 0;
  else `db.site.delete` (cascade); audit `site.deleted`.
- `setSiteCompleted(siteId, completed, ctx)` — `db.site.update({ completionDate: completed ? now : null })`;
  `isActive` untouched; audit `site.completed` / `site.completion_cleared`.
- `DELETE` route swaps `deactivateSite` → `hardDeleteSite`.

## UI (admin-sites)

- `SiteDetail` buttons: add **Выполнен/Снять отметку**, keep **Деактивировать/Активировать**,
  rename **Удалить → Удалить навсегда**.
- `DeleteSiteDialog` → permanent-delete confirm; on 409, show reason + «Деактивировать вместо удаления».
- `use-site-mutations`:
  - `handleConfirmDelete` → `DELETE` (hard); on success **remove** the row from the list; on 409 surface the message.
  - `handleSetCompleted` → `PUT { completed }`.
  - deactivate reuses the existing `PUT { isActive }` path.
- **Data plumbing:** carry `completionDate` into the list/overview rows so a **«Выполнен»** badge can render.

## Tests (lean — per user preference, no new test files)

Add **one** safety guard into the existing `site-admin-command.test.ts`:
- `hardDeleteSite` **refuses** (409) when the site has crews or reports, and does not call `db.site.delete`.

No other new tests. (This single guard protects against irreversible data loss; everything else is left untested by request.)

## Out of scope

- No change to the `status` string column semantics.
- No backfill/migration (fields already exist).
- No bulk delete.
