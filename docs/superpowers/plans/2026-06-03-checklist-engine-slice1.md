# Движок чек-листов — Срез 1 (ядро + ЕО) — План реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать структурированные осмотры по чек-листам (ЕО): админ заводит шаблон → машинист проводит осмотр закреплённой техники с фото и Health Score → серверная проверка обязательных пунктов/фото → подпись → история.

**Architecture:** Новая доменная граница `src/modules/inspections` (подход А — осмотр отдельная сущность). 5 новых таблиц поверх существующих `Equipment`/медиа/обёрток — без дублирования наряда. Тонкие client-компоненты, бизнес-логика и проверки на сервере; чистые функции (Health Score, проверка полноты) вынесены и покрыты юнит-тестами.

**Tech Stack:** Next.js App Router, Prisma 7 + PostgreSQL (tenantId + RLS), Zod, Vitest, Tailwind + shadcn/ui, существующий медиа-сервис.

**Связанный спец:** `docs/superpowers/specs/2026-06-03-checklist-engine-slice1-design.md`. Реальные чек-листы — в `2026-06-03-maintenance-redesign-notes.md` (§12d-CANON — ЕО гидромолота для сида).

---

## Структура файлов

Prisma / БД:
- Modify `prisma/schema.prisma` — 5 моделей + 3 enum + back-relation в `Equipment`
- Create `prisma/migrations/<ts>_checklist_engine_slice1/migration.sql` (через `prisma migrate dev`)
- Create миграция RLS-политик (отдельным логическим шагом)

Домен `src/modules/inspections/`:
- Create `domain/inspection-logic.ts` — чистые `computeHealthScore`, `findMissing` (+ типы)
- Create `domain/__tests__/inspection-logic.test.ts`
- Create `application/queries/template-query.service.ts` — `listTemplates`, `getTemplate`
- Create `application/queries/inspection-query.service.ts` — `listInspections`, `getInspection`
- Create `application/commands/template-commands.ts` — `createTemplate`, `updateTemplate`, `deleteTemplate`
- Create `application/commands/inspection-commands.ts` — `startInspection`, `saveAnswers`, `completeInspection`
- Create `application/**/__tests__/*.test.ts`
- Create `index.ts` — публичные экспорты модуля

API `src/app/api/`:
- Create `checklist-templates/route.ts` (GET, POST)
- Create `checklist-templates/[id]/route.ts` (PUT, DELETE)
- Create `inspections/route.ts` (GET, POST)
- Create `inspections/[id]/route.ts` (GET, PUT)
- Create `inspections/[id]/complete/route.ts` (POST)

UI `src/`:
- Create `components/piling/inspections/*` (список, форма осмотра, редактор шаблона, блок на карточке установки)
- Create `app/(app)/inspections/page.tsx`, `app/(app)/admin/checklists/page.tsx` (+ `[id]`)
- Modify `app/(app)/layout.tsx` — пункты меню

Seed:
- Modify `prisma/seed.ts` — шаблон «ЕО гидромолота» (dev/CI only)

---

## Task 1: Prisma-схема (модели + enum)

**Files:**
- Modify: `prisma/schema.prisma` (добавить в конец секции моделей)

- [ ] **Step 1: Добавить enum и модели** (вставить рядом с `MaintenanceRecord`):

```prisma
enum ChecklistLevel { EO TO1 TO2 TO3 SEASONAL }
enum AnswerType { YES_NO STATUS4 DONE MEASURE }
enum InspectionStatus { DRAFT COMPLETED }

model ChecklistTemplate {
  id             String   @id @default(cuid())
  tenantId       String
  name           String
  level          ChecklistLevel
  appliesToModel String?
  isActive       Boolean  @default(true)
  createdById    String?
  createdAt      DateTime @default(now()) @db.Timestamptz(3)
  updatedAt      DateTime @updatedAt      @db.Timestamptz(3)
  sections       ChecklistSection[]
  inspections    Inspection[]
  @@index([tenantId])
  @@index([tenantId, level])
}

model ChecklistSection {
  id         String @id @default(cuid())
  tenantId   String
  templateId String
  title      String
  order      Int
  items      ChecklistItem[]
  template   ChecklistTemplate @relation(fields: [templateId], references: [id], onDelete: Cascade)
  @@index([tenantId])
  @@index([templateId])
}

model ChecklistItem {
  id            String     @id @default(cuid())
  tenantId      String
  sectionId     String
  text          String
  answerType    AnswerType @default(YES_NO)
  unit          String?
  norm          String?
  provenance    String?
  photoRequired Boolean    @default(false)
  required      Boolean    @default(true)
  order         Int
  section       ChecklistSection @relation(fields: [sectionId], references: [id], onDelete: Cascade)
  @@index([tenantId])
  @@index([sectionId])
}

model Inspection {
  id               String   @id @default(cuid())
  tenantId         String
  equipmentId      String
  templateId       String
  level            ChecklistLevel
  performedById    String
  shift            String?
  inspectionDate   DateTime @db.Timestamptz(3)
  engineHours      Int?
  healthScore      Int?
  status           InspectionStatus @default(DRAFT)
  templateSnapshot Json
  signedByName     String?
  signedAt         DateTime? @db.Timestamptz(3)
  createdAt        DateTime @default(now()) @db.Timestamptz(3)
  updatedAt        DateTime @updatedAt      @db.Timestamptz(3)
  answers          InspectionAnswer[]
  equipment        Equipment        @relation(fields: [equipmentId], references: [id], onDelete: Cascade)
  template         ChecklistTemplate @relation(fields: [templateId], references: [id], onDelete: Restrict)
  @@index([tenantId])
  @@index([tenantId, equipmentId])
  @@index([tenantId, status])
}

model InspectionAnswer {
  id           String @id @default(cuid())
  tenantId     String
  inspectionId String
  itemId       String
  result       String
  value        String?
  note         String?
  photoCount   Int    @default(0)
  inspection   Inspection @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  @@index([tenantId])
  @@index([inspectionId])
}
```

- [ ] **Step 2: Добавить back-relation в `Equipment`** — найти `model Equipment {` и в секцию связей добавить строку:

```prisma
  inspections Inspection[]
```

- [ ] **Step 3: Проверить синтаксис схемы**

