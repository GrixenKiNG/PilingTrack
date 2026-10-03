/**
 * Версии экрана оператора на телефоне: вход оператора и помощника, все
 * кнопки стартового экрана и экранов, куда они ведут. Полный цикл смены
 * «как новичок» проходит Hermes (решение владельца 27.09.2026).
 */
import { test } from '@playwright/test';
import { coverage, crashText, login, matrix, shot, watchErrors } from './helpers';
import { crawlScreen, settle } from './crawl';

for (const v of matrix.operatorVersions) {
  for (const who of ['OPERATOR', 'ASSISTANT'] as const) {
    const email = who === 'OPERATOR' ? v.operator : v.assistant;
    test(`${v.version} (${v.equipment}): ${who === 'OPERATOR' ? 'оператор' : 'помощник'}`, async ({ page }) => {
      const errs = watchErrors(page);
      const ctx = { role: who, version: v.version, module: 'оператор' };
      await login(page, email);
      await page.goto(v.path);
      await settle(page);
      const crash = await crashText(page);
      const problems = errs.take();
      if (crash || problems.length) {
        coverage({ ...ctx, screen: v.path, element: 'открытие версии', result: 'DEFECT',
          evidence: `${crash ?? ''} ${problems.join(' | ')} ${await shot(page, `${v.version}-${v.equipment}-${who}-open`)}`.trim() });
      } else {
        coverage({ ...ctx, screen: v.path, element: 'открытие версии', result: 'OK', evidence: await shot(page, `${v.version}-${v.equipment}-${who}-open`) });
      }
      await crawlScreen(page, ctx, v.path, errs);
    });
  }
}
