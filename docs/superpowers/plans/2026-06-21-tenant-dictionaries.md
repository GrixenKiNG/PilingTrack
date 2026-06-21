# Tenant-Owned Dictionaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Создать независимые справочники каждой организации, безопасно перенести существующие связи и защитить исторические отчёты от изменения значения через rename/delete.

**Architecture:** Справочники получают обязательный `tenantId`; все API и queries используют tenant authenticated session. Неизменяемый TypeScript-каталог системных шаблонов копируется при создании tenant. Использованные значения только архивируются, а расчёт свайных метров переходит на `PileGrade.lengthMeters`.

**Tech Stack:** Next.js 16, TypeScript 6, Prisma 7/PostgreSQL, Zod 4, Vitest 4, Playwright.

## Global Constraints

- Справочники каждой организации независимы.
- Системные шаблоны используются только при первоначальном заполнении.
- Использованное значение нельзя переименовать или удалить.
- Cross-tenant lookup возвращает `404`.
- Метры свай считаются по `lengthMeters`, а не по regex имени.
- Миграция fail-closed при неоднозначной связи и проверяет контрольные количества.

---

## File Map

- `prisma/schema.prisma` — tenant-owned dictionaries и structured pile data.
- `prisma/migrations/20260621_tenant_dictionaries/migration.sql` — schema/data remap.
- `src/services/dictionaries/system-templates.ts` — неизменяемые первоначальные шаблоны.
- `src/services/dictionaries/tenant-dictionary-initializer.ts` — idempotent cloning.
- `src/services/dictionaries/dictionary-service.ts` — tenant-scoped registry rules.
- `src/services/tenancy/tenant-billing-service.ts` — transactionally initialize new tenant.
- `src/app/api/dictionary/all/route.ts` — operator feed.
- `src/app/api/dictionary/manage/route.ts` — admin registry.
- `src/lib/cached-queries.ts` — tenant cache key/invalidation.
- `src/components/piling/admin-dictionaries.tsx` — structured registry UI.
- `src/lib/pile-length.ts` — one normalized pile-meter calculation.
- report/dashboard/fleet query files — consume `lengthMeters`.

### Task 1: Schema and relational contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260621_tenant_dictionaries/migration.sql`
- Create: `tests/integration/tenant-dictionaries-schema.spec.ts`

**Interfaces:**
- Produces: `PileGrade.tenantId`, `code`, `lengthMeters`, `sectionOrDiameter`, `notes`.
- Produces: `DrillingType.tenantId`, `DowntimeReason.tenantId`.
- Produces: unique tenant/name indexes and Tenant relations.

- [ ] **Step 1: Write failing schema assertions**

Read `schema.prisma` and assert every dictionary model contains `tenantId String`, `tenant Tenant`, `@@index([tenantId])`, and a tenant-scoped unique constraint. Assert `PileGrade` contains `lengthMeters Float`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/integration/tenant-dictionaries-schema.spec.ts`

Expected: FAIL because dictionary models are global.

- [ ] **Step 3: Add Prisma fields**

Use:

```prisma
tenantId          String
tenant            Tenant @relation(fields: [tenantId], references: [id], onDelete: Cascade)
normalizedName    String
@@unique([tenantId, normalizedName])
@@index([tenantId, isActive])
```

For `PileGrade` additionally:

```prisma
code              String
lengthMeters      Float
sectionOrDiameter String?
notes             String @default("")
```

Add arrays to `Tenant`: `pileGrades`, `drillingTypes`, `downtimeReasons`.

- [ ] **Step 4: Add expand-only migration stage**

The first SQL section adds nullable tenant/structured columns and indexes without dropping old constraints. Data remap is completed in Task 2 before `SET NOT NULL`.

- [ ] **Step 5: Verify GREEN**

Run: `npm run db:generate`

Run: `npx vitest run tests/integration/tenant-dictionaries-schema.spec.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma tests/integration/tenant-dictionaries-schema.spec.ts
git commit -m "feat(dictionaries): add tenant-owned schema"
```

### Task 2: Safe existing-data remap

**Files:**
- Modify: `prisma/migrations/20260621_tenant_dictionaries/migration.sql`
- Create: `scripts/verify-tenant-dictionary-migration.ts`
- Create: `tests/integration/tenant-dictionary-migration.spec.ts`

**Interfaces:**
- Produces: every existing dictionary FK points to a dictionary row owned by the report/site tenant.

- [ ] **Step 1: Write failing real-Postgres migration test**

Seed two tenants sharing old global dictionary ids, reports for both and a `SitePilePlan`. Apply migration, then assert separate dictionary ids per tenant, identical labels/lengths, preserved FK counts and no null tenant.

- [ ] **Step 2: Verify RED**

Run against disposable PostgreSQL: `npx vitest run tests/integration/tenant-dictionary-migration.spec.ts`

Expected: FAIL before remap SQL exists.

- [ ] **Step 3: Implement transactional remap SQL**

Create tenant copies with a temporary mapping table keyed by `(old_id, tenant_id)`. Resolve tenant through `Report.tenantId` for work rows and `Site.tenantId` for plans. Abort with `RAISE EXCEPTION` when tenant is null or conflicting.

Populate `lengthMeters` in this priority:

1. unique non-zero `SitePilePlan.metersPerPile` for the tenant/grade;
2. unambiguous existing grade parser result;
3. abort and print the grade id/name for manual correction.

Update all four FK tables, compare counts, then set columns NOT NULL and remove obsolete global rows.

- [ ] **Step 4: Add read-only verification script**

Report null tenants, cross-tenant FK mismatches, duplicates and total links. Exit non-zero on any mismatch.

- [ ] **Step 5: Verify GREEN**

Run migration test and `npx tsx scripts/verify-tenant-dictionary-migration.ts` on disposable DB.

Expected: PASS and zero mismatches.

- [ ] **Step 6: Commit**

```bash
git add prisma/migrations/20260621_tenant_dictionaries scripts/verify-tenant-dictionary-migration.ts tests/integration/tenant-dictionary-migration.spec.ts
git commit -m "feat(dictionaries): migrate dictionaries per tenant"
```

### Task 3: System templates and tenant initialization

**Files:**
- Create: `src/services/dictionaries/system-templates.ts`
- Create: `src/services/dictionaries/tenant-dictionary-initializer.ts`
- Create: `src/services/dictionaries/__tests__/tenant-dictionary-initializer.test.ts`
- Modify: `src/services/tenancy/tenant-billing-service.ts`
- Modify: `src/services/tenancy/__tests__/tenant-billing-service.test.ts`

**Interfaces:**
- Produces: `initializeTenantDictionaries(tx: Prisma.TransactionClient, tenantId: string): Promise<void>`.

- [ ] **Step 1: Write failing idempotency tests**

Assert initializer uses `createMany({ skipDuplicates: true })`, assigns the provided tenant and creates all three kinds. Assert `createTenant` invokes initializer in the same `$transaction` callback.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/services/dictionaries/__tests__/tenant-dictionary-initializer.test.ts src/services/tenancy/__tests__/tenant-billing-service.test.ts`

