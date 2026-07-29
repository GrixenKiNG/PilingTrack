# Tech Readiness Backend Task 11 — Performance and observability

**Work-plan coverage:** backend half of TR-1002. **Goal:** bounded queries/workers plus measurable command, snapshot, audit and tenant-denial health.

## Target files

- Edit readiness repositories under `src/modules/readiness/infrastructure/**`, projection worker integration from Task 05, and existing observability adapter files returned by GitNexus.
- Create `src/modules/readiness/infrastructure/observability/readiness-metrics.ts`.
- Add `tests/integration/tech-readiness-performance.spec.ts`.

## Prerequisites and steps

1. Backend Tasks 05–10 and Frontend Task 10.
2. Add bounded pagination/cancellation and remove measured N+1/load-all.
3. Instrument center/commands/snapshot lag, conflicts, outbox/DLQ, chain verification and tenant denials with correlation IDs and redaction.

## Tests and validation

- Add production-like cancellation/performance probes.
- Measure and report dataset/load: center p95 <1s target, commands excluding fanout <1.5s, snapshot 95% <5s; verify alerts distinguish API success from projection/audit failure.

## GitNexus gate

- Upstream `impact`: each edited repository, outbox worker, observability/query integration. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; performance/metrics/repository/test allowlist only.

## Acceptance, rollback, exclusions

- Acceptance: limits/cancellation proven and measured metrics cover lag/failure/security signals.
- Rollback: reduce limits or disable readiness consumer/feature only; retain queued events.
- Forbidden: stopping unrelated consumers, unbounded labels/PII, invented SLO success, unrelated observability.
