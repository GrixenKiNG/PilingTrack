# ADR-0043: Tenant-scoped append-only AuditLog hash chain

- Status: Accepted
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
