import {expect, test, type Browser, type Page} from '@playwright/test';
import {
  TECH_READINESS_ENTITIES,
  TECH_READINESS_TEST_TENANT,
  TECH_READINESS_USERS,
} from '../tests/fixtures/tech-readiness.fixture';

type TestRole = keyof Pick<
  typeof TECH_READINESS_USERS,
  'operator' | 'dispatcher' | 'secondDispatcher' | 'mechanic' | 'admin'
>;

async function openIsolatedSession(browser: Browser, role: TestRole): Promise<Page> {
  const context = await browser.newContext({
    extraHTTPHeaders: {
      'X-Test-Tenant': TECH_READINESS_TEST_TENANT.id,
      'X-Test-User': TECH_READINESS_USERS[role].id,
      'X-Test-Role': TECH_READINESS_USERS[role].role,
    },
  });
  const page = await context.newPage();
  await page.goto('/admin/to?view=center');
  return page;
}

test.describe.skip('Tech Readiness production role journeys', () => {
  test('operator observes readiness but cannot invoke mechanic/dispatcher commands', async ({browser}) => {
    const page = await openIsolatedSession(browser, 'operator');

    await expect(page.getByTestId('tech-readiness-tabs')).toBeVisible();
    await expect(page.getByTestId('current-snapshot')).toContainText(/готов|огранич|блок|нет данных/i);
    await expect(page.getByRole('button', {name: /начать смену/i})).toHaveCount(0);
    await expect(page.getByRole('button', {name: /принять передачу/i})).toHaveCount(0);

    const bypass = await page.request.post(
      `/api/readiness/handovers/${TECH_READINESS_ENTITIES.handoverId}/accept`,
      {
        headers: {
          'Idempotency-Key': 'test-e2e-operator-bypass',
          'If-Match': `"handover-${TECH_READINESS_ENTITIES.handoverId}-v1"`,
        },
        data: {expectedVersion: 1},
      },
    );
    expect(bypass.status()).toBe(403);
  });

  test('dispatcher approves NORMAL permit and accepts mechanic handover', async ({browser}) => {
    const mechanic = await openIsolatedSession(browser, 'mechanic');
    await mechanic.getByRole('tab', {name: /допуски/i}).click();
    await mechanic.getByRole('button', {name: /создать допуск/i}).click();
    await mechanic.getByLabel(/риск/i).selectOption('NORMAL');
    await mechanic.getByLabel(/объём работ/i).fill('Test-only normal permit');
    await mechanic.getByRole('button', {name: /отправить на согласование/i}).click();
    await expect(mechanic.getByText(/ожидает согласования/i)).toBeVisible();

    const dispatcher = await openIsolatedSession(browser, 'dispatcher');
    await dispatcher.getByRole('tab', {name: /допуски/i}).click();
    await dispatcher.getByTestId(`permit-${TECH_READINESS_ENTITIES.normalPermitId}`).click();
    await dispatcher.getByRole('button', {name: /одобрить/i}).click();
    await dispatcher.getByRole('button', {name: /подтвердить/i}).click();
    await expect(dispatcher.getByText(/approved|одобрен/i)).toBeVisible();

    await mechanic.getByRole('tab', {name: /смены/i}).click();
    await mechanic.getByTestId(`shift-${TECH_READINESS_ENTITIES.shiftId}`).click();
    await mechanic.getByRole('button', {name: /передать смену/i}).click();
    await mechanic.getByLabel(/сводка/i).fill('Test-only handover summary');
    await mechanic.getByRole('button', {name: /передать/i}).click();

    await dispatcher.getByRole('tab', {name: /смены/i}).click();
    await dispatcher.getByTestId(`handover-${TECH_READINESS_ENTITIES.handoverId}`).click();
    await dispatcher.getByRole('button', {name: /принять передачу/i}).click();
    await dispatcher.getByRole('button', {name: /подтвердить/i}).click();
    await expect(dispatcher.getByText(/accepted|принята/i)).toBeVisible();
    await expect(dispatcher.getByTestId('current-snapshot')).toBeVisible();
  });

  test('mechanic and admin approve ELEVATED permit as two distinct users', async ({browser}) => {
    const dispatcher = await openIsolatedSession(browser, 'dispatcher');
    await dispatcher.getByRole('tab', {name: /допуски/i}).click();
    await dispatcher.getByTestId(`permit-${TECH_READINESS_ENTITIES.elevatedPermitId}`).click();
    await dispatcher.getByRole('button', {name: /одобрить/i}).click();
    await dispatcher.getByRole('button', {name: /подтвердить/i}).click();
    await expect(dispatcher.getByText(/1\s*\/\s*2/)).toBeVisible();

    const admin = await openIsolatedSession(browser, 'admin');
    await admin.getByRole('tab', {name: /допуски/i}).click();
    await admin.getByTestId(`permit-${TECH_READINESS_ENTITIES.elevatedPermitId}`).click();
    await admin.getByRole('button', {name: /одобрить/i}).click();
    await admin.getByRole('button', {name: /подтвердить/i}).click();
    await expect(admin.getByText(/approved|одобрен/i)).toBeVisible();
  });

  test('second dispatcher receives visible 409 recovery after concurrent accept', async ({browser}) => {
    const first = await openIsolatedSession(browser, 'dispatcher');
    const second = await openIsolatedSession(browser, 'secondDispatcher');

    for (const page of [first, second]) {
      await page.getByRole('tab', {name: /смены/i}).click();
      await page.getByTestId(`handover-${TECH_READINESS_ENTITIES.handoverId}`).click();
    }

    await Promise.all([
      first.getByRole('button', {name: /принять передачу/i}).click(),
      second.getByRole('button', {name: /принять передачу/i}).click(),
    ]);
    await Promise.all([
      first.getByRole('button', {name: /подтвердить/i}).click(),
      second.getByRole('button', {name: /подтвердить/i}).click(),
    ]);

    await expect(first.getByText(/accepted|принята/i)).toBeVisible();
    await expect(second.getByRole('alert')).toContainText(/уже принята/i);
    await expect(second.getByRole('alert')).toContainText(/диспетчер|dispatcher/i);
    await expect(second.getByRole('button', {name: /принять передачу/i})).toHaveCount(0);
  });
});

test.describe.skip('Tech Readiness critical blocker', () => {
  test('published blocker prevents shift start and points to a correcting action', async ({browser}) => {
    const mechanic = await openIsolatedSession(browser, 'mechanic');
    await mechanic.getByRole('tab', {name: /смены/i}).click();
    await mechanic.getByTestId(`shift-${TECH_READINESS_ENTITIES.shiftId}`).click();
    await mechanic.getByRole('button', {name: /начать смену/i}).click();
    await mechanic.getByRole('button', {name: /подтвердить/i}).click();

    const dialog = mechanic.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText(/действующий наряд-допуск обязателен/i);
    await expect(dialog.getByRole('link', {name: /создать|открыть допуск/i})).toBeVisible();
    await expect(mechanic.getByTestId(`shift-${TECH_READINESS_ENTITIES.shiftId}`))
      .toContainText(/planned|запланирована/i);
    await expect(mechanic.getByTestId('current-snapshot')).toContainText(/blocked|заблокирована/i);
  });
});
