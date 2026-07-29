# Tech Readiness Backend Task 05 — Evaluator, snapshots and backfill

**Work-plan coverage:** TR-500, TR-501, TR-502. **Goal:** one authoritative evaluator feeding immutable, deduplicated projections and resumable tenant backfill.

## Target files

- `prisma/schema.prisma`; migrations `*_readiness_snapshots_outbox_idempotency/migration.sql` and `*_readiness_start_snapshot_fk/migration.sql`; new `*_readiness_backfill_progress/migration.sql` only if progress is DB-persisted.
- Create `src/modules/readiness/domain/evaluation/{evaluator,facts,rules,evidence,clock}.ts`.
- Edit `src/modules/readiness/application/{readiness-facts,readiness-score,readiness-rules}.ts`.
- Create `src/modules/readiness/application/projection/{consumer,project-event,current-read-model}.ts`.
- Create `src/modules/readiness/infrastructure/snapshots/{snapshot-repository,outbox-repository}.ts`.
- Create `src/modules/readiness/application/backfill/{backfill-service,progress-repository}.ts` and `scripts/backfill-tech-readiness.ts`.
- Edit exact readiness worker handler discovered by GitNexus; owned tests only.

## Prerequisites and steps

1. Backend Task 04.
2. Implement evaluator with explicit clock/timezone/immutable rules and authoritative inspection, FAULT/REPAIR, meter, maintenance and permit adapters.
3. Project atomically one immutable snapshot plus projected marker with trigger dedupe and captured event clock.
4. Backfill with `(tenantId,id)`, batch 200, `MIGRATION` provenance, resumable errors/counts; attach shift start FK last.

## Tests and validation

- Activate all evaluation cases and progressively all integration write-pipeline cases.
- Add absent-rule fail-closed, permit on/off, DST, duplicate/delayed delivery, projection/source rollback, immutable current/history, resume/idempotency/count tests.
- Run focused unit/integration; migration/production-like copy twice; reconcile every active equipment; measure 95% snapshot visibility under 5s.

## GitNexus gate

- Upstream `impact`: `computeReadinessScore`, `blockerTriggered`, `deriveEquipmentReadiness`, inspection complete, `addMeterReading`, maintenance create/update, outbox worker/handler, source query repositories. HIGH/CRITICAL stops.
- `detect_changes(scope:"all")`; evaluator/projection/backfill/schema/worker/test allowlist only; verify unrelated consumers unchanged.

## Acceptance, rollback, exclusions

- Acceptance: command/projection use same evaluator; duplicate delivery creates one snapshot; failed event is retryable; backfill coverage reconciled per tenant; no history mutation.
- Rollback: pause only readiness consumer/backfill; retain events/snapshots/checkpoint for forward replay.
- Forbidden: process-local clock, client facts, deleting snapshots, stopping unrelated consumers, synthetic production permits/shifts.
