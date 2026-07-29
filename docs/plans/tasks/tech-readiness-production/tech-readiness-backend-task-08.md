# Tech Readiness Backend Task 08 — Typed readiness rules

**Work-plan coverage:** TR-700. **Goal:** production draft/publish/archive lifecycle with atomic deduplicated fanout.

## Target files

- `prisma/schema.prisma`; `prisma/migrations/*_readiness_rules_typed/migration.sql`; `prisma/seed.ts`.
- Edit `src/modules/readiness/application/readiness-rules.ts` and exact `readiness-rules-service.ts` found by GitNexus.
- Edit routes under `src/app/api/readiness-rules/**`.
- Add focused domain/route/integration tests.

## Prerequisites and steps

1. Backend Task 05; may execute after Task 07.
2. Preserve semantic `version=vN.N`; add separate integer `revision`.
3. Implement DRAFT/PUBLISHED/ARCHIVED, strong optimistic publish and one-live-version rule.
4. Publish atomically queues deduplicated equipment fanout; seed one published and one draft through services, while production seed only creates missing timezone/default draft.

## Tests and validation

- Add malformed-version/duplicate preflight, draft conflict, publish race, one published version, fanout/current snapshot and historical rule provenance tests.
- Run existing rules route tests plus focused integration; migration twice; Prisma generate/check; typecheck.

## GitNexus gate

- Upstream `impact`: `READINESS_CRITERION_KEYS`, `DEFAULT_READINESS_RULES`, rules draft/publish service functions and routes. Stop on HIGH/CRITICAL.
- `detect_changes(scope:"all")`; rules/schema/migration/seed/tests only.

## Acceptance, rollback, exclusions

- Acceptance: semantic version never cast to integer; past snapshots retain rule version; publish creates only new snapshots and exactly one published version.
- Rollback: disable publish flag; retain drafts/history/events.
- Forbidden: automatic production publish, destructive rule conversion, unrelated settings/dictionaries.
