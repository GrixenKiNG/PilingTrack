/**
 * Блок C задания №5: сценарии записи — только на своих данных «AC-QA».
 *
 * Справочники: добавить марку, архивировать с «Отменить» в уведомлении,
 * массовая архивация — окно «Архивировать N записей?», «Отмена» ничего не
 * меняет. Объект: «Выполнен» с отменой, деактивация с окном про бригады,
 * активация обратно, удаление. Отчёт: диспетчер создаёт на AC-QA объект,
 * правит, удаляет. Всё созданное — удаляется или архивируется здесь же.
 */
import { expect, test } from '@playwright/test';
import { login, matrix } from '../qa/helpers';
import { RUN_SUF, api, pause, sweepAcqa, writeRunJson } from './util';

const ADMIN = matrix.roles.find((r) => r.role === 'ADMIN')!.email;
const DISPATCHER = matrix.roles.find((r) => r.role === 'DISPATCHER')!.email;

test('C1: справочники — добавить, архивировать с «Отменить», массовая архивация', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const nameA = `AC-QA Марка ${RUN_SUF}-1`;
  const nameB = `AC-QA Марка ${RUN_SUF}-2`;

  await login(page, ADMIN);
  await page.goto('/admin/dictionaries');
  await expect(page.getByRole('heading', { name: 'Справочники' })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText('Сваи — активные')).toBeVisible();

  // --- Добавить две марки свай.
  for (const name of [nameA, nameB]) {
    await page.getByRole('button', { name: 'Добавить марку сваи' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Название').fill(name);
    await dialog.getByLabel('Длина, м').fill('12');
    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(page.locator('[data-sonner-toast]', { hasText: 'Элемент добавлен' }).last()).toBeVisible();
    await expect(page.getByRole('button', { name: `Архивировать ${name}` })).toBeVisible({ timeout: 30_000 });
  }

  // --- Одна запись: архивация сразу, «Отменить» в уведомлении возвращает.
  await page.getByRole('button', { name: `Архивировать ${nameA}` }).click();
  const toast = page.locator('[data-sonner-toast]', { hasText: `Архивировано: ${nameA}` });
  await expect(toast).toBeVisible();
  const undo = toast.getByRole('button', { name: 'Отменить' });
  await expect(undo, 'в уведомлении об архивации должна быть кнопка «Отменить»').toBeVisible({ timeout: 5_000 });
  await undo.click();
  await expect(page.getByRole('button', { name: `Архивировать ${nameA}` }), 'марка вернулась в активные').toBeVisible({ timeout: 30_000 });
  // Изменение переживает перезагрузку.
  await page.reload();
  await expect(page.getByRole('button', { name: `Архивировать ${nameA}` })).toBeVisible({ timeout: 30_000 });

  // --- Массовая архивация: окно с числом записей; «Отмена» ничего не меняет.
  await page.getByRole('checkbox', { name: `Выбрать ${nameA}` }).click();
  await page.getByRole('checkbox', { name: `Выбрать ${nameB}` }).click();
  await page.getByRole('button', { name: 'Архивировать', exact: true }).click();
  const confirm = page.getByRole('alertdialog');
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await expect(confirm).toContainText('Архивировать 2 записи?');
  await confirm.getByRole('button', { name: 'Отмена' }).click();
  await expect(confirm).toBeHidden();
  // Ничего не изменилось: обе марки на месте и активны.
  await expect(page.getByRole('button', { name: `Архивировать ${nameA}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Архивировать ${nameB}` })).toBeVisible();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Архивировано: 2' })).toHaveCount(0);

  // --- Подтверждённая массовая архивация — уборка тестовых данных.
  await page.getByRole('button', { name: 'Архивировать', exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Архивировать' }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Архивировано: 2' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: `Архивировать ${nameA}` })).toBeHidden({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: `Архивировать ${nameB}` })).toBeHidden({ timeout: 30_000 });
});

test('C2: объект — «Выполнен» с «Отменить», деактивация с окном, удаление', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const siteName = `AC-QA Объект ${RUN_SUF} (объект)`;

  await login(page, ADMIN);
  await page.goto('/admin/sites');
  await expect(page.getByRole('heading', { name: 'Объекты' })).toBeVisible({ timeout: 90_000 });

  // --- Новый объект.
  await page.getByRole('button', { name: 'Новый объект' }).click();
  const createDialog = page.getByRole('dialog');
  await createDialog.getByPlaceholder('Например: ЖК Солнечный').fill(siteName);
  await createDialog.getByRole('button', { name: 'Создать' }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Объект создан' }).last()).toBeVisible({ timeout: 30_000 });
  await page.getByText(siteName).first().click();
  await pause(page);
  await expect(page.getByRole('button', { name: 'Выполнен', exact: true })).toBeVisible({ timeout: 30_000 });

  // --- «Выполнен» → «Отменить» в уведомлении.
  await page.getByRole('button', { name: 'Выполнен', exact: true }).click();
  const toast = page.locator('[data-sonner-toast]', { hasText: 'Объект отмечен «Выполнен»' }).last();
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Отменить' }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Отметка «Выполнен» снята' }).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Выполнен', exact: true })).toBeVisible();

  // --- Деактивация: окно подтверждения с текстом про бригады.
  await page.getByRole('button', { name: 'Деактивировать', exact: true }).click();
  const dlg = page.getByRole('alertdialog');
  await expect(dlg).toBeVisible({ timeout: 5_000 });
  await expect(dlg).toContainText(`Деактивировать объект «${siteName}»?`);
  await expect(dlg, 'окно объясняет, что будет с бригадами').toContainText(/бригад/i);
  await dlg.getByRole('button', { name: 'Деактивировать' }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Объект деактивирован' }).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Активировать', exact: true })).toBeVisible({ timeout: 30_000 });

  // --- Обратно активный объект переживает перезагрузку.
  await page.getByRole('button', { name: 'Активировать', exact: true }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Объект активирован' }).last()).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await page.getByText(siteName).first().click();
  await pause(page);
  await expect(page.getByRole('button', { name: 'Деактивировать', exact: true })).toBeVisible({ timeout: 30_000 });

  // --- Удаление навсегда: окно предупреждает про бригады; объект без бригад и отчётов удаляется.
  await page.getByRole('button', { name: 'Удалить навсегда' }).click();
  const del = page.getByRole('dialog');
  await expect(del).toContainText('без бригад и без отчётов');
  await del.getByRole('button', { name: 'Удалить навсегда' }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Объект удалён' }).last()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(siteName)).toHaveCount(0, { timeout: 30_000 });
});

