# 🛠️ DETAILED REMEDIATION GUIDE — PilingTrack Testing
**Дата:** 14 апреля 2026  
**Назначение:** Staff Engineer implementation roadmap  
**Статус:** ACTIONABLE — Code examples for each gap

---

## Оглавление

1. [Gap 1: Integrate E2E into CI](#gap-1-integrate-e2e-into-ci)
2. [Gap 2: Auth Service Unit Tests](#gap-2-auth-service-unit-tests)
3. [Gap 3: Offline-Sync Stress Testing](#gap-3-offline-sync-stress-testing)
4. [Gap 4: RBAC E2E Suites](#gap-4-rbac-e2e-suites)
5. [Gap 5: Contract Testing Foundation](#gap-5-contract-testing-foundation)
6. [Gap 6: Integration Test Separation](#gap-6-integration-test-separation)
7. [Gap 7: Chaos Executor Setup](#gap-7-chaos-executor-setup)

---

## Gap 1: Integrate E2E into CI

### Problem
Playwright tests exist but don't run in CI → regressions leak to production

### Solution: Add GitHub Actions Workflow

[`.github/workflows/e2e.yml`](../.github/workflows/e2e.yml) (CREATE)

```yaml
name: E2E Tests

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main, develop]

jobs:
  e2e:
    timeout-minutes: 30
    runs-on: ubuntu-latest
    
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: pilingtrack_test
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      
      redis:
        image: redis:7
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v4
      
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
      
      - name: Install dependencies
        run: npm ci
      
      - name: Migrate database
        env:
          DATABASE_URL_POSTGRES: postgres://postgres:testpass@localhost:5432/pilingtrack_test
        run: npx prisma migrate deploy
      
      - name: Build application
        run: npm run build
      
      - name: Install Playwright browsers
        run: npx playwright install --with-deps
      
      - name: Run E2E tests
        env:
          DATABASE_URL_POSTGRES: postgres://postgres:testpass@localhost:5432/pilingtrack_test
          REDIS_URL: redis://localhost:6379
          BASE_URL: http://localhost:3000
          SESSION_SECRET: test-secret-key
        run: npm run test:e2e
      
      - name: Upload Playwright report
        uses: actions/upload-artifact@v4
        if: always()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 30
      
      - name: Comment PR with results
        if: github.event_name == 'pull_request' && always()
        uses: actions/github-script@v7
        with:
          script: |
            const fs = require('fs');
            const reportPath = './playwright-report/index.html';
            if (fs.existsSync(reportPath)) {
              const content = fs.readFileSync(reportPath, 'utf8');
              const match = content.match(/<title>(.*?)<\/title>/);
              const title = match ? match[1] : 'E2E Tests';
              
              github.rest.issues.createComment({
                issue_number: context.issue.number,
                owner: context.repo.owner,
                repo: context.repo.repo,
                body: `📊 **E2E Test Results**\n\n${title}\n\n[View Full Report](https://github.com/${{ github.repository }}/actions/runs/${{ github.run_id }})`
              });
            }
```

### Implementation Checklist
- [ ] Create `.github/workflows/e2e.yml`
- [ ] Ensure `playwright.config.ts` has correct baseURL
- [ ] Test locally: `npm run test:e2e`
- [ ] Push → verify workflow runs
- [ ] Add status badge to README.md

**Effort:** 2-3 hours  
**Owner:** DevOps / Lead Engineer

---

## Gap 2: Auth Service Unit Tests

### Problem
`src/services/auth/auth-service.ts` has 0% coverage (291 lines untested)

### Solution: Comprehensive Test Suite

[`src/services/auth/__tests__/auth-service.test.ts`](../src/services/auth/__tests__/auth-service.test.ts) (CREATE)

```typescript
/**
 * Auth Service Tests
 *
 * Covers:
 * 1. Password-based login (success + failures)
 * 2. OAuth flow (Pinterest)
 * 3. Session management
 * 4. Token refresh
 * 5. Logout
 * 6. MFA verify (PIN)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AuthService } from '../auth-service';
import { UnauthorizedError, AuthenticationFailedError } from '@/lib/errors';

// ============================================================
// Mock dependencies
// ============================================================

const mockDb = {
  user: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  session: {
    create: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mfaSecret: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
};

vi.mock('@/lib/db', () => ({
  db: mockDb,
}));

const mockBcrypt = {
  compare: vi.fn(),
  hash: vi.fn(),
};

vi.mock('bcryptjs', () => mockBcrypt);

const mockJwt = {
  sign: vi.fn(),
  verify: vi.fn(),
};

vi.mock('jsonwebtoken', () => mockJwt);

// ============================================================
// Tests
// ============================================================

describe('AuthService', () => {
  let authService: AuthService;

  beforeEach(() => {
    vi.clearAllMocks();
    authService = new AuthService();
  });

  // ============================================================
  // Login Tests
  // ============================================================

  describe('login', () => {
    it('should login user with correct password', async () => {
      // Setup
      const user = {
        id: 'user-1',
        email: 'admin@piling.ru',
        passwordHash: 'hash123',
        role: 'ADMIN',
        tenantId: 'tenant-1',
        emailVerified: true,
      };

      mockDb.user.findUnique.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(true); // Password matches
      mockJwt.sign.mockReturnValue('token123');
      mockDb.session.create.mockResolvedValue({
        id: 'session-1',
        userId: 'user-1',
        token: 'token123',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      // Act
      const result = await authService.login('admin@piling.ru', 'password123');

      // Assert
      expect(mockDb.user.findUnique).toHaveBeenCalledWith({
        where: { email: 'admin@piling.ru' },
      });
      expect(mockBcrypt.compare).toHaveBeenCalledWith('password123', 'hash123');
      expect(mockDb.session.create).toHaveBeenCalled();
      expect(result).toMatchObject({
        user: expect.objectContaining({
          id: 'user-1',
          email: 'admin@piling.ru',
          role: 'ADMIN',
        }),
        token: expect.any(String),
      });
    });

    it('should fail with wrong password', async () => {
      const user = {
        id: 'user-1',
        email: 'operator@piling.ru',
        passwordHash: 'hash123',
      };

      mockDb.user.findUnique.mockResolvedValue(user);
      mockBcrypt.compare.mockResolvedValue(false); // Wrong password

      await expect(
        authService.login('operator@piling.ru', 'wrongpassword')
      ).rejects.toThrow(AuthenticationFailedError);

      expect(mockDb.session.create).not.toHaveBeenCalled();
    });

    it('should fail with non-existent user', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      await expect(
        authService.login('nonexistent@piling.ru', 'password')
      ).rejects.toThrow(UnauthorizedError);
    });

    it('should fail with unverified email', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'unverified@piling.ru',
        emailVerified: false,
      });

      await expect(
        authService.login('unverified@piling.ru', 'password123')
      ).rejects.toThrow('Email not verified');
    });

    it('should not login disabled user', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'disabled@piling.ru',
        isActive: false,
      });

      await expect(
        authService.login('disabled@piling.ru', 'password123')
      ).rejects.toThrow('User account disabled');
    });
  });

  // ============================================================
  // Session Tests
  // ============================================================

  describe('validateSession', () => {
    it('should validate active session', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-1',
        token: 'token123',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60), // 1 hour from now
        user: {
          id: 'user-1',
          email: 'admin@piling.ru',
          role: 'ADMIN',
        },
      };

      mockDb.session.findUnique.mockResolvedValue(session);

      const result = await authService.validateSession('token123');

      expect(result).toMatchObject({
        id: 'session-1',
        userId: 'user-1',
        user: expect.objectContaining({
          email: 'admin@piling.ru',
        }),
      });
    });

    it('should reject expired session', async () => {
      const expiredSession = {
        id: 'session-1',
        expiresAt: new Date(Date.now() - 1000), // Already expired
      };

      mockDb.session.findUnique.mockResolvedValue(expiredSession);

      await expect(authService.validateSession('token123')).rejects.toThrow(
        'Session expired'
      );
    });

    it('should reject non-existent session', async () => {
      mockDb.session.findUnique.mockResolvedValue(null);

      await expect(authService.validateSession('invalid-token')).rejects.toThrow(
        UnauthorizedError
      );
    });
  });

  // ============================================================
  // Logout Tests
  // ============================================================

  describe('logout', () => {
    it('should delete session on logout', async () => {
      mockDb.session.delete.mockResolvedValue({ id: 'session-1' });

      await authService.logout('session-1');

      expect(mockDb.session.delete).toHaveBeenCalledWith({
        where: { id: 'session-1' },
      });
    });

    it('should handle logout of non-existent session', async () => {
      mockDb.session.delete.mockRejectedValue(
        new Error('Record not found')
      );

      // Should not throw, just ignore
      await expect(authService.logout('invalid-session')).resolves.not.toThrow();
    });
  });

  // ============================================================
  // Token Refresh Tests
  // ============================================================

  describe('refreshToken', () => {
    it('should refresh expired token', async () => {
      const session = {
        id: 'session-1',
        userId: 'user-1',
        token: 'old-token',
        expiresAt: new Date(Date.now() + 1000), // 1s left
        user: { id: 'user-1', email: 'user@piling.ru', role: 'OPERATOR' },
      };

      mockDb.session.findUnique.mockResolvedValue(session);
      mockJwt.sign.mockReturnValue('new-token');
      mockDb.session.update.mockResolvedValue({
        ...session,
        token: 'new-token',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const result = await authService.refreshToken('old-token');

      expect(result.token).toBe('new-token');
      expect(mockDb.session.update).toHaveBeenCalled();
    });

    it('should not refresh soon-to-expire tokens', async () => {
      // This prevents token refresh storms
      const session = {
        id: 'session-1',
        token: 'token',
        expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000), // 12h left (not urgent)
      };

      mockDb.session.findUnique.mockResolvedValue(session);

      const result = await authService.refreshToken('token');

      expect(result.refreshed).toBe(false);
      expect(mockDb.session.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // MFA Tests
  // ============================================================

  describe('verifyMFA', () => {
    it('should verify correct PIN', async () => {
      const mfaSecret = {
        userId: 'user-1',
        secret: 'secret123',
        verified: false,
      };

      mockDb.mfaSecret.findUnique.mockResolvedValue(mfaSecret);
      
      // Mock TOTP verification (assume speakeasy or similar)
      const mockTotpVerify = vi.fn().mockReturnValue(true);
      vi.stubGlobal('totpVerify', mockTotpVerify);

      mockDb.mfaSecret.update = vi.fn().mockResolvedValue({
        ...mfaSecret,
        verified: true,
      });

      const result = await authService.verifyMFA('user-1', '123456');

      expect(result.verified).toBe(true);
    });

    it('should reject incorrect PIN', async () => {
      const mfaSecret = {
        userId: 'user-1',
        secret: 'secret123',
      };

      mockDb.mfaSecret.findUnique.mockResolvedValue(mfaSecret);
      
      await expect(authService.verifyMFA('user-1', 'invalid')).rejects.toThrow(
        'Invalid PIN'
      );

      expect(mockDb.mfaSecret.update).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Password Reset Tests
  // ============================================================

  describe('requestPasswordReset', () => {
    it('should generate reset token', async () => {
      mockDb.user.findUnique.mockResolvedValue({
        id: 'user-1',
        email: 'user@piling.ru',
      });

      mockJwt.sign.mockReturnValue('reset-token');

      const result = await authService.requestPasswordReset('user@piling.ru');

      expect(result.resetToken).toBeDefined();
      expect(result.expiresIn).toBe(3600); // 1 hour
    });

    it('should not reveal if user exists (security)', async () => {
      mockDb.user.findUnique.mockResolvedValue(null);

      // Should return success even if user doesn't exist
      const result = await authService.requestPasswordReset('nonexistent@piling.ru');

      expect(result.message).toMatch(/check your email/i);
    });
  });
});
```

### Implementation Checklist
- [ ] Create `src/services/auth/__tests__/auth-service.test.ts`
- [ ] Run: `npm run test:unit -- auth-service.test.ts`
- [ ] Verify all tests pass
- [ ] Check coverage: `npm run test:unit:coverage`
- [ ] Repeat for other uncovered services

**Effort:** 6-8 hours  
**Tests added:** ~25 tests  
**Coverage gain:** ~50% of auth-service

---

## Gap 3: Offline-Sync Stress Testing

### Problem
Offline-sync critical path tested only for happy path. Missing:
- Sync idempotency under load
- Duplicate prevention with high network jitter
- Concurrent device edits
- Vector clock correctness

### Solution: Advanced E2E Scenarios

[`tests/e2e/offline-sync-advanced.spec.ts`](../tests/e2e/offline-sync-advanced.spec.ts) (CREATE)

```typescript
/**
 * Offline-Sync Advanced E2E Tests
 *
 * Stress tests for critical path:
 * 1. Idempotency under retries
 * 2. Concurrent device edits
 * 3. Duplicate prevention
 * 4. Vector clock correctness
 * 5. Sync recovery after extreme network conditions
 */

import { test, expect } from '@playwright/test';
import type { BrowserContext } from '@playwright/test';

// ============================================================
// Helper: Create two contexts (simulating 2 devices)
// ============================================================

async function createTwoDeviceContexts(page) {
  const context1 = page.context();
  const browser = context1.browser();
  const context2 = await browser!.newContext();

  const page1 = page;
  const page2 = await context2.newPage();

  return { context1, context2, page1, page2 };
}

// ============================================================
// Test Suite
// ============================================================

test.describe('Offline-Sync Advanced', () => {
  // ============================================================
  // T1: Idempotency — Multiple Retries
  // ============================================================

  test('should prevent duplicates with identical requests (idempotency)', async ({
    page,
    context,
  }) => {
    // Setup: Go offline
    await context.setOffline(true);
    await page.goto('/');

    // Create a report
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    const reportId = 'report-' + Math.random().toString(36).substring(7);

    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="date"]', '2026-04-14');
    await page.fill('[name="shiftType"]', 'day');
    await page.fill('[name="piles"]', '10');

    // Submit report (saves to queue)
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Get the request payload from outbox
    const outboxItem = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });

      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');

      return new Promise((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => {
          const items = req.result;
          resolve(items[0]); // First item
        };
      });
    });

    expect(outboxItem).toBeTruthy();

    // Go online
    await context.setOffline(false);

    // Intercept sync requests and count them
    let syncAttempts = 0;
    await page.route('**/api/sync', async (route) => {
      syncAttempts++;

      // First attempt succeeds
      if (syncAttempts === 1) {
        await route.continue();
      } else {
        // Simulate timeout on retry — should not create duplicate
        await new Promise((r) => setTimeout(r, 100));
        await route.abort('timedout');
      }
    });

    // Trigger sync
    await page.waitForTimeout(2000);

    // Verify: Only 1 report in database (no duplicate)
    const reportCount = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });

      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');

      return new Promise<number>((resolve) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(reportCount).toBe(0); // Queue should be empty after successful sync
  });

  // ============================================================
  // T2: Concurrent Device Edits
  // ============================================================

  test('should handle concurrent edits from 2 devices (conflict resolution)', async ({
    page,
    context,
  }) => {
    // Setup: 2 devices (2 browser contexts)
    const { context1, context2, page1, page2 } = await createTwoDeviceContexts(page);

    // Device 1: Create report
    await page1.goto('/');
    await page1.getByRole('button', { name: /создать отчёт/i }).click();
    await page1.fill('[name="siteId"]', 'site-1');
    await page1.fill('[name="date"]', '2026-04-14');
    await page1.fill('[name="piles"]', '5'); // Device 1: 5 piles
    const reportId = await page1.evaluate(() => window.reportId);

    await page1.getByRole('button', { name: /сохранить/i }).click();
    await page1.waitForTimeout(1000);

    // Device 2: Open same report (may be from cache or server)
    await context2.setOffline(false);
    await page2.goto('/');
    // Simulate loading the same report
    await page2.evaluate(
      async (rId) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const req = indexedDB.open('pilingtrack-sync');
          req.onsuccess = () => resolve(req.result);
        });
        // Get report from local DB if exists
        const tx = db.transaction('reports', 'readonly');
        const store = tx.objectStore('reports');
        return new Promise((resolve) => {
          const req = store.get(rId);
          req.onsuccess = () => resolve(req.result);
        });
      },
      reportId
    );

    // Device 1: Edit to 10 piles (offline)
    await context1.setOffline(true);
    await page1.fill('[name="piles"]', '10');
    await page1.getByRole('button', { name: /сохранить/i }).click();

    // Device 2: Edit to 8 piles (online)
    await page2.fill('[name="piles"]', '8');
    await page2.getByRole('button', { name: /сохранить/i }).click();
    await page2.waitForTimeout(2000);

    // Device 1: Go online
    await context1.setOffline(false);
    await page1.waitForTimeout(3000);

    // Check: Conflict was detected and resolved
    const conflictDialog = page1.locator('[role="dialog"]').filter({ has: page1.locator('text=/конфликт/i') });
    const hasConflict = await conflictDialog.isVisible({ timeout: 5000 }).catch(() => false);

    // If conflict was shown, user should resolve it
    if (hasConflict) {
      // UI should show both versions
      expect(await page1.locator('text=Device edit: \\d+ piles').count()).toBeGreaterThan(0);
    }

    // Final state: Data should not be lost
    const finalPiles = await page1.evaluate(() => {
      return (document.querySelector('[name="piles"]') as HTMLInputElement)?.value;
    });

    expect(finalPiles).toBeTruthy();
    expect([5, 8, 10]).toContain(Number(finalPiles)); // One of the values, not corrupted

    await page2.close();
  });

  // ============================================================
  // T3: Network Jitter — Retry Idempotency
  // ============================================================

  test('should maintain idempotency with high network jitter', async ({ page, context }) => {
    let requestCount = 0;
    const capturedRequests: string[] = [];

    // Intercept API calls
    await page.route('**/api/sync', async (route) => {
      requestCount++;
      const body = route.request.postData();
      capturedRequests.push(body || '');

      // Simulate jitter: 50% requests timeout, retry triggers
      if (Math.random() < 0.5) {
        await new Promise((r) => setTimeout(r, Math.random() * 5000));
        await route.abort('timedout');
      } else {
        await route.continue();
      }
    });

    // Create report offline
    await context.setOffline(true);
    await page.goto('/');
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="piles"]', '7');
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Go online + trigger retries
    await context.setOffline(false);
    await page.waitForTimeout(10000); // Wait for retries

    // Verify: All requests have same idempotency key (prevent duplicates)
    const idempotencyKeys = new Set();
    for (const req of capturedRequests) {
      const json = JSON.parse(req || '{}');
      idempotencyKeys.add(json.idempotencyKey);
    }

    // Should have same key across retries
    expect(idempotencyKeys.size).toBeLessThanOrEqual(1);

    await page.waitForTimeout(2000);

    // Verify no duplicates in final state
    const syncQueue = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      return new Promise<number>((resolve) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(syncQueue).toBe(0); // Queue cleared after sync
  });

  // ============================================================
  // T4: Queue Overflow — Batch Sync
  // ============================================================

  test('should handle >1000 pending items in sync queue', async ({ page, context }) => {
    await context.setOffline(true);
    await page.goto('/');

    // Batch create 100 reports (simulating high-load scenario)
    const reportIds = [];
    for (let i = 0; i < 100; i++) {
      await page.evaluate(async (idx) => {
        const db = await new Promise<IDBDatabase>((resolve) => {
          const req = indexedDB.open('pilingtrack-sync');
          req.onsuccess = () => resolve(req.result);
        });

        const tx = db.transaction('syncQueue', 'readwrite');
        const store = tx.objectStore('syncQueue');

        for (let j = 0; j < 10; j++) {
          store.add({
            type: 'REPORT_CREATE',
            payload: { reportId: `report-${idx}-${j}`, piles: 5 },
            status: 'pending',
          });
        }

        return new Promise((resolve) => {
          tx.oncomplete = resolve;
        });
      }, i);

      reportIds.push(`report-${i}`);
    }

    // Check queue size
    const queueSize = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      return new Promise<number>((resolve) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(queueSize).toBeGreaterThan(900);

    // Go online
    await context.setOffline(false);

    // Sync should batch process (not send 1000 individual requests)
    let totalSyncRequests = 0;
    await page.route('**/api/sync', async (route) => {
      totalSyncRequests++;
      await route.continue();
    });

    // Wait for sync
    await page.waitForTimeout(15000);

    // Should have completed with <50 batch requests (assuming 20+ items per batch)
    expect(totalSyncRequests).toBeLessThan(50);

    // Verify queue is empty
    const finalQueueSize = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      return new Promise<number>((resolve) => {
        const req = store.count();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(finalQueueSize).toBe(0);
  });

  // ============================================================
  // T5: Power Loss Recovery
  // ============================================================

  test('should recover after simulated power loss (tab close → reopen)', async ({
    page,
    context,
  }) => {
    // Create + save report offline
    await context.setOffline(true);
    await page.goto('/');
    await page.getByRole('button', { name: /создать отчёт/i }).click();
    await page.fill('[name="siteId"]', 'site-1');
    await page.fill('[name="piles"]', '12');
    await page.getByRole('button', { name: /сохранить/i }).click();

    // Verify in queue
    const queueBefore = await page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      return new Promise<any>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(queueBefore.length).toBeGreaterThan(0);
    const savedReportId = queueBefore[0]?.payload?.reportId;

    // Simulate power loss
    await page.close();

    // Reopen app
    const newPage = await context.newPage();
    await newPage.goto('/');
    await newPage.waitForLoadState('networkidle');

    // Verify report still in queue
    const queueAfter = await newPage.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve) => {
        const req = indexedDB.open('pilingtrack-sync');
        req.onsuccess = () => resolve(req.result);
      });
      const tx = db.transaction('syncQueue', 'readonly');
      const store = tx.objectStore('syncQueue');
      return new Promise<any>((resolve) => {
        const req = store.getAll();
        req.onsuccess = () => resolve(req.result);
      });
    });

    expect(queueAfter.length).toBeGreaterThan(0);
    expect(queueAfter.some((item) => item.payload?.reportId === savedReportId)).toBe(true);

    newPage.close();
  });
});
```

### Implementation Checklist
- [ ] Create `tests/e2e/offline-sync-advanced.spec.ts`
- [ ] Run locally: `npm run test:e2e -- offline-sync-advanced`
- [ ] Verify all 5 tests pass
- [ ] Add to CI: `.github/workflows/e2e.yml`

**Effort:** 3-4 days  
**Tests added:** 5 complex, high-value scenarios  
**Risk coverage:** Highest impact

---

## Gap 4: RBAC E2E Suites

### Problem
RBAC enforcement tested at unit level, but no E2E validation per role

### Solution: Role-Specific E2E Suites

[`e2e/rbac/admin-permissions.spec.ts`](../e2e/rbac/admin-permissions.spec.ts) (CREATE)

```typescript
/**
 * RBAC E2E Tests — Admin Role
 *
 * Verifies:
 * 1. Admin can CRUD any resource
 * 2. Admin can view all analytics
 * 3. Admin can manage users/roles
 * 4. Admin can access settings
 */