Expected: FAIL because initializer does not exist.

- [ ] **Step 3: Implement immutable template constants**

Export readonly arrays with explicit code/length for pile grades and names for drilling/downtime. Do not query these templates from report APIs.

- [ ] **Step 4: Implement transaction-bound initialization**

Normalize every name and create tenant-owned rows with `skipDuplicates`. Refactor `createTenant` to one Prisma transaction that creates tenant then initializes dictionaries.

- [ ] **Step 5: Verify GREEN and commit**

Run focused tests; expected PASS.

```bash
git add src/services/dictionaries src/services/tenancy
git commit -m "feat(tenancy): initialize tenant dictionaries from templates"
```

### Task 4: Tenant-scoped dictionary service and immutability

**Files:**
- Modify: `src/services/dictionaries/dictionary-service.ts`
- Modify: `src/services/dictionaries/__tests__/dictionary-service.test.ts`

**Interfaces:**
- Produces: all service functions accept `tenantId` first.
- Produces: `normalizeDictionaryName(name: string): string`.
- Produces: `DictionaryUsageConflict` response details through `ServiceError` metadata or message-safe DTO.

- [ ] **Step 1: Write failing tests**

Cover tenant-scoped find/update/delete, same normalized name conflict, rename-used `409`, delete-used `409`, archive-used success and cross-tenant `404`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts`

Expected: FAIL because current functions are global and rename ignores usage.

- [ ] **Step 3: Implement tenant-first signatures**

Every lookup uses `{ id, tenantId }`; every create writes tenant and normalized name. Before rename/delete call `getItemUsage(tenantId, type, id)`. Rename throws `409` when total usage is non-zero; archive never changes historical relations.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/services/dictionaries/__tests__/dictionary-service.test.ts
git add src/services/dictionaries
git commit -m "fix(dictionaries): enforce tenant scope and immutable usage"
```

### Task 5: Audit and tenant-aware cache invalidation

**Files:**
- Modify: `src/services/dictionaries/dictionary-service.ts`
- Modify: `src/lib/cached-queries.ts`
- Modify: `src/core/cache/response-cache.ts` only if current tenant scope cannot invalidate the needed key.
- Test: `src/services/dictionaries/__tests__/dictionary-service.test.ts`
- Test: `src/lib/__tests__/cached-queries.test.ts`

**Interfaces:**
- Produces: `getCachedAllDictionaries(tenantId: string)`.
- Produces: `invalidateDictionaries(tenantId: string)`.

- [ ] **Step 1: Write failing audit/cache tests**

Assert cache keys equal `dictionary:all:<tenantId>`, invalidating tenant A does not delete tenant B, and each mutation records action, actor, target, tenant and before/after metadata.

- [ ] **Step 2: Verify RED**

Run focused service/cache tests; expected FAIL because key is global and mutations do not audit.

- [ ] **Step 3: Implement scoped cache and audit**

Mutation context is `{ tenantId, actorId }`. After DB success call `recordAuditEvent` and both data/response cache invalidation for that tenant. Never invalidate before a successful transaction.

- [ ] **Step 4: Verify GREEN and commit**