Run: `npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma
git commit -m "feat(inspections): add checklist engine prisma models"
```
(Завершай каждое сообщение коммита: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`)

---

## Task 2: Миграция + генерация клиента

**Files:**
- Create: `prisma/migrations/<timestamp>_checklist_engine_slice1/migration.sql` (генерируется)

- [ ] **Step 1: Создать и применить миграцию (локальная dev-БД должна быть поднята)**

Run: `npx prisma migrate dev --name checklist_engine_slice1`
Expected: создаётся папка миграции, печатается `Your database is now in sync with your schema`, и клиент регенерируется.

- [ ] **Step 2: Проверить, что таблицы созданы**

Run: `docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -tc "SELECT count(*) FROM information_schema.tables WHERE table_name IN ('ChecklistTemplate','ChecklistSection','ChecklistItem','Inspection','InspectionAnswer');"`
Expected: `5`

- [ ] **Step 3: Перегенерировать типизированный клиент (патч postgres-client)**

Run: `npm run db:generate`
Expected: без ошибок.

- [ ] **Step 4: Commit**

```bash
git add prisma/migrations
git commit -m "feat(inspections): migration for checklist engine tables"
```

---

## Task 3: RLS-политики для новых таблиц

**Files:**
- Create: `prisma/migrations/<timestamp>_checklist_engine_rls/migration.sql`

- [ ] **Step 1: Посмотреть существующий паттерн RLS** — открыть `prisma/migrations/20260516100000_extend_rls_tenant_scoped/migration.sql` и скопировать блок политики для одной tenant-scoped таблицы (как устанавливается tenant GUC и `USING`/`WITH CHECK`). Этот же шаблон применить к 5 новым таблицам.

- [ ] **Step 2: Создать пустую миграцию и вписать SQL**

Run: `npx prisma migrate dev --create-only --name checklist_engine_rls`
Затем в созданный `migration.sql` добавить для КАЖДОЙ из таблиц `ChecklistTemplate`, `ChecklistSection`, `ChecklistItem`, `Inspection`, `InspectionAnswer` ровно тот же набор команд, что в эталонной миграции (включить RLS + политики по tenant), подставив имя таблицы. Пример формы (сверить точные имена GUC/политик с эталоном):

```sql
ALTER TABLE "ChecklistTemplate" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "ChecklistTemplate"
  USING ("tenantId" = current_setting('app.current_tenant', true))
  WITH CHECK ("tenantId" = current_setting('app.current_tenant', true));
-- повторить для ChecklistSection, ChecklistItem, Inspection, InspectionAnswer
```
> ВАЖНО: имя GUC (`app.current_tenant` или иное) и имя политики взять ИЗ эталонной миграции, не выдумывать.

- [ ] **Step 3: Применить**

Run: `npx prisma migrate dev`
Expected: `Your database is now in sync`.

- [ ] **Step 4: Проверить, что RLS включён**

Run: `docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -tc "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('ChecklistTemplate','Inspection');"`
Expected: обе строки с `t`.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations
git commit -m "feat(inspections): RLS policies for checklist tables"
```

---

## Task 4: Чистая логика — Health Score и проверка полноты (TDD)

**Files:**
- Create: `src/modules/inspections/domain/inspection-logic.ts`
- Test: `src/modules/inspections/domain/__tests__/inspection-logic.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { computeHealthScore, findMissing, type SnapItem, type AnswerLike } from '../inspection-logic';

const items: SnapItem[] = [
  { id: 'a', answerType: 'YES_NO', required: true, photoRequired: false },
  { id: 'b', answerType: 'STATUS4', required: true, photoRequired: true },
  { id: 'c', answerType: 'STATUS4', required: false, photoRequired: false },
  { id: 'd', answerType: 'DONE', required: true, photoRequired: false },
];

describe('computeHealthScore', () => {
  it('ok = YES/OK/DONE; NA excluded from denominator', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: 'YES', photoCount: 0 },
      { itemId: 'b', result: 'OK', photoCount: 1 },
      { itemId: 'c', result: 'NA', photoCount: 0 },
      { itemId: 'd', result: 'NOT_DONE', photoCount: 0 },
    ];
    // applicable = a,b,d (c is NA) => 2 ok of 3 => 67
    expect(computeHealthScore(items, answers)).toBe(67);
  });
  it('returns 100 when all applicable are ok', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: 'YES', photoCount: 0 },
      { itemId: 'b', result: 'OK', photoCount: 1 },
      { itemId: 'd', result: 'DONE', photoCount: 0 },
    ];
    expect(computeHealthScore(items, answers)).toBe(100);
  });
  it('returns 0 when no applicable answers', () => {
    expect(computeHealthScore(items, [])).toBe(0);
  });
});

describe('findMissing', () => {
  it('flags unanswered required items and required-photo items without photos', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: '', photoCount: 0 },     // required, empty -> missing answer
      { itemId: 'b', result: 'OK', photoCount: 0 },   // photoRequired, no photo -> missing photo
      // 'd' required, no answer at all -> missing answer
    ];
    const res = findMissing(items, answers);
    expect(res.missingAnswers.sort()).toEqual(['a', 'd']);
    expect(res.missingPhotos).toEqual(['b']);
  });
  it('passes when all required answered and photos present', () => {
    const answers: AnswerLike[] = [
      { itemId: 'a', result: 'YES', photoCount: 0 },
      { itemId: 'b', result: 'OK', photoCount: 2 },
      { itemId: 'd', result: 'DONE', photoCount: 0 },
    ];
    const res = findMissing(items, answers);
    expect(res.missingAnswers).toEqual([]);
    expect(res.missingPhotos).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `npx vitest run src/modules/inspections/domain/__tests__/inspection-logic.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
export type AnswerType = 'YES_NO' | 'STATUS4' | 'DONE' | 'MEASURE';

export interface SnapItem {
  id: string;
  answerType: AnswerType;
  required: boolean;
  photoRequired: boolean;
}
export interface AnswerLike {
  itemId: string;
  result: string;
  value?: string | null;
  photoCount: number;
}

const OK_RESULTS = new Set(['YES', 'OK', 'DONE']);
const NA_RESULTS = new Set(['NA']);

export function computeHealthScore(items: SnapItem[], answers: AnswerLike[]): number {
  const byId = new Map(answers.map((a) => [a.itemId, a]));
  let applicable = 0;
  let ok = 0;
  for (const it of items) {
    const a = byId.get(it.id);
    if (!a || a.result === '' || NA_RESULTS.has(a.result)) continue; // unanswered/NA excluded
    applicable += 1;
    if (OK_RESULTS.has(a.result)) ok += 1;
  }
  if (applicable === 0) return 0;
  return Math.round((ok / applicable) * 100);
}

export function findMissing(
  items: SnapItem[],
  answers: AnswerLike[],
): { missingAnswers: string[]; missingPhotos: string[] } {
  const byId = new Map(answers.map((a) => [a.itemId, a]));
  const missingAnswers: string[] = [];
  const missingPhotos: string[] = [];
  for (const it of items) {
    const a = byId.get(it.id);
    const answered = !!a && a.result !== '';
    if (it.required && !answered) missingAnswers.push(it.id);
    if (it.photoRequired && (!a || a.photoCount < 1)) missingPhotos.push(it.id);
  }
  return { missingAnswers, missingPhotos };
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `npx vitest run src/modules/inspections/domain/__tests__/inspection-logic.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/modules/inspections/domain
git commit -m "feat(inspections): pure health-score and completeness logic"
```

---

## Task 5: Запросы шаблонов (TDD)

**Files:**
- Create: `src/modules/inspections/application/queries/template-query.service.ts`
- Test: `src/modules/inspections/application/queries/__tests__/template-query.service.test.ts`

- [ ] **Step 1: Failing test** (мок `@/lib/db`):

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyMock, findUniqueMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(), findUniqueMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { checklistTemplate: { findMany: findManyMock, findUnique: findUniqueMock } },
}));
import { listTemplates, getTemplate } from '../template-query.service';