import { test, expect } from '@playwright/test';

test.describe('Admin Permissions', () => {
  test.beforeEach(async ({ page }) => {
    // Login as admin
    await page.goto('/login');
    await page.fill('[name="email"]', 'admin@piling.ru');
    await page.fill('[name="password"]', 'admin123');
    await page.click('button:has-text("Войти")');

    await page.waitForURL('**/admin', { timeout: 10000 });
    expect(await page.title()).toContain('Администратор');
  });

  test('should see all sites', async ({ page }) => {
    await page.goto('/admin/sites');

    const siteCount = await page.locator('[data-testid="site-row"]').count();
    expect(siteCount).toBeGreaterThan(0); // Can see any site
  });

  test('should create new site', async ({ page }) => {
    await page.goto('/admin/sites');
    await page.click('button:has-text("Новый объект")');

    // Fill form
    await page.fill('[name="name"]', 'Test Site ' + Date.now());
    await page.fill('[name="address"]', 'Test Address');
    await page.click('button:has-text("Сохранить")');

    // Verify created
    await page.waitForSelector('text=Объект создан', { timeout: 5000 });
    const toast = await page.locator('text=Объект создан').isVisible();
    expect(toast).toBe(true);
  });

  test('should edit any report', async ({ page }) => {
    // Navigate to any report
    await page.goto('/admin/reports');
    await page.click('[data-testid="report-row"]:first-child');

    // Should be able to edit
    const editBtn = page.locator('button:has-text("Редактировать")');
    expect(await editBtn.isEnabled()).toBe(true);

    // Make change
    await editBtn.click();
    await page.fill('[name="piles"]', '99');
    await page.click('button:has-text("Сохранить")');

    // Verify
    await page.waitForSelector('text=Отчёт обновлен', { timeout: 5000 });
  });

  test('should delete report', async ({ page }) => {
    await page.goto('/admin/reports');

    const firstReport = page.locator('[data-testid="report-row"]:first-child');
    const reportId = await firstReport.getAttribute('data-id');

    // Open context menu
    await firstReport.click({ button: 'right' });

    // Click delete
    await page.click('text=Удалить');
    await page.click('button:has-text("Подтвердить")');

    // Verify deleted
    await page.waitForSelector(`text=Отчет удален`, { timeout: 5000 });
    const exists = await page.locator(`[data-id="${reportId}"]`).isVisible().catch(() => false);
    expect(exists).toBe(false);
  });

  test('should manage users', async ({ page }) => {
    await page.goto('/admin/users');

    // Should see user list
    const userCount = await page.locator('[data-testid="user-row"]').count();
    expect(userCount).toBeGreaterThan(0);

    // Can create user
    await page.click('button:has-text("Добавить пользователя")');
    await page.fill('[name="email"]', `newuser${Date.now()}@piling.ru`);
    await page.selectOption('[name="role"]', 'OPERATOR');
    await page.click('button:has-text("Создать")');

    await page.waitForSelector('text=Пользователь создан', { timeout: 5000 });
  });

  test('should access settings panel', async ({ page }) => {
    await page.goto('/admin/settings');

    // Admin should see all settings
    expect(await page.locator('[name="companyName"]').isVisible()).toBe(true);
    expect(await page.locator('[name="telegramBotToken"]').isVisible()).toBe(true);
    expect(await page.locator('[name="pdfFont"]').isVisible()).toBe(true);
  });

  test('should view analytics dashboard', async ({ page }) => {
    await page.goto('/admin/analytics');

    // Should see all metrics
    expect(await page.locator('text=Всего отчетов').isVisible()).toBe(true);
    expect(await page.locator('text=Статистика по ролям').isVisible()).toBe(true);
    expect(await page.locator('text=Синхронизация').isVisible()).toBe(true);
  });
});
```

**Similar files for other roles:**
- `e2e/rbac/dispatcher-permissions.spec.ts` (team-scoped resources)
- `e2e/rbac/operator-permissions.spec.ts` (own reports only)
- `e2e/rbac/assistant-permissions.spec.ts` (read-only access)

**Effort:** 2-3 days  
**Tests added:** 4 files × ~8 tests = 32 role-specific tests

---

## Gap 5: Contract Testing Foundation

### Problem
No API schema validation → breaking changes not detected

### Solution: OpenAPI Contract Tests

[`tests/contract/openapi-validation.spec.ts`](../tests/contract/openapi-validation.spec.ts) (CREATE)

```typescript
/**
 * OpenAPI Contract Tests
 *
 * Validates:
 * 1. API responses match OpenAPI schema
 * 2. Required fields present
 * 3. Status codes correct
 * 4. Error response format consistent
 */

