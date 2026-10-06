/**
 * Общее для ночных автотестов AutoClaw №5 (e2e/qa-ac): разбор чисел,
 * чтение плиток KPI и пунктов меню, работа с выгрузками. Ничего не пишет в
 * приложение — только читает DOM и файлы прогона.
 */
import type { Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { OUT_DIR } from '../qa/helpers';

/** Хвост прогона: имена тестовых записей «AC-QA …» остаются уникальными. */
export const RUN_SUF = `${String(Date.now()).slice(-6)}`;

/** «1 234 шт. / 5 678,9 м.п.» → { count, meters }. */
export function parseCountMeters(text: string): { count: number; meters: number } | null {
  const norm = text.replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
  const m = norm.match(/([\d ]+(?:,\d+)?)\s*шт\.\s*\/\s*([\d ]+(?:,\d+)?)\s*м\.п\./);
  if (!m) return null;
  const num = (s: string) => Number(s.replace(/ /g, '').replace(',', '.'));
  return { count: num(m[1]), meters: num(m[2]) };
}

/** Значения KPI-плиток страницы: подпись → значение (структура-агностично). */
export async function kpiTiles(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const LABEL = /^(Сваи|Бурение)( факт)?$/;
    const VALUE = /^(\d[\d\s\u00A0]*)\s*шт\.\s*\/\s*([\d\s\u00A0]+(?:,\d+)?)\s*м\.п\.$/;
    const out: Record<string, string> = {};
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main *'))) {
      const t = (el.textContent || '').trim();
      if (!VALUE.test(t)) continue;
      let root: HTMLElement | null = el;
      let label = '';
      for (let i = 0; i < 8 && root; i++) {
        root = root.parentElement;
        if (!root) break;
        for (const cand of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
          if (cand === el) continue;
          const ct = (cand.textContent || '').trim();
          if (LABEL.test(ct) && cand.childElementCount === 0) { label = ct; break; }
        }
        if (label) break;
      }
      if (label && !(label in out)) out[label] = t;
    }
    return out;
  });
}

/** Видимые пункты меню (nav): подпись + адрес, без дублей. */
export async function menuLinks(page: Page): Promise<{ label: string; href: string }[]> {
  return page.evaluate(() => {
    const seen = new Map<string, string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>('nav a[href]'))) {
      const href = a.getAttribute('href') || '';
      if (!href.startsWith('/')) continue;
      const r = a.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const label = (a.getAttribute('aria-label') || a.innerText || a.getAttribute('title') || href)
        .trim().replace(/\s+/g, ' ');
      if (!seen.has(href)) seen.set(href, label.slice(0, 60));
    }
    return [...seen].map(([href, label]) => ({ href, label }));
  });
}

/** Видимые кнопки основной области (до 15 подписей). */
export async function screenButtons(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('main button, main [role="button"]'))) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (r.width === 0 || r.height === 0 || style.visibility === 'hidden') continue;
      const name = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '')
        .trim().replace(/\s+/g, ' ').slice(0, 60);
      if (!name || /^close toast$/i.test(name)) continue;
      if (!out.includes(name)) out.push(name);
      if (out.length >= 15) break;
    }
    return out;
  });
}

/** Пауза на «дорисовать экран» (живые дашборды всегда что-то перерисовывают). */
export async function pause(page: Page, ms = 900) {
  await page.waitForTimeout(ms);
}

/** Утверждает, что значение определено (не null/undefined), иначе бросает с сообщением. */
export function expectDefined<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new Error(message);
  return value;
}

/** Записать JSON рядом с результатами прогона. */
export function writeRunJson(name: string, data: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, name), JSON.stringify(data, null, 2), 'utf8');
}

/** Меню с ожиданием: оболочка рисуется после проверки сессии — читаем с повторами. */
export async function readMenu(page: Page, tries = 6) {
  let menu: { label: string; href: string }[] = [];
  for (let i = 0; i < tries; i++) {
    menu = await menuLinks(page);
    if (menu.length) return menu;
    await page.waitForTimeout(800);
  }
  return menu;
}

/** Кнопки экрана с ожиданием отрисовки (страницы дев-сервера компилируются). */
export async function readButtons(page: Page, tries = 5) {
  let buttons: string[] = [];
  for (let i = 0; i < tries; i++) {
    buttons = await screenButtons(page);
    if (buttons.length) return buttons;
    await page.waitForTimeout(800);
  }
  return buttons;
}

