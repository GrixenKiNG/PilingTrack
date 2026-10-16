#!/usr/bin/env node
/**
 * Краткий отчёт ночного E2E для карточки запуска в GitHub (GITHUB_STEP_SUMMARY).
 *
 * Читает JSON-отчёт Playwright и печатает Markdown: итог, таблицу по профилям
 * (chromium / Mobile Safari / Mobile Chrome), список упавших и «шатких»
 * сценариев с первой строкой ошибки. Код возврата 0 всегда: падение или успех
 * запуска решает сам шаг Playwright, а этот скрипт только рассказывает.
 *
 * Запуск: node scripts/e2e-summary.cjs playwright-results.json >> "$GITHUB_STEP_SUMMARY"
 */
const fs = require('node:fs');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.log('## Ночной E2E\n\nОтчёт Playwright не найден: прогон не дошёл до тестов (см. журнал шагов выше).');
  process.exit(0);
}

const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const byProject = new Map();
const failed = [];
const flaky = [];

function bucket(project) {
  if (!byProject.has(project)) byProject.set(project, {passed: 0, failed: 0, flaky: 0, skipped: 0});
  return byProject.get(project);
}

function firstLine(text) {
  const clean = String(text || '').replace(/\u001b\[[0-9;]*m/g, '').trim();
  return (clean.split('\n').find((line) => line.trim()) || '').trim().slice(0, 240);
}

function walk(suite, trail) {
  const here = suite.title && !suite.file ? [...trail, suite.title] : trail;
  for (const spec of suite.specs || []) {
    for (const test of spec.tests || []) {
      const project = test.projectName || 'default';
      const row = bucket(project);
      const where = `${spec.file || suite.file || ''}:${spec.line || ''}`;
      const title = [...here, spec.title].filter(Boolean).join(' › ');
      if (test.status === 'skipped') row.skipped += 1;
      else if (test.status === 'expected') row.passed += 1;
      else if (test.status === 'flaky') {
        row.flaky += 1;
        flaky.push({project, title, where});
      } else {
        row.failed += 1;
        const result = (test.results || []).find((item) => item.error) || {};
        failed.push({project, title, where, error: firstLine(result.error && (result.error.message || result.error.stack))});
      }
    }
  }
  for (const child of suite.suites || []) walk(child, here);
}

for (const suite of report.suites || []) walk(suite, []);

const total = [...byProject.values()].reduce((sum, row) => ({
  passed: sum.passed + row.passed, failed: sum.failed + row.failed,
  flaky: sum.flaky + row.flaky, skipped: sum.skipped + row.skipped,
}), {passed: 0, failed: 0, flaky: 0, skipped: 0});

const lines = [];
lines.push('## Ночной E2E по ролям');
lines.push('');
lines.push(failed.length === 0
  ? `**Итог: зелёный.** Прошло ${total.passed}, шатких ${total.flaky}, пропущено ${total.skipped}.`
  : `**Итог: красный.** Упало ${total.failed}, прошло ${total.passed}, шатких ${total.flaky}, пропущено ${total.skipped}.`);
lines.push('');
lines.push('| Профиль | Прошло | Упало | Шаткие | Пропущено |');
lines.push('|---|--:|--:|--:|--:|');
for (const [project, row] of [...byProject.entries()].sort()) {
  lines.push(`| ${project} | ${row.passed} | ${row.failed} | ${row.flaky} | ${row.skipped} |`);
}
if (failed.length > 0) {
  lines.push('');
  lines.push('### Упавшие сценарии');
  for (const item of failed) lines.push(`- **${item.project}** — ${item.title} (\`${item.where}\`)${item.error ? `\n  - ${item.error}` : ''}`);
}
if (flaky.length > 0) {
  lines.push('');
  lines.push('### Шаткие (прошли со второй-третьей попытки)');
  for (const item of flaky) lines.push(`- **${item.project}** — ${item.title} (\`${item.where}\`)`);
}
lines.push('');
lines.push('Полный отчёт с трассами и видео упавших — во вложении `playwright-report` этого запуска.');
console.log(lines.join('\n'));