describe('listTemplates', () => {
  beforeEach(() => { findManyMock.mockReset(); findManyMock.mockResolvedValue([]); });
  it('scopes to tenant and active, supports level filter', async () => {
    await listTemplates('orion', { level: 'EO' });
    const arg = findManyMock.mock.calls[0][0];
    expect(arg.where).toEqual({ tenantId: 'orion', isActive: true, level: 'EO' });
  });
  it('throws when tenantId empty (fail-closed)', async () => {
    await expect(listTemplates('', {})).rejects.toThrow();
  });
});

describe('getTemplate', () => {
  beforeEach(() => { findUniqueMock.mockReset(); });
  it('returns template with sections+items when tenant matches', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'orion', sections: [] });
    const t = await getTemplate('t1', 'orion');
    expect(t.id).toBe('t1');
  });
  it('throws 404 on cross-tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'other' });
    await expect(getTemplate('t1', 'orion')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

Run: `npx vitest run src/modules/inspections/application/queries/__tests__/template-query.service.test.ts`

- [ ] **Step 3: Implement**

```typescript
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { ChecklistLevel } from '@/generated/postgres-client';

export async function listTemplates(
  tenantId: string,
  filter: { level?: ChecklistLevel } = {},
) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.checklistTemplate.findMany({
    where: { tenantId, isActive: true, ...(filter.level ? { level: filter.level } : {}) },
    orderBy: [{ level: 'asc' }, { name: 'asc' }],
  });
}

export async function getTemplate(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const t = await db.checklistTemplate.findUnique({
    where: { id },
    include: { sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } } },
  });
  if (!t || t.tenantId !== tenantId) throw new ServiceError('Template not found', 404);
  return t;
}
```
> Если импорт типа `ChecklistLevel` из `@/generated/postgres-client` не резолвится — взять путь как в других сервисах (`@/generated/postgres-client/client`); проверить, как импортируются enum в `src/modules/equipment`.

- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add src/modules/inspections/application/queries/template-query.service.ts src/modules/inspections/application/queries/__tests__/template-query.service.test.ts
git commit -m "feat(inspections): template queries"
```

---

## Task 6: Команды шаблонов (TDD)

**Files:**
- Create: `src/modules/inspections/application/commands/template-commands.ts`
- Test: `src/modules/inspections/application/commands/__tests__/template-commands.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { createMock, updateMock, findUniqueMock } = vi.hoisted(() => ({
  createMock: vi.fn(), updateMock: vi.fn(), findUniqueMock: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: { checklistTemplate: { create: createMock, update: updateMock, findUnique: findUniqueMock } },
}));
import { createTemplate, deleteTemplate } from '../template-commands';

beforeEach(() => { createMock.mockReset(); updateMock.mockReset(); findUniqueMock.mockReset(); });

describe('createTemplate', () => {
  it('writes tenantId on template, sections and items', async () => {
    createMock.mockResolvedValue({ id: 't1' });
    await createTemplate({
      name: 'ЕО гидромолота', level: 'EO', appliesToModel: 'HHK7A',
      sections: [{ title: 'Гидросистема', order: 0, items: [
        { text: 'РВД без течей', answerType: 'YES_NO', required: true, photoRequired: false, order: 0 },
      ]}],
    }, { tenantId: 'orion', createdById: 'u1' });
    const data = createMock.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.sections.create[0].tenantId).toBe('orion');
    expect(data.sections.create[0].items.create[0].tenantId).toBe('orion');
  });
  it('throws when tenantId empty', async () => {
    await expect(createTemplate({ name: 'x', level: 'EO', sections: [] }, { tenantId: '' })).rejects.toThrow();
  });
});

describe('deleteTemplate', () => {
  it('soft-deactivates own-tenant template', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'orion' });
    updateMock.mockResolvedValue({ id: 't1', isActive: false });
    await deleteTemplate('t1', 'orion');
    expect(updateMock.mock.calls[0][0]).toMatchObject({ where: { id: 't1' }, data: { isActive: false } });
  });
  it('throws 404 cross-tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 't1', tenantId: 'other' });
    await expect(deleteTemplate('t1', 'orion')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement**

```typescript
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import type { AnswerType, ChecklistLevel } from '@/generated/postgres-client';

export interface TemplateItemInput {
  text: string; answerType: AnswerType; unit?: string | null; norm?: string | null;
  provenance?: string | null; photoRequired: boolean; required: boolean; order: number;
}
export interface TemplateSectionInput { title: string; order: number; items: TemplateItemInput[] }
export interface TemplateInput {
  name: string; level: ChecklistLevel; appliesToModel?: string | null; sections: TemplateSectionInput[];
}

export async function createTemplate(input: TemplateInput, ctx: { tenantId: string; createdById?: string | null }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  return db.checklistTemplate.create({
    data: {
      tenantId: ctx.tenantId,
      name: input.name.trim(),
      level: input.level,
      appliesToModel: input.appliesToModel?.trim() || null,
      createdById: ctx.createdById ?? null,
      sections: {
        create: input.sections.map((s) => ({
          tenantId: ctx.tenantId,
          title: s.title.trim(),
          order: s.order,
          items: {
            create: s.items.map((i) => ({
              tenantId: ctx.tenantId,
              text: i.text.trim(),
              answerType: i.answerType,
              unit: i.unit?.trim() || null,
              norm: i.norm?.trim() || null,
              provenance: i.provenance?.trim() || null,
              photoRequired: i.photoRequired,
              required: i.required,
              order: i.order,
            })),
          },
        })),
      },
    },
  });
}

// Update = деактивировать старый + создать новый (проще и безопаснее, чем диффить вложенные пункты).
export async function updateTemplate(id: string, input: TemplateInput, ctx: { tenantId: string; createdById?: string | null }) {
  await deleteTemplate(id, ctx.tenantId);
  return createTemplate(input, ctx);
}

export async function deleteTemplate(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const existing = await db.checklistTemplate.findUnique({ where: { id }, select: { id: true, tenantId: true } });
  if (!existing || existing.tenantId !== tenantId) throw new ServiceError('Template not found', 404);
  return db.checklistTemplate.update({ where: { id }, data: { isActive: false } });
}
```

- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add src/modules/inspections/application/commands/template-commands.ts src/modules/inspections/application/commands/__tests__/template-commands.test.ts
git commit -m "feat(inspections): template commands (create/update/deactivate)"
```

---

## Task 7: Команды осмотра — start/save/complete (TDD)

**Files:**
- Create: `src/modules/inspections/application/commands/inspection-commands.ts`
- Test: `src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({
  tplFindUnique: vi.fn(), eqFindUnique: vi.fn(),
  insCreate: vi.fn(), insFindUnique: vi.fn(), insUpdate: vi.fn(),
  ansDeleteMany: vi.fn(), ansCreateMany: vi.fn(),
}));
vi.mock('@/lib/db', () => ({
  db: {
    checklistTemplate: { findUnique: m.tplFindUnique },
    equipment: { findUnique: m.eqFindUnique },
    inspection: { create: m.insCreate, findUnique: m.insFindUnique, update: m.insUpdate },
    inspectionAnswer: { deleteMany: m.ansDeleteMany, createMany: m.ansCreateMany },
  },
}));
import { startInspection, completeInspection } from '../inspection-commands';

beforeEach(() => Object.values(m).forEach((fn) => fn.mockReset()));

describe('startInspection', () => {
  it('snapshots template items and writes tenant-scoped inspection', async () => {
    m.eqFindUnique.mockResolvedValue({ id: 'eq1', tenantId: 'orion' });
    m.tplFindUnique.mockResolvedValue({ id: 't1', tenantId: 'orion', level: 'EO',
      sections: [{ items: [{ id: 'i1', text: 'x', answerType: 'YES_NO', required: true, photoRequired: false }] }] });
    m.insCreate.mockResolvedValue({ id: 'ins1' });
    await startInspection({ equipmentId: 'eq1', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1' });
    const data = m.insCreate.mock.calls[0][0].data;
    expect(data.tenantId).toBe('orion');
    expect(data.status).toBe('DRAFT');
    expect(Array.isArray(data.templateSnapshot)).toBe(true);
    expect(data.templateSnapshot[0].id).toBe('i1');
  });
  it('throws 404 if equipment cross-tenant', async () => {
    m.eqFindUnique.mockResolvedValue(null);
    await expect(startInspection({ equipmentId: 'x', templateId: 't1', inspectionDate: '2026-06-03' },
      { tenantId: 'orion', userId: 'u1' })).rejects.toThrow('Equipment not found');
  });
});

describe('completeInspection', () => {
  it('rejects when required items unanswered (no status change)', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [],
    });
    await expect(completeInspection('ins1', { tenantId: 'orion', signedByName: 'Иванов' }))
      .rejects.toThrow(/не заполнен/i);
    expect(m.insUpdate).not.toHaveBeenCalled();
  });
  it('completes and stores health score when all required answered', async () => {
    m.insFindUnique.mockResolvedValue({
      id: 'ins1', tenantId: 'orion', status: 'DRAFT',
      templateSnapshot: [{ id: 'i1', answerType: 'YES_NO', required: true, photoRequired: false }],
      answers: [{ itemId: 'i1', result: 'YES', photoCount: 0 }],
    });
    m.insUpdate.mockResolvedValue({ id: 'ins1', status: 'COMPLETED', healthScore: 100 });
    const res = await completeInspection('ins1', { tenantId: 'orion', signedByName: 'Иванов' });
    const data = m.insUpdate.mock.calls[0][0].data;
    expect(data.status).toBe('COMPLETED');
    expect(data.healthScore).toBe(100);
    expect(data.signedByName).toBe('Иванов');
    expect(res.healthScore).toBe(100);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement**

```typescript
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';
import { computeHealthScore, findMissing, type SnapItem, type AnswerLike } from '../../domain/inspection-logic';

const toDate = (v: string | Date) => (v instanceof Date ? v : new Date(v));

export async function startInspection(
  input: { equipmentId: string; templateId: string; inspectionDate: string | Date; shift?: string | null; engineHours?: number | null },
  ctx: { tenantId: string; userId: string },
) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const eq = await db.equipment.findUnique({ where: { id: input.equipmentId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!eq) throw new ServiceError('Equipment not found', 404);
  const tpl = await db.checklistTemplate.findUnique({
    where: { id: input.templateId },
    include: { sections: { orderBy: { order: 'asc' }, include: { items: { orderBy: { order: 'asc' } } } } },
  });
  if (!tpl || tpl.tenantId !== ctx.tenantId) throw new ServiceError('Template not found', 404);

  const snapshot = tpl.sections.flatMap((s) =>
    s.items.map((i) => ({
      id: i.id, sectionTitle: s.title, text: i.text, answerType: i.answerType,
      unit: i.unit, norm: i.norm, provenance: i.provenance, required: i.required, photoRequired: i.photoRequired,
    })),
  );

  return db.inspection.create({
    data: {
      tenantId: ctx.tenantId, equipmentId: eq.id, templateId: tpl.id, level: tpl.level,
      performedById: ctx.userId, inspectionDate: toDate(input.inspectionDate),
      shift: input.shift ?? null, engineHours: input.engineHours ?? null,
      status: 'DRAFT', templateSnapshot: snapshot,
    },
  });
}

export interface AnswerInput { itemId: string; result: string; value?: string | null; note?: string | null; photoCount?: number }

export async function saveAnswers(id: string, answers: AnswerInput[], ctx: { tenantId: string }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({ where: { id }, select: { id: true, tenantId: true, status: true } });
  if (!ins || ins.tenantId !== ctx.tenantId) throw new ServiceError('Inspection not found', 404);
  if (ins.status === 'COMPLETED') throw new ServiceError('Inspection already completed', 409);
  await db.inspectionAnswer.deleteMany({ where: { inspectionId: id } });
  if (answers.length) {
    await db.inspectionAnswer.createMany({
      data: answers.map((a) => ({
        tenantId: ctx.tenantId, inspectionId: id, itemId: a.itemId,
        result: a.result, value: a.value ?? null, note: a.note ?? null, photoCount: a.photoCount ?? 0,
      })),
    });
  }
  return db.inspection.findUnique({ where: { id }, include: { answers: true } });
}

export async function completeInspection(id: string, ctx: { tenantId: string; signedByName: string }) {
  if (!ctx.tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({ where: { id }, include: { answers: true } });
  if (!ins || ins.tenantId !== ctx.tenantId) throw new ServiceError('Inspection not found', 404);

  const items = (ins.templateSnapshot as unknown as SnapItem[]) ?? [];
  const answers: AnswerLike[] = ins.answers.map((a) => ({ itemId: a.itemId, result: a.result, photoCount: a.photoCount }));
  const { missingAnswers, missingPhotos } = findMissing(items, answers);
  if (missingAnswers.length || missingPhotos.length) {
    throw new ServiceError(
      `Осмотр не заполнен: пунктов без ответа ${missingAnswers.length}, без обязательного фото ${missingPhotos.length}`,
      400,
    );
  }
  const healthScore = computeHealthScore(items, answers);
  return db.inspection.update({
    where: { id },
    data: { status: 'COMPLETED', healthScore, signedByName: ctx.signedByName, signedAt: new Date() },
  });
}
```

- [ ] **Step 4: Run, confirm PASS** + `npx vitest run src/modules/inspections`.
- [ ] **Step 5: Commit**

```bash
git add src/modules/inspections/application/commands/inspection-commands.ts src/modules/inspections/application/commands/__tests__/inspection-commands.test.ts
git commit -m "feat(inspections): start/save/complete inspection commands"
```

---

## Task 8: Запросы осмотров + видимость (TDD)

**Files:**
- Create: `src/modules/inspections/application/queries/inspection-query.service.ts`
- Test: `src/modules/inspections/application/queries/__tests__/inspection-query.service.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
const { findManyMock, findUniqueMock } = vi.hoisted(() => ({ findManyMock: vi.fn(), findUniqueMock: vi.fn() }));
vi.mock('@/lib/db', () => ({ db: { inspection: { findMany: findManyMock, findUnique: findUniqueMock } } }));
import { listInspections, getInspection } from '../inspection-query.service';

beforeEach(() => { findManyMock.mockReset(); findManyMock.mockResolvedValue([]); findUniqueMock.mockReset(); });

describe('listInspections', () => {
  it('scopes to tenant; equipment filter applied', async () => {
    await listInspections('orion', { equipmentId: 'eq1' }, null);
    expect(findManyMock.mock.calls[0][0].where).toMatchObject({ tenantId: 'orion', equipmentId: 'eq1' });
  });
  it('operator sees only own inspections', async () => {
    await listInspections('orion', {}, 'op1');
    expect(findManyMock.mock.calls[0][0].where).toMatchObject({ tenantId: 'orion', performedById: 'op1' });
  });
  it('throws when tenantId empty', async () => {
    await expect(listInspections('', {}, null)).rejects.toThrow();
  });
});

describe('getInspection', () => {
  it('throws 404 cross-tenant', async () => {
    findUniqueMock.mockResolvedValue({ id: 'i1', tenantId: 'other' });
    await expect(getInspection('i1', 'orion')).rejects.toThrow('not found');
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement**

```typescript
import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export async function listInspections(
  tenantId: string,
  filter: { equipmentId?: string; level?: string },
  operatorUserId: string | null,
) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  return db.inspection.findMany({
    where: {
      tenantId,
      ...(filter.equipmentId ? { equipmentId: filter.equipmentId } : {}),
      ...(filter.level ? { level: filter.level as never } : {}),
      ...(operatorUserId ? { performedById: operatorUserId } : {}),
    },
    include: { equipment: { select: { id: true, name: true, model: true } } },
    orderBy: { inspectionDate: 'desc' },
    take: 200,
  });
}

export async function getInspection(id: string, tenantId: string) {
  if (!tenantId) throw new ServiceError('tenantId is required', 400);
  const ins = await db.inspection.findUnique({
    where: { id },
    include: { answers: true, equipment: { select: { id: true, name: true, model: true } } },
  });
  if (!ins || ins.tenantId !== tenantId) throw new ServiceError('Inspection not found', 404);
  return ins;
}
```

- [ ] **Step 4: Run, confirm PASS.**
- [ ] **Step 5: Commit**

```bash
git add src/modules/inspections/application/queries/inspection-query.service.ts src/modules/inspections/application/queries/__tests__/inspection-query.service.test.ts
git commit -m "feat(inspections): inspection queries with operator scoping"
```

---

## Task 9: Публичные экспорты модуля

**Files:**
- Create: `src/modules/inspections/index.ts`

- [ ] **Step 1: Implement**

```typescript
export { listTemplates, getTemplate } from './application/queries/template-query.service';
export { createTemplate, updateTemplate, deleteTemplate,
  type TemplateInput, type TemplateSectionInput, type TemplateItemInput } from './application/commands/template-commands';
export { startInspection, saveAnswers, completeInspection, type AnswerInput } from './application/commands/inspection-commands';
export { listInspections, getInspection } from './application/queries/inspection-query.service';
```

- [ ] **Step 2:** `npx tsc --noEmit` → clean.
- [ ] **Step 3: Commit**

```bash
git add src/modules/inspections/index.ts
git commit -m "feat(inspections): module public exports"
```

---

## Task 10: API — шаблоны (GET, POST)

**Files:**
- Create: `src/app/api/checklist-templates/route.ts`

- [ ] **Step 1: Implement** (зеркалить `src/app/api/equipment/route.ts`):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listTemplates, createTemplate } from '@/modules/inspections';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const levelEnum = z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL']);
const answerEnum = z.enum(['YES_NO', 'STATUS4', 'DONE', 'MEASURE']);
const itemSchema = z.object({
  text: z.string().trim().min(1).max(500), answerType: answerEnum,
  unit: z.string().max(40).optional().nullable(), norm: z.string().max(300).optional().nullable(),
  provenance: z.string().max(120).optional().nullable(),
  photoRequired: z.boolean().default(false), required: z.boolean().default(true), order: z.number().int().min(0),
});
const sectionSchema = z.object({ title: z.string().trim().min(1).max(200), order: z.number().int().min(0), items: z.array(itemSchema) });
const createSchema = z.object({
  name: z.string().trim().min(1).max(200), level: levelEnum,
  appliesToModel: z.string().max(120).optional().nullable(), sections: z.array(sectionSchema),
});

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const level = request.nextUrl.searchParams.get('level') as never;
  const templates = await listTemplates(tenantId, level ? { level } : {});
  return NextResponse.json({ templates });
}, { domain: 'inspections' });

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) }, { status: 400 });
  }
  try {
    const template = await createTemplate(parsed.data, { tenantId, createdById: user!.id });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });
```

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npx eslint src/app/api/checklist-templates/route.ts`.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/checklist-templates/route.ts
git commit -m "feat(inspections): templates API (list/create)"
```

---

## Task 11: API — шаблон по id (PUT, DELETE)

**Files:**
- Create: `src/app/api/checklist-templates/[id]/route.ts`

- [ ] **Step 1: Implement** — те же `levelEnum/answerEnum/itemSchema/sectionSchema/createSchema`, что в Task 10 (повтори их в этом файле), и:

```typescript
export const PUT = withMutation(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const { id } = await params;
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) }, { status: 400 });
  try {
    const template = await updateTemplate(id, parsed.data, { tenantId, createdById: user!.id });
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });

export const DELETE = withMutation(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const { id } = await params;
  try {
    await deleteTemplate(id, tenantId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });
```
Импорты: `updateTemplate, deleteTemplate` из `@/modules/inspections` (+ те же, что в Task 10).

- [ ] **Step 2:** tsc + eslint clean.
- [ ] **Step 3: Commit**

```bash
git add "src/app/api/checklist-templates/[id]/route.ts"
git commit -m "feat(inspections): template update/deactivate API"
```

---

## Task 12: API — осмотры (GET список, POST старт)

**Files:**
- Create: `src/app/api/inspections/route.ts`

- [ ] **Step 1: Implement** (operator-скоупинг как в `equipment/route.ts`):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listInspections, startInspection } from '@/modules/inspections';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const startSchema = z.object({
  equipmentId: z.string().min(1), templateId: z.string().min(1),
  inspectionDate: z.coerce.date(), shift: z.string().max(20).optional().nullable(),
  engineHours: z.coerce.number().int().min(0).optional().nullable(),
});

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const operatorUserId = user!.role === 'OPERATOR' ? user!.id : null;
  const equipmentId = request.nextUrl.searchParams.get('equipmentId') ?? undefined;
  const level = request.nextUrl.searchParams.get('level') ?? undefined;
  const inspections = await listInspections(tenantId, { equipmentId, level }, operatorUserId);
  return NextResponse.json({ inspections });
}, { domain: 'inspections' });

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
  if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
  const parsed = startSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) }, { status: 400 });
  try {
    const inspection = await startInspection(parsed.data, { tenantId, userId: user!.id });
    return NextResponse.json({ inspection }, { status: 201 });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });
