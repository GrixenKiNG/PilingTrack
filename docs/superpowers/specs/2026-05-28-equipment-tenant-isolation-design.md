# Equipment Tenant Isolation — Design Spec

**Date:** 2026-05-28
**Status:** Approved
**Motivation:** Security review identified IDOR on `Equipment` — no `tenantId` column, no RLS, all queries unscoped. Must be fixed before a second tenant is onboarded.

---

## Scope

Fix tenant isolation for three models: `Equipment`, `EquipmentDocument`, `MaintenanceRecord`.
`EquipmentDocument` and `MaintenanceRecord` already have `tenantId` columns — they only need RLS.
`Equipment` needs both the column and RLS.

Out of scope: `TelematicsDevice`, `DeviceKey` (separate migration tracks), billing, registration.

---

## 1. Database Migration

One migration file: `20260528_equipment_tenant_isolation`

```sql
-- Step 1: add tenantId with default so existing rows get backfilled
ALTER TABLE "Equipment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'orion';
ALTER TABLE "Equipment" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "Equipment_tenantId_idx" ON "Equipment"("tenantId");

-- Step 2: RLS for Equipment (same audit-mode pattern as extend_rls_tenant_scoped)
ALTER TABLE "Equipment" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_equipment ON "Equipment"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

-- Step 3: RLS for EquipmentDocument (tenantId column already exists)
ALTER TABLE "EquipmentDocument" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_equipmentdocument ON "EquipmentDocument"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );

-- Step 4: RLS for MaintenanceRecord (tenantId column already exists)
ALTER TABLE "MaintenanceRecord" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_maintenancerecord ON "MaintenanceRecord"
  FOR ALL
  USING (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  )
  WITH CHECK (
    current_setting('app.current_tenant', true) IS NULL
    OR current_setting('app.current_tenant', true) = ''
    OR "tenantId" IS NULL
    OR "tenantId" = current_setting('app.current_tenant', true)
  );
```

**Safe on prod:** `ADD COLUMN ... DEFAULT` on PostgreSQL 11+ is instant (no table rewrite for NOT NULL + constant default). The backfill of 'orion' is one scan, no downtime risk.

---

## 2. Prisma Schema

In `prisma/schema.prisma`, model `Equipment`:

```prisma
model Equipment {
  id        String @id @default(cuid())
  tenantId  String                        // добавить — без FK, как у Report
  ...
  @@index([tenantId])                     // добавить
  @@index([isActive])
  ...
}
```

No foreign key constraint — same convention as `Report.tenantId`, `Site.tenantId`, etc.

---

## 3. Query Service (`equipment-query.service.ts`)

All read functions gain a `tenantId: string` parameter and add it to `where`.

| Function | Change |
|---|---|
| `getAccessibleEquipment(tenantId)` | `where: { isActive: true, tenantId }` |
| `getEquipmentById(id, tenantId)` | `where: { id, tenantId }` |
| `getEquipmentByIdOrThrow(id, tenantId)` | `where: { id, tenantId }` |
| `listEquipmentWithCrewCounts(tenantId)` | `where: { tenantId }` in `findMany` |
| `getEquipmentDetails(equipmentId, tenantId)` | `where: { id: equipmentId, tenantId }` |
| `listEquipmentCatalog(tenantId)` | `where: { tenantId }` |
| `listMaintenance(equipmentId, tenantId)` | `where: { equipmentId, tenantId }` |
| `listAllEquipment(pagination, siteId, operatorUserId, tenantId)` | `where: { ...existing, tenantId }` |

---

## 4. Equipment Commands

### Aggregate layer (`equipment.aggregate.ts`, `equipment.prisma.mapper.ts`, `equipment.command.ts`)

`createEquipment` goes through `EquipmentAggregate` → `PrismaEquipmentRepository.save()` → upsert.
`tenantId` must be threaded through the whole chain:

- `CreateEquipmentCommand` — add `tenantId: string`
- `EquipmentInfo` interface — add `tenantId: string`
- `EquipmentCreateData` interface — add `tenantId: string`
- `EquipmentAggregate.create()` — accept `tenantId` and store it in state
- `EquipmentAggregate.toPersistence()` — include `tenantId` in returned object
- `toPrismaData(agg)` mapper — include `tenantId` in the returned object (used for `create` in upsert)
- `fromPrismaToState(p)` mapper — map `p.tenantId` to state

For `updateEquipment`: the route calls `updateEquipment(id, ...)` followed by `getEquipmentByIdOrThrow(id, tenantId)`. Since the update runs before the tenant-scoped read, add `tenantId` to `UpdateEquipmentCommand` and check it in `PrismaEquipmentRepository.findById(id, tenantId)` — return null if tenantId doesn't match.

For `deleteEquipment`: add `tenantId` parameter to `deleteEquipment(equipmentId, tenantId)` and include it in the `findUnique` lookup.

### `equipment-document.ts`

- `createEquipmentDocument`: existence check becomes `db.equipment.findUnique({ where: { id: equipmentId, tenantId } })`
- `updateEquipmentDocument(equipmentId, documentId, input, ctx: { tenantId })`: verify `doc.equipmentId === equipmentId` and `doc.tenantId === ctx.tenantId`
- `deleteEquipmentDocument(equipmentId, documentId, ctx: { tenantId })`: same guard

### `equipment-maintenance.ts`

- `createMaintenance`: existence check becomes `where: { id: equipmentId, tenantId: ctx.tenantId }`
- `updateMaintenance(equipmentId, recordId, input, ctx: { tenantId })`: guard on `existing.tenantId === ctx.tenantId`
- `deleteMaintenance(equipmentId, recordId, ctx: { tenantId })`: same guard

---

## 5. Route Handlers

Pattern: resolve `tenantId` from user, pass to service calls.

```ts
const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
```

Affected routes:
- `GET/PUT/DELETE /api/equipment/[id]/route.ts`
- `GET/POST /api/equipment/route.ts`
- `POST /api/equipment/[id]/documents/route.ts` — already has this pattern, just update command call
- `PUT/DELETE /api/equipment/[id]/documents/[docId]/route.ts`
- `GET/POST /api/equipment/[id]/maintenance/route.ts`
- `PUT/DELETE /api/equipment/[id]/maintenance/[recordId]/route.ts`

---

## 6. What Is Not Changed

- `equipment-metadata.ts` — only updates fields on a known Equipment id; after query service is scoped, the upstream `getEquipmentByIdOrThrow` already enforces tenant
- `TelematicsDevice`, `DeviceKey` — separate migration tracks, out of scope
- `fleet-monitoring.service.ts` — uses Equipment.id only for joining, inherits tenant from session context; can be scoped in a follow-up

---

## Success Criteria

1. `prisma migrate deploy` runs cleanly on prod with no downtime
2. `db.equipment.findUnique({ where: { id: '<other-tenant-id>' } })` from a different tenant context returns null (or is blocked by RLS)
3. All existing equipment operations (CRUD, documents, maintenance) work for the single `orion` tenant
4. No TypeScript errors — all callers of query/command functions pass `tenantId`
