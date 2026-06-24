# Simplicity First Audit — Karpathy Principles Applied

**Principle:** "Minimum code that solves the problem. Nothing speculative."

This audit identifies code that violates the Simplicity First principle and proposes concrete simplifications.

---

## Top 5 Overcomplications

### 1. ⚠️ QUICK WIN: Unused API Wrapper Options

**File:** `src/core/api-wrapper.ts:7-11, 82-84`

**Issue:**
```typescript
export interface ApiWrapperOptions {
  domain?: string;    // only used in error log (1 place)
  cache?: boolean;    // NEVER USED
  cacheTTL?: number;  // NEVER USED
}
```

All routes pass `domain` but it's only logged. `cache` and `cacheTTL` are ghost code.

**Fix (5 minutes):**
- Keep `domain` (it's cheap, provides context in logs)
- Delete `cache` and `cacheTTL` — nothing uses them
- Remove unused config from 30 route calls

**Effort:** ~5 lines changed per route × 6 routes = ~30 lines saved

---

### 2. ⚠️ MEDIUM: Conflict Resolution Over-Abstraction

**File:** `src/core/conflict-resolution/conflict-resolution-engine.ts:250-400+`

**Issue:** 4 strategy classes (`LastWriteWinsStrategy`, `ServerWinsStrategy`, `FieldMergeStrategy`, `VectorClockMergeStrategy`) with identical merge patterns. Comments say "v2 — Production-grade" — redone strategy pattern.

**Current code (100+ lines):**
```typescript
interface MergeStrategy {
  merge(serverData, clientData, baseVersion): Result
}
class ServerWinsStrategy implements MergeStrategy { /* 40 lines */ }
class FieldMergeStrategy implements MergeStrategy { /* 50 lines */ }
// ... repeat for 4 total strategies
```

**Fix:** Simplify to 2 strategies max OR use a dispatcher function

```typescript
function resolveConflict(strategy: 'server_wins' | 'field_merge', server, client, baseV) {
  if (strategy === 'server_wins') return server;
  return mergeByField(server, client);  // ~20 lines for both cases
}
```

**Effort:** Consolidate ~200 lines to ~50

---

### 3. ⚠️ LARGE: Massive Component Over-Nesting

**File:** `src/components/piling/admin-sites/site-editor.tsx:1-643`

**Issue:** Single 643-line file with:
- 6 dialog components (CreateSiteDialog, EditSiteDialog, DeleteSiteDialog, AddHierarchyDialog, etc.)
- Repeated state logic for piles/drillings (lines 108-140 duplicated 4 times)
- Shared form state management (30+ useState calls)

**Current smell:** One component doing the work of 6.

**Fix:**
```
Before:
site-editor.tsx (643 lines)

After:
site-editor.tsx (200 lines) — main layout + routing
dialogs/
  create-site-dialog.tsx (80 lines)
  edit-site-dialog.tsx (100 lines)
  delete-site-dialog.tsx (40 lines)
  add-hierarchy-dialog.tsx (60 lines)
hooks/
  use-plan-row.ts (30 lines) — shared pile/drilling state
```

**Effort:** 6-8 hours refactoring, but makes future edits 3x faster

---

### 4. ⚠️ QUICK WIN: Speculative Future Features

**File:** `src/app/api/telemetry/ingest/route.ts:90-99`

**Issue:** 93 lines of commented-out JWT authentication code with multi-line TODO:
```typescript
// JWT token authentication (future feature)
// TODO: Implement JWT verification for device tokens
// This would support JWT tokens issued for IoT devices.
// Implementation steps:
// 1. Extract JWT from Authorization header
// ... 6 more commented lines ...
// For now, JWT auth is not supported
```

Also ~50 lines about "MQTT broker integration" that will never be built.

**Fix:** Delete it. If needed later, add it back (git history is forever).

**Effort:** Delete ~100 lines

---

### 5. 🔴 COMPLEX: Over-parameterized Hook

**File:** `src/components/piling/report-form/use-report-form.ts:17-56`

**Issue:** Single hook returns 30+ properties/methods:
```typescript
export interface UseReportFormReturn {
  reportId, date, setDate,
  shiftStart, setShiftStart,
  shiftEnd, setShiftEnd,
  equipmentId, setEquipmentId,
  // ... 14 more fields ...
  addPile, removePile,
  addDrilling, removeDrilling,
  addDowntime, removeDowntime,
  // ... 4 lookup functions ...
}
```

**Problem:** Hook is doing 5 things at once. Hard to test. Hard to reuse.

**Fix:** Split into focused hooks:
```typescript
const basics = useReportBasics(reportId);      // date, shift, equipment
const piles = useReportPiles(reportId);         // add/remove pile logic
const drillings = useReportDrillings(reportId); // add/remove drilling
const downtimes = useReportDowntimes(reportId); // add/remove downtime
```

Each hook ~20-30 lines, testable independently.

**Effort:** 4-6 hours refactoring, but hook becomes 4x more reusable

---

## Summary of Simplifications

| Issue | Type | Effort | Impact |
|-------|------|--------|--------|
| Remove unused API options | Quick | 15 min | Remove ghost code |
| Consolidate conflict strategies | Medium | 2 hrs | -150 LOC, easier to maintain |
| Split site-editor component | Large | 8 hrs | Better testability, faster edits |
| Delete speculative code | Quick | 10 min | -100 LOC, clarity |
| Split report form hook | Medium | 4 hrs | -30 LOC, 4x more reusable |

---

## How This Aligns with Karpathy Principles

✅ **Simplicity First:** Remove features nobody asked for (future JWT, MQTT)  
✅ **Surgical Changes:** Fix component-split in isolation, no other refactoring  
✅ **Goal-Driven:** Each simplification has clear success criteria (tests pass before & after)  
✅ **Think Before Coding:** Understand why complexity was added, whether it's needed now  

---

## Next Steps

1. **Start with Quick Wins** (15-30 min)
   - Remove unused `cache`, `cacheTTL` from `ApiWrapperOptions`
   - Delete commented future-code in telemetry/

2. **Move to Medium Complexity** (2-4 hrs each)
   - Consolidate conflict strategies OR split report form hook (your choice)

3. **Leave Large Refactors** for dedicated sprint
   - Component splitting (site-editor) is valuable but time-consuming

---

**Date:** 2026-04-17  
**Audit Tool:** Karpathy Simplicity First Principle  
**Success Metric:** Code that's easier to read, test, and change