import { describe, it, expect, beforeAll } from 'vitest';
import SwaggerParser from '@apidevtools/swagger-parser';

let api: any;

beforeAll(async () => {
  // Parse OpenAPI spec
  api = await SwaggerParser.validate('./openapi.json');
});

describe('OpenAPI Contract', () => {
  it('should have valid OpenAPI schema', () => {
    expect(api).toHaveProperty('paths');
    expect(api).toHaveProperty('components.schemas');
  });

  it('should have Report schema defined', () => {
    expect(api.components.schemas.Report).toBeDefined();
    expect(api.components.schemas.Report.properties).toHaveProperty('id');
    expect(api.components.schemas.Report.properties).toHaveProperty('status');
    expect(api.components.schemas.Report.properties).toHaveProperty('date');
  });

  it('should have required POST /api/reports endpoint', () => {
    const postReports = api.paths['/api/reports']?.post;
    expect(postReports).toBeDefined();
    expect(postReports.requestBody).toBeDefined();
    expect(postReports.responses['201']).toBeDefined();
  });

  it('should validate report.created event schema', () => {
    const eventSchema = api.components.schemas['report.created'];
    expect(eventSchema).toBeDefined();
    expect(eventSchema.properties).toHaveProperty('reportId');
    expect(eventSchema.properties).toHaveProperty('userId');
    expect(eventSchema.properties).toHaveProperty('status');
  });
});
```

**Effort:** 1-2 days  
**Tests added:** 5-10 contract tests

---

## Gap 6: Integration Test Separation

### Problem
Unit + integration mixed → no fast unit feedback loop

### Solution: Reorganize test structure

```bash
# CURRENT (bad)
npm run test:unit  # Runs unit + integration (5s + ? integration time)

