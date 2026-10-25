---
name: report-evidence-model
description: >-
  PilingTrack's report evidence and provenance model — how shift reports, their
  photo evidence, version snapshots, and audit/diff history fit together. Use
  when working on anything touching reports, report photos/media, evidence panes,
  report history/provenance, audit diffs, or report version snapshots: editing
  Report/ReportAudit/ReportVersion/Media/ReportPhoto, the /api/reports/[id]/history
  endpoint, humanizeDiff, the admin evidence/thumbnail UI, or adding a new field
  that must appear in report history. Prevents building on the dormant ReportPhoto
  path, breaking the client/server bundle split, or misrepresenting the integrity hash.
---

# Report Evidence Model

PilingTrack proves *who recorded what work, when, and with what photo evidence*.
That guarantee is spread across several tables and two service files. This skill
maps them so changes don't silently break the evidence chain.

## Read this first

Full table-by-table detail (fields, lifecycle, auth rules) is in
[references/data-model.md](references/data-model.md). Read it before editing any
report/evidence table or the history pipeline. The essentials below are enough to
orient and to avoid the three common traps.

## The model in one picture

```
Report (mutable head, one per user/site/day)
 ├─ ReportVersion[]  immutable full-JSON snapshots  (legal "what did v3 look like")
 ├─ ReportAudit[]    immutable diffs + integrity hashes  ← primary provenance
 ├─ AuditLog         cross-cutting trail (report.* scope)
 └─ Media[]          photos, linked by entityType='report' + entityId  ← LIVE evidence

ReportPhoto                DORMANT — richer photo model, not written in src/
Report.journalPhotoMediaId DRIFT — legacy single-photo pointer, not written in src/
```

History pipeline: `ReportAudit` + `ReportVersion` → `getReportHistory()` →
`humanizeDiff()` → `GET /api/reports/[id]/history` → `useReportHistory` → evidence pane.

## Three traps to avoid

1. **Photos live in `Media`, not `ReportPhoto`.** The live evidence path is the
   `Media` table with `entityType='report'`. `ReportPhoto` (with GPS/photoType)
   and `Report.journalPhotoMediaId` are designed-but-unused. Default to `Media`.
   Before building on `ReportPhoto`, confirm it's still dormant:
   `rg "reportPhoto\.(create|findMany|count|update)" src --glob '!**/generated/**'`.

2. **The integrity hash is not a signature.** `hashState` in
   `src/modules/reports/application/audit-service.ts` is a non-crypto 32-bit rolling hash.
   It catches accidental drift, not tampering. Never describe it as tamper-proof
   or a signature. Real tamper-evidence = a new design (HMAC/hash chain), not a tweak.

3. **Don't break the client/server split.** Pure helpers (`humanizeDiff`,
   `actionLabel`, `statusLabel`, types) live in `report-history.ts` (DB-free).
   `getReportHistory` lives in `report-history-service.ts` (imports Prisma).
   Client code imports from `report-history.ts` only — importing the `-service`
   file pulls Prisma + `pg` into the browser bundle.

## Common tasks

**Adding a new field that must show in report history**
1. Add the column to `Report` (own migration — see CLAUDE.md migration rules).
2. If it changes on every save but carries no meaning → add to the `NOISE` set in
   `report-history.ts`. Otherwise add a `case` in `humanizeDiff` with a Russian
   label (and a name lookup if it's an id reference) so history reads in Russian.
3. Confirm `computeDiff` already captures it (it diffs all keys generically).

**Writing an audit row for a report change**
Use `writeReportAuditRow(record, tx)` with the saving transaction so the audit is
atomic with the save. Fall back to `recordAudit(record)` only outside a transaction
(it also fires the general `AuditLog`). See audit-service.ts.

**Touching report photos / media**
Photos attach via `entityType='report'`. Authorization is IDOR-sensitive — read
`src/core/media/media-auth.ts` first. Note the deliberate draft-window rule:
uploads to a not-yet-persisted report are allowed (operators attach before submit).
When counting evidence, filter `isDeleted=false` and consider `uploadStatus='completed'`.

**Tenant safety**
Reports/Media carry `tenantId String?` (nullable in schema, must be `orion` on prod).
Never scope a report/media query with `IS NULL OR tenantId` — fail closed on a
missing tenantId. (IDOR policy in CLAUDE.md / resource-access-service.ts.)

## Key files
- `prisma/schema.prisma` — models `Report`, `ReportVersion`, `ReportAudit`, `Media`, `ReportPhoto`
- `src/modules/reports/application/report-history.ts` — pure helpers (`humanizeDiff`, `NOISE`)
- `src/modules/reports/application/report-history-service.ts` — `getReportHistory`
- `src/modules/reports/application/audit-service.ts` — `writeReportAuditRow`, `computeDiff`, `hashState`
- `src/core/media/media-auth.ts` — media authorization
- `src/app/api/reports/[id]/history/route.ts` — history endpoint
- `src/components/piling/admin-reports/report-thumbnail.tsx` — evidence thumbnail UI