/** Уборка «AC-QA»-записей, оставшихся от прерванных прогонов (только тестовые). */
export async function sweepAcqa(page: Page) {
  try {
    const dict = await (await api(page).get('/api/dictionary/all')).json() as Record<string, unknown>;
    const lists: Array<[string, Array<{ id: string; name: string; isActive?: boolean }>]> = [
      ['pileGrade', (dict.pileGrades ?? []) as Array<{ id: string; name: string; isActive?: boolean }>],
      ['drillingType', (dict.drillingTypes ?? []) as Array<{ id: string; name: string; isActive?: boolean }>],
      ['downtimeReason', (dict.downtimeReasons ?? []) as Array<{ id: string; name: string; isActive?: boolean }>],
    ];
    for (const [type, items] of lists) {
      for (const item of items.filter((it) => /^AC-QA /i.test(it.name))) {
        const del = await api(page).delete('/api/dictionary/manage', { data: { type, id: item.id } });
        if (del.status() >= 400 && item.isActive !== false) {
          await api(page).patch('/api/dictionary/manage', { data: { type, id: item.id, isActive: false } });
        }
      }
    }
    const sites = await (await api(page).get('/api/sites/all')).json().then((j) => j.sites as Array<{ id: string; name: string }>).catch(() => []);
    const acqaSiteIds = new Set(sites.filter((x) => /^AC-QA /i.test(x.name)).map((x) => x.id));
    const reports = await (await api(page).get('/api/reports/all?limit=100')).json().then((j) => j.reports as Array<{ reportId: string; siteId?: string; site?: { id?: string; name?: string } }>).catch(() => []);
    for (const r of reports) {
      const sid = r.siteId ?? r.site?.id ?? '';
      const sname = r.site?.name ?? sites.find((s) => s.id === sid)?.name ?? '';
      if (acqaSiteIds.has(sid) || /^AC-QA /i.test(sname)) {
        await api(page).delete('/api/reports/delete', { data: { reportId: r.reportId } });
      }
    }
    for (const s of sites.filter((x) => /^AC-QA /i.test(x.name))) {
      const del = await api(page).delete(`/api/sites/${s.id}`);
      if (del.status() >= 400) await api(page).put(`/api/sites/${s.id}`, { data: { isActive: false } });
    }
  } catch { /* уборка — лучшие усилия */ }
}export function parseCsv(text: string): string[][] {
  const t = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  for (const line of t.split('\n')) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
        } else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ';') { cells.push(cur); cur = ''; }
      else cur += ch;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

/** Разбор .xlsx (ZIP из OOXML) на части без внешних зависимостей. */
export function readZipEntries(buf: Buffer): Record<string, Buffer> {
  const out: Record<string, Buffer> = {};
  let off = 0;
  while (off + 30 <= buf.length) {
    if (buf.readUInt32LE(off) !== 0x04034b50) break;
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const name = buf.subarray(off + 30, off + 30 + nameLen).toString('utf8');
    const dataStart = off + 30 + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    onEntry(out, name, data, buf.readUInt16LE(off + 8));
    off = dataStart + compSize;
  }
  return out;
}

function onEntry(out: Record<string, Buffer>, name: string, data: Buffer, method: number) {
  if (method !== 8) { out[name] = Buffer.from(data); return; }
  try { out[name] = inflateRawSync(data); } catch { /* часть без сжатия — пропускаем */ }
}

/**
 * Контекст запросов к приложению с заголовками источника.
 *
 * Мутации (/api/*, POST/PUT/PATCH/DELETE) проходят оценку CSRF: без
 * Origin/Referer сервер отвечает 403 «CSRF validation failed», и проверялось бы
 * не право роли, а отсутствие заголовка. Origin — тот же localhost:3000.
 */
export function api(page: Page) {
  const H = { Origin: 'http://localhost:3000', Referer: 'http://localhost:3000/' };
  const merge = (opts?: Record<string, unknown>) => ({
    ...(opts ?? {}),
    headers: { ...H, ...((opts?.headers as Record<string, string>) ?? {}) },
  });
  return {
    get: (url: string, opts?: Record<string, unknown>) => page.request.get(url, merge(opts)),
    post: (url: string, opts?: Record<string, unknown>) => page.request.post(url, merge(opts)),
    put: (url: string, opts?: Record<string, unknown>) => page.request.put(url, merge(opts)),
    patch: (url: string, opts?: Record<string, unknown>) => page.request.patch(url, merge(opts)),
    delete: (url: string, opts?: Record<string, unknown>) => page.request.delete(url, merge(opts)),
  };
}
