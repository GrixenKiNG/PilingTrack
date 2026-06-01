# Модуль ТО — План P1a: Наряды (Work Orders), бэкенд

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Развить `MaintenanceRecord` до полноценного наряда (исполнитель, приоритет, расширенные статусы, время, причина отказа, закрытие) и дать API глобального списка нарядов — backend-слой с юнит-тестами.

**Architecture:** Аддитивное расширение существующей модели `MaintenanceRecord` (без destructive-миграций). Команды в `src/modules/equipment/application/commands/equipment-maintenance.ts`, запросы в `equipment-query.service.ts`, роуты через `withApi`/`withMutation`. Tenant-isolation строгим равенством по `tenantId` (правило проекта против IDOR). Новые поля-ссылки на `User` (`assigneeId`, `closedById`) хранятся как `String?` без relation — по образцу существующего `createdById`.

**Tech Stack:** Next.js (route handlers), Prisma (PostgreSQL), Zod, Vitest. Миграции — через скилл `/create-migration`.

**Связанный спек:** `docs/superpowers/specs/2026-05-31-maintenance-module-phase1-design.md` (§2.1, §3).

**Вне P1a:** фото-вложения (Media) → в P1b (UI); `pmRuleId` и чек-листы → в P3/P4 (там появляются `MaintenancePlan`/шаблоны). UI → P1b.

---

## Структура файлов

- Modify: `prisma/schema.prisma` — модель `MaintenanceRecord`, enum `MaintenanceStatus`, новый enum `MaintenancePriority`.
- Create: `prisma/migrations/<timestamp>_work_order_fields/migration.sql` (через `/create-migration`).
- Modify: `src/modules/equipment/application/commands/equipment-maintenance.ts` — расширить `MaintenanceInput`, `createMaintenance`, `updateMaintenance`.
- Modify: `src/modules/equipment/application/commands/__tests__/` — новый тест `equipment-maintenance.test.ts`.
- Modify: `src/modules/equipment/application/queries/equipment-query.service.ts` — добавить `listAllMaintenance`.
- Modify: `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts` — тест для `listAllMaintenance`.
- Modify: `src/modules/equipment/index.ts` — экспорт `listAllMaintenance`.
- Modify: `src/app/api/equipment/[id]/maintenance/route.ts` — расширить `createSchema`.
- Modify: `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts` — расширить схему обновления.
- Create: `src/app/api/maintenance/route.ts` — GET глобального списка нарядов.

---

## Task 1: Миграция — поля наряда на `MaintenanceRecord`

**Files:**
- Modify: `prisma/schema.prisma:229-266` (модель `MaintenanceRecord`, enum `MaintenanceStatus`)
- Create: `prisma/migrations/<timestamp>_work_order_fields/migration.sql`

- [ ] **Step 1: Добавить enum `MaintenancePriority` и расширить `MaintenanceStatus`**

В `prisma/schema.prisma` заменить enum `MaintenanceStatus` (строки 261-266) на:

```prisma
enum MaintenanceStatus {
  PLANNED
  ASSIGNED
  IN_PROGRESS
  ON_HOLD
  DONE
  CANCELLED
}

enum MaintenancePriority {
  LOW
  NORMAL
  HIGH
  CRITICAL
}
```

- [ ] **Step 2: Добавить поля в модель `MaintenanceRecord`**

В модель `MaintenanceRecord` (после строки `performedBy String?`, перед `createdById`) добавить:

```prisma
  priority    MaintenancePriority @default(NORMAL)
  assigneeId  String?                               // исполнитель (User.id), без relation — как createdById
  startedAt   DateTime?         @db.Timestamptz(3)   // начало работ (для MTTR)
  laborHours  Float?                                // трудозатраты
  faultCause  String?                               // причина отказа (текст)
  partsUsedText String          @default("")         // израсходованные запчасти текстом ("крючок" под склад)
  closedById  String?                               // кто проверил/закрыл (User.id)
```

И добавить индексы в блок `@@index` модели:

```prisma
  @@index([assigneeId])
  @@index([priority])
```

- [ ] **Step 3: Создать миграцию через скилл**

