# Authoritative Readiness Facts

## Goal

Make the technical-readiness center render one internally consistent decision from the authoritative readiness snapshot. The displayed status, score, blockers, warnings, next action, checklist stages, and evidence cards must all describe the same server-side evaluation.

## Scope

This change affects the readiness snapshot persistence model, authoritative evaluation pipeline, current/history API contracts, and the `Центр готовности` view. Existing tenant isolation, role capabilities, shift and permit state machines, idempotency, audit chaining, and the global application shell remain unchanged.

The other module tabs may continue to use their existing data sources during this phase. The legacy client readiness projection must no longer determine any decision shown in the readiness center when an authoritative snapshot is selected.

## Persistence

Add an optional `facts Json?` column to `ReadinessScoreSnapshot` through an additive PostgreSQL migration.

- New authoritative snapshots persist the complete normalized `AuthoritativeReadinessFacts` used by the evaluator.
- Existing snapshots retain `facts = null` because their original facts cannot be reconstructed reliably.
- `CurrentReadiness` remains a lightweight pointer to the latest immutable snapshot.
- The migration must not synthesize historical facts from current operational rows.
- Snapshot immutability and existing tenant-scoped indexes and unique constraints remain intact.

## Snapshot pipeline

`evaluateAuthoritativeReadiness` already returns the normalized facts used for the decision. Snapshot creation will serialize those exact facts into `ReadinessScoreSnapshot.facts` in the same transaction as the score, blockers, warnings, evidence references, and facts hash.

The stored `factsHash` continues to protect the canonical fact input. The new JSON is the readable presentation payload; the hash remains the integrity fingerprint. Snapshot deduplication and trigger semantics do not change.

All snapshot creation paths, including shift-start decisions, permit changes, maintenance-driven projections, migration/backfill, and worker processing, must use the shared snapshot repository so new rows cannot omit facts accidentally.

## API contract

The current-readiness and readiness-history endpoints return:

- `facts`: normalized authoritative facts or `null` for a legacy snapshot;
- existing status, score, blockers, warnings, evidence references, trigger, rule-set version, and calculation time.

The client contract must replace `unknown` readiness payloads with validated DTO types. Runtime parsers must reject malformed new payloads safely while accepting `facts: null` for historical rows.

No endpoint may recompute historical facts from current equipment state.

## Presentation model

Introduce a pure authoritative presentation adapter. Its input is `CurrentReadinessDto | null`; its output contains:

- decision status and label;
- score;
- blocker and warning collections;
- next action and target module;
- five readiness stages;
- evidence cards;
- rule-set version and evaluation time;
- provenance state: `authoritative`, `legacy-incomplete`, or `missing`.

The adapter owns user-facing mapping from domain fact and blocker codes. React components must not independently infer readiness.

### Authoritative snapshot

When facts are present, every readiness-center decision surface is derived from the snapshot. The server status takes precedence over visual thresholds.

### Legacy snapshot

When `facts = null`, preserve the stored score, status, blockers, warnings, rule version, and timestamp. Show a visible `Исторические доказательства неполны` notice. Fact-dependent stages and cards display `Нет данных в историческом снимке`; they must not fall back to the current journal or legacy client score.

### Missing snapshot

When no snapshot exists, show `Авторитетная оценка отсутствует`, an unconfirmed score, and a safe next action to create or refresh the readiness evidence. Do not display a synthetic percentage or operational permission.

### Malformed snapshot

If the contract parser encounters malformed facts or decision payloads, use a safe blocked/error state with retry. The page must remain usable and must never substitute the legacy calculation silently.

## UI changes

Retain the existing PilingTrack global shell, left navigation, and single module tab row.

Within the readiness center:

- make the decision card the primary source of status, score, blocking reason, and next action;
- show snapshot provenance, rule version, and calculation timestamp near the decision;
- render the state chain from authoritative facts;
- render blocker details adjacent to the decision;
- distinguish `not satisfied`, `not required`, and `historical data unavailable`;
- preserve responsive one-, two-, and three-column layouts;
- preserve keyboard-accessible controls, focus behavior, live announcements, loading, forbidden, error, and retry states.

## Compatibility

- PostgreSQL migration is additive and nullable.
- Existing snapshots and exports remain readable.
- CSV/audit export must include facts only where its existing contract requires snapshot payloads; no unrelated export format changes are introduced.
- Old API consumers receive the new nullable property without removal of existing fields.
- Legacy readiness helpers remain temporarily available for non-center tabs.

## Testing

Add or update focused tests for:

1. migration shape and nullable legacy rows;
2. snapshot repository persistence of exact evaluation facts;
3. current/history endpoint serialization;
4. DTO runtime validation;
5. presentation adapter for READY and BLOCKED snapshots;
6. each blocker and next-action mapping;
7. legacy `facts = null` rendering;
8. missing and malformed snapshots;
9. proof that the readiness center does not use legacy score/status fallback;
10. desktop and mobile readiness-center rendering for operator and dispatcher roles.

Run focused readiness tests, contract tests, integration tests, migration guard, TypeScript, lint, and a browser smoke check. Existing unrelated dirty-worktree changes must remain untouched.

## Acceptance criteria

- A selected installation displays one consistent authoritative status, score, blocker count, stage chain, and next action.
- New snapshots persist the exact facts evaluated by the server.
- Old snapshots remain readable and are explicitly marked incomplete.
- Missing or invalid snapshot data never produces a positive readiness decision.
- No readiness-center decision falls back silently to `deriveEquipmentReadiness` or client-side `computeReadinessScore`.
- Tenant, role, audit, idempotency, and workflow protections remain unchanged.
