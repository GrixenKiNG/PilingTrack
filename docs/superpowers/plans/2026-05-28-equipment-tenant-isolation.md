# Equipment Tenant Isolation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `tenantId` to the `Equipment` model and scope all equipment queries, commands, and routes to the actor's tenant, closing an IDOR gap before multi-tenancy goes live.

**Architecture:** One Prisma migration adds `tenantId` to `Equipment` and RLS policies to three tables. `tenantId` is threaded from route handlers (resolved from `user.tenantId ?? DEFAULT_TENANT_ID`) down through the DDD layers: command interfaces → aggregate → mapper → repository → query service → Prisma `where` clauses.

**Tech Stack:** TypeScript, Prisma ORM, PostgreSQL RLS, Next.js API routes, Vitest.

---

## Files Modified

| File | Change |
|---|---|
| `prisma/migrations/<ts>_equipment_tenant_isolation/migration.sql` | CREATE — DB migration |
| `prisma/schema.prisma` | Add `tenantId String` + `@@index` to Equipment |
| `src/modules/equipment/domain/equipment.aggregate.ts` | Add `tenantId` to `EquipmentInfo`, `EquipmentCreateData`, `create()`, `toPersistence()` |
| `src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts` | Update tests — pass `tenantId` to `create()`, update `reconstitute` fixture |
| `src/modules/equipment/infrastructure/equipment.prisma.mapper.ts` | Include `tenantId` in `toPrismaData` and `fromPrismaToState` |
| `src/modules/equipment/infrastructure/equipment.repository.ts` | Add `tenantId` param to `findById` interface + implementation |
| `src/modules/equipment/application/commands/equipment.command.ts` | Add `tenantId: string` to `CreateEquipmentCommand` and `UpdateEquipmentCommand` |
| `src/modules/equipment/application/commands/equipment-command.service.ts` | Pass `tenantId` in `createEquipment`; add `tenantId` guard to `updateEquipment`, `retireEquipment`, `deleteEquipment` |
| `src/modules/equipment/application/queries/equipment-query.service.ts` | Add `tenantId: string` param to all 8 functions |
| `src/modules/equipment/application/commands/equipment-document.ts` | Add `tenantId` guard to existence checks in `create`, `update`, `delete` |
| `src/modules/equipment/application/commands/equipment-maintenance.ts` | Add `tenantId` guard to existence checks in `create`, `update`, `delete` |
| `src/modules/equipment/application/commands/__tests__/equipment-document.test.ts` | Extend with cross-tenant rejection tests |
| `src/app/api/equipment/route.ts` | Pass `tenantId` to `listAllEquipment` and `createEquipment` |
| `src/app/api/equipment/[id]/route.ts` | Pass `tenantId` to `getEquipmentByIdOrThrow`, `updateEquipment`, `deleteEquipment` |
| `src/app/api/equipment/[id]/documents/route.ts` | Pass `tenantId` to `createEquipmentDocument` (already present, verify no change needed) |
| `src/app/api/equipment/[id]/documents/[docId]/route.ts` | Pass `ctx: { tenantId }` to `updateEquipmentDocument`, `deleteEquipmentDocument` |
| `src/app/api/equipment/[id]/maintenance/route.ts` | Pass `tenantId` to `listMaintenance` |
| `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts` | Pass `ctx: { tenantId }` to `updateMaintenance`, `deleteMaintenance` |

---

## Task 1: Prisma Migration — add tenantId + RLS

**Files:**
- Create: `prisma/migrations/<generated-timestamp>_equipment_tenant_isolation/migration.sql` (created by `prisma migrate dev`)

- [ ] **Step 1: Run migrate dev to create the migration scaffold**

```bash
npx prisma migrate dev --name equipment_tenant_isolation --create-only
```

Expected: Prisma creates a new folder under `prisma/migrations/` with a timestamped name and an empty `migration.sql`. The `--create-only` flag writes the file but does NOT apply it yet.

- [ ] **Step 2: Open the generated `migration.sql` and replace its contents**

Paste the following into the generated file (exact path shown after the previous command):

```sql
-- Equipment Tenant Isolation
-- 1. Add tenantId to Equipment, backfill existing rows with 'orion', then drop the default.
ALTER TABLE "Equipment" ADD COLUMN "tenantId" TEXT NOT NULL DEFAULT 'orion';
ALTER TABLE "Equipment" ALTER COLUMN "tenantId" DROP DEFAULT;
CREATE INDEX "Equipment_tenantId_idx" ON "Equipment"("tenantId");

-- 2. RLS for Equipment — same audit-mode pattern as 20260516100000_extend_rls_tenant_scoped.
--    Permissive when app.current_tenant GUC is unset (backward compat), enforced when set.
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

-- 3. RLS for EquipmentDocument (tenantId column already exists).
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

-- 4. RLS for MaintenanceRecord (tenantId column already exists).
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

- [ ] **Step 3: Apply the migration**

```bash
npx prisma migrate dev
```

Expected output includes: `The following migration(s) have been applied: ..._equipment_tenant_isolation` and no errors.

- [ ] **Step 4: Verify the column exists in the DB**

```bash
docker compose exec postgres psql -U piling -d pilingtrack -c "\d \"Equipment\""
```

Expected: column `tenantId | text | not null` appears in the output, and existing rows have value `orion`.

---

## Task 2: Prisma Schema

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Update the Equipment model**

In `prisma/schema.prisma`, find the `model Equipment` block. Add `tenantId` after `isActive` and add `@@index([tenantId])`:

```prisma
model Equipment {
  id          String   @id @default(cuid())
  name        String
  model       String   @default("")
  qty         Int      @default(1)
  isActive    Boolean  @default(true)
  tenantId    String
  description String   @default("")

  // ... all other existing fields unchanged ...

  @@index([tenantId])
  @@index([isActive])
  @@index([kind])
  @@index([inventoryNumber])
}
```

- [ ] **Step 2: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: `Generated Prisma Client` with no errors. After this, `db.equipment.findUnique({ where: { id, tenantId } })` is a valid TypeScript call.

---

## Task 3: Domain Aggregate + Infrastructure

**Files:**
- Modify: `src/modules/equipment/domain/equipment.aggregate.ts`
- Modify: `src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts`
- Modify: `src/modules/equipment/infrastructure/equipment.prisma.mapper.ts`
- Modify: `src/modules/equipment/infrastructure/equipment.repository.ts`
- Modify: `src/modules/equipment/application/commands/equipment.command.ts`

- [ ] **Step 1: Update aggregate tests first (TDD — they will fail until Step 2)**

Replace the contents of `src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts`:

```typescript
/**
 * Equipment Aggregate — Unit Tests
 */

