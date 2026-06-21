# Tenant-Owned Dictionaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

> ## ⚠️ Revision 2026-06-21 (council review — read before executing)
>
> This plan was written **before** the pile-length integrity fix shipped on `chore/project-skills`. Reconcile before running any task:
>
> 1. **Pile length is already done, differently.** Production code now uses `PileGrade.lengthMm Int?` (nullable, millimetres) with a single resolver `pileLengthMeters` in `src/lib/pile-length.ts`, applied in all seven KPI paths. **Do NOT introduce `lengthMeters Float`** — that would create a second, conflicting source. Tasks 1 & 7 below are rewritten/retired accordingly.
> 2. **Decision (2026-06-21): pile length comes from the grade everywhere.** `SitePilePlan.metersPerUnit` is a *planning* figure and is **not** a length source — local data proved it unreliable (a plan of 123 m/pile for a 12 m grade). The only remaining code step is to drop the plan-as-length override still living in the period summary + PDF and compute from `lengthMm` there too (see **Task 7'**). After that, simplify `pileLengthMeters` to take only `gradeLengthMm`.
> 3. **Column name bug:** the schema column is `SitePilePlan.metersPerUnit`, not `metersPerPile` (Task 2 step 3). And **never seed grade length from the plan** — it imports the bad data. Seed from the name parser once (already done for existing grades) or from explicit template lengths for new tenants.
> 4. **Sequencing / product gate:** tenant-*owned* dictionaries is preparation for a **second tenant**. Today `MULTI_TENANT_MODE=single`, one tenant `orion`, so the tenant-ownership migration (Tasks 1–6) carries real prod-data-remap risk with **no current isolation payoff**. Per product direction it is legitimate roadmap work but should be **gated to when the second tenant is actually onboarded**, and bundled with the audit's tenant-isolation / RLS fail-closed work (`docs/qa-council/2026-06-21-release-audit.md` P1). Do not run the remap on single-tenant prod just to "get ahead".
> 5. **Testing:** the data remap (Task 2) MUST have a real-Postgres integration test (two tenants), not a mocked one — current integration tests mock the DB.
>
> **Recommended order:** do **Task 7'** (small, now) → defer Tasks 1–6 + 8–9 until second-tenant onboarding.

**Goal:** Создать независимые справочники каждой организации, безопасно перенести существующие связи и защитить исторические отчёты от изменения значения через rename/delete.

**Architecture:** Справочники получают обязательный `tenantId`; все API и queries используют tenant authenticated session. Неизменяемый TypeScript-каталог системных шаблонов копируется при создании tenant. Использованные значения только архивируются. Расчёт свайных метров **уже** переведён на `PileGrade.lengthMm` (мм, nullable) через `pileLengthMeters` — см. Revision выше; `lengthMeters Float` из исходного плана не вводить.

**Tech Stack:** Next.js 16, TypeScript 6, Prisma 7/PostgreSQL, Zod 4, Vitest 4, Playwright.

## Global Constraints

- Справочники каждой организации независимы.
- Системные шаблоны используются только при первоначальном заполнении.
- Использованное значение нельзя переименовать или удалить.
- Cross-tenant lookup возвращает `404`.
- Метры свай считаются по `PileGrade.lengthMm` (мм), а не по regex имени и не по плану. (Done; остаётся Task 7'.)
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
- `src/lib/pile-length.ts` — one normalized pile-meter calculation (shipped: `pileLengthMeters`).
- report/dashboard/fleet query files — consume `PileGrade.lengthMm`.

### Task 1: Schema and relational contract

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260621_tenant_dictionaries/migration.sql`
- Create: `tests/integration/tenant-dictionaries-schema.spec.ts`

**Interfaces:**
- Produces: `PileGrade.tenantId`, `code`, `sectionOrDiameter`, `notes`. (`lengthMm` already exists — do not add `lengthMeters`.)
- Produces: `DrillingType.tenantId`, `DowntimeReason.tenantId`.
- Produces: unique tenant/name indexes and Tenant relations.

- [ ] **Step 1: Write failing schema assertions**

Read `schema.prisma` and assert every dictionary model contains `tenantId String`, `tenant Tenant`, `@@index([tenantId])`, and a tenant-scoped unique constraint. (Length is already covered by the existing `PileGrade.lengthMm Int?` — do not assert `lengthMeters`.)

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

For `PileGrade` additionally (note: `lengthMm Int?` already exists — do not re-add length):

```prisma
code              String
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

**Length:** `PileGrade.lengthMm` already exists and is backfilled for the current (single) tenant. Carry it over to each per-tenant copy as-is. Do **NOT** seed length from `SitePilePlan` — its `metersPerUnit` (note: the column is `metersPerUnit`, not `metersPerPile`) contains bad data (e.g. 123 m/pile) and is not a length source. For grades that still have `lengthMm = NULL`, leave NULL (= 0 m, surfaced for admin correction) rather than guessing.

Update all four FK tables, compare counts, then set tenant columns NOT NULL and remove obsolete global rows.

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

### Task 7: Replace name-derived pile length — ✅ DONE (2026-06-21, branch `chore/project-skills`)

Shipped already, differently from the original draft:
- `PileGrade.lengthMm Int?` + migration `20260621010000_pile_grade_length_mm` with behaviour-preserving backfill.
- Single resolver `pileLengthMeters({ planMetersPerUnit?, gradeLengthMm? })` in `src/lib/pile-length.ts` + `lengthMmFromGradeName` (seed-only).
- All seven KPI paths converted (fleet, report-query, equipment-query, report-totals, period route, single-pdf, period-pdf).
- Tests: `src/lib/__tests__/pile-length.test.ts`, `src/lib/__tests__/pile-meters-invariant.test.ts`, plus updated report-totals / period-summary / fleet fixtures. Admin can edit length per grade in `admin-dictionaries.tsx`.

The original interface name `calculatePileMeters(... lengthMeters ...)` does **not** exist — use `pileLengthMeters(... gradeLengthMm ...)`.

### Task 7': Make pile length come from the grade everywhere — ✅ DONE (2026-06-21)

**Decision 2026-06-21:** plan is not a length source; `lengthMm` is authoritative on every screen. Shipped:
- `pileLengthMeters` simplified to `{ gradeLengthMm }` only (plan branch removed).
- `computePeriodSummary` lost its `plans` param + `PilePlanInput`; period route no longer queries `SitePilePlan`.
- single-pdf / period-pdf compute from `lengthMm` only.
- Data fix migration `20260621020000_fix_site_pile_plan_meters` aligned the 3 bad `metersPerUnit` rows to grade length first.
- Tests updated (period-summary, period route, pile-meters-invariant, pile-length, pdf-generator); full gate green (1145 unit, lint, migrations).
- ⚠️ Deploy: TWO new migrations now (`20260621010000` + `20260621020000`) → `docker compose build migrate app workers`.

**Files:**
- Modify: `src/lib/pile-length.ts` — drop the `planMetersPerUnit` branch; `pileLengthMeters` takes only `{ gradeLengthMm }`.
- Modify: `src/app/api/reports/period/route.ts` — remove the `SitePilePlan` load + `plans` param from `computePeriodSummary`; compute from `lengthMm` only.
- Modify: `src/lib/pdf-generator/single-pdf.ts`, `src/lib/pdf-generator/period-pdf.ts` — drop the `metersPerUnit` override; use `lengthMm` only.
- Modify tests: `src/app/api/reports/period/__tests__/period-summary.test.ts` (remove the plan-override assertions), `src/lib/__tests__/pile-meters-invariant.test.ts` (drop the plan-override case), `src/lib/__tests__/pdf-generator.test.ts` (give fixtures `pileGrade.lengthMm` instead of `metersPerUnit`).

- [ ] **Step 1:** Update the invariant test so period/PDF/report/fleet all read `lengthMm` and agree; no plan override anywhere.
- [ ] **Step 2: RED** — `npx vitest run src/app/api/reports/period src/lib/__tests__/pile-meters-invariant.test.ts src/lib/__tests__/pdf-generator.test.ts`.
- [ ] **Step 3:** Simplify resolver + remove plan loading; keep `SitePilePlan` only for planning/count, never length.
- [ ] **Step 4: GREEN + full gate** — `npm run lint && npm run test:unit`.
- [ ] **Step 5:** Note for deploy — this **changes displayed period/PDF м.п.** for sites whose plan differed from the grade length (3 grades in current data, incl. the bogus 123 m). Communicate before deploying.

> Note: the 3 bad `SitePilePlan.metersPerUnit` rows (123 vs 12, 12 vs 11, 15 vs 10) become irrelevant to KPI once length stops reading the plan, but should still be cleaned for planning accuracy.

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