```

- [ ] **Step 2:** tsc + eslint clean.
- [ ] **Step 3: Commit**

```bash
git add src/app/api/inspections/route.ts
git commit -m "feat(inspections): inspections API (list/start)"
```

---

## Task 13: API — осмотр по id (GET, PUT ответы) + complete

**Files:**
- Create: `src/app/api/inspections/[id]/route.ts`
- Create: `src/app/api/inspections/[id]/complete/route.ts`

- [ ] **Step 1: `[id]/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getInspection, saveAnswers } from '@/modules/inspections';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const answersSchema = z.object({
  answers: z.array(z.object({
    itemId: z.string().min(1), result: z.string().max(40),
    value: z.string().max(200).optional().nullable(), note: z.string().max(2000).optional().nullable(),
    photoCount: z.number().int().min(0).optional(),
  })),
});

export const GET = withApi(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const { id } = await params;
  try {
    const inspection = await getInspection(id, tenantId);
    return NextResponse.json({ inspection });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });

export const PUT = withMutation(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const { id } = await params;
  const parsed = answersSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) }, { status: 400 });
  try {
    const inspection = await saveAnswers(id, parsed.data.answers, { tenantId });
    return NextResponse.json({ inspection });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });
```

- [ ] **Step 2: `[id]/complete/route.ts`**

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { completeInspection } from '@/modules/inspections';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';
const schema = z.object({ signedByName: z.string().trim().min(1).max(200) });

export const POST = withMutation(async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;
  assertCan(user!, 'maintenance.manage');
  const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
  const { id } = await params;
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: 'Validation failed' }, { status: 400 });
  try {
    const inspection = await completeInspection(id, { tenantId, signedByName: parsed.data.signedByName });
    return NextResponse.json({ inspection });
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }
}, { domain: 'inspections' });
```