Запустить скилл `/create-migration` с описанием: `work_order_fields — add priority, assigneeId, startedAt, laborHours, faultCause, partsUsedText, closedById to MaintenanceRecord; extend MaintenanceStatus with ASSIGNED, ON_HOLD; add MaintenancePriority enum`.

Миграция аддитивная (только `ADD COLUMN` / `ALTER TYPE ... ADD VALUE` / `CREATE TYPE`). DROP отсутствует.

- [ ] **Step 4: Проверить, что миграция применилась локально**

Run:
```bash
docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -c "\d \"MaintenanceRecord\""
```
Expected: в выводе присутствуют колонки `priority`, `assigneeId`, `startedAt`, `laborHours`, `faultCause`, `partsUsedText`, `closedById`.

Run:
```bash
docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -c "SELECT unnest(enum_range(NULL::\"MaintenanceStatus\"));"
```
Expected: `PLANNED, ASSIGNED, IN_PROGRESS, ON_HOLD, DONE, CANCELLED`.

- [ ] **Step 5: Перегенерировать Prisma-клиент**

Run: `npx prisma generate`
Expected: завершается без ошибок; типы `MaintenancePriority` доступны.

- [ ] **Step 6: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(maintenance): add work order fields to MaintenanceRecord"
```

---

## Task 2: Расширить команды `createMaintenance` / `updateMaintenance`

**Files:**
- Test: `src/modules/equipment/application/commands/__tests__/equipment-maintenance.test.ts` (создать)
- Modify: `src/modules/equipment/application/commands/equipment-maintenance.ts`

- [ ] **Step 1: Написать падающий тест**

Создать `src/modules/equipment/application/commands/__tests__/equipment-maintenance.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { findUniqueEquipmentMock, createRecMock, findUniqueRecMock, updateRecMock } = vi.hoisted(() => ({
  findUniqueEquipmentMock: vi.fn(),
  createRecMock: vi.fn(),
  findUniqueRecMock: vi.fn(),
  updateRecMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    equipment: { findUnique: findUniqueEquipmentMock },
    maintenanceRecord: {
      create: createRecMock,
      findUnique: findUniqueRecMock,
      update: updateRecMock,
    },
  },
}));

import { createMaintenance, updateMaintenance } from '../equipment-maintenance';

describe('createMaintenance — work order fields', () => {
  beforeEach(() => {
    findUniqueEquipmentMock.mockReset();
    createRecMock.mockReset();
    findUniqueEquipmentMock.mockResolvedValue({ id: 'eq_1' });
    createRecMock.mockResolvedValue({ id: 'rec_1' });
  });

  it('checks equipment existence scoped by tenantId', async () => {
    await createMaintenance('eq_1', { type: 'REPAIR', title: 'Ремонт насоса' }, { tenantId: 'orion' });
    expect(findUniqueEquipmentMock.mock.calls[0][0].where).toEqual({ id: 'eq_1', tenantId: 'orion' });
  });

  it('persists new work order fields and defaults priority to NORMAL', async () => {
    await createMaintenance(
      'eq_1',
      { type: 'REPAIR', title: 'x', priority: 'HIGH', assigneeId: 'usr_2', faultCause: 'кавитация', partsUsedText: 'фильтр' },
      { tenantId: 'orion' },
    );
    const data = createRecMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.priority).toBe('HIGH');
    expect(data.assigneeId).toBe('usr_2');
    expect(data.faultCause).toBe('кавитация');
    expect(data.partsUsedText).toBe('фильтр');
  });

  it('throws 404 when equipment missing', async () => {
    findUniqueEquipmentMock.mockResolvedValue(null);
    await expect(
      createMaintenance('missing', { type: 'FAULT', title: 'x' }, { tenantId: 'orion' }),
    ).rejects.toThrow('Equipment not found');
  });
});