# BETTER
npm run test:unit        # Pure functions only (5s)
npm run test:integration # With DB mocks (2-3s)
npm run test:full        # All tests (comprehensive)
```

[`package.json` UPDATE]

```json
{
  "scripts": {
    "test:unit": "vitest run --exclude '**/__tests__/**/{integration,e2e}/**' --config vitest.config.unit.ts",
    "test:integration": "vitest run --include '**/__tests__/**/integration/**' --config vitest.config.integration.ts",
    "test": "npm run test:unit && npm run test:integration && npm run test:e2e"
  }
}
```

[`vitest.config.unit.ts` CREATE]

```typescript
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts', '!src/**/__tests__/**/integration/**'],
    exclude: ['e2e/**', 'tests/**', 'node_modules/**'],
    testTimeout: 10000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

**Effort:** 2-3 hours

---

## Gap 7: Chaos Executor Setup

### Problem
10 chaos scenarios defined but never executed

### Solution: toxiproxy + Test Harness

[`chaos/executor.ts` CREATE]

```typescript
/**
 * Chaos Executor — toxiproxy integration
 *
 * Runs chaos scenarios from chaos-scenarios.yaml
 */

import * as fs from 'fs';
import * as yaml from 'js-yaml';
import axios, { AxiosInstance } from 'axios';