- [ ] **Step 3:** tsc + eslint clean on both.
- [ ] **Step 4: Commit**

```bash
git add "src/app/api/inspections/[id]/route.ts" "src/app/api/inspections/[id]/complete/route.ts"
git commit -m "feat(inspections): inspection detail, answers, complete API"
```

---

## Task 14: Seed — шаблон «ЕО гидромолота»

**Files:**
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Read first** — открыть `prisma/seed.ts`, найти как строится `PrismaPg`-клиент и где список сидов; добавить функцию после существующих сидов, под тем же гардом `assertNotProduction()`/`SKIP_SEED`.

- [ ] **Step 2: Implement** — добавить идемпотентный сид (upsert по `name+tenantId`): шаблон level `EO`, `appliesToModel: 'HHK7A'`, разделы и пункты по §12d-CANON. Минимум 3 раздела с показательными типами:

```typescript
async function seedHydraulicHammerEO(db: PrismaClient, tenantId: string) {
  const exists = await db.checklistTemplate.findFirst({ where: { tenantId, name: 'ЕО гидромолота', level: 'EO' } });
  if (exists) return;
  await db.checklistTemplate.create({
    data: {
      tenantId, name: 'ЕО гидромолота', level: 'EO', appliesToModel: 'HHK7A',
      sections: { create: [
        { tenantId, title: 'Гидросистема', order: 0, items: { create: [
          { tenantId, text: 'РВД без течей и повреждений', answerType: 'YES_NO', required: true, photoRequired: false, order: 0 },
          { tenantId, text: 'Рабочее давление по манометру', answerType: 'MEASURE', unit: 'бар', norm: 'HHK7A ~183, HHK5A ~131', required: true, photoRequired: false, order: 1 },
        ]}},
        { tenantId, title: 'Свайный наголовник', order: 1, items: { create: [
          { tenantId, text: 'Наголовник без трещин', answerType: 'STATUS4', required: true, photoRequired: true, order: 0 },
          { tenantId, text: 'Износ демпферной подушки (Ø600 — замена ≤150 мм)', answerType: 'MEASURE', unit: 'мм', norm: 'замена при ≤150 мм', required: true, photoRequired: false, order: 1 },
        ]}},
        { tenantId, title: 'Смазка', order: 2, items: { create: [
          { tenantId, text: 'Смазка наголовника и направляющих выполнена', answerType: 'DONE', required: true, photoRequired: false, order: 0 },
        ]}},
      ]},
    },
  });
}
```
Вызвать `await seedHydraulicHammerEO(prisma, DEFAULT_TENANT_ID)` рядом с прочими сидами (использовать ту же переменную тенанта, что и в seed.ts).

