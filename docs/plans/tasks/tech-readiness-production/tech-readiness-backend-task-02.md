# Tech Readiness Backend Task 02 — Command pipeline and audit-chain primitive

**Work-plan coverage:** TR-202, TR-203. **Goal:** provide reusable strong concurrency/idempotency envelopes and append masked tenant hash-chain audit records.

## Target files

- `prisma/schema.prisma`; migrations `*_readiness_snapshots_outbox_idempotency/migration.sql` (nullable primitive fields only here) and `*_audit_chain_v1/migration.sql`.
- Create `src/modules/readiness/application/command-pipeline/{errors,etag,idempotency,execute-command,correlation}.ts`.
- Create `src/app/api/readiness/_shared/{route-adapter,request-context,response}.ts`.
- Create `src/modules/readiness/domain/audit/{canonicalize,mask,digest,types}.ts`.
- Create `src/modules/readiness/infrastructure/audit/{append-audit,verify-chain,audit-repository}.ts`.
- Edit adapter around `src/core/infrastructure/audit-log-service.ts`; do not switch `src/app/api/audit/route.ts`.

## Prerequisites and steps

1. Backend Task 01.
2. Implement common envelopes, strong ETag `428/409/422`, tenant/scope/request-hash idempotency, exact replay and `COMMAND_IN_PROGRESS`.
3. Implement recursive masking, RFC 8785 canonicalization, ADR digest, tenant chain lock, append-only guard, verifier and shadow metrics.
4. Backfill legacy audit only through an approved mapping manifest or restricted quarantine; validate before NOT NULL/guard enforcement.

## Tests and validation

- Activate strong/weak/missing ETag and idempotent replay/mismatch cases once bound to a thin real command.
- Activate only `Audit canonicalization and hash chain` domain group.
- Add golden hash/canonical vectors, masking, concurrent contiguous sequence, update/delete denial, verifier break, winner rollback/timeout tests.
- Run focused Vitest/contract/integration; migration twice in disposable DB; `npx.cmd tsc --noEmit`.

## GitNexus gate

- Upstream `impact`: current API mutation wrapper, idempotency publisher, outbox publisher, `audit-log-service`, `audit-service`, `/api/audit` reader integration. Stop on HIGH/CRITICAL.
- Run `detect_changes(scope:"all")`; no audit-reader semantic switch or unrelated outbox consumer may appear.

## Acceptance, rollback, exclusions

- Acceptance: same key/request replays exact status/body/headers; different payload is stable 409; persisted masked payload equals hashed payload; application-role tamper evidence only.
- Rollback: disable new command routes; shadow writes only with security-owner approval; never delete, update, or rechain written audit data.
- Forbidden: FeedbackEvent reader switch, electronic-signature claims, stale processing reset, destructive schema rollback, unrelated audit/outbox code.
