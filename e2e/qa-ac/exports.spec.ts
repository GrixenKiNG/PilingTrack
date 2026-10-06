/**
 * Блок D задания №5: выгрузки до файла.
 *
 * CSV и XLSX в «Отчётах» с быстрым фильтром «Сегодня»: файл реально скачан и
 * не пуст; дробные метры — с запятой (РФ-формат); итоги свай шт./м.п. и бурения
 * шт./м.п. совпадают с плитками «Сваи»/«Бурение» за тот же отбор; формульные
 * комментарии обезврежены (апостроф в CSV, inline-строка без <f> в XLSX).
 * PDF отчёта скачан и не пуст.
 *
 * Тестовые данные — только «AC-QA»; в конце удаляются.
 */
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { login, matrix, OUT_DIR } from '../qa/helpers';
import { RUN_SUF, api, kpiTiles, parseCountMeters, parseCsv, pause, readZipEntries, sweepAcqa, writeRunJson, expectDefined } from './util';

const ADMIN = expectDefined(matrix.roles.find((r) => r.role === 'ADMIN'), 'ADMIN role not found in matrix').email;
const todayMsk = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

const num = (s: string) => Number(s.replace(/\s/g, '').replace(',', '.'));

test('D: выгрузки CSV/XLSX/PDF — файлы, запятые, итоги, формулы', async ({ page }) => {
  test.setTimeout(30 * 60_000);
  const siteName = `AC-QA Объект ${RUN_SUF} (выгрузка)`;
  let siteId = '';
  let reportId = '';
  const checks: Array<{ name: string; ok: boolean; note: string }> = [];

  try {
    await login(page, ADMIN);

    // ===== Подготовка: объект и отчёт с дробным бурением и формульными комментариями =====
    const siteResp = await api(page).post('/api/sites/create', { data: { name: siteName } });
    expect(siteResp.status(), 'AC-QA объект создан').toBe(201);
    siteId = (await siteResp.json()).site.id as string;

    const dict = await (await api(page).get('/api/dictionary/all')).json() as Record<string, unknown>;
    const pick = (names: string[]) => {
      for (const n of names) {
        const v = dict[n] ?? (dict.data as Record<string, unknown> | undefined)?.[n];
        if (Array.isArray(v)) return v as Array<{ id: string; isActive?: boolean }>;
      }
      return [];
    };
    const grades = pick(['pileGrades', 'pileGrade']);
    const drills = pick(['drillingTypes', 'drillingType']);
    const reasons = pick(['downtimeReasons', 'downtimeReason']);
    const active = (arr: Array<{ id: string; isActive?: boolean }>) => arr.find((x) => x.isActive !== false) ?? arr[0];
    const grade = active(grades);
    const drill = active(drills);
    const reason = active(reasons);
    expect(grade, 'активная марка сваи найдена').toBeTruthy();
    expect(drill, 'активный тип бурения найден').toBeTruthy();
    expect(reason, 'активная причина простоя найдена').toBeTruthy();

    const gradeId = expectDefined(grade, 'grade missing after check').id;
    const drillId = expectDefined(drill, 'drill missing after check').id;
    const reasonId = expectDefined(reason, 'reason missing after check').id;

    reportId = crypto.randomUUID();
    const users = (await (await api(page).get('/api/users')).json()).users as Array<{ id: string; email: string }>;
    const owner = users.find((u) => u.email === matrix.operatorVersions[0].operator) ?? users[0];
    // Владелец отчёта должен быть закреплён за объектом (иначе запись отчёта — 403).
    const assign = await api(page).post(`/api/sites/${siteId}/assign`, { data: { userId: owner.id } });
    expect(assign.status(), 'владелец закреплён за AC-QA объектом').toBe(200);
    const mkReport = await api(page).post('/api/reports/admin-upsert', { data: {
      reportId, userId: owner.id,
      siteId, date: todayMsk(),
      piles: [{ pileGradeId: gradeId, count: 5 }],
      drillings: [{ typeId: drillId, count: 2, metersPerUnit: 8.35, meters: 16.7 }],
      downtimes: [
        { reasonId: reasonId, duration: 2, comment: '=1+1' },
        { reasonId: reasonId, duration: 1, comment: '@SUM(A1)' },
      ],
    } });
    expect(mkReport.status(), 'AC-QA отчёт с формульными комментариями создан').toBe(200);

    // ===== Экран «Отчёты», быстрый фильтр «Сегодня» =====
    await page.goto('/admin/reports');
    await expect(page.getByRole('heading', { name: 'Отчёты' })).toBeVisible({ timeout: 90_000 });
    await page.getByRole('button', { name: 'Сегодня', exact: true }).click();
    await pause(page, 1500);
    await expect(page.getByText(siteName).first()).toBeVisible({ timeout: 60_000 });

    // Плитки «Сваи»/«Бурение» за тот же отбор.
    const tiles = await kpiTiles(page);
    const tilesPiles = parseCountMeters(tiles['Сваи'] ?? '');
    const tilesDrill = parseCountMeters(tiles['Бурение'] ?? '');
    expect(tilesPiles, `плитка «Сваи» распознана: ${tiles['Сваи']}`).toBeTruthy();
    expect(tilesDrill, `плитка «Бурение» распознана: ${tiles['Бурение']}`).toBeTruthy();

    // ===== CSV =====
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /CSV/ }).click(),
    ]);
    const csvPath = path.join(OUT_DIR, `export-today-${RUN_SUF}.csv`);
    await download.saveAs(csvPath);
    const csvText = fs.readFileSync(csvPath, 'utf8');
    checks.push({ name: 'CSV скачан', ok: csvText.length > 200, note: `${csvText.length} байт` });
    expect.soft(csvText.length, 'CSV не пуст').toBeGreaterThan(200);
    expect.soft(csvText, 'шапка CSV на месте').toContain('ID отчёта');

    // Формулы обезврежены: в ячейках нет «сырых» =,+,-,@ (кроме обычных чисел).
    const rowsCsv = parseCsv(csvText);
    const cells = rowsCsv.flat();
    const unescaped = cells.filter((c) => {
      const t = c.replace(/\s/g, ' ');
      const trimmed = t.trimStart();
      if (trimmed.startsWith("'")) return false;
      if (/^[=+@]/.test(trimmed)) return true;
      return trimmed.startsWith('-') && !/^-?\d+([.,]\d+)?$/.test(trimmed);
    });
    checks.push({ name: 'формулы без экранирования', ok: unescaped.length === 0, note: unescaped.slice(0, 3).join(' | ') });
    expect.soft(unescaped, 'ни одна ячейка не начинается с формулы без апострофа').toEqual([]);
    expect.soft(cells, 'комментарий =1+1 экранирован').toContain("'=1+1");
    expect.soft(cells, 'комментарий @SUM(A1) экранирован').toContain("'@SUM(A1)");

    // Дробные метры — через запятую.
    const header = rowsCsv[0];
    const col = (name: string) => header.findIndex((h) => h.startsWith(name));
    const iDrillMeters = col('Метры бурения');
    const drillCells = rowsCsv.slice(1).map((r) => (r[iDrillMeters] ?? '').trim()).filter((c) => /^\d+[.,]\d+$/.test(c));
    const dotCells = drillCells.filter((c) => c.includes('.'));
    checks.push({ name: 'дробные метры через запятую', ok: drillCells.length > 0 && dotCells.length === 0, note: `пример: ${drillCells.slice(0, 3).join(', ') || 'нет дробных ячеек'}` });
    expect.soft(drillCells.length, 'в выгрузке есть дробные метры').toBeGreaterThan(0);
    expect.soft(dotCells, 'дробные метры записаны через точку (ожидалась запятая)').toEqual([]);

    // Итоги CSV против плиток.
    const iPileCount = col('Кол-во свай');
    const iPileMeters = col('Свай,');
    const sumIfNum = (idx: number) => rowsCsv.slice(1).reduce((s, r) => {
      const c = (r[idx] ?? '').trim();
      return /^[\d\s]+([.,]\d+)?$/.test(c) ? s + num(c) : s;
    }, 0);
    const tilesPilesCount = expectDefined(tilesPiles, 'tilesPiles missing after check').count;
    const tilesPilesMeters = expectDefined(tilesPiles, 'tilesPiles missing after check').meters;
    const tilesDrillCount = expectDefined(tilesDrill, 'tilesDrill missing after check').count;
    const tilesDrillMeters = expectDefined(tilesDrill, 'tilesDrill missing after check').meters;
    await compare('CSV: сваи шт. против плитки', () => sumIfNum(iPileCount), () => tilesPilesCount);
    await compare('CSV: сваи м.п. против плитки', () => sumIfNum(iPileMeters), () => tilesPilesMeters);
    await compare('CSV: бурение м.п. против плитки', () => sumIfNum(iDrillMeters), () => tilesDrillMeters);

    async function compare(name: string, got: () => number, want: () => number) {
      const g = got();
      const w = want();
      const ok = Math.abs(g - w) <= (Number.isInteger(w) ? 0.001 : 0.06);
      checks.push({ name, ok, note: `в файле ${g}, на плитке ${w}` });
      expect.soft(ok, `${name}: в файле ${g}, на плитке ${w}`).toBe(true);
    }

    // ===== XLSX =====
    const [downloadX] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: /Excel/ }).click(),
    ]);
    const xlsxPath = path.join(OUT_DIR, `export-today-${RUN_SUF}.xlsx`);
    await downloadX.saveAs(xlsxPath);
    const buf = fs.readFileSync(xlsxPath);
    expect.soft(buf.length, 'XLSX не пуст').toBeGreaterThan(500);
    const zip = readZipEntries(buf);
    const sheetKeys = Object.keys(zip).filter((k) => k.includes('worksheets/sheet')).sort();
    const allXml = sheetKeys.map((k) => zip[k].toString('utf8')).join('\n');
    checks.push({ name: 'XLSX: листы', ok: sheetKeys.length >= 2, note: sheetKeys.join(', ') });
    expect.soft(sheetKeys.length, 'в книге два листа').toBeGreaterThanOrEqual(2);
    expect.soft(allXml, 'XLSX: нет формул <f>').not.toMatch(/<f[ >/]/);
    expect.soft(allXml, 'XLSX: комментарий присутствует текстом').toContain('=1+1');
    expect.soft(allXml, 'XLSX: второй комментарий присутствует').toContain('@SUM(A1)');
    // Итоги листа «Итоги»: Свай, всего / Свай, м.п. / Бурение, скв. / Бурение, м.
    const sheet2 = zip[sheetKeys[1]]?.toString('utf8') ?? '';
    const cellsOfRow = (rowXml: string) => rowXml.split('<c ').slice(1).map((c) => {
      const v = c.match(/<v>([^<]*)<\/v>/);
      if (v) return Number(v[1]);
      const t = c.match(/<t[^>]*>([^<]*)<\/t>/);
      return t ? t[1] : '';
    });
    const dataRowsX = sheet2.split('<row ').slice(2).map(cellsOfRow);
    const sumCol = (idx: number) => dataRowsX.reduce((s, r) => s + (typeof r[idx] === 'number' ? (r[idx] as number) : 0), 0);
    const xPiles = sumCol(6), xPileM = sumCol(7), xDrillN = sumCol(8), xDrillM = sumCol(9);
    await compare('XLSX: сваи шт. против плитки', () => xPiles, () => tilesPilesCount);
    await compare('XLSX: сваи м.п. против плитки', () => xPileM, () => tilesPilesMeters);
    await compare('XLSX: бурение шт. против плитки', () => xDrillN, () => tilesDrillCount);
    await compare('XLSX: бурение м.п. против плитки', () => xDrillM, () => tilesDrillMeters);

    // ===== PDF =====
    const row = page.locator('div.grid.gap-3.px-3.py-3', { hasText: siteName }).first();
    await row.getByRole('button', { name: 'Показать в правой панели' }).click();
    const link = page.locator('a[href*="single-pdf"][download]').first();
    await expect(link, 'ссылка «Скачать» PDF в панели').toBeVisible({ timeout: 30_000 });
    const [pdfDownload] = await Promise.all([page.waitForEvent('download'), link.click()]);
    const pdfPath = path.join(OUT_DIR, `report-${RUN_SUF}.pdf`);
    await pdfDownload.saveAs(pdfPath);
    const pdfBuf = fs.readFileSync(pdfPath);
    const pdfOk = pdfBuf.length > 1000 && pdfBuf.subarray(0, 5).toString('latin1').startsWith('%PDF');
    checks.push({ name: 'PDF скачан', ok: pdfOk, note: `${pdfBuf.length} байт, начало: ${pdfBuf.subarray(0, 5).toString('latin1')}` });
    expect.soft(pdfOk, `PDF не пуст и начинается с %PDF (${pdfBuf.length} байт)`).toBe(true);
  } finally {
    if (reportId) await api(page).delete('/api/reports/delete', { data: { reportId } }).catch(() => undefined);
    if (siteId) {
      const del = await api(page).delete(`/api/sites/${siteId}`);
      if (del.status() >= 400) await api(page).put(`/api/sites/${siteId}`, { data: { isActive: false } }).catch(() => undefined);
    }
    writeRunJson('exports-checks.json', { generatedAt: new Date().toISOString(), checks });
  }
});

test.afterAll(async ({ browser }) => {
  // Страховка: если прогон прервался, «AC-QA»-записи не остаются в базе.
  const page = await browser.newPage();
  try {
    await login(page, expectDefined(matrix.roles.find((r) => r.role === 'ADMIN'), 'ADMIN role not found in matrix').email);
    await sweepAcqa(page);
  } finally {
    await page.close();
  }
});
