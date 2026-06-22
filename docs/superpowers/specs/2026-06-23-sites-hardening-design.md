# Objects Module Hardening Design

## Goal

Make the PilingTrack `Объекты` module safe for tenant-scoped production use and remove the confirmed data-loss and contract defects without performing a risky legacy-data migration.

## Scope

The change covers only the `Объекты` module:

- tenant-scoped reads and mutations;
- tenant-safe user assignments and hierarchy operations;
- correct hierarchy deletion contract;
- explicit deactivate/reactivate semantics;
- lossless partial plan updates;
- consistent plan totals;
- edit-form protection when plan loading fails;
- regression tests for every corrected behavior.

The change does not make `Site.tenantId` non-null and does not add database RLS. Existing null-tenant rows need a separately approved backfill because assigning them to a tenant without verified ownership could expose data.

## Security Boundary

`ADMIN` and `DISPATCHER` are tenant-scoped roles. Every site read or mutation must receive the authenticated tenant ID and fail closed when it is missing. Access to a site is valid only when `site.tenantId === tenantId`.

Creating a site always writes the authenticated tenant ID. Assigning a user requires both the user and site to belong to that tenant. Creating or deleting hierarchy nodes requires resolving the complete parent chain and proving it belongs to the route site and tenant.

Null-tenant legacy sites are not visible or mutable through tenant-scoped admin APIs.

## Application Architecture

Site application services accept an explicit context:

```ts
interface SiteCommandContext {
  tenantId: string;
  actorId: string;
}
```

Read services scope privileged lists by `tenantId`; operator access continues to require an explicit `UserSiteAssignment`. Mutation routes derive context exclusively from `requireAuth`; request bodies cannot select a tenant.

Existing aggregate/repository writes receive tenant-aware lookup methods. Plan and hierarchy commands may continue using Prisma directly where that is already the established path, but all lookup predicates and nested writes must enforce the same tenant invariant.

## Plans

Plan updates distinguish an omitted collection from an explicitly empty collection:

- omitted `pilePlans` preserves existing pile plans;
- `pilePlans: []` clears pile plans;
- omitted `drillingPlans` preserves existing drilling plans;
- `drillingPlans: []` clears drilling plans.

Whenever a plan collection is supplied, its aggregate total is calculated from that collection. Clients cannot submit a conflicting aggregate total for the same supplied collection. `pileGradeId` must resolve to a grade owned by the same tenant.

The entire site-and-plan mutation remains transactional.

## Lifecycle Semantics

The destructive UI action is renamed to `Деактивировать`. It performs the existing guarded soft deactivation and does not claim to delete reports or data permanently.

Inactive sites remain available to administrators through an explicit inactive filter and can be reactivated through a dedicated mutation. Reactivation must be tenant-scoped and audited.

No hard-delete endpoint is added.

## Hierarchy Contract

The delete request uses one canonical shape:

```json
{ "type": "field|cluster|picket", "itemId": "..." }
```

The route site ID is mandatory authorization context. The service confirms:

- field belongs directly to the route site;
- cluster belongs to a field of the route site;
- picket belongs to a cluster and field of the route site;
- the route site belongs to the authenticated tenant.

Hierarchy deletions retain database referential protections. The UI requires confirmation before deletion and reports dependency conflicts clearly.

## Frontend Error Handling

The edit dialog has explicit loading, loaded, and error states for site details. It never initializes a failed request as empty plans. Save is disabled until the existing plans load successfully. The error state provides retry and cancel actions.

The list distinguishes deactivation from deletion and updates the local row rather than removing it permanently. Inactive rows can be filtered and reactivated.

## Audit and Cache

Create, update, deactivate, reactivate, assignment, and hierarchy mutations include the authenticated actor and tenant context in their audit metadata. Audit calls remain best-effort under the existing audit service contract; making audit storage transactional is outside this focused change.

Mutations invalidate both the custom site list cache and response-cache entries for site routes using the existing cache invalidation facilities where available.

## Testing Strategy

Tests are written before implementation and must demonstrate failure first. Required regression coverage:

- privileged site lists return only the authenticated tenant;
- create writes `tenantId` from auth context;
- cross-tenant update, deactivate, reactivate, assignment, hierarchy create, and hierarchy delete return not found/forbidden without mutation;
- hierarchy delete accepts the canonical request and resolves the route site chain;
- omitted plan collections are preserved while explicit empty collections are cleared;
- plan totals cannot diverge from supplied detail rows;
- foreign-tenant pile grades are rejected;
- failed detail loading cannot submit empty plans;
- deactivate/reactivate copy and local list behavior are consistent.

Focused Vitest suites run after each red-green cycle, followed by unit, contract/integration tests, build, `git diff --check`, and GitNexus `detect_changes`.

## Success Criteria

- No tenant-scoped role can read or mutate another tenant's sites, assignments, plans, or hierarchy through the affected APIs.
- A partial update never deletes an omitted plan category.
- A failed edit-detail request cannot overwrite plans.
- Hierarchy deletion works with one validated contract.
- Users see truthful deactivate/reactivate behavior.
- All focused and project verification commands pass.

