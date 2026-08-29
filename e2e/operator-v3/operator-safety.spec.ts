import {expect, test, type Page, type TestInfo} from '@playwright/test';

async function signInAsOperator(page: Page) {
  await page.goto('/login', {waitUntil: 'domcontentloaded'});
  await page.waitForLoadState('networkidle');
  const email = page.getByLabel(/электронная почта|email/i);
  const password = page.getByRole('textbox', {name: 'Пароль'});
  await email.fill(process.env.OPERATOR_EMAIL ?? 'operator@piling.ru');
  await password.fill(process.env.OPERATOR_PASSWORD ?? 'operator123');
  await expect(email).toHaveValue(process.env.OPERATOR_EMAIL ?? 'operator@piling.ru');
  await expect(password).toHaveValue(process.env.OPERATOR_PASSWORD ?? 'operator123');
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/auth/login') && response.request().method() === 'POST'),
    page.getByRole('button', {name: /войти/i}).click(),
  ]);
  await page.goto('/operator/v3', {waitUntil: 'domcontentloaded'});
  await expect(page.getByTestId('operator-v3-workplace')).toBeVisible();
}

async function submitCommand(page: Page, buttonName: RegExp, info: TestInfo, evidenceName: string) {
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' && response.url().includes('/api/operator/v3/commands/'));
  await page.getByRole('button', {name: buttonName}).click();
  const response = await responsePromise;
  const body = await response.json();
  await info.attach(evidenceName, {body: JSON.stringify(body, null, 2), contentType: 'application/json'});
  expect(response.ok(), `Команда завершилась с HTTP ${response.status()}: ${JSON.stringify(body)}`).toBeTruthy();
  return body;
}

test.describe.serial('Оператор v3 — реальная безопасная остановка', () => {
  test('опасность с фотографией блокирует производство и сохраняет остановку после обновления', async ({page}, info) => {
    await signInAsOperator(page);
    await expect(page.getByRole('button', {name: 'Сообщить об опасном событии'})).toBeVisible();

    await page.getByRole('button', {name: 'Сообщить об опасном событии'}).click();
    await page.getByLabel('Что произошло').fill('Самопроизвольное движение рабочего органа');
    await page.getByText('Самопроизвольное движение', {exact: true}).click();
    await page.getByLabel('Есть ли пострадавшие').selectOption('NO');
    await page.getByLabel('Применена ли аварийная остановка').selectOption('YES');
    await page.getByLabel('Текущее безопасное состояние').fill('Рабочий орган опущен, люди выведены из опасной зоны');
    await page.getByLabel('Фотография доказательства').setInputFiles({
      name: 'опасное-событие.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZQmcAAAAASUVORK5CYII=', 'base64'),
    });
    await expect(page.getByText('Фотография подтверждена')).toBeVisible();

    await submitCommand(page, /сохранить опасное событие/i, info, 'опасное-событие-команда');
    await expect(page.getByRole('heading', {name: 'Требуется безопасная остановка'})).toBeFocused();
    await expect(page.getByText(/производственные действия заблокированы сервером/i)).toBeVisible();
    await expect(page.getByRole('button', {name: /записать выполненную работу|добавить выполненную работу/i})).toHaveCount(0);
    await expect(page.getByText('Выполнено свай')).toHaveCount(0);
    await info.attach('экран-stop-required', {body: await page.screenshot({fullPage: true}), contentType: 'image/png'});

    await page.getByLabel('Текущее безопасное состояние').fill('Двигатель заглушён, рабочий орган опущен, зона ограждена');
    await submitCommand(page, /подтвердить безопасную остановку/i, info, 'безопасная-остановка-команда');
    await expect(page.getByRole('heading', {name: 'Восстановление безопасной работы'})).toBeVisible();
    await expect(page.getByRole('button', {name: /записать выполненную работу|добавить выполненную работу/i})).toHaveCount(0);

    const workplaceResponse = page.waitForResponse((response) => response.url().includes('/api/operator/v3/workplace'));
    await page.reload({waitUntil: 'domcontentloaded'});
    expect((await workplaceResponse).ok()).toBeTruthy();
    await expect(page.getByRole('heading', {name: 'Восстановление безопасной работы'})).toBeVisible();
    await expect(page.getByRole('button', {name: /записать выполненную работу|добавить выполненную работу/i})).toHaveCount(0);
    await info.attach('экран-stopped-после-обновления', {body: await page.screenshot({fullPage: true}), contentType: 'image/png'});
  });
});