import { describe, it, expect } from 'vitest';
import { EquipmentAggregate } from '../equipment.aggregate';

describe('EquipmentAggregate', () => {
  describe('create', () => {
    it('should create equipment with required fields', () => {
      const agg = EquipmentAggregate.create({ name: 'Буровая D5', tenantId: 'orion' });
      const state = agg.getState();

      expect(state.name).toBe('Буровая D5');
      expect(state.model).toBe('');
      expect(state.qty).toBe(1);
      expect(state.isActive).toBe(true);
      expect(state.tenantId).toBe('orion');
      expect(state.id).toBeDefined();
    });

    it('should create equipment with all fields', () => {
      const agg = EquipmentAggregate.create({
        name: 'Кран КС-55',
        model: 'KC-55713-1K',
        qty: 3,
        description: 'Автокран 25 тонн',
        tenantId: 'orion',
      });
      const state = agg.getState();

      expect(state.model).toBe('KC-55713-1K');
      expect(state.qty).toBe(3);
      expect(state.description).toBe('Автокран 25 тонн');
    });

    it('should trim name whitespace', () => {
      const agg = EquipmentAggregate.create({ name: '  Насос  ', tenantId: 'orion' });
      expect(agg.getState().name).toBe('Насос');
    });

    it('should throw when name is empty', () => {
      expect(() => EquipmentAggregate.create({ name: '', tenantId: 'orion' })).toThrow(
        'Equipment name is required'
      );
    });

    it('should throw when name is whitespace only', () => {
      expect(() => EquipmentAggregate.create({ name: '   ', tenantId: 'orion' })).toThrow(
        'Equipment name is required'
      );
    });

    it('should emit EquipmentCreated event', () => {
      const agg = EquipmentAggregate.create({ name: 'Сваебой', tenantId: 'orion' }, 'user-1');
      const events = agg.getPendingEvents();

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('EquipmentCreated');
      expect(events[0].aggregateId).toBe(agg.getState().id);
    });

    it('should store tenantId in state and toPersistence', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'tenant-b' });
      expect(agg.getState().tenantId).toBe('tenant-b');
      expect(agg.toPersistence().tenantId).toBe('tenant-b');
    });
  });

  describe('update', () => {
    it('should update name', () => {
      const agg = EquipmentAggregate.create({ name: 'Old Name', tenantId: 'orion' });
      agg.update({ name: 'New Name' });
      expect(agg.getState().name).toBe('New Name');
    });

    it('should update qty', () => {
      const agg = EquipmentAggregate.create({ name: 'Pump', qty: 1, tenantId: 'orion' });
      agg.update({ qty: 5 });
      expect(agg.getState().qty).toBe(5);
    });

    it('should throw when updated name is empty', () => {
      const agg = EquipmentAggregate.create({ name: 'Valid', tenantId: 'orion' });
      expect(() => agg.update({ name: '' })).toThrow('Name required');
    });

    it('should emit EquipmentUpdated event', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'orion' });
      agg.clearPendingEvents();
      agg.update({ model: 'XR-2000' }, 'user-1');

      const events = agg.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('EquipmentUpdated');
    });
  });

  describe('retire', () => {
    it('should set isActive to false', () => {
      const agg = EquipmentAggregate.create({ name: 'Old Drill', tenantId: 'orion' });
      agg.retire();
      expect(agg.getState().isActive).toBe(false);
    });

    it('should emit EquipmentRetired event', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'orion' });
      agg.clearPendingEvents();
      agg.retire('admin-1');

      const events = agg.getPendingEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('EquipmentRetired');
    });
  });

  describe('reconstitute', () => {
    it('should rebuild aggregate from state', () => {
      const state = {
        id: 'eq-1',
        name: 'Pump',
        model: 'P-100',
        qty: 2,
        description: '',
        isActive: true,
        tenantId: 'orion',
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };

      const agg = EquipmentAggregate.reconstitute(state);
      expect(agg.getState()).toEqual(state);
      expect(agg.getPendingEvents()).toHaveLength(0);
    });
  });

  describe('clearPendingEvents', () => {
    it('should clear all pending events', () => {
      const agg = EquipmentAggregate.create({ name: 'Drill', tenantId: 'orion' });
      expect(agg.getPendingEvents()).toHaveLength(1);
      agg.clearPendingEvents();
      expect(agg.getPendingEvents()).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 2: Run the tests — expect failures**

```bash
npx vitest run src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts
```

Expected: several FAIL — `tenantId` doesn't exist yet in the aggregate.

- [ ] **Step 3: Update the aggregate**

Replace the full contents of `src/modules/equipment/domain/equipment.aggregate.ts`:

```typescript
import { createEquipmentEvent, EquipmentDomainEvent } from './equipment.events';

export interface EquipmentInfo {
  id: string; name: string; model: string; qty: number; description: string; isActive: boolean;
  tenantId: string;
  createdAt: string; updatedAt: string;
}

export interface EquipmentCreateData {
  name: string; model?: string; qty?: number; description?: string; tenantId: string;
}

export class EquipmentAggregate {
  private state: EquipmentInfo;
  private pendingEvents: EquipmentDomainEvent[] = [];
  private constructor(state: EquipmentInfo) { this.state = { ...state }; }

  static create(data: EquipmentCreateData, userId?: string): EquipmentAggregate {
    if (!data.name?.trim()) throw new Error('Equipment name is required');
    const now = new Date().toISOString();
    const state: EquipmentInfo = {
      id: crypto.randomUUID(), name: data.name.trim(), model: data.model || '', qty: data.qty || 1,
      description: data.description || '', isActive: true, tenantId: data.tenantId,
      createdAt: now, updatedAt: now,
    };
    const agg = new EquipmentAggregate(state);
    agg.pendingEvents.push(createEquipmentEvent('EquipmentCreated', state.id, { name: state.name, model: state.model, qty: state.qty }, { userId }));
    return agg;
  }

  static reconstitute(state: EquipmentInfo): EquipmentAggregate { return new EquipmentAggregate(state); }

  update(data: { name?: string; model?: string; qty?: number; description?: string }, userId?: string): void {
    if (data.name !== undefined) { if (!data.name.trim()) throw new Error('Name required'); this.state.name = data.name.trim(); }
    if (data.model !== undefined) this.state.model = data.model;
    if (data.qty !== undefined) this.state.qty = data.qty;
    if (data.description !== undefined) this.state.description = data.description;
    this.state.updatedAt = new Date().toISOString();
    this.pendingEvents.push(createEquipmentEvent('EquipmentUpdated', this.state.id, { changes: data }, { userId }));
  }

  retire(userId?: string): void {
    this.state.isActive = false;
    this.state.updatedAt = new Date().toISOString();
    this.pendingEvents.push(createEquipmentEvent('EquipmentRetired', this.state.id, {}, { userId }));
  }

  getState(): Readonly<EquipmentInfo> { return { ...this.state }; }
  getPendingEvents(): ReadonlyArray<EquipmentDomainEvent> { return [...this.pendingEvents]; }
  clearPendingEvents(): void { this.pendingEvents = []; }
  toPersistence() {
    return {
      id: this.state.id, name: this.state.name, model: this.state.model, qty: this.state.qty,
      description: this.state.description, isActive: this.state.isActive, tenantId: this.state.tenantId,
    };
  }
}

export { createEquipmentEvent };
export type { EquipmentDomainEvent, EquipmentDomainEventType } from './equipment.events';
```

- [ ] **Step 4: Update mapper**

Replace the full contents of `src/modules/equipment/infrastructure/equipment.prisma.mapper.ts`:

```typescript
import { EquipmentAggregate, EquipmentInfo } from '../domain';

export function toPrismaData(agg: EquipmentAggregate) {
  const s = agg.getState();
  return { id: s.id, name: s.name, model: s.model, qty: s.qty, description: s.description, isActive: s.isActive, tenantId: s.tenantId };
}

export function fromPrismaToState(p: { id: string; name: string; model: string; qty: number; description: string; isActive: boolean; tenantId: string; createdAt: Date; updatedAt: Date }): EquipmentInfo {
  return { id: p.id, name: p.name, model: p.model, qty: p.qty, description: p.description, isActive: p.isActive, tenantId: p.tenantId, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString() };
}

export function toOutboxData(e: { type: string; aggregateId: string; [key: string]: unknown }) {
  return { type: e.type, aggregateId: e.aggregateId, aggregateType: 'Equipment', payload: e };
}
```

- [ ] **Step 5: Update repository — add tenantId to findById**

Replace the full contents of `src/modules/equipment/infrastructure/equipment.repository.ts`:

```typescript
import { db } from '@/lib/db';
import { EquipmentAggregate } from '../domain';
import { toPrismaData, fromPrismaToState, toOutboxData } from './equipment.prisma.mapper';

export interface EquipmentRepository {
  save(agg: EquipmentAggregate): Promise<void>;
  findById(id: string, tenantId: string): Promise<EquipmentAggregate | null>;
}

export class PrismaEquipmentRepository implements EquipmentRepository {
  async save(agg: EquipmentAggregate): Promise<void> {
    const s = agg.getState();
    const pd = toPrismaData(agg);
    const evts = agg.getPendingEvents();
    await db.equipment.upsert({
      where: { id: s.id },
      create: pd,
      update: { name: pd.name, model: pd.model, qty: pd.qty, description: pd.description, isActive: pd.isActive },
    });
    if (evts.length > 0) await Promise.all(evts.map(e => db.outboxEvent.create({ data: toOutboxData(e) })));
    agg.clearPendingEvents();
  }

  async findById(id: string, tenantId: string): Promise<EquipmentAggregate | null> {
    const p = await db.equipment.findUnique({ where: { id, tenantId } });
    if (!p) return null;
    return EquipmentAggregate.reconstitute(fromPrismaToState(p));
  }
}

let _i: PrismaEquipmentRepository | null = null;
export function getEquipmentRepository(): EquipmentRepository {
  if (!_i) _i = new PrismaEquipmentRepository();
  return _i;
}
```

- [ ] **Step 6: Update command interfaces**

Replace the full contents of `src/modules/equipment/application/commands/equipment.command.ts`:

```typescript
export interface CreateEquipmentCommand {
  name: string; model?: string; qty?: number; description?: string; userId?: string; tenantId: string;
}
export interface UpdateEquipmentCommand {
  equipmentId: string; name?: string; model?: string; qty?: number; description?: string; userId?: string; tenantId: string;
}
```

- [ ] **Step 7: Run aggregate tests — expect all pass**

```bash
npx vitest run src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add prisma/schema.prisma \
  src/modules/equipment/domain/equipment.aggregate.ts \
  src/modules/equipment/domain/__tests__/equipment-aggregate.test.ts \
  src/modules/equipment/infrastructure/equipment.prisma.mapper.ts \
  src/modules/equipment/infrastructure/equipment.repository.ts \
  src/modules/equipment/application/commands/equipment.command.ts
git commit -m "feat(equipment): add tenantId to aggregate, mapper, repository

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Query Service

**Files:**
- Modify: `src/modules/equipment/application/queries/equipment-query.service.ts`

No unit tests for pure Prisma query functions — TypeScript compilation is the check.

- [ ] **Step 1: Replace the full contents of the query service**

```typescript
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { CursorPaginationResult } from '@/lib/pagination-cursor';

export async function getAccessibleEquipment(tenantId: string) {
  return db.equipment.findMany({ where: { isActive: true, tenantId }, orderBy: { name: 'asc' } });
}

export async function getEquipmentById(id: string, tenantId: string) {
  return db.equipment.findUnique({
    where: { id, tenantId },
    include: { crews: { select: { id: true, name: true, siteId: true } } },
  });
}

export async function getEquipmentByIdOrThrow(id: string, tenantId: string) {
  const equipment = await db.equipment.findUnique({
    where: { id, tenantId },
    include: {
      crews: {
        where: { isActive: true },
        include: {
          operator: { select: { id: true, name: true } },
          site: { select: { id: true, name: true } },
        },
      },
    },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);
  return equipment;
}

export async function listEquipmentWithCrewCounts(tenantId: string) {
  const list = await db.equipment.findMany({
    where: { tenantId },
    include: { crews: { where: { isActive: true } } },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  return list.map((eq) => ({
    id: eq.id, name: eq.name, model: eq.model, qty: eq.qty,
    isActive: eq.isActive, description: eq.description,
    kind: eq.kind,
    inventoryNumber: eq.inventoryNumber,
    registrationNumber: eq.registrationNumber,
    serialNumber: eq.serialNumber,
    manufactureYear: eq.manufactureYear,
    baseVehicle: eq.baseVehicle,
    crewCount: eq.crews.length,
  }));
}

/**
 * Rich snapshot for /admin/equipment/[id]. One call returns:
 *   - the equipment row with the full template metadata
 *   - active crew (operator + assistants + current site)
 *   - 30-day activity totals from ReportAnalytics
 *   - active telematics devices
 *   - documents
 */
export async function getEquipmentDetails(equipmentId: string, tenantId: string) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId },
    include: {
      crews: {
        where: { isActive: true },
        include: {
          operator: { select: { id: true, name: true, email: true } },
          site:     { select: { id: true, name: true } },
          assistants: { select: { id: true, name: true } },
        },
      },
      telematicsDevices: {
        where: { status: { not: 'ARCHIVED' } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, label: true, provider: true, model: true,
          status: true, lastSeenAt: true, imei: true, installedAt: true,
        },
      },
      documents: {
        orderBy: [{ expiresAt: 'asc' }, { createdAt: 'desc' }],
      },
    },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  const cutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const allReports = await db.report.findMany({
    where: { equipmentId },
    orderBy: { date: 'desc' },
    take: 1000,
    select: {
      id: true, reportId: true, date: true, shiftType: true, status: true,
      site: { select: { id: true, name: true } },
      user: { select: { id: true, name: true } },
      updatedAt: true,
    },
  });
  const analyticsRows = allReports.length
    ? await db.reportAnalytics.findMany({
        where: { reportId: { in: allReports.map((r) => r.reportId) } },
        select: { reportId: true, totalPiles: true, totalDrilling: true, totalDowntime: true },
      })
    : [];
  const analyticsByReport = new Map(analyticsRows.map((a) => [a.reportId, a]));

  const reports30d = allReports.filter((r) => r.date >= cutoff);
  const stats30d = reports30d.reduce(
    (acc, r) => {
      const a = analyticsByReport.get(r.reportId);
      if (!a) return acc;
      acc.piles += a.totalPiles;
      acc.drillingMeters += a.totalDrilling;
      acc.downtimeMinutes += a.totalDowntime;
      return acc;
    },
    { piles: 0, drillingMeters: 0, downtimeMinutes: 0 }
  );

  const timeline = allReports.map((r) => {
    const a = analyticsByReport.get(r.reportId);
    return {
      reportId: r.reportId, date: r.date, shiftType: r.shiftType, status: r.status,
      siteName: r.site?.name ?? null, operatorName: r.user?.name ?? null,
      updatedAt: r.updatedAt.toISOString(),
      piles: a?.totalPiles ?? null, drillingMeters: a?.totalDrilling ?? null,
      downtimeMinutes: a?.totalDowntime ?? null,
    };
  });

  return {
    equipment,
    crew: equipment.crews[0] ?? null,
    telematicsDevices: equipment.telematicsDevices,
    documents: equipment.documents,
    stats30d: { reportCount: reports30d.length, ...stats30d },
    timeline,
  };
}

export async function listEquipmentCatalog(tenantId: string) {
  return db.equipment.findMany({ where: { tenantId }, orderBy: { name: 'asc' } });
}

/**
 * Журнал ТО/ремонтов установки
 */
export async function listMaintenance(equipmentId: string, tenantId: string) {
  return db.maintenanceRecord.findMany({
    where: { equipmentId, tenantId },
    orderBy: [{ status: 'asc' }, { scheduledAt: 'desc' }, { createdAt: 'desc' }],
  });
}

export async function listAllEquipment(
  pagination?: CursorPaginationResult,
  siteId?: string | null,
  operatorUserId?: string | null,
  tenantId?: string,
) {
  const take = pagination?.take ?? 50;
  const cursor = pagination?.cursor ?? undefined;
  const where: Record<string, unknown> = {};

  if (tenantId) where.tenantId = tenantId;

  if (operatorUserId) {
    where.crews = {
      some: {
        isActive: true,
        operatorId: operatorUserId,
        ...(siteId ? { siteId } : {}),
      },
    };
  }

  return db.equipment.findMany({
    where,
    select: { id: true, name: true, model: true, qty: true, isActive: true },
    orderBy: { name: 'asc' },
    cursor: cursor ? { id: cursor } : undefined,
    take: take + 1,
    skip: cursor ? 1 : 0,
  });
}
```

- [ ] **Step 2: Check TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | grep -E "equipment-query|error TS" | head -20
```

Expected: no errors on `equipment-query.service.ts`. (Other errors from callers not yet updated are expected and will be fixed in Tasks 6–7.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/equipment/application/queries/equipment-query.service.ts
git commit -m "feat(equipment): scope all queries by tenantId

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Document + Maintenance Commands

**Files:**
- Modify: `src/modules/equipment/application/commands/equipment-document.ts`
- Modify: `src/modules/equipment/application/commands/__tests__/equipment-document.test.ts`
- Modify: `src/modules/equipment/application/commands/equipment-maintenance.ts`

- [ ] **Step 1: Add cross-tenant rejection tests to equipment-document.test.ts**

Replace the full contents of `src/modules/equipment/application/commands/__tests__/equipment-document.test.ts`:

```typescript
/**
 * createEquipmentDocument — tenant-source + tenant-isolation regression tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueEquipmentMock, createDocMock, findUniqueDocMock, updateDocMock, deleteDocMock } = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  createDocMock: vi.fn(),
  findUniqueDocMock: vi.fn(),
  updateDocMock: vi.fn(),
  deleteDocMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueEquipmentMock },
    equipmentDocument: {
      create: createDocMock,
      findUnique: findUniqueDocMock,
      update: updateDocMock,
      delete: deleteDocMock,
    },
  },
}));

import { createEquipmentDocument, updateEquipmentDocument, deleteEquipmentDocument } from '../equipment-document';

describe('createEquipmentDocument', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    createDocMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    createDocMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('writes tenantId from ctx, not from the equipment row', async () => {
    await createEquipmentDocument('eq_1', { type: 'PASSPORT', title: 'Паспорт' }, { tenantId: 'orion' });

    // Existence check must include tenantId to prevent cross-tenant attach.
    expect(findUniqueEquipmentMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });

    const data = createDocMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.equipmentId).toBe('eq_1');
  });

  it('throws 404 when equipment is missing', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);
    await expect(
      createEquipmentDocument('missing', { type: 'OTHER', title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Equipment not found');
  });
});

describe('updateEquipmentDocument', () => {
  beforeEach(() => {
    findUniqueDocMock.mockReset();
    updateDocMock.mockReset();
    updateDocMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('updates when equipmentId and tenantId match', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await updateEquipmentDocument('eq_1', 'doc_1', { title: 'Updated' }, { tenantId: 'orion' });
    expect(updateDocMock).toHaveBeenCalledOnce();
  });

  it('throws 404 when tenantId does not match (cross-tenant attack)', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await expect(
      updateEquipmentDocument('eq_1', 'doc_1', { title: 'x' }, { tenantId: 'tenant-b' }),
    ).rejects.toThrow('Document not found');
    expect(updateDocMock).not.toHaveBeenCalled();
  });

  it('throws 404 when equipmentId does not match', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'other_eq', tenantId: 'orion' });
    await expect(
      updateEquipmentDocument('eq_1', 'doc_1', { title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Document not found');
  });
});

describe('deleteEquipmentDocument', () => {
  beforeEach(() => {
    findUniqueDocMock.mockReset();
    deleteDocMock.mockReset();
    deleteDocMock.mockResolvedValue({ id: 'doc_1' });
  });

  it('deletes when equipmentId and tenantId match', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await deleteEquipmentDocument('eq_1', 'doc_1', { tenantId: 'orion' });
    expect(deleteDocMock).toHaveBeenCalledOnce();
  });

  it('throws 404 when tenantId does not match (cross-tenant attack)', async () => {
    findUniqueDocMock.mockResolvedValue({ id: 'doc_1', equipmentId: 'eq_1', tenantId: 'orion' });
    await expect(
      deleteEquipmentDocument('eq_1', 'doc_1', { tenantId: 'tenant-b' }),
    ).rejects.toThrow('Document not found');
    expect(deleteDocMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run new tests — expect failures**

```bash
npx vitest run src/modules/equipment/application/commands/__tests__/equipment-document.test.ts
```

Expected: cross-tenant tests FAIL (functions don't accept `ctx` yet).

- [ ] **Step 3: Update equipment-document.ts**

Replace the full contents of `src/modules/equipment/application/commands/equipment-document.ts`:

```typescript
/**
 * EquipmentDocument CRUD.
 *
 * Tenant comes from the acting user via ctx.tenantId. Equipment existence checks
 * are scoped to the same tenant to prevent cross-tenant document attachment (IDOR fix).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export type EquipmentDocumentType =
  | 'PASSPORT' | 'OTS' | 'INSURANCE' | 'INSPECTION'
  | 'CERTIFICATE' | 'MAINTENANCE_LOG' | 'OTHER';

export interface EquipmentDocumentInput {
  type: EquipmentDocumentType;
  title: string;
  issuedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  notes?: string;
  mediaId?: string | null;
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function createEquipmentDocument(
  equipmentId: string,
  input: EquipmentDocumentInput,
  ctx: { tenantId: string },
) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  return db.equipmentDocument.create({
    data: {
      tenantId: ctx.tenantId,
      equipmentId: equipment.id,
      type: input.type,
      title: input.title.trim(),
      issuedAt: toDate(input.issuedAt),
      expiresAt: toDate(input.expiresAt),
      notes: input.notes?.trim() ?? '',
      mediaId: input.mediaId || null,
    },
  });
}

export async function updateEquipmentDocument(
  equipmentId: string,
  documentId: string,
  input: Partial<EquipmentDocumentInput>,
  ctx: { tenantId: string },
) {
  const doc = await db.equipmentDocument.findUnique({
    where: { id: documentId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!doc || doc.equipmentId !== equipmentId || doc.tenantId !== ctx.tenantId) {
    throw new ServiceError('Document not found', 404);
  }

  const data: Record<string, unknown> = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.issuedAt !== undefined) data.issuedAt = toDate(input.issuedAt);
  if (input.expiresAt !== undefined) data.expiresAt = toDate(input.expiresAt);
  if (input.notes !== undefined) data.notes = input.notes?.trim() ?? '';
  if (input.mediaId !== undefined) data.mediaId = input.mediaId || null;

  return db.equipmentDocument.update({ where: { id: documentId }, data });
}

export async function deleteEquipmentDocument(
  equipmentId: string,
  documentId: string,
  ctx: { tenantId: string },
) {
  const doc = await db.equipmentDocument.findUnique({
    where: { id: documentId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!doc || doc.equipmentId !== equipmentId || doc.tenantId !== ctx.tenantId) {
    throw new ServiceError('Document not found', 404);
  }
  await db.equipmentDocument.delete({ where: { id: documentId } });
}
```

- [ ] **Step 4: Run document tests — expect all pass**

```bash
npx vitest run src/modules/equipment/application/commands/__tests__/equipment-document.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Update equipment-maintenance.ts**

Replace the full contents of `src/modules/equipment/application/commands/equipment-maintenance.ts`:

```typescript
/**
 * MaintenanceRecord CRUD.
 *
 * Tenant comes from ctx.tenantId. Existence checks for parent Equipment and
 * individual records are scoped to the same tenant (IDOR fix).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export type MaintenanceType = 'SCHEDULED' | 'REPAIR' | 'FAULT' | 'INSPECTION';
export type MaintenanceStatus = 'PLANNED' | 'IN_PROGRESS' | 'DONE' | 'CANCELLED';

export interface MaintenanceInput {
  type: MaintenanceType;
  status?: MaintenanceStatus;
  title: string;
  description?: string;
  scheduledAt?: string | Date | null;
  completedAt?: string | Date | null;
  engineHoursAtService?: number | null;
  cost?: number | null;
  performedBy?: string | null;
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function createMaintenance(
  equipmentId: string,
  input: MaintenanceInput,
  ctx: { tenantId: string; createdById?: string | null },
) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  const status = input.status ?? 'PLANNED';
  const completedAt = toDate(input.completedAt) ?? (status === 'DONE' ? new Date() : null);

  return db.maintenanceRecord.create({
    data: {
      tenantId: ctx.tenantId,
      equipmentId: equipment.id,
      type: input.type,
      status,
      title: input.title.trim(),
      description: input.description?.trim() ?? '',
      scheduledAt: toDate(input.scheduledAt),
      completedAt,
      engineHoursAtService: input.engineHoursAtService ?? null,
      cost: input.cost ?? null,
      performedBy: input.performedBy?.trim() || null,
      createdById: ctx.createdById ?? null,
    },
  });
}

export async function updateMaintenance(
  equipmentId: string,
  recordId: string,
  input: Partial<MaintenanceInput>,
  ctx: { tenantId: string },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, completedAt: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }

  const data: Record<string, unknown> = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.description !== undefined) data.description = input.description?.trim() ?? '';
  if (input.scheduledAt !== undefined) data.scheduledAt = toDate(input.scheduledAt);
  if (input.engineHoursAtService !== undefined) data.engineHoursAtService = input.engineHoursAtService ?? null;
  if (input.cost !== undefined) data.cost = input.cost ?? null;
  if (input.performedBy !== undefined) data.performedBy = input.performedBy?.trim() || null;
  if (input.completedAt !== undefined) data.completedAt = toDate(input.completedAt);

  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'DONE' && input.completedAt === undefined && !existing.completedAt) {
      data.completedAt = new Date();
    }
  }

  return db.maintenanceRecord.update({ where: { id: recordId }, data });
}

export async function deleteMaintenance(
  equipmentId: string,
  recordId: string,
  ctx: { tenantId: string },
) {
  const existing = await db.maintenanceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!existing || existing.equipmentId !== equipmentId || existing.tenantId !== ctx.tenantId) {
    throw new ServiceError('Maintenance record not found', 404);
  }
  await db.maintenanceRecord.delete({ where: { id: recordId } });
}
```

- [ ] **Step 6: Commit**

```bash
git add \
  src/modules/equipment/application/commands/equipment-document.ts \
  src/modules/equipment/application/commands/__tests__/equipment-document.test.ts \
  src/modules/equipment/application/commands/equipment-maintenance.ts
git commit -m "feat(equipment): add tenant guards to document and maintenance commands

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 6: Command Service

**Files:**
- Modify: `src/modules/equipment/application/commands/equipment-command.service.ts`

- [ ] **Step 1: Replace the full contents of equipment-command.service.ts**

```typescript
/**
 * Equipment Command Service
 */
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { EquipmentAggregate } from '../../domain';
import { getEquipmentRepository } from '../../infrastructure';
import { CreateEquipmentCommand, UpdateEquipmentCommand } from './equipment.command';

export async function createEquipment(cmd: CreateEquipmentCommand) {
  const agg = EquipmentAggregate.create(
    { name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description, tenantId: cmd.tenantId },
    cmd.userId,
  );
  await getEquipmentRepository().save(agg);
  return db.equipment.findUnique({ where: { id: agg.getState().id } });
}

export async function updateEquipment(cmd: UpdateEquipmentCommand) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(cmd.equipmentId, cmd.tenantId);
  if (!agg) throw new ServiceError('Equipment not found', 404);
  agg.update({ name: cmd.name, model: cmd.model, qty: cmd.qty, description: cmd.description }, cmd.userId);
  await repo.save(agg);
}

export async function retireEquipment(equipmentId: string, tenantId: string, userId?: string) {
  const repo = getEquipmentRepository();
  const agg = await repo.findById(equipmentId, tenantId);
  if (!agg) throw new ServiceError('Equipment not found', 404);
  agg.retire(userId);
  await repo.save(agg);
}

export async function deleteEquipment(equipmentId: string, tenantId: string) {
  const existing = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId },
    include: { crews: { where: { isActive: true } } },
  });
  if (!existing) throw new ServiceError('Equipment not found', 404);
  if (existing.crews.length > 0) {
    throw new ServiceError('Cannot delete equipment with linked active crews', 409);
  }
  await db.equipment.delete({ where: { id: equipmentId } });
  return { success: true };
}
```

- [ ] **Step 2: Check TypeScript on command service**

```bash
npx tsc --noEmit 2>&1 | grep "equipment-command.service" | head -10
```

Expected: no errors on this file.

- [ ] **Step 3: Commit**

```bash
git add src/modules/equipment/application/commands/equipment-command.service.ts
git commit -m "feat(equipment): scope createEquipment/update/delete to tenant

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 7: Route Handlers

**Files:**
- Modify: `src/app/api/equipment/route.ts`
- Modify: `src/app/api/equipment/[id]/route.ts`
- Modify: `src/app/api/equipment/[id]/documents/[docId]/route.ts`
- Modify: `src/app/api/equipment/[id]/maintenance/route.ts`
- Modify: `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts`

Note: `src/app/api/equipment/[id]/documents/route.ts` already resolves `tenantId` correctly — it only needs the updated `createEquipmentDocument` signature (already done in Task 5, no route change required).

- [ ] **Step 1: Update `src/app/api/equipment/route.ts`**

Replace full contents:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createEquipment, listAllEquipment, updateEquipmentMetadata } from '@/modules/equipment';
import { createEquipmentSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';
import { parseCursorPagination } from '@/lib/pagination-cursor';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const pagination = parseCursorPagination(request, { defaultLimit: 50, maxLimit: 100 });
    const siteId = request.nextUrl.searchParams.get('siteId');
    const operatorUserId = user!.role === 'OPERATOR' ? user!.id : null;
    const equipment = await listAllEquipment(pagination, siteId, operatorUserId, tenantId);
    const nextCursor = pagination.getNextCursor(equipment);
    return NextResponse.json({ data: equipment, nextCursor });
  },
  { domain: 'equipment', cache: true, cacheTTL: 60_000 }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const body = await request.json();
    const validation = createEquipmentSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const equipment = await createEquipment({
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      userId: user!.id,
      tenantId,
    });

    if (equipment) {
      await updateEquipmentMetadata(equipment.id, validation.data);
    }

    return NextResponse.json({ equipment }, { status: 201 });
  },
  { domain: 'equipment' }
);
```

- [ ] **Step 2: Update `src/app/api/equipment/[id]/route.ts`**

Replace full contents:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getEquipmentByIdOrThrow, updateEquipment, updateEquipmentMetadata, deleteEquipment } from '@/modules/equipment';
import { equipmentManageSchema } from '@/lib/validation-schemas';
import { withApi, withMutation } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const equipment = await getEquipmentByIdOrThrow(id, tenantId);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const body = await request.json();

    const validation = equipmentManageSchema.partial().safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.error.issues.map(e => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    await updateEquipment({
      equipmentId: id,
      name: validation.data.name,
      model: validation.data.model,
      qty: validation.data.qty,
      description: validation.data.description,
      userId: user!.id,
      tenantId,
    });

    await updateEquipmentMetadata(id, validation.data);

    const equipment = await getEquipmentByIdOrThrow(id, tenantId);
    return NextResponse.json({ equipment });
  },
  { domain: 'equipment' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    assertCan(user!, 'equipment.manage');
    const { id } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const result = await deleteEquipment(id, tenantId);
    return NextResponse.json(result);
  },
  { domain: 'equipment' }
);
```

