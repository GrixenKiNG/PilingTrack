# ADR-0041: Consistency model for Tech Readiness workflows

- Status: Accepted
- Date: 2026-07-29
- Decision owners: Tech Readiness backend
- Related: `docs/product/tech-readiness-production-prd.md`

## Context

Shift start, handover acceptance and work-permit approval are safety-relevant commands. They must remain correct under retries, concurrent requests and delayed readiness projections. The existing application has Prisma transactions and a transactional outbox, but current readiness is calculated as a transient read model.

## Decision

1. `Shift`, `ShiftHandover` and `WorkPermit` are authoritative transactional aggregates with integer optimistic versions.
2. Every mutation requires `Idempotency-Key`; versioned mutations also require a strong `If-Match: "<aggregate-kind>-<id>-v<version>"` or an equivalent integer `expectedVersion` body field. Weak ETags are rejected; if header and body are both supplied they must match. `ReadinessRuleSet` keeps semantic `version` (`v1.x`) separate from integer optimistic `revision`.
3. PostgreSQL partial unique indexes enforce one active shift per `(tenantId, equipmentId)` and one live handover per shift. State transitions use conditional `updateMany` predicates containing tenant, id, state and version.
4. Shift start evaluates the latest published rule set and authoritative source rows inside the same `SERIALIZABLE` transaction. It never trusts a possibly stale snapshot to authorize start.
5. A successful domain mutation writes its aggregate, `AuditLog`, idempotency claim/result and `OutboxEvent` atomically. A concurrent idempotency claimant waits on the unique-key winner up to a short lock timeout, then replays the committed result or returns `COMMAND_IN_PROGRESS`; no separately committed/stale-reset processing row is allowed. The outbox projection creates immutable readiness snapshots and atomically marks its event projected. Shift start also persists the decision snapshot synchronously.
6. Rule publication is atomic for the rule lifecycle, then fans out snapshot recalculation through one deduplicated outbox job per affected equipment.

## Consequences

- A stale command returns `409` with the current safe read model.
- A violated domain gate returns `422`; a unique-index race is translated to a stable conflict code.
- Read views may be eventually consistent for at most the snapshot SLO, while authorization decisions are strongly consistent.
- Command handlers must accept a transaction client; existing inspection, meter and maintenance commands need transactional adapters before they can emit readiness events atomically.