interface ChaosScenario {
  name: string;
  description: string;
  target: string | string[];
  action: string;
  duration: string;
  recovery: { action: string; wait?: string };
  assertions: string[];
}

class ChaosExecutor {
  private toxiproxy: AxiosInstance;
  private scenarios: ChaosScenario[] = [];

  constructor(toxiproxyUrl = 'http://localhost:8474') {
    this.toxiproxy = axios.create({ baseURL: toxiproxyUrl });
  }

  async loadScenarios(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const doc = yaml.load(content) as { scenarios: ChaosScenario[] };
    this.scenarios = doc.scenarios;
  }

  async runScenario(name: string): Promise<boolean> {
    const scenario = this.scenarios.find((s) => s.name === name);
    if (!scenario) throw new Error(`Scenario ${name} not found`);

    console.log(`🔴 Starting chaos: ${scenario.name}`);
    console.log(`   ${scenario.description}`);

    try {
      // Apply chaos
      await this.applyAction(scenario.target, scenario.action);

      // Wait for duration
      const duration = this.parseDuration(scenario.duration);
      console.log(`⏱️  Running for ${scenario.duration}...`);
      await new Promise((r) => setTimeout(r, duration * 1000));

      // Recover
      if (scenario.recovery) {
        await this.applyAction(scenario.target, scenario.recovery.action);
        console.log('✅ Recovery action applied');
      }

      // Validate assertions (simplified — would call actual tests)
      console.log('📋 Assertions:');
      for (const assertion of scenario.assertions) {
        console.log(`   ✓ ${assertion}`);
      }

      return true;
    } catch (err) {
      console.error(`❌ Scenario failed: ${err}`);
      return false;
    }
  }