describe('updateMaintenance — lifecycle transitions', () => {
  beforeEach(() => {
    findUniqueRecMock.mockReset();
    updateRecMock.mockReset();
    updateRecMock.mockResolvedValue({ id: 'rec_1' });
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'orion' });
  });

  it('sets startedAt when status moves to IN_PROGRESS', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'IN_PROGRESS' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.startedAt).toBeInstanceOf(Date);
  });

  it('sets closedById from ctx when status moves to DONE', async () => {
    await updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' });
    const data = updateRecMock.mock.calls[0][0].data;
    expect(data.status).toBe('DONE');
    expect(data.closedById).toBe('usr_9');
    expect(data.completedAt).toBeInstanceOf(Date);
  });

  it('rejects cross-tenant record', async () => {
    findUniqueRecMock.mockResolvedValue({ id: 'rec_1', equipmentId: 'eq_1', completedAt: null, startedAt: null, tenantId: 'other' });
    await expect(
      updateMaintenance('eq_1', 'rec_1', { status: 'DONE' }, { tenantId: 'orion', userId: 'usr_9' }),
    ).rejects.toThrow('Maintenance record not found');
  });
});
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/modules/equipment/application/commands/__tests__/equipment-maintenance.test.ts`
Expected: FAIL — поля `priority`/`assigneeId`/`faultCause`/`partsUsedText`/`startedAt`/`closedById` не сохраняются; `updateMaintenance` не принимает `userId` в ctx.

- [ ] **Step 3: Расширить `MaintenanceInput` и обе команды**

В `src/modules/equipment/application/commands/equipment-maintenance.ts`:

Заменить тип статуса и добавить приоритет в начале файла:
```typescript
export type MaintenanceType = 'SCHEDULED' | 'REPAIR' | 'FAULT' | 'INSPECTION';
export type MaintenanceStatus = 'PLANNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';
export type MaintenancePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
```

Расширить `MaintenanceInput`:
```typescript
export interface MaintenanceInput {
  type: MaintenanceType;
  status?: MaintenanceStatus;
  priority?: MaintenancePriority;
  title: string;
  description?: string;
  scheduledAt?: string | Date | null;
  completedAt?: string | Date | null;
  startedAt?: string | Date | null;
  engineHoursAtService?: number | null;
  laborHours?: number | null;
  cost?: number | null;
  performedBy?: string | null;
  assigneeId?: string | null;
  faultCause?: string | null;
  partsUsedText?: string | null;
}
```

В `createMaintenance` добавить новые поля в объект `data` (внутри `db.maintenanceRecord.create`):
```typescript
      priority: input.priority ?? 'NORMAL',
      assigneeId: input.assigneeId ?? null,
      startedAt: toDate(input.startedAt),
      laborHours: input.laborHours ?? null,
      faultCause: input.faultCause?.trim() || null,
      partsUsedText: input.partsUsedText?.trim() ?? '',
```

Изменить сигнатуру `updateMaintenance` ctx на `{ tenantId: string; userId?: string | null }`, расширить `select` существующей `findUnique` добавлением `startedAt: true`, и в построении `data` добавить:
```typescript
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.assigneeId !== undefined) data.assigneeId = input.assigneeId ?? null;
  if (input.laborHours !== undefined) data.laborHours = input.laborHours ?? null;
  if (input.faultCause !== undefined) data.faultCause = input.faultCause?.trim() || null;
  if (input.partsUsedText !== undefined) data.partsUsedText = input.partsUsedText?.trim() ?? '';
  if (input.startedAt !== undefined) data.startedAt = toDate(input.startedAt);
```

И в блоке обработки статуса (где сейчас обрабатывается `DONE`) дополнить переходы:
```typescript
  if (input.status !== undefined) {
    data.status = input.status;
    if (input.status === 'IN_PROGRESS' && !existing.startedAt) {
      data.startedAt = new Date();
    }
    if (input.status === 'DONE') {
      if (input.completedAt === undefined && !existing.completedAt) data.completedAt = new Date();
      data.closedById = ctx.userId ?? null;
    }
  }
```

- [ ] **Step 4: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/modules/equipment/application/commands/__tests__/equipment-maintenance.test.ts`
Expected: PASS (все кейсы).

- [ ] **Step 5: Commit**

```bash
git add src/modules/equipment/application/commands/equipment-maintenance.ts src/modules/equipment/application/commands/__tests__/equipment-maintenance.test.ts
git commit -m "feat(maintenance): extend work order commands with assignee, priority, lifecycle"
```

---

## Task 3: Запрос глобального списка нарядов `listAllMaintenance`

**Files:**
- Test: `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts` (дополнить)
- Modify: `src/modules/equipment/application/queries/equipment-query.service.ts`
- Modify: `src/modules/equipment/index.ts`

