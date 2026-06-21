# Tenant-Scoped Operational Users Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ограничить управление пользователями организацией текущего администратора и превратить список учётных записей в оперативный модуль с назначениями, активностью и безопасным жизненным циклом.

**Architecture:** API получает tenant исключительно из authenticated session и передаёт его в service-layer. Query возвращает tenant-scoped `OperationalUserDTO`; security-sensitive mutations повышают `sessionVersion`, из-за чего ранее выданные JWT перестают проходить проверку. UI остаётся в `ops-shell`, а фильтрация и правая панель выделяются в небольшие тестируемые компоненты.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, Prisma 7/PostgreSQL, Zod 4, Vitest 4, Playwright.

## Global Constraints

- `ADMIN` управляет только пользователями своего `tenantId`; `SUPER_ADMIN` не вводится.
- Cross-tenant lookup возвращает `404`.
- Пароль содержит минимум 8 символов; PIN содержит 4–10 цифр.
- Работавший пользователь блокируется, а hard delete разрешён только при отсутствии связей.
- Любая блокировка или смена credentials отзывает ранее выданные сессии.
- UI показывает только данные, реально полученные из БД.

---

## File Map

- `prisma/schema.prisma` — версия сессии пользователя.
- `prisma/migrations/20260621_user_session_version/migration.sql` — безопасное добавление `sessionVersion`.
- `src/services/users/user-service.ts` — tenant-scoped queries и commands.
- `src/services/auth/session-service.ts` — claim `sv` в JWT.
- `src/lib/auth.ts` — сравнение JWT `sv` с текущей версией пользователя.
- `src/lib/validation-schemas.ts` — единые password/PIN правила.
- `src/app/api/users/route.ts` — основной tenant-scoped API.
- `src/app/api/users/manage/route.ts` — совместимый tenant-scoped mutation endpoint.
- `src/lib/types.ts` — `OperationalUserDTO`.
- `src/components/piling/admin-users/user-list-model.ts` — чистая фильтрация/KPI.
- `src/components/piling/admin-users/user-detail.tsx` — правая панель с вкладками.
- `src/components/piling/admin-users/admin-users.tsx` — композиция страницы.
- `src/components/piling/admin-users/use-users-list.ts` — загрузка, поиск и mutations.

### Task 1: Tenant-scoped service boundary

**Files:**
- Modify: `src/services/users/user-service.ts`
- Modify: `src/modules/users/index.ts`
- Test: `src/services/users/__tests__/user-service.test.ts`

**Interfaces:**
- Produces: `listUsers(tenantId: string, role: string | null | undefined, pagination?: CursorPaginationResult): Promise<OperationalUserDTO[]>`
- Produces: `updateUser(tenantId: string, input: UpdateUserInput, actorUserId?: string | null)`
- Produces: `deleteUser(tenantId: string, actorUserId: string, targetUserId: string)`

- [ ] **Step 1: Write failing tenant tests**

Add mocks for `findUnique`, `update`, `delete`, then add:

```ts
it('lists only users in the requested tenant', async () => {
  await listUsers('tenant-a', null);
  expect(findManyUserMock).toHaveBeenCalledWith(expect.objectContaining({
    where: { tenantId: 'tenant-a' },
  }));
});

it('updates only a user owned by the tenant', async () => {
  findUniqueUserMock.mockResolvedValue(null);
  await expect(updateUser('tenant-a', { id: 'user-b', name: 'X' }, 'admin-a'))
    .rejects.toMatchObject({ status: 404 });
  expect(updateUserMock).not.toHaveBeenCalled();
});

it('deletes only an unused user owned by the tenant', async () => {
  findUniqueUserMock.mockResolvedValue(null);
  await expect(deleteUser('tenant-a', 'admin-a', 'user-b'))
    .rejects.toMatchObject({ status: 404 });
  expect(deleteUserMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/services/users/__tests__/user-service.test.ts`

Expected: FAIL because current signatures do not require tenant and `where` is unscoped.

- [ ] **Step 3: Implement fail-closed tenant checks**

Use this boundary in every service function:

```ts
function requireTenantId(tenantId: string): string {
  if (!tenantId) throw new ServiceError('Tenant context missing', 400);
  return tenantId;
}

const target = await db.user.findFirst({
  where: { id: input.id, tenantId: requireTenantId(tenantId) },
  select: { id: true, tenantId: true, email: true, name: true, phone: true, role: true, isActive: true },
});
if (!target) throw new ServiceError('User not found', 404);
```