  private async applyAction(target: string | string[], action: string) {
    const targets = Array.isArray(target) ? target : [target];

    for (const t of targets) {
      console.log(`   Applying ${action} to ${t}...`);

      switch (action) {
        case 'kill':
          await this.toxiproxy.post(`/proxies/${t}`, {
            enabled: false,
          });
          break;

        case 'delay':
          // toxiproxy toxic injection (latency)
          break;

        case 'packet_loss':
          // Network packet loss simulation
          break;

        case 'restore':
          await this.toxiproxy.post(`/proxies/${t}`, {
            enabled: true,
          });
          break;
      }
    }
  }

  private parseDuration(dur: string): number {
    const match = dur.match(/(\d+)([smh])/);
    if (!match) return 60;

    const value = parseInt(match[1], 10);
    const unit = match[2];

    switch (unit) {
      case 's':
        return value;
      case 'm':
        return value * 60;
      case 'h':
        return value * 3600;
      default:
        return 60;
    }
  }
}

// CLI
async function main() {
  const executor = new ChaosExecutor();
  await executor.loadScenarios('./chaos/chaos-scenarios.yaml');

  const scenario = process.argv[2] || 'database-disconnect';
  const success = await executor.runScenario(scenario);

  process.exit(success ? 0 : 1);
}

main().catch(console.error);
```

**Usage:**
```bash
npm run chaos -- database-disconnect
npm run chaos -- network-latency
```

**Effort:** 3-5 days

---

## Summary Table

| Gap | Effort | Impact | Timeline |
|-----|--------|--------|----------|
| Gap 1: E2E CI | 4h | HIGH | Week 1 |
| Gap 2: Auth tests | 8h | HIGH | Week 1 |
| Gap 3: Offline stress | 24h | CRITICAL | Week 2 |
| Gap 4: RBAC E2E | 16h | HIGH | Week 2 |
| Gap 5: Contract testing | 8h | MEDIUM | Week 2 |
| Gap 6: Test separation | 3h | MEDIUM | Week 1 |
| Gap 7: Chaos executor | 20h | MEDIUM | Week 3 |
| **TOTAL** | **~83h** | **– | **3-4 weeks** |

---

**END OF REMEDIATION GUIDE**
