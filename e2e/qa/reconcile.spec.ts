/**
 * Сверка цифр между слоями за 14 дней — только чтение базы (SELECT):
 *   первичные сваи (PileWork) → строка аналитики отчёта (ReportAnalytics)
 *   → дневная сводка объекта (SiteDailySummary).
 * Расхождение — повод для разбора, а не готовый дефект: сверку проверяет
 * Hermes (черновики, поправки, фильтры) и затем ревьюер.
 */
import { test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { coverage, OUT_DIR } from './helpers';

function select(sql: string): string[][] {
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('только SELECT');
  const out = execFileSync('docker', ['exec', '-i', 'pilingtrack-postgres', 'psql', '-U', 'postgres', '-d', 'pilingtrack_test', '-AtF', '\t'],
    { input: sql, encoding: 'utf8' });
  return out.trim() ? out.trim().split('\n').map((l) => l.split('\t')) : [];
}

const SINCE = `to_char(now() AT TIME ZONE 'Europe/Moscow' - interval '14 days', 'YYYY-MM-DD')`;

test('сверка: сваи отчёта ↔ аналитика ↔ дневная сводка', async () => {
  const checks: { name: string; rows: string[][]; header: string }[] = [
    {
      name: 'Сваи в отчёте ≠ ReportAnalytics.totalPiles',
      header: 'reportId;дата;объект;сваи в записях;в аналитике;статус',
      rows: select(`
        SELECT r."reportId", r.date, s.name, coalesce(p.cnt,0), ra."totalPiles", r.status
        FROM "Report" r JOIN "Site" s ON s.id = r."siteId"
        LEFT JOIN (SELECT "reportId", sum(count) cnt FROM "PileWork" GROUP BY "reportId") p ON p."reportId" = r.id
        LEFT JOIN "ReportAnalytics" ra ON ra."reportId" = r."reportId"
        WHERE r."tenantId" = 'orion' AND r.date >= ${SINCE}
          AND coalesce(p.cnt,0) <> coalesce(ra."totalPiles", -1)
        ORDER BY r.date DESC;`),
    },
    {
      name: 'Сводка объекта за день ≠ сумма аналитики его отчётов',
      header: 'объект;дата;в сводке;сумма отчётов (все);сумма сданных',
      rows: select(`
        SELECT s.name, d.date, d."totalPiles", coalesce(sum(ra."totalPiles"),0),
               coalesce(sum(ra."totalPiles") FILTER (WHERE r.status = 'submitted'),0)
        FROM "SiteDailySummary" d JOIN "Site" s ON s.id = d."siteId"
        LEFT JOIN "Report" r ON r."siteId" = d."siteId" AND r.date = d.date AND r."tenantId" = 'orion'
        LEFT JOIN "ReportAnalytics" ra ON ra."reportId" = r."reportId"
        WHERE s."tenantId" = 'orion' AND d.date >= ${SINCE}
        GROUP BY s.name, d.date, d."totalPiles"
        HAVING d."totalPiles" <> coalesce(sum(ra."totalPiles"),0)
           AND d."totalPiles" <> coalesce(sum(ra."totalPiles") FILTER (WHERE r.status = 'submitted'),0)
        ORDER BY d.date DESC;`),
    },
    {
      name: 'Отчёты за период без строки аналитики',
      header: 'reportId;дата;статус',
      rows: select(`
        SELECT r."reportId", r.date, r.status FROM "Report" r
        WHERE r."tenantId" = 'orion' AND r.date >= ${SINCE}
          AND NOT EXISTS (SELECT 1 FROM "ReportAnalytics" ra WHERE ra."reportId" = r."reportId");`),
    },
  ];

  const lines: string[] = [`# Сверка слоёв данных (14 дней), ${new Date().toISOString()}`, ''];
  for (const c of checks) {
    lines.push(`## ${c.name}: ${c.rows.length}`, '', c.header, ...c.rows.map((r) => r.join(';')), '');
    coverage({ module: 'сверка', screen: 'база', element: c.name, role: 'ADMIN', version: '-',
      result: c.rows.length ? 'DEFECT' : 'OK', evidence: c.rows.length ? `${c.rows.length} строк, см. reconcile.md` : 'совпадает' });
  }
  fs.writeFileSync(path.join(OUT_DIR, 'reconcile.md'), lines.join('\n'));
});