- [ ] **Step 3: Прогнать сид локально**

Run: `npm run db:seed`
Expected: без ошибок; повторный запуск не дублирует (idempotent).

- [ ] **Step 4: Проверить**

Run: `docker exec -i pilingtrack-postgres psql -U postgres -d pilingtrack_test -tc "SELECT name, level FROM \"ChecklistTemplate\";"`
Expected: строка `ЕО гидромолота | EO`.

- [ ] **Step 5: Commit**

```bash
git add prisma/seed.ts
git commit -m "feat(inspections): seed ЕО гидромолота template (dev/CI)"
```

---

## Task 15: UI — список осмотров + страница

**Files:**
- Create: `src/components/piling/inspections/inspections-list.tsx`
- Create: `src/app/(app)/inspections/page.tsx`

- [ ] **Step 1: Компонент `inspections-list.tsx`** — client-компонент, зеркалить `maintenance-board.tsx`:
  - На монтировании: `GET /api/inspections${query}` → `{ inspections }`; `authFetch`; toast при ошибке; loading/empty как в борде.
  - Строка: `Link` на `/inspections/${i.id}`; `i.equipment?.name`, уровень (бейдж), дата, **Health Score** с цветом (≥90 emerald, 75–89 amber, 50–74 orange, <50 rose), статус (DRAFT/COMPLETED).
  - Кнопка «Провести осмотр» → переход на форму старта (Task 16) или открытие диалога выбора техники+шаблона.
  - Фильтр по уровню (EO/TO1/…), по установке.
  - Локальный интерфейс `InspectionRow { id; level; inspectionDate; healthScore; status; equipment }`.