- [ ] **Step 1: Написать падающий тест**

Дополнить `src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts` новым блоком (моки `db.maintenanceRecord.findMany` добавить в существующий `vi.mock`, если его там нет):

```typescript
describe('listAllMaintenance', () => {
  it('scopes by tenantId and applies status filter', async () => {
    findManyRecMock.mockResolvedValue([{ id: 'rec_1' }]);
    const { listAllMaintenance } = await import('../equipment-query.service');
    await listAllMaintenance('orion', { status: 'PLANNED' });

    const arg = findManyRecMock.mock.calls[0][0];
    expect(arg.where.tenantId).toBe('orion');
    expect(arg.where.status).toBe('PLANNED');
  });

  it('throws when tenantId is empty (fail-closed)', async () => {
    const { listAllMaintenance } = await import('../equipment-query.service');
    await expect(listAllMaintenance('', {})).rejects.toThrow();
  });
});
```

> Если в файле теста ещё нет мока `findMany` для `maintenanceRecord`, добавить `findManyRecMock` в `vi.hoisted` и в `vi.mock('@/lib/db', ...)` под `maintenanceRecord: { findMany: findManyRecMock }`.

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `npx vitest run src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts -t listAllMaintenance`
Expected: FAIL — `listAllMaintenance` не существует.

- [ ] **Step 3: Реализовать `listAllMaintenance`**

В `src/modules/equipment/application/queries/equipment-query.service.ts` добавить:

```typescript
export interface MaintenanceListFilter {
  status?: 'PLANNED' | 'ASSIGNED' | 'IN_PROGRESS' | 'ON_HOLD' | 'DONE' | 'CANCELLED';
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'CRITICAL';
  assigneeId?: string;
  type?: 'SCHEDULED' | 'REPAIR' | 'FAULT' | 'INSPECTION';
}

export async function listAllMaintenance(tenantId: string, filter: MaintenanceListFilter) {
  if (!tenantId) throw new Error('tenantId is required'); // fail-closed (IDOR guard)
  return db.maintenanceRecord.findMany({
    where: {
      tenantId,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.priority ? { priority: filter.priority } : {}),
      ...(filter.assigneeId ? { assigneeId: filter.assigneeId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    include: { equipment: { select: { id: true, name: true, model: true } } },
    orderBy: [{ priority: 'desc' }, { scheduledAt: 'asc' }, { createdAt: 'desc' }],
    take: 500,
  });
}
```

(Убедиться, что `db` уже импортирован в файле; если нет — `import { db } from '@/lib/db';`.)

- [ ] **Step 4: Экспортировать из модуля**

В `src/modules/equipment/index.ts` в строке экспорта queries добавить `listAllMaintenance` и тип:
```typescript
export { /* ...existing..., */ listAllMaintenance } from './application/queries/equipment-query.service';
export type { MaintenanceListFilter } from './application/queries/equipment-query.service';
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `npx vitest run src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts -t listAllMaintenance`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/equipment/application/queries/equipment-query.service.ts src/modules/equipment/application/queries/__tests__/equipment-query.service.test.ts src/modules/equipment/index.ts
git commit -m "feat(maintenance): add global work order list query"
```

---

## Task 4: Расширить роуты по машине (создание/обновление наряда)

**Files:**
- Modify: `src/app/api/equipment/[id]/maintenance/route.ts:11-26` (схема создания)
- Modify: `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts` (схема обновления + проброс userId)

- [ ] **Step 1: Расширить `createSchema` и enum статусов**

В `src/app/api/equipment/[id]/maintenance/route.ts` заменить enum статусов и схему (строки 12-26):

```typescript
const statusEnum = z.enum(['PLANNED', 'ASSIGNED', 'IN_PROGRESS', 'ON_HOLD', 'DONE', 'CANCELLED']);
const priorityEnum = z.enum(['LOW', 'NORMAL', 'HIGH', 'CRITICAL']);

const createSchema = z.object({
  type: typeEnum,
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  scheduledAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  completedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  startedAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  engineHoursAtService: z.preprocess(emptyToUndef, z.coerce.number().int().min(0)).optional().nullable(),
  laborHours: z.preprocess(emptyToUndef, z.coerce.number().min(0)).optional().nullable(),
  cost: z.preprocess(emptyToUndef, z.coerce.number().min(0)).optional().nullable(),
  performedBy: z.string().max(200).optional().nullable(),
  assigneeId: z.string().optional().nullable(),
  faultCause: z.string().max(2000).optional().nullable(),
  partsUsedText: z.string().max(2000).optional().nullable(),
});
```

