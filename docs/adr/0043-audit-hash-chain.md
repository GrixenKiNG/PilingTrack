# ADR-0043: Tenant-scoped append-only AuditLog hash chain

- Status: Accepted
- Amended: 2026-10-07 (see Amendment at the end)
- Date: 2026-07-29
- Decision owners: Security and Tech Readiness backend

## Context

The current `AuditLog` is append-only only by application convention, has no integrity chain, and `/api/audit` currently reads `FeedbackEvent`. Safety-relevant workflow decisions need a reproducible, tenant-scoped history without claiming an electronic signature.

## Decision

1. `AuditLog` becomes the only source for the audit API and CSV. `FeedbackEvent` remains an operational notification stream.
2. A `TenantAuditChain` row stores the current sequence and head hash. Appending locks that tenant row with `SELECT ... FOR UPDATE`, increments the sequence and inserts the event in the same transaction.
3. Sensitive values are recursively masked before persistence. The masked event is serialized with RFC 8785 JSON Canonicalization Scheme and encoded as UTF-8.
4. `eventHash = SHA-256("PILINGTRACK-AUDIT-V1\n" + tenantId + "\n" + sequence + "\n" + (prevHash ?? "") + "\n" + canonicalEvent)`, stored as 32-byte `Bytes`. `sequence` is canonicalized as a decimal string and timestamps as UTC RFC 3339. `canonicalEvent` excludes `hash` and `prevHash`, but includes immutable identity, actor, action, entity/version, domain `occurredAt`, chain `recordedAt`, correlation/idempotency IDs and masked payload.
5. Database grants deny `UPDATE`, `DELETE` and `TRUNCATE` on `AuditLog` to application and worker roles. A trigger rejects mutation as a second guard.
6. Verification scans each tenant in sequence order, checks gaps and hashes, and emits a security alert outside the audited table when a break is found.

## Consequences

- Parallel audit appends for the same tenant serialize briefly on one head row.
- Imported legacy events are explicit `LEGACY_IMPORT` records with provenance and import time; they are not presented as historically native hash-chain events.
- Legacy rows with no tenant are explicitly mapped by an approved manifest or quarantined outside the tenant API; they are never assigned to a default tenant.
- Hash chaining detects tampering but is not an electronic signature and does not prove actor identity beyond the authenticated application record.
- Detection against a privileged database owner requires external signed/WORM anchoring of chain heads; without it, claims are limited to application-role tamper evidence.

## Amendment 2026-10-07 (owner decision, option B)

The code never matched Decision item 1. The owner chose to bring the document in line with the code, not the code with the document (see `docs/audits/hermes-night/W24-ADR-0043-OPTIONS.md`).

Decision item 1 is replaced by:

1. `AuditLog` is the tamper-evident hash chain for decisions that matter for safety. Today this is the tech-readiness contour; its only write point is `src/modules/readiness/infrastructure/audit/audit-repository.ts`. `FeedbackEvent` is the audit feed and the entity history for all other modules (sign-in, reports, sites, users, dictionaries, equipment, maintenance). `GET /api/audit` and the audit screen read it through `src/services/audit/audit-history-service.ts`.

Items 2-6 describe the chain itself and stay unchanged.

Consequences of the amendment:

- The chain does not cover actions outside tech readiness.
- `FeedbackEvent` is not protected against tampering. Outside tech readiness, an external guard (for example signed anchors) is required to prove who changed what.
- Moving the other modules into the chain (the former option A) is not planned. It needs a new decision of the owner.