```bash
git add src/services/dictionaries/dictionary-service.ts src/lib/cached-queries.ts src/core/cache/response-cache.ts
git commit -m "feat(dictionaries): audit changes and invalidate tenant cache"
```

### Task 6: Dictionary APIs

**Files:**
- Modify: `src/app/api/dictionary/all/route.ts`
- Modify: `src/app/api/dictionary/manage/route.ts`
- Modify: `src/app/api/dictionary/manage/__tests__/route.test.ts`
- Create: `src/app/api/dictionary/all/__tests__/route.test.ts`

**Interfaces:**
- Consumes: tenant-first dictionary services and cache functions.
- Produces: tenant-safe operator/admin APIs.

- [ ] **Step 1: Write failing route tests**

Assert authenticated tenant is passed to every operation; null tenant returns 400; body/header tenant is ignored; cross-tenant service miss remains 404; used rename/delete remains 409.

- [ ] **Step 2: Verify RED**

Run focused API tests; expected FAIL.

- [ ] **Step 3: Implement authenticated tenant propagation**

Read only `user!.tenantId`, fail when absent, pass `{ tenantId, actorId: user!.id }` to mutations. Extend pile-grade schemas with `code`, positive `lengthMeters`, optional section and notes.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/app/api/dictionary
git add src/app/api/dictionary
git commit -m "fix(dictionaries): bind APIs to authenticated tenant"
```

### Task 7: Replace name-derived pile length

**Files:**
- Create: `src/lib/pile-length.ts`
- Create: `src/lib/__tests__/pile-length.test.ts`
- Modify: `src/modules/monitoring/application/queries/fleet-monitoring.service.ts`
- Modify: `src/modules/reports/application/queries/report-query.service.ts`
- Modify: `src/app/api/reports/period/route.ts`
- Modify: `src/components/piling/admin-reports/report-totals.ts`
- Modify related tests in the same directories.

**Interfaces:**
- Produces: `calculatePileMeters(rows: Array<{ count: number; pileGrade: { lengthMeters: number } | null }>): number`.

- [ ] **Step 1: Write failing invariant tests**

Assert a grade name can change without changing meters; missing/non-positive length produces explicit data error rather than `0`; dashboard/report/fleet totals match for the same fixture.

- [ ] **Step 2: Verify RED**

Run related report/fleet tests; expected FAIL because current code parses names.

- [ ] **Step 3: Implement shared calculation and select lengthMeters**

Replace every regex/name fallback in production KPI paths with structured length. Keep a migration-only parser outside runtime code.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/lib/__tests__/pile-length.test.ts src/modules/monitoring src/modules/reports src/app/api/reports/period src/components/piling/admin-reports
git add src/lib/pile-length.ts src/modules/monitoring src/modules/reports src/app/api/reports/period src/components/piling/admin-reports
git commit -m "fix(analytics): calculate pile meters from structured length"
```

### Task 8: Dictionary registry UI

**Files:**
- Modify: `src/components/piling/admin-dictionaries.tsx`
- Create: `src/components/piling/admin-dictionaries/dictionary-table.tsx`
- Create: `src/components/piling/admin-dictionaries/dictionary-form.tsx`
- Create: `src/components/piling/admin-dictionaries/__tests__/admin-dictionaries.test.tsx`

**Interfaces:**
- Produces: structured pile-grade form and conflict action `archive-and-copy`.

- [ ] **Step 1: Write failing UI tests**

Assert pile form requires positive length; usage columns show reports and plans separately; used row disables rename/delete but enables archive-and-copy; API error state shows retry.

- [ ] **Step 2: Verify RED**

Run component test; expected FAIL.

- [ ] **Step 3: Implement compact registry**

Keep three tabs and existing visual language. Split oversized component, use semantic buttons with tooltips, preserve desktop density and mobile row readability. Surface server `409` text rather than generic save failure.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npx vitest run src/components/piling/admin-dictionaries
git add src/components/piling/admin-dictionaries.tsx src/components/piling/admin-dictionaries
git commit -m "feat(dictionaries): build tenant registry workflow"
```

### Task 9: Release verification

**Files:**
- Create: `e2e/admin-dictionaries.spec.ts`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add isolated browser scenarios**

Verify tenant-specific lists, create/archive/restore, used rename denial, archive-and-copy and mobile layout. Fixtures must create two tenants in CI and assert their values do not cross.

- [ ] **Step 2: Run complete verification**

```bash
npm run db:check-migrations
npm run postgres:check-rules
npm run lint
npm run test:unit
npm run test:contract
npm run test:integration
npm run build
npx playwright test e2e/admin-users.spec.ts e2e/admin-dictionaries.spec.ts --project=chromium --workers=1
```

Expected: all gates PASS; migration verifier reports zero mismatches.

- [ ] **Step 3: Run GitNexus change detection**

Run `detect_changes({ scope: "compare", base_ref: "chore/april-accumulated-work" })`; review every affected auth/report/fleet process before release.

- [ ] **Step 4: Commit**

```bash
git add e2e/admin-dictionaries.spec.ts .github/workflows/ci.yml
git commit -m "test(dictionaries): cover tenant registry end to end"
```
