# Report Evidence — Data Model Reference

Authoritative map of every table and field involved in report evidence and
provenance. Verify against `prisma/schema.prisma` before relying on it — line
numbers drift; field names rarely do.

## Table of contents
- [The seven tables](#the-seven-tables)
- [Report (mutable head)](#report-mutable-head)
- [ReportVersion (immutable snapshots)](#reportversion-immutable-snapshots)
- [ReportAudit (immutable diff log)](#reportaudit-immutable-diff-log)
- [AuditLog (general, via recordAuditEvent)](#auditlog-general)
- [Media (LIVE photo evidence)](#media-live-photo-evidence)
- [ReportPhoto (DORMANT)](#reportphoto-dormant)
- [Provenance assembly](#provenance-assembly)
- [Field-name lookups](#field-name-lookups)

## The seven tables

| Table | Mutability | Role | Status |
|---|---|---|---|
| `Report` | mutable | Current editable state of a shift report | live |
| `ReportVersion` | append-only | Full JSON snapshot per version number | live |
| `ReportAudit` | append-only | Humanizable diff + integrity hashes per change | live |
| `AuditLog` | append-only | Cross-cutting audit (`report.*` scope) | live |
| `Media` | soft-delete | S3-backed files; **the photo evidence path** | live |
| `ReportPhoto` | — | Richer compliance photo model (GPS, photoType) | **dormant — not written in `src/`** |
| `Report.journalPhotoMediaId` | column | Legacy single-photo pointer | **drift — not written in `src/`** |

## Report (mutable head)
`prisma/schema.prisma` model `Report`. The one row a user edits. Key evidentiary fields:
- `reportId` — client-generated CUID, unique. **Generated on the client before submit** so photos can attach to a not-yet-persisted report.
- `version Int` + `vectorClock Json?` — optimistic concurrency / causal ordering (sync v3).
- `status` — `draft` | `submitted`.
- `lastEditedBy{Id,Name,Role}` — denormalized actor of the last edit.
- `@@unique([userId, siteId, date])` — one report per operator/site/day.
- `tenantId String?` — nullable in schema, but **must be `orion` on prod**. Never query reports with `IS NULL OR tenantId` (IDOR — see CLAUDE.md).

## ReportVersion (immutable snapshots)
Append-only full-state snapshots. `@@unique([reportId, version])`. `data Json` is the entire report at that version. Use for legal "what did it look like at v3" questions. Never UPDATE or DELETE rows here.

## ReportAudit (immutable diff log)
The **primary provenance source**. One row per change (`created`/`updated`/`submitted`/`deleted`).
- `diff Json` — shape `{ field: { old, new } }` (produced by `computeDiff`).
- `beforeHash` / `afterHash` — integrity fingerprints via `hashState`.
- `actorId` / `actorName` / `actorRole`, plus `ipAddress` / `userAgent` / `requestId` for forensic correlation.

⚠️ **`hashState` is NOT cryptographic** — it is a 32-bit polynomial rolling hash (`((hash<<5)-hash+char)|0`) over sorted-key JSON. It detects accidental drift, not malicious tampering. Do not present it as a signature or tamper-proof seal. If real tamper-evidence is required, that is a new design (HMAC/chain hash), not a tweak.

Writing audit rows — two paths in `src/services/reports/audit-service.ts`:
- `writeReportAuditRow(record, tx)` — pass `tx` to make the audit row atomic with the report save. **Prefer this.**
- `recordAudit(record)` — non-transactional fallback; also fires the general `AuditLog` event. Use only when you can't hook the save transaction.
- Defensive guard: both skip silently if `client.reportAudit` is missing from the generated Prisma client. Don't remove without checking all deploy targets have the model.

## AuditLog (general)
Written via `recordAuditEvent` from `@/services/audit/audit-service` (note: different file from the reports audit-service). Scope `reports`, action `report.<action>`. Carries `oldData`/`newData`/`diff` in `metadata`. This is the cross-cutting trail; `ReportAudit` is the report-specific one. Both get written by `recordAudit`.

## Media (LIVE photo evidence)
`prisma/schema.prisma` model `Media`. **This is where report photos actually live.** Generic S3-backed store:
- Linked to a report by `entityType='report'` + `entityId=<report.id or reportId>`.
- Lifecycle: `uploadStatus` `pending` → `completed` (or `failed`). `fileSize` stays `0` until confirmed.
- Soft delete: `isDeleted` / `deletedAt` / `deletedBy` — filter `isDeleted=false` when counting evidence.
- `key` (S3 object), `thumbnailKey`, `cdnUrl`.

UI reads it via `GET /api/media?entityType=report&entityId=<id>`; download/thumbnail via `/api/media/[id]/download?thumb=1`. See `src/components/piling/admin-reports/report-thumbnail.tsx`.

### Media authorization (`src/core/media/media-auth.ts`)
IDOR-sensitive — read before touching:
- `assertCanAccessMediaEntity` — privileged roles pass; for `entityType='report'`, if the report row **does not exist yet** (draft, not submitted) the upload is **allowed** (operators attach photos before submit). If it exists, the operator must own it (`report.userId === actor.id`).
- `assertCanAccessMedia` — once a media row exists, ownership is checked on the **media row** (`media.userId`), not the entity. Deliberate: entity ownership may be absent (draft) or reassigned (admin moved the report).

## ReportPhoto (DORMANT)
A richer photo model (`latitude`/`longitude`/`altitude`, `photoType`, `width`/`height`, `mediaId` link). **Currently not created/read anywhere in `src/`** (only in generated Prisma client). It is a designed-but-unused compliance path.

⚠️ Before building any feature on `ReportPhoto`, confirm it is still dormant:
```
rg "reportPhoto\.(create|findMany|count|update)" src --glob '!**/generated/**'
```
If that returns nothing, it is still dead. Building on it means wiring a new path end-to-end, not extending a live one. Default to `Media` unless you specifically need GPS/photoType columns and are prepared to activate `ReportPhoto` fully.

## Provenance assembly
`getReportHistory(reportId)` in `src/services/reports/report-history-service.ts`:
1. Loads `ReportAudit` (desc by `createdAt`) + `ReportVersion` (desc by `version`).
2. Loads name lookups (pileGrade, drillingType, downtimeReason, site, user, equipment).
3. Maps each audit row to a `ReportHistoryEvent`, running `diff` through `humanizeDiff`.

Returns `{ events, versions }`. Exposed at `GET /api/reports/[id]/history`, consumed by `useReportHistory` hook.

## Client/server split (important)
`src/services/reports/report-history.ts` holds **pure, DB-free** helpers (`humanizeDiff`, `actionLabel`, `statusLabel`, all types). `report-history-service.ts` holds the DB-bound `getReportHistory` and re-exports the pure helpers.

**Client/browser code must import from `report-history.ts`** — importing from `report-history-service.ts` drags Prisma + `pg` into the browser bundle. Keep new pure helpers in `report-history.ts`.

## Field-name lookups
`humanizeDiff(diff, lookups)` turns raw diffs into Russian operator-facing change rows.
- `NOISE` set — fields skipped as non-evidentiary on every save: `version, updatedAt, createdAt, vectorClock, lastEditedById, lastEditedByName, lastEditedByRole, id, reportId`. **Add a field here if it changes on every save but carries no meaning.**
- Array formatters: `piles` (grade: count шт), `drillings` (type: count шт, meters м), `downtimes` (reason: duration ч).
- Scalar relabels (RU): `status`→Статус, `siteId`→Объект, `userId`→Оператор, `equipmentId`→Установка, `shiftStart/End`→Начало/Окончание смены, `date`→Дата, `shiftType`→Тип смены.
- Unknown fields fall through to raw `field` label + `scalar()` value. **Add a `case` when introducing a new evidentiary field** so history reads in Russian, not as a raw key.
