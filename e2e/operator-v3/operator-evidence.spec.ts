import {expect, test, type Page, type TestInfo} from '@playwright/test';

const optionalRoles = process.env.OPERATOR_V3_ALL_TEST_ROLES === 'true';

async function signIn(page: Page, email = 'operator@piling.ru', password = process.env.OPERATOR_PASSWORD ?? 'operator123') {
  await page.goto('/login');
  await page.getByLabel(/электронная почта|email/i).fill(email);
  await page.getByLabel(/пароль|password/i).fill(password);
  await page.getByRole('button', {name: /войти/i}).click();
  await page.goto('/operator/v3');
  await expect(page.getByTestId('operator-v3-workplace')).toBeVisible();
}

async function commandEvidence(page: Page, action: RegExp, info: TestInfo) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/operator/v3/commands/'));
  await page.getByRole('button', {name: action}).click();
  const response = await responsePromise;
  expect(response.ok()).toBeTruthy();
  const receipt = await response.json();
  expect(receipt).toMatchObject({result: 'COMPLETED', commandId: expect.any(String), newVersion: expect.any(Number)});
  await info.attach(`квитанция-${receipt.commandId}`, {body: JSON.stringify(receipt, null, 2), contentType: 'application/json'});
  return receipt;
}

async function authoritativeRefresh(page: Page) {
  const responsePromise = page.waitForResponse((response) => response.url().includes('/api/operator/v3/workplace'));
  await page.reload();
  expect((await responsePromise).ok()).toBeTruthy();
  await expect(page.getByTestId('operator-v3-workplace')).toBeVisible();
}

test.describe.serial('Оператор v3 — семь нормативных сценариев с доказательствами', () => {
  test('1. обычная смена проходит семь серверных фаз', async ({page}, info) => {
    await signIn(page);
    await expect(page.getByTestId('operator-v3-phase-route').getByRole('listitem')).toHaveCount(7);
    for (const action of [/принять назначение/i, /получить установку/i, /завершить проверку/i,
      /подтвердить рабочую зону/i, /сохранить моточасы/i, /начать смену/i]) {
      await commandEvidence(page, action, info);
    }
    await expect(page.getByText(/работа разрешена/i)).toBeVisible();
    await authoritativeRefresh(page);
    await expect(page.getByText(/работа/i)).toBeVisible();
  });

  test('2. замечание требует доказательство и попадает в передачу', async ({page}, info) => {
    test.skip(!optionalRoles, 'Нужна отдельная подготовленная смена с некритическим замечанием');
    await signIn(page);
    await page.getByRole('button', {name: /добавить фотографию/i}).click();
    await page.getByLabel(/описание/i).fill('Следы эксплуатации без запрета работы');
    await commandEvidence(page, /сохранить доказательство/i, info);
    await expect(page.getByText(/работа разрешена с замечаниями/i)).toBeVisible();
    await authoritativeRefresh(page);
  });

  test('3. критический дефект запрещает пуск до независимой проверки', async ({page}, info) => {
    test.skip(!optionalRoles, 'Нужны механик и независимый проверяющий');
    await signIn(page);
    await page.getByRole('button', {name: /сообщить о дефекте/i}).click();
    await page.getByLabel(/утечка/i).check();
    await commandEvidence(page, /зарегистрировать дефект/i, info);
    await expect(page.getByText(/работа запрещена/i)).toBeVisible();
    await expect(page.getByRole('button', {name: /начать смену/i})).toHaveCount(0);
    await authoritativeRefresh(page);
  });

  test('4. опасное событие включает безопасную остановку', async ({page}, info) => {
    test.skip(!optionalRoles, 'Нужна подготовленная работающая смена');
    await signIn(page);
    await page.getByRole('button', {name: /опасное событие/i}).click();
    await commandEvidence(page, /зарегистрировать событие/i, info);
    await expect(page.getByText(/требуется безопасная остановка/i)).toBeVisible();
    await expect(page.getByRole('button', {name: /записать выработку/i})).toHaveCount(0);
    await commandEvidence(page, /подтвердить безопасную остановку/i, info);
  });

  test('5. потеря связи сохраняет и однократно согласовывает запись', async ({page}, info) => {
    test.skip(!optionalRoles, 'Нужно подписанное разрешение работы без связи');
    await signIn(page);
    await page.context().setOffline(true);
    await page.getByRole('button', {name: /добавить фотографию/i}).click();
    await expect(page.getByText(/сохранено на устройстве/i)).toBeVisible();
    await page.reload({waitUntil: 'commit'}).catch(() => undefined);
    await page.context().setOffline(false);
    await page.reload();
    await expect(page.getByText(/все данные переданы/i)).toBeVisible();
    await info.attach('очередь-после-восстановления', {body: await page.locator('body').innerText(), contentType: 'text/plain'});
  });

  test('6. противоречие двух устройств не перезаписывает сервер молча', async ({browser}, info) => {
    test.skip(!optionalRoles, 'Нужны два зарегистрированных испытательных устройства');
    const first = await browser.newPage();
    const second = await browser.newPage();
    await signIn(first); await signIn(second);
    await commandEvidence(first, /принять назначение/i, info);
    await second.getByRole('button', {name: /принять назначение/i}).click();
    await expect(second.getByRole('alert')).toContainText(/состояние изменилось|противоречие/i);
    await authoritativeRefresh(second);
  });

  test('7. передача без принимающего закрывается только уполномоченным', async ({page}, info) => {
    test.skip(!optionalRoles, 'Нужен уполномоченный ответственный и смена в передаче');
    await signIn(page);
    await expect(page.getByRole('button', {name: /закрыть без принимающего/i})).toHaveCount(0);
    await commandEvidence(page, /передать установку/i, info);
    await expect(page.getByText(/ожидает принятия/i)).toBeVisible();
    await authoritativeRefresh(page);
  });
});