test('C3: отчёт — диспетчер создаёт на AC-QA объекте, правит, удаляет', async ({ page }) => {
  test.setTimeout(20 * 60_000);
  const siteName = `AC-QA Объект ${RUN_SUF} (отчёт)`;

  await login(page, DISPATCHER);
  const siteResp = await api(page).post('/api/sites/create', { data: { name: siteName } });
  expect(siteResp.status(), 'AC-QA объект создан диспетчером').toBe(201);
  const siteId = (await siteResp.json()).site.id as string;
  // Владелец отчёта должен быть закреплён за объектом (иначе запись отчёта — 403).
  const users = (await (await api(page).get('/api/users')).json()).users as Array<{ id: string; email: string; name: string }>;
  const ka = users.find((u) => u.email === matrix.operatorVersions[0].operator);
  expect(ka, 'оператор ka найден').toBeTruthy();
  const assign = await api(page).post(`/api/sites/${siteId}/assign`, { data: { userId: ka!.id } });
  expect(assign.status(), 'оператор закреплён за AC-QA объектом').toBe(200);

  await page.goto('/admin/reports');
  await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible({ timeout: 90_000 });
  await page.getByRole('button', { name: 'Новый отчёт' }).click();
  const dlg = page.getByRole('dialog');
  await expect(dlg.getByText('Сформировать отчёт')).toBeVisible({ timeout: 30_000 });

  // Оператор — Краснов (закреплён за объектом); объект — свой AC-QA.
  await dlg.getByText('Выберите оператора').click();
  await page.getByRole('option', { name: ka!.name }).click();
  await dlg.getByText('Выберите объект').click();
  await page.getByRole('option', { name: siteName }).click();

  // Свая: 5 шт.
  await dlg.getByText('Марка сваи...').click();
  await page.getByRole('option').first().click();
  await dlg.getByPlaceholder('Кол-во').first().fill('5');
  await dlg.locator('div.flex.gap-2.mb-2').first().getByRole('button').click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Свая добавлена' }).last()).toBeVisible();

  const formText = await dlg.innerText().catch(() => '');
  await dlg.getByRole('button', { name: 'Создать' }).click();
  await pause(page, 3500);
  const toastTexts = await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => []);
  writeRunJson('write-flows-c3.json', { formText: formText.slice(0, 2000), toastTexts });
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Отчёт создан' }).last(), `тосты после «Создать»: ${toastTexts.join(' | ') || 'нет тостов'}`).toBeVisible({ timeout: 30_000 });
  await page.reload();
  await pause(page, 1500);

  const row = page.locator('div.grid.gap-3.px-3.py-3', { hasText: siteName }).first();
  await expect(row, 'отчёт виден в журнале').toBeVisible({ timeout: 30_000 });
  await expect(row).toContainText('5 шт.');

  // --- Правка: заменить строку свай на 7 шт.
  await row.getByRole('button', { name: 'Редактировать' }).click();
  const edit = page.getByRole('dialog');
  await expect(edit.getByText('Редактировать отчёт')).toBeVisible({ timeout: 30_000 });
  await edit.getByRole('button', { name: /Удалить сваю/ }).click();
  await edit.getByText('Марка сваи...').click();
  await page.getByRole('option').first().click();
  await edit.getByPlaceholder('Кол-во').first().fill('7');
  await edit.locator('div.flex.gap-2.mb-2').first().getByRole('button').click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Свая добавлена' }).last()).toBeVisible();
  await edit.getByRole('button', { name: 'Сохранить' }).click();
  await expect(page.locator('[data-sonner-toast]', { hasText: 'Отчёт обновлён' }).last()).toBeVisible({ timeout: 40_000 });
  await pause(page);
  // Изменение переживает перезагрузку.
  await page.reload();
  const row2 = page.locator('div.grid.gap-3.px-3.py-3', { hasText: siteName }).first();
  await expect(row2).toContainText('7 шт.', { timeout: 40_000 });

  // --- Удаление отчёта.
  await row2.getByRole('button', { name: 'Удалить' }).click();
  const del = page.getByRole('alertdialog');
  await expect(del).toContainText('Удалить сменный отчёт?');
  await del.getByRole('button', { name: 'Удалить отчёт' }).click();
  await expect(row2).toBeHidden({ timeout: 40_000 });

  // --- Уборка: объект теста.
  const cleanup = await api(page).delete(`/api/sites/${siteId}`);
  expect(cleanup.status(), 'AC-QA объект удалён').toBeLessThan(400);
});

test.afterAll(async ({ browser }) => {
  // Страховка: если прогон прервался, «AC-QA»-записи не остаются в базе.
  const page = await browser.newPage();
  try {
    await login(page, ADMIN);
    await sweepAcqa(page);
  } finally {
    await page.close();
  }
});
