/**
 * Разовый пересчёт текстов в ленте событий.
 *
 * До 22.09.2026 тридцать действий не имели описания и ложились в ленту машинным
 * кодом: title = «user.document_type.created», message = «Событие аудита в
 * контуре users». Правка в audit-service подействовала только на новые события —
 * история осталась нечитаемой.
 *
 * Скрипт НЕ ходит в базу: на вход берёт выгрузку строк, на выход даёт SQL.
 * Так пересчёт считается здесь той же функцией `describeAuditEvent`, что пишет
 * новые события (иначе история разойдётся с текущей лентой), а на сервере не
 * нужен ни node, ни tsx — только psql.
 *
 *   node --experimental-strip-types scripts/backfill-audit-feed-text.ts rows.json out.sql
 *
 * Пересчитываются только строки, где title совпадает с action, — признак того,
 * что описание не нашлось. Строки, для которых описания нет и сейчас,
 * пропускаются: перезаписывать их тем же машинным кодом бессмысленно.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { describeAuditEvent } from '../src/services/audit/audit-service';

interface Row {
  id: string;
  action: string;
  scope: string;
  title: string;
  metadata: Record<string, unknown> | null;
}

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

const [, , inputPath, outputPath] = process.argv;
if (!inputPath || !outputPath) {
  console.error('Использование: backfill-audit-feed-text.ts <rows.json> <out.sql>');
  process.exit(1);
}

const rows: Row[] = JSON.parse(readFileSync(inputPath, 'utf8'));
const statements: string[] = [];
const perAction = new Map<string, number>();
let skipped = 0;

for (const row of rows) {
  // Страховка: пересчитываем только нерасшифрованные строки, даже если выгрузка
  // содержит лишнее. Иначе можно затереть текст, отредактированный руками.
  if (row.title !== row.action) {
    skipped += 1;
    continue;
  }

  const described = describeAuditEvent({
    action: row.action,
    scope: row.scope,
    metadata: row.metadata ?? undefined,
  });

  // Описания всё ещё нет — оставляем как есть.
  if (described.title === row.action) {
    skipped += 1;
    continue;
  }

  statements.push(
    `UPDATE "FeedbackEvent" SET title = ${sqlLiteral(described.title)}, ` +
      `message = ${sqlLiteral(described.message)} WHERE id = ${sqlLiteral(row.id)};`,
  );
  perAction.set(row.action, (perAction.get(row.action) ?? 0) + 1);
}

const header = [
  '-- Пересчёт текстов ленты событий (scripts/backfill-audit-feed-text.ts).',
  '-- Уровень и приоритет НЕ трогаем: от них зависит порядок в ленте.',
  'BEGIN;',
];
writeFileSync(outputPath, [...header, ...statements, 'COMMIT;', ''].join('\n'), 'utf8');

console.log(`строк на входе: ${rows.length}`);
console.log(`будет обновлено: ${statements.length}`);
console.log(`пропущено: ${skipped}`);
for (const [action, count] of [...perAction.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${action}: ${count}`);
}