- [ ] **Step 2: Расширить схему обновления и пробросить `userId` в `updateMaintenance`**

В `src/app/api/equipment/[id]/maintenance/[recordId]/route.ts` привести схему обновления к тем же полям (все `.optional()`), и в вызове передать ctx с `userId`:

```typescript
await updateMaintenance(id, recordId, parsed.data, { tenantId, userId: user!.id });
```

(Если в файле объявлен свой `updateSchema` с фиксированным enum статусов — синхронизировать его с `statusEnum`/`priorityEnum` выше.)

- [ ] **Step 3: Проверить типизацию**

Run: `npx tsc --noEmit`
Expected: без ошибок в изменённых файлах.

- [ ] **Step 4: Commit**

```bash
git add "src/app/api/equipment/[id]/maintenance/route.ts" "src/app/api/equipment/[id]/maintenance/[recordId]/route.ts"
git commit -m "feat(maintenance): accept work order fields in equipment maintenance routes"
```

---

## Task 5: Роут глобального списка нарядов `GET /api/maintenance`

**Files:**
- Create: `src/app/api/maintenance/route.ts`

- [ ] **Step 1: Создать роут**

Создать `src/app/api/maintenance/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listAllMaintenance } from '@/modules/equipment';
import { withApi } from '@/core/api-wrapper';

export const runtime = 'nodejs';

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');

    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) {
      return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    }

    const sp = request.nextUrl.searchParams;
    const records = await listAllMaintenance(tenantId, {
      status: sp.get('status') as never ?? undefined,
      priority: sp.get('priority') as never ?? undefined,
      assigneeId: sp.get('assigneeId') ?? undefined,
      type: sp.get('type') as never ?? undefined,
    });
    return NextResponse.json({ records });
  },
  { domain: 'equipment.maintenance' }
);
```

- [ ] **Step 2: Проверить типизацию и сборку роутов**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Ручная проверка (dev-сервер запущен)**

Run:
```bash
curl -s "http://localhost:3000/api/maintenance?status=PLANNED" -H "Cookie: <сессия админа>" | head
```
Expected: JSON `{ "records": [...] }` (или 401 без сессии — что подтверждает работу авторизации).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/maintenance/route.ts
git commit -m "feat(maintenance): add global work order list endpoint"
```

---

## Task 6: Финальная проверка P1a

- [ ] **Step 1: Прогнать все тесты модуля equipment**

Run: `npx vitest run src/modules/equipment`
Expected: все тесты PASS.

- [ ] **Step 2: Полная типизация**

Run: `npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Lint изменённых файлов**

Run: `npx eslint src/modules/equipment src/app/api/maintenance "src/app/api/equipment/[id]/maintenance"`
Expected: без ошибок.

---

## Self-Review (выполнено автором плана)

- **Покрытие спека §2.1/§3:** поля наряда (assignee/priority/startedAt/laborHours/faultCause/partsUsedText/closedById) — Task 1-2; команды — Task 2; глобальный список — Task 3; роуты — Task 4-5. Tenant-scoping/fail-closed — тесты Task 2-3. ✔
- **Осознанно отложено вне P1a:** `pmRuleId` (нет `MaintenancePlan` до P3), фото/Media (P1b), чек-листы (P4), UI (P1b). Помечено в шапке — это не пропуск, а граница инкремента.
- **Плейсхолдеры:** отсутствуют — в каждом шаге реальный код/команда/ожидаемый вывод.
- **Консистентность типов:** `MaintenanceStatus`/`MaintenancePriority` совпадают в схеме, командах, Zod и фильтре; ctx `updateMaintenance` использует `userId` в Task 2 и Task 4 одинаково; `listAllMaintenance(tenantId, filter)` — одна сигнатура в Task 3 и Task 5.
