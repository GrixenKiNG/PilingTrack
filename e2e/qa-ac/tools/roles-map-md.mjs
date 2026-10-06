/**
 * Сборка docs/qa-autoclaw/roles-map.md из roles-map.json прогона.
 *
 * Запуск из корня репозитория:
 *   node e2e/qa-ac/tools/roles-map-md.mjs <roles-map.json> [docs/qa-autoclaw/roles-map.md]
 *
 * Ожидаемые меню — копия src/components/piling/icons/role-navigation.ts
 * (сервер приложения отдаёт навигацию по каждой роли; расхождения — в раздел
 * «Подозрительное»).
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , inPath, outPathArg] = process.argv;
if (!inPath) {
  console.error('usage: node e2e/qa-ac/tools/roles-map-md.mjs <roles-map.json> [out.md]');
  process.exit(1);
}
const outPath = outPathArg || 'docs/qa-autoclaw/roles-map.md';
const data = JSON.parse(fs.readFileSync(inPath, 'utf8'));

const EXPECTED = {
  ADMIN: ['/admin', '/monitoring', '/admin/sites', '/admin/reports', '/admin/equipment', '/admin/to', '/admin/crews', '/admin/safety', '/admin/analytics', '/admin/dictionaries', '/admin/users', '/admin/settings'],
  DISPATCHER: ['/admin', '/monitoring', '/admin/sites', '/admin/reports', '/admin/equipment', '/admin/to', '/admin/crews', '/admin/safety', '/admin/analytics', '/admin/settings'],
  MECHANIC: ['/admin/to', '/admin/safety'],
  FOREMAN: ['/admin', '/monitoring', '/admin/sites', '/admin/crews', '/admin/safety', '/admin/reports', '/admin/analytics'],
  SAFETY_ENGINEER: ['/admin/safety', '/admin/to', '/admin/sites', '/admin/reports'],
  OPERATOR: ['/operator', '/admin/safety', '/history'],
  ASSISTANT: ['/assistant', '/admin/safety', '/history'],
};

const OFFICE = ['/admin/dictionaries', '/admin/users', '/admin/settings', '/admin/dlq', '/admin/telegram'];

const lines = [];
lines.push('# Карта ролей (снято автоматически)');
lines.push('');
lines.push(`Источник: roles-map.json прогона; снято ${data.generatedAt} на http://localhost:3000.`);
lines.push('');
lines.push('## Сводка: пункты меню по ролям');
lines.push('');
lines.push('| Роль / режим | Пункты меню |');
lines.push('|---|---|');
const suspicious = [];
for (const row of data.rows) {
  const menu = row.menu.map((m) => m.label || m.href).join(' · ');
  const menuCell = menu || (row.role === 'ASSISTANT' ? 'свой экран (общего меню нет)' : '—');
  lines.push(`| ${row.actor} | ${menuCell} |`);
  const expected = EXPECTED[row.role] ?? [];
  const extra = row.menu.filter((m) => !expected.includes(m.href));
  const missing = expected.filter((h) => !row.menu.some((m) => m.href === h));
  // У помощника своя оболочка-мастер: общего меню нет по замыслу, сверять нечего.
  if (row.role !== 'ASSISTANT') {
    if (extra.length) suspicious.push(`${row.actor}: видит лишнее — ${extra.map((e) => `${e.label} (${e.href})`).join(', ')}`);
    if (missing.length) suspicious.push(`${row.actor}: не хватает — ${missing.join(', ')}`);
  }
  // «Механик видит управление пользователями» и т. п. — отдельная проверка.
  if (row.role !== 'ADMIN' && row.role !== 'DISPATCHER') {
    const office = row.menu.filter((m) => OFFICE.includes(m.href));
    if (office.length) suspicious.push(`${row.actor}: офисный раздел у не-офисной роли — ${office.map((o) => o.href).join(', ')}`);
  }
}
lines.push('');
lines.push('## Разделы и главные действия');
lines.push('');
for (const row of data.rows) {
  lines.push(`### ${row.actor}`);
  lines.push('');
  const byHref = new Map(row.menu.map((m) => [m.href, m.label]));
  for (const screen of row.screens) {
    const label = byHref.get(screen.href) ?? (screen.href === row.landing ? 'стартовый экран' : screen.href);
    const buttons = screen.buttons.length ? screen.buttons.join(' · ') : '—';
    lines.push(`- **${label}** (\`${screen.href}\`): ${buttons}`);
  }
  lines.push('');
}
lines.push('## Подозрительное (сверить вручную)');
lines.push('');
if (data.rows.some((r) => r.role === 'ASSISTANT')) {
  lines.push('- ASSISTANT: у роли своя оболочка — общего меню нет; действия сняты со стартового экрана (раздел выше).');
}
if (suspicious.length === 0) lines.push('Больше расхождений нет: меню остальных ролей совпадают с ожидаемым.');
else for (const s of suspicious) lines.push(`- ${s}`);
lines.push('');

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
console.log(`written: ${outPath} (${lines.length} строк)`);