Make list `where` start as `{ tenantId }`. Remove the default-tenant fallback from `createUser`; the caller must provide a non-empty authenticated tenant.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/services/users/__tests__/user-service.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/users/user-service.ts src/services/users/__tests__/user-service.test.ts src/modules/users/index.ts
git commit -m "fix(users): enforce tenant ownership in user service"
```

### Task 2: API tenant propagation and validation

**Files:**
- Modify: `src/app/api/users/route.ts`
- Modify: `src/app/api/users/manage/route.ts`
- Modify: `src/lib/validation-schemas.ts`
- Create: `src/app/api/users/__tests__/route.test.ts`
- Modify: `src/app/api/users/manage/__tests__/route.test.ts`

**Interfaces:**
- Consumes: tenant-first service signatures from Task 1.
- Produces: `/api/users` GET/POST/PUT/DELETE that never accepts tenant from request data.

- [ ] **Step 1: Write failing route tests**

```ts
it('passes the authenticated tenant to listUsers', async () => {
  requireAuthMock.mockResolvedValue({
    user: { id: 'admin-a', role: 'ADMIN', tenantId: 'tenant-a' }, error: null,
  });
  listUsersMock.mockResolvedValue([]);
  await GET(req('GET'));
  expect(listUsersMock).toHaveBeenCalledWith('tenant-a', null, expect.anything());
});

it('fails closed when the admin has no tenant', async () => {
  requireAuthMock.mockResolvedValue({ user: { id: 'a', role: 'ADMIN', tenantId: null }, error: null });
  expect((await GET(req('GET'))).status).toBe(400);
});