- [ ] **Step 2: Страница**

```typescript
'use client';
import { InspectionsList } from '@/components/piling/inspections/inspections-list';
export default function InspectionsPage() { return <InspectionsList />; }
```

- [ ] **Step 3:** tsc + eslint clean.
- [ ] **Step 4: Commit**

```bash
git add src/components/piling/inspections/inspections-list.tsx "src/app/(app)/inspections/page.tsx"
git commit -m "feat(inspections): inspections list page"
```

---

## Task 16: UI — форма проведения осмотра

**Files:**
- Create: `src/components/piling/inspections/run-inspection.tsx`
- Create: `src/app/(app)/inspections/new/page.tsx`
- Create: `src/app/(app)/inspections/[id]/page.tsx`

**Контракт потока (точно соблюсти — это и есть ядро Среза 1):**
1. Выбор техники: `GET /api/equipment?limit=100` → `{ data }` (оператору вернётся только закреплённая — фильтрация уже на сервере). Выбор даты/смены/наработки.
2. Выбор шаблона: `GET /api/checklist-templates?level=EO` → `{ templates }`; подсказка: шаблоны с `appliesToModel === equipment.model` показать первыми.
3. Старт: `POST /api/inspections` `{ equipmentId, templateId, inspectionDate, shift, engineHours }` → `{ inspection }` (содержит `templateSnapshot`). Перейти на `/inspections/[id]`.
4. Заполнение (`[id]/page.tsx` рендерит `run-inspection` в режиме редактирования по `GET /api/inspections/[id]`): для каждого пункта `templateSnapshot` показать контрол по `answerType`:
   - `YES_NO` — две кнопки Да/Нет (result `YES`/`NO`)
   - `STATUS4` — сегмент Исправно/Замечание/Неисправно/Не проверено (`OK/REMARK/FAULT/NA`)
   - `DONE` — чекбокс (result `DONE`/`NOT_DONE`)
   - `MEASURE` — числовое поле в `value` (показать `unit` и `norm` подсказкой)
   - на каждом пункте: примечание (textarea) и **фото** через `WorkOrderPhotos`-подобный виджет с `entityType='inspection_answer'`, `entityId=answer.id` (для этого ответы должны быть сохранены — сохранять черновик `PUT /api/inspections/[id]` перед загрузкой фото, чтобы получить `answer.id`; `photoCount` обновлять из ответа `/api/media` списка).
   - Живой Health Score (использовать `computeHealthScore` из `@/modules/inspections/domain/inspection-logic` — чистая функция, можно импортировать в client).
5. Завершение: `POST /api/inspections/[id]/complete` `{ signedByName }`. При 400 — показать сообщение о незаполненных пунктах/фото (сервер вернёт текст). После успеха — на список.

- [ ] **Step 1:** Создать `run-inspection.tsx` по контракту выше, переиспользуя `authFetch`, shadcn (`Button/Input/Label/Textarea/Select/Segmented`), `sonner`. Фото-виджет — вынести/переиспользовать паттерн `work-order-photos.tsx` с параметром `entityType='inspection_answer'` и `entityId`.
- [ ] **Step 2:** Страницы `new/page.tsx` (старт) и `[id]/page.tsx` (заполнение через `use(params)`), как `admin/equipment/[id]/page.tsx`.
- [ ] **Step 3:** tsc + eslint clean.
- [ ] **Step 4: Commit**