- [ ] **Step 3: Update `src/app/api/equipment/[id]/documents/[docId]/route.ts`**

Replace full contents:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateEquipmentDocument, deleteEquipmentDocument } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const documentTypeEnum = z.enum([
  'PASSPORT', 'OTS', 'INSURANCE', 'INSPECTION',
  'CERTIFICATE', 'MAINTENANCE_LOG', 'OTHER',
]);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const updateSchema = z.object({
  type: documentTypeEnum.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  issuedAt:  z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  expiresAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  notes: z.string().max(2000).optional(),
  mediaId: z.string().optional().nullable(),
});

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'equipment.manage');

    const { id, docId } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    try {
      const doc = await updateEquipmentDocument(id, docId, parsed.data, { tenantId });
      return NextResponse.json({ document: doc });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.documents' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'equipment.manage');

    const { id, docId } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    try {
      await deleteEquipmentDocument(id, docId, { tenantId });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.documents' }
);
```

- [ ] **Step 4: Update `src/app/api/equipment/[id]/maintenance/route.ts`**

Only the GET handler needs updating (POST already resolves `tenantId`). Replace full contents:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { createMaintenance, listMaintenance } from '@/modules/equipment';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const typeEnum = z.enum(['SCHEDULED', 'REPAIR', 'FAULT', 'INSPECTION']);
const statusEnum = z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const createSchema = z.object({
  type: typeEnum,
  status: statusEnum.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduledAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  completedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  engineHoursAtService: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  cost: z.preprocess(emptyToUndef, z.coerce.number().min(0)).optional().nullable(),
  performedBy: z.string().max(200).optional().nullable(),
});

export const GET = withApi(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const records = await listMaintenance(id, tenantId);
    return NextResponse.json({ records });
  },
  { domain: 'equipment.maintenance' }
);

export const POST = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const { id } = await params;
    const body = await request.json();
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    try {
      const record = await createMaintenance(id, parsed.data, { tenantId, createdById: user!.id });
      return NextResponse.json({ record }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
```

- [ ] **Step 5: Update `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts`**

Replace full contents:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateMaintenance, deleteMaintenance } from '@/modules/equipment';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const typeEnum = z.enum(['SCHEDULED', 'REPAIR', 'FAULT', 'INSPECTION']);
const statusEnum = z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'CANCELLED']);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const updateSchema = z.object({
  type: typeEnum.optional(),
  status: statusEnum.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  scheduledAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  completedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  engineHoursAtService: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  cost: z.preprocess(emptyToUndef, z.coerce.number().min(0)).optional().nullable(),
  performedBy: z.string().max(200).optional().nullable(),
});

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const { id, recordId } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const body = await request.json();
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    try {
      const record = await updateMaintenance(id, recordId, parsed.data, { tenantId });
      return NextResponse.json({ record });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; recordId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const { id, recordId } = await params;
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    try {
      await deleteMaintenance(id, recordId, { tenantId });
      return NextResponse.json({ ok: true });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.maintenance' }
);
```

- [ ] **Step 6: Commit**

```bash
git add \
  src/app/api/equipment/route.ts \
  src/app/api/equipment/[id]/route.ts \
  "src/app/api/equipment/[id]/documents/[docId]/route.ts" \
  "src/app/api/equipment/[id]/maintenance/route.ts" \
  "src/app/api/equipment/[id]/maintenance/[recordId]/route.ts"
git commit -m "feat(equipment): thread tenantId through all equipment route handlers

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 8: Final TypeScript Check + Tests

- [ ] **Step 1: Full TypeScript check**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | head -30
```

Expected: zero errors. If any errors appear — they will point to callers of the functions changed in Tasks 3–7 that haven't been updated yet. Fix each one before proceeding.

- [ ] **Step 2: Run all equipment-related tests**

```bash
npx vitest run src/modules/equipment
```

Expected: all tests PASS.

- [ ] **Step 3: Run the full test suite**

```bash
npx vitest run
```

Expected: no regressions. Note any pre-existing failures (if any) that are unrelated to this change.

- [ ] **Step 4: Commit the migration files**

```bash
git add prisma/migrations/
git commit -m "feat(equipment): add tenantId column + RLS migration

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

- [ ] **Step 5: Smoke-test locally**

Start the dev server:
```bash
npm run dev
```

Open the browser, go to the equipment list page, confirm equipment loads. Open one equipment detail page, confirm documents and maintenance records load. Create a new maintenance record and verify it saves. No console errors or 500 responses expected.

---

## Summary of Changes

| Layer | What changed |
|---|---|
| DB | `tenantId` column on `Equipment`; RLS on `Equipment`, `EquipmentDocument`, `MaintenanceRecord` |
| Prisma schema | `tenantId String` + `@@index([tenantId])` on Equipment |
| Domain | `EquipmentInfo`, `EquipmentCreateData`, `create()`, `toPersistence()` include `tenantId` |
| Infrastructure | `toPrismaData`, `fromPrismaToState`, `findById(id, tenantId)` |
| Commands | `CreateEquipmentCommand.tenantId`, all existence checks scoped to tenant |
| Query service | All 8 functions accept and apply `tenantId` in `where` |
| Routes | `tenantId = user.tenantId ?? DEFAULT_TENANT_ID` passed to every service call |