it('rejects a password shorter than 8 characters', async () => {
  const response = await POST(req('POST', {
    name: 'Иванов И.И.', email: 'i@example.ru', role: 'OPERATOR', password: '1234',
  }));
  expect(response.status).toBe(400);
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/users/__tests__/route.test.ts src/app/api/users/manage/__tests__/route.test.ts`

Expected: FAIL because tenant is not passed and server accepts one-character credentials.

- [ ] **Step 3: Implement route guards and schemas**

Add:

```ts
const tenantId = user!.tenantId;
if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
```

Call `listUsers(tenantId, role, pagination)`, `updateUser(tenantId, validation.data, user!.id)` and `deleteUser(tenantId, user!.id, validation.data.id)`.

Change Zod rules to:

```ts
pin: z.string().regex(/^\d{4,10}$/, 'PIN must contain 4 to 10 digits').optional().or(z.literal('')),
password: z.string().min(8, 'Password must contain at least 8 characters').max(100).optional(),
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/app/api/users/__tests__/route.test.ts src/app/api/users/manage/__tests__/route.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/users src/lib/validation-schemas.ts
git commit -m "fix(users): bind user API to authenticated tenant"
```

### Task 3: Session revocation by version

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260621_user_session_version/migration.sql`
- Modify: `src/services/auth/session-service.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/services/users/user-service.ts`
- Test: `src/services/auth/__tests__/session-service.test.ts`
- Test: `src/lib/__tests__/auth.test.ts`
- Test: `src/services/users/__tests__/user-service.test.ts`

**Interfaces:**
- Produces: `User.sessionVersion: Int`.
- Produces: JWT claim `sv: number`.
- Consumes: `sessionVersion` in `requireAuth` cache resolution.

- [ ] **Step 1: Write failing revocation tests**

```ts
it('writes the current session version into the token', async () => {
  const token = await createSessionToken({ ...user, sessionVersion: 3 });
  expect((await verifyTokenSignature(token))?.sv).toBe(3);
});

it('rejects a token issued before the user session version changed', async () => {
  verifySessionTokenMock.mockResolvedValue({ sub: 'u1', sv: 2 });
  findUniqueMock.mockResolvedValue({ ...dbUser, sessionVersion: 3 });
  expect((await requireAuth(request)).error?.status).toBe(401);
});

it('increments sessionVersion when an admin blocks a user', async () => {
  await updateUser('tenant-a', { id: 'u1', isActive: false }, 'admin-a');
  expect(updateUserMock).toHaveBeenCalledWith(expect.objectContaining({
    data: expect.objectContaining({ sessionVersion: { increment: 1 } }),
  }));
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/services/auth/__tests__/session-service.test.ts src/lib/__tests__/auth.test.ts src/services/users/__tests__/user-service.test.ts`

Expected: FAIL because `sessionVersion` and claim `sv` do not exist.

- [ ] **Step 3: Add schema and migration**

```prisma
sessionVersion Int @default(0)
```

```sql
ALTER TABLE "User" ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Implement token verification**

Include `sv: user.sessionVersion` in `SignJWT`, select `sessionVersion` in `resolveSessionUser`, and reject when `(payload.sv ?? 0) !== user.sessionVersion`.

When `isActive` becomes false or password/PIN changes, update with:

```ts
data.sessionVersion = { increment: 1 };
```

- [ ] **Step 5: Verify GREEN and generate client**

Run: `npm run db:generate`

Run: `npx vitest run src/services/auth/__tests__/session-service.test.ts src/lib/__tests__/auth.test.ts src/services/users/__tests__/user-service.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add prisma src/services/auth/session-service.ts src/lib/auth.ts src/services/users
git commit -m "feat(auth): revoke user sessions with session versions"
```

### Task 4: Operational user DTO

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/services/users/user-service.ts`
- Test: `src/services/users/__tests__/user-service.test.ts`

**Interfaces:**
- Produces:

```ts
export interface OperationalUserDTO extends UserDTO {
  createdAt: string;
  assignedSites: Array<{ id: string; name: string }>;
  activeCrew: { id: string; name: string; equipmentName: string | null; siteName: string | null } | null;
  reportCount: number;
  lastReportAt: string | null;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  lastActivitySource: 'login' | 'report' | 'profile' | null;
}
```

- [ ] **Step 1: Write failing DTO query test**

Mock users with `sites`, `crew`, `_count.reports`, latest report and batched login events. Assert that `listUsers('tenant-a', null)` maps only those real values and chooses the newest timestamp as `lastActivityAt`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/services/users/__tests__/user-service.test.ts`

Expected: FAIL because list returns only base fields.

- [ ] **Step 3: Implement one users query plus one batched login-events query**

Use Prisma `select` for sites, active crew, report count and latest report. Load `FeedbackEvent` with `action: 'auth.login.succeeded'`, `actorId: { in: userIds }`, `tenantId`, ordered descending; keep the first event per actor.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/services/users/__tests__/user-service.test.ts`

Expected: PASS with no N+1 queries.

- [ ] **Step 5: Commit**

```bash
git add src/lib/types.ts src/services/users/user-service.ts src/services/users/__tests__/user-service.test.ts
git commit -m "feat(users): expose assignments and activity"
```

### Task 5: Pure filters and KPI model

**Files:**
- Create: `src/components/piling/admin-users/user-list-model.ts`
- Create: `src/components/piling/admin-users/__tests__/user-list-model.test.ts`

**Interfaces:**
- Produces: `filterOperationalUsers(users, { quick, search, now }): OperationalUserDTO[]`.
- Produces: `computeUserKpis(users): OpsKpiItem[]`.

- [ ] **Step 1: Write failing filter tests**

Cover assistants, blocked, no-site, no-crew, inactive-30-days and case-insensitive FIO/email/phone search with a fixed `now`.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/components/piling/admin-users/__tests__/user-list-model.test.ts`

Expected: FAIL because module does not exist.

- [ ] **Step 3: Implement pure functions**

Use a discriminated `UserQuickFilter` union and no React imports. Treat missing activity as inactive for 30-day filtering only when `createdAt` is also older than 30 days.

- [ ] **Step 4: Verify GREEN**

Run the same command; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/piling/admin-users/user-list-model.ts src/components/piling/admin-users/__tests__/user-list-model.test.ts
git commit -m "feat(users): add operational filters and KPIs"
```

### Task 6: Operational users UI

**Files:**
- Modify: `src/components/piling/admin-users/admin-users.tsx`
- Modify: `src/components/piling/admin-users/use-users-list.ts`
- Modify: `src/components/piling/admin-users/user-dialogs.tsx`
- Create: `src/components/piling/admin-users/user-detail.tsx`
- Create: `src/components/piling/admin-users/__tests__/admin-users.test.tsx`

**Interfaces:**
- Consumes: `OperationalUserDTO`, pure filters and KPI model.
- Produces: searchable table and tabs `Обзор / Закрепление / Активность / Доступ / История`.

- [ ] **Step 1: Write failing component tests**

Render with injected users hook data and assert columns `Объект`, `Бригада / установка`, `Активность`; assert search finds by phone; assert selecting a row exposes all five tabs.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/components/piling/admin-users/__tests__/admin-users.test.tsx`

Expected: FAIL because current table has three columns and no tabs/search.

- [ ] **Step 3: Implement the compact operational table**

Keep current `OpsPage` split layout. Add one-line primary values and muted secondary values; do not add horizontal scrolling on desktop. Add explicit retry state to `useUsersList` and validate API responses before state updates.

- [ ] **Step 4: Implement access actions**

Keep edit/block actions in `Доступ`; show hard delete only when API DTO marks `canHardDelete`. Add phone and optional PIN to create/edit dialogs without exposing stored credentials.

- [ ] **Step 5: Verify GREEN**

Run: `npx vitest run src/components/piling/admin-users/__tests__/admin-users.test.tsx src/components/piling/admin-users/__tests__/user-list-model.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/piling/admin-users
git commit -m "feat(users): build operational user registry"
```

### Task 7: Users verification

**Files:**
- Create: `e2e/admin-users.spec.ts`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: non-destructive browser coverage for users module.

- [ ] **Step 1: Add Playwright scenarios**

Login as admin, open `/admin/users`, verify search, role filters, row selection, five detail tabs and mobile layout. Use API-created tenant fixtures only in isolated CI DB; never mutate developer/prod data.

- [ ] **Step 2: Run focused verification**

Run: `npm run lint`

Run: `npm run test:unit`

Run: `npm run build`

Run with isolated test DB: `npx playwright test e2e/admin-users.spec.ts --project=chromium --workers=1`

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add e2e/admin-users.spec.ts .github/workflows/ci.yml
git commit -m "test(users): cover tenant-safe admin workflows"
```