```bash
git add src/components/piling/inspections/run-inspection.tsx "src/app/(app)/inspections/new/page.tsx" "src/app/(app)/inspections/[id]/page.tsx"
git commit -m "feat(inspections): run-inspection form with typed items, photos, health score"
```

---

## Task 17: UI — редактор шаблонов (админ)

**Files:**
- Create: `src/components/piling/inspections/template-list.tsx`
- Create: `src/components/piling/inspections/template-editor.tsx`
- Create: `src/app/(app)/admin/checklists/page.tsx`
- Create: `src/app/(app)/admin/checklists/[id]/page.tsx`

**Контракт:**
- `template-list.tsx`: `GET /api/checklist-templates` → `{ templates }`; строки (название, уровень, модель, активен) → `Link` на `/admin/checklists/[id]`; кнопка «Новый шаблон» (создаёт пустой через `POST` и открывает редактор, либо ведёт на `/admin/checklists/new`).
- `template-editor.tsx`: редактирование структуры (разделы → пункты). Поля пункта: `text`, `answerType` (Select из 4), `unit`, `norm`, `provenance`, `photoRequired` (switch), `required` (switch), `order`. Добавление/удаление разделов и пунктов. Сохранение: `PUT /api/checklist-templates/[id]` всем телом (бэкенд делает деактивацию+пересоздание). Для нового — `POST /api/checklist-templates`.
- Страницы — тонкие обёртки (`use(params)` для `[id]`).

- [ ] **Step 1:** Создать `template-list.tsx` + `template-editor.tsx` по контракту.
- [ ] **Step 2:** Страницы `admin/checklists/page.tsx` и `[id]/page.tsx`.
- [ ] **Step 3:** tsc + eslint clean.
- [ ] **Step 4: Commit**

```bash
git add src/components/piling/inspections/template-list.tsx src/components/piling/inspections/template-editor.tsx "src/app/(app)/admin/checklists/page.tsx" "src/app/(app)/admin/checklists/[id]/page.tsx"
git commit -m "feat(inspections): admin checklist template list + editor"
```

---

## Task 18: UI — блок «Осмотры» на карточке установки + навигация

**Files:**
- Modify: `src/components/piling/admin-equipment/detail/equipment-detail.tsx`
- Modify: `src/app/(app)/layout.tsx`

- [ ] **Step 1: Блок осмотров на карточке** — добавить компонент/секцию, фетчащую `GET /api/inspections?equipmentId=${equipmentId}` и показывающую список осмотров этой машины (дата, уровень, Health Score, статус) со ссылками на `/inspections/[id]`. Разместить рядом с вкладкой ТО (`equipment-maintenance.tsx`), не заменяя её.

- [ ] **Step 2: Навигация** — в `roleNavigation` добавить в массивы ADMIN и DISPATCHER после `{ label: 'Обслуживание', href: '/admin/maintenance' }`:

```typescript
    { label: 'Осмотры', href: '/inspections' },
    { label: 'Чек-листы', href: '/admin/checklists' },
```
(Если в парке есть отдельная роль машиниста/OPERATOR с доступом к осмотрам — добавить `{ label: 'Осмотры', href: '/inspections' }` и в его массив. Без `Чек-листы`.)

- [ ] **Step 3:** tsc + eslint clean.
- [ ] **Step 4: Commit**

```bash
git add src/components/piling/admin-equipment/detail/equipment-detail.tsx "src/app/(app)/layout.tsx"
git commit -m "feat(inspections): equipment-card inspections block + nav entries"
```

---

## Task 19: Финальная проверка Среза 1

- [ ] **Step 1: Полный прогон тестов**

Run: `npx vitest run`
Expected: все проходят (новые тесты модуля inspections — зелёные).

- [ ] **Step 2: Типы и линт**

Run: `npx tsc --noEmit` → clean.
Run: `npx eslint src/modules/inspections src/app/api/checklist-templates src/app/api/inspections src/components/piling/inspections "src/app/(app)/inspections" "src/app/(app)/admin/checklists"` → 0 errors.

- [ ] **Step 3: Ручной smoke (dev-сервер, перезапустить после миграций!)**

Войти админом → «Чек-листы»: открыть засеянный «ЕО гидромолота», добавить пункт, сохранить. → «Осмотры» → «Провести осмотр»: выбрать технику, шаблон, заполнить пункты (оставить один обязательный пустым) → «Завершить» → убедиться, что сервер не даёт закрыть и показывает список пропусков. Заполнить всё, загрузить обязательное фото → завершить → Health Score рассчитан, подпись сохранена, осмотр виден в списке и на карточке установки.

- [ ] **Step 4: detect-changes / финальный коммит при необходимости.**

---

## Self-Review (выполнено автором плана)

- **Покрытие спеца:** §4 модель → T1–T3; §5 типы/Health Score → T4; §6 серверная проверка → T7 (completeInspection) + T4 (findMissing); §7 API → T10–T13; §8 видимость → T8 (operator scoping) + T12; §9 экраны → T15–T18; §10 seed → T14; §11 тесты → юнит в T4–T8, ручной smoke T19. ✔
- **Без заглушек:** backend и чистая логика (T1–T14) — полный код + тесты + команды. UI (T15–T18) — точные контракты потока, эндпоинтов и образцы для зеркалирования (`maintenance-board.tsx`, `work-order-photos.tsx`, `equipment/[id]/page.tsx`); тестируемая логика (Health Score, findMissing) вынесена в T4 и переиспользуется. Это осознанная граница, как в плане P1b.
- **Согласованность типов:** `AnswerType`/`ChecklistLevel`/`InspectionStatus` — из Prisma; `SnapItem`/`AnswerLike` (T4) используются в `completeInspection` (T7); `TemplateInput`/`AnswerInput` объявлены в командах и потребляются роутами/UI; эндпоинты `/api/checklist-templates*`, `/api/inspections*` согласованы между T10–T13 и T15–T18.
- **Зависимости:** T1→T2→T3 (БД); T4 (чистая логика) без зависимостей; T5/T6/T7/T8 от T1–T4; T9 экспорт; T10–T13 от T9; T14 от T1–T2; T15–T18 от T10–T13; T19 финал. Порядок = номера задач.
- **Анти-дубль (ключевое требование пользователя):** новых «нарядов» не создаём; переиспуем Equipment/медиа/обёртки; осмотры — отдельный список в «Обслуживании». ✔
