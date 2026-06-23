# Sites Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Objects module tenant-safe and remove hierarchy, lifecycle, plan-loss, and edit-form defects.

**Architecture:** Authenticated routes derive a mandatory tenant context and pass it into tenant-aware site application services. Direct Prisma plan/hierarchy commands validate complete ownership chains, while the UI represents deactivate/reactivate honestly and refuses to save plans until detail data has loaded.

**Tech Stack:** Next.js route handlers, TypeScript, Prisma, React, Vitest, Testing Library.

## Global Constraints

- Do not change `Site.tenantId` to non-null and do not add RLS in this change.
- Preserve unrelated edits in `AGENTS.md` and `CLAUDE.md`.
- Write each regression test before its production change and observe the expected failure.
- Run GitNexus impact analysis before editing every existing symbol.

---

### Task 1: Tenant-scoped site reads and creation

**Files:**
- Modify: `src/modules/sites/application/queries/site-query.service.ts`
- Modify: `src/modules/sites/application/commands/site-admin-command.service.ts`
- Modify: `src/app/api/sites/route.ts`
- Modify: `src/app/api/sites/all/route.ts`
- Modify: `src/app/api/sites/create/route.ts`
- Test: `src/modules/sites/application/queries/__tests__/site-query.service.test.ts`
- Test: `src/modules/sites/application/commands/__tests__/site-admin-command.test.ts`
- Test: `src/app/api/sites/create/__tests__/route.test.ts`

**Interfaces:**
- `getAccessibleSites(sessionUser, tenantId, requestedUserId?, pagination?)`
- `listAllSitesForAdmin(tenantId, includeInactive?)`
- `createSiteWithPlans(input, { tenantId, actorId })`

- [ ] Write tests proving privileged reads include `tenantId` and creation persists it.
- [ ] Run focused tests and verify failures show missing tenant predicates/data.
- [ ] Add fail-closed tenant arguments to query and create services and routes.
- [ ] Run focused tests and verify they pass.

### Task 2: Tenant-safe mutations, assignments, and lifecycle

**Files:**
- Modify: `src/modules/sites/application/commands/site-command.service.ts`
- Modify: `src/modules/sites/application/commands/site-admin-command.service.ts`
- Modify: `src/modules/sites/infrastructure/site.repository.ts`
- Modify: `src/app/api/sites/[id]/route.ts`
- Modify: `src/app/api/sites/[id]/assign/route.ts`
- Test: `src/modules/sites/application/commands/__tests__/site-admin-command.test.ts`
- Test: `src/app/api/sites/[id]/assign/__tests__/route.test.ts`
- Create: `src/app/api/sites/[id]/__tests__/route.test.ts`

**Interfaces:**
- `updateSite(command, ctx: SiteCommandContext)`
- `deactivateSite(siteId, ctx)` and `activateSite(siteId, ctx)`
- `assignUserToSite(siteId, userId, ctx)` and `unassignUserFromSite(siteId, userId, ctx)`

- [ ] Write cross-tenant mutation/assignment tests and reactivation tests.
- [ ] Run them and verify expected tenant and lifecycle failures.
- [ ] Scope repository/service lookups to tenant, validate both assignment sides, and add PUT `isActive` lifecycle handling.
- [ ] Run focused tests and verify green.

### Task 3: Lossless, consistent plan updates

**Files:**
- Modify: `src/modules/sites/application/commands/site-admin-command.service.ts`
- Modify: `src/app/api/sites/[id]/route.ts`
- Test: `src/modules/sites/application/commands/__tests__/site-admin-command.test.ts`

**Interfaces:**
- `updateSiteWithPlans(siteId, input, ctx)` preserves omitted arrays and clears explicit empty arrays.
- Supplied plan arrays own their calculated aggregate totals.

- [ ] Write tests for omitted-vs-empty collections, calculated totals, foreign-tenant grades, and cross-tenant site IDs.
- [ ] Run focused tests and verify failures.
- [ ] Validate site/grade tenancy and mutate only supplied collections in one transaction.
- [ ] Run focused tests and verify green.

### Task 4: Canonical, tenant-safe hierarchy contract

**Files:**
- Modify: `src/lib/validation-schemas.ts`
- Modify: `src/modules/sites/application/commands/site-admin-command.service.ts`
- Modify: `src/app/api/sites/[id]/hierarchy/route.ts`
- Create: `src/app/api/sites/[id]/hierarchy/__tests__/route.test.ts`
- Test: `src/modules/sites/application/commands/__tests__/site-admin-command.test.ts`

**Interfaces:**
- Body: `{ type: 'field' | 'cluster' | 'picket', itemId: string }`
- `createSiteHierarchyItem(input, ctx)` and `deleteSiteHierarchyItem(siteId, type, itemId, ctx)` resolve ownership through the complete chain.

- [ ] Write failing contract and cross-tenant/route-parent tests.
- [ ] Run focused tests and verify failures.
- [ ] Correct the schema, route delegation, and ownership queries.
- [ ] Run focused tests and verify green.

### Task 5: Honest lifecycle UI and edit-load protection

**Files:**
- Modify: `src/components/piling/admin-sites/site-editor/edit-site-dialog.tsx`
- Modify: `src/components/piling/admin-sites/site-editor/delete-site-dialog.tsx`
- Modify: `src/components/piling/admin-sites/use-site-mutations.ts`
- Modify: `src/components/piling/admin-sites/index.tsx`
- Create: `src/components/piling/admin-sites/site-editor/__tests__/edit-site-dialog.test.tsx`

**Interfaces:**
- Edit dialog exposes loading/error/retry and disables save until detail is loaded.
- Deactivate keeps the row with inactive status; activate uses PUT `{ isActive: true }`.

- [ ] Write failing component tests for failed detail loading and disabled save.
- [ ] Run focused tests and verify failure.
- [ ] Add explicit detail state/retry and truthful deactivate/reactivate copy/state updates.
- [ ] Run focused tests and verify green.

### Task 6: Full verification and graph review

**Files:**
- Review all modified files.

- [ ] Run all focused site tests.
- [ ] Run `npm.cmd run test:unit`.
- [ ] Run `npm.cmd run test:contract` and `npm.cmd run test:integration`.
- [ ] Run `npm.cmd run build`.
- [ ] Run `git diff --check`.
- [ ] Run GitNexus `detect_changes({scope: 'compare', base_ref: 'chore/april-accumulated-work'})` and review affected flows.

