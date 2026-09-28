/**
 * Каждая роль матрицы: вход, все пункты навигации, все кнопки каждого экрана.
 * Реестр покрытия — coverage.csv в папке прогона.
 */
import { test } from '@playwright/test';
import { coverage, crashText, login, matrix, shot, watchErrors } from './helpers';
import { crawlScreen, navLinks, settle } from './crawl';

const ACCOUNTS = [
  ...matrix.roles.map((r) => ({ role: r.role, email: r.email })),
  // Помощник — роль со своим входом; берём помощника первой версии.
  { role: 'ASSISTANT', email: matrix.operatorVersions[0].assistant },
];

for (const acc of ACCOUNTS) {
  test(`роль ${acc.role}: навигация и кнопки`, async ({ page }) => {
    // У администратора разделов в несколько раз больше, чем у любой роли:
    // 28.09 его обход упёрся в общий лимит 10 мин и не дошёл до конца.
    if (acc.role === 'ADMIN') test.setTimeout(40 * 60_000);
    const errs = watchErrors(page);
    const ctx = { role: acc.role, version: '-', module: 'навигация' };
    try {
      await login(page, acc.email);
    } catch (e) {
      coverage({ ...ctx, screen: '/login', element: 'вход', result: 'BLOCKED', evidence: (e as Error).message.split('\n')[0] });
      test.fail(true, 'вход не удался');
      throw e;
    }
    const landing = new URL(page.url()).pathname;
    coverage({ ...ctx, screen: '/login', element: 'Войти', result: 'OK', evidence: `→ ${landing}` });
    await crawlScreen(page, { ...ctx, module: landing }, landing, errs);

    await page.goto(landing);
    const links = await navLinks(page);
    for (const link of links) {
      const c = { ...ctx, module: link.href };
      try {
        await page.goto(landing);
        await page.locator(`a[href="${link.href}"]`).first().click({ timeout: 15_000 });
        await settle(page);
        const crash = await crashText(page);
        const problems = errs.take();
        const where = new URL(page.url()).pathname;
        if (crash || problems.length) {
          coverage({ ...c, screen: landing, element: `меню «${link.name}»`, result: 'DEFECT',
            evidence: `${crash ?? ''} ${problems.join(' | ')} ${await shot(page, `${acc.role}-${link.href}`)}`.trim() });
          continue;
        }
        coverage({ ...c, screen: landing, element: `меню «${link.name}»`, result: 'OK', evidence: `→ ${where}` });
        await crawlScreen(page, c, where, errs);
      } catch (e) {
        coverage({ ...c, screen: landing, element: `меню «${link.name}»`, result: 'BLOCKED', evidence: (e as Error).message.split('\n')[0] });
      }
    }
  });
}
