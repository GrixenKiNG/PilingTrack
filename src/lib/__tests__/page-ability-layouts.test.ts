/**
 * W27: КАЖДЫЙ раздел админки при отказе в праве уводит на `/no-access`.
 *
 * `requirePageAbility` вызывают 15 раскладок/страниц. Соседний тест
 * (`require-page-ability.test.ts`) проверяет сам гвард; здесь — что каждая
 * фактическая точка вызова из `src/app` на него действительно опирается, а не
 * просто импортирует и забывает. Таблица ниже собрана по фактическим вызовам
 * `requirePageAbility(` (`grep -rn "requirePageAbility(" src/app`); тест читает
 * `src/app` через fs и падает, если число строк таблицы разошлось с числом
 * вызовов — новая раскладка без строки здесь роняет тест.
 *
 * Моки — как в соседних тестах: `next/navigation.redirect` бросает (реальный
 * redirect прерывает рендер), сессия приходит из `@/lib/page-session`. Права
 * считаются настоящей `can()` из authorization-service.
 *
 * Одна точка НЕ подчиняется общей схеме раскладки: `src/app/(app)/admin/page.tsx`
 * (сама страница раздела, объявлена без `children` и возвращает `<AdminDashboard/>`,
 * а не `<>children</>`). Она проверяется тем же редиректом на `/no-access`, но
 * «возвращает children» для неё заменено на «возвращает раздел без редиректа».
 * Остальные 14 — раскладки вида `layout.tsx` с `<>{children}</>`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  session: { user: null as { role: string } | null },
  redirect: vi.fn((url: string): never => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

vi.mock('next/navigation', () => ({ redirect: mocks.redirect }));
vi.mock('@/lib/page-session', () => ({
  readPageSessionUser: vi.fn(async () => mocks.session.user),
}));

type LayoutProps = { children?: ReactNode };
type LayoutComponent = (props: LayoutProps) => Promise<unknown>;

interface LayoutRow {
  /** Путь от корня репозитория — его же читает тест через fs. */
  file: string;
  /** Право, которое запрашивает раскладка. */
  ability: string;
  /** Раскладка возвращает `children`, а не произвольный раздел. */
  returnsChildren: boolean;
  load: () => Promise<{ default: unknown }>;
}

/**
 * Роль без права админки: `ASSISTANT` отсутствует в `abilityRoles`, поэтому
 * `can()` даёт на любое право `false` (authorization-service.ts, отказ по
 * умолчанию). `ADMIN` — есть во всех 15 правах таблицы.
 */
const NO_RIGHT_ROLE = 'ASSISTANT';
const FULL_RIGHT_ROLE = 'ADMIN';

const CHILDREN = 'SECTION-CONTENT';

const rows: LayoutRow[] = [
  { file: 'src/app/(app)/admin/analytics/layout.tsx', ability: 'analytics.read', returnsChildren: true, load: () => import('@/app/(app)/admin/analytics/layout') },
  { file: 'src/app/(app)/admin/checklists/layout.tsx', ability: 'inspection.perform', returnsChildren: true, load: () => import('@/app/(app)/admin/checklists/layout') },
  { file: 'src/app/(app)/admin/crews/layout.tsx', ability: 'crews.read', returnsChildren: true, load: () => import('@/app/(app)/admin/crews/layout') },
  { file: 'src/app/(app)/admin/dictionaries/layout.tsx', ability: 'dictionary.manage', returnsChildren: true, load: () => import('@/app/(app)/admin/dictionaries/layout') },
  { file: 'src/app/(app)/admin/dlq/layout.tsx', ability: 'dlq.manage', returnsChildren: true, load: () => import('@/app/(app)/admin/dlq/layout') },
  { file: 'src/app/(app)/admin/equipment/layout.tsx', ability: 'equipment.read', returnsChildren: true, load: () => import('@/app/(app)/admin/equipment/layout') },
  { file: 'src/app/(app)/admin/incidents/layout.tsx', ability: 'incidents.read', returnsChildren: true, load: () => import('@/app/(app)/admin/incidents/layout') },
  { file: 'src/app/(app)/admin/maintenance/layout.tsx', ability: 'maintenance.manage', returnsChildren: true, load: () => import('@/app/(app)/admin/maintenance/layout') },
  { file: 'src/app/(app)/admin/page.tsx', ability: 'analytics.read', returnsChildren: false, load: () => import('@/app/(app)/admin/page') },
  { file: 'src/app/(app)/admin/piles/layout.tsx', ability: 'piles.manage', returnsChildren: true, load: () => import('@/app/(app)/admin/piles/layout') },
  { file: 'src/app/(app)/admin/reports/layout.tsx', ability: 'reports.read_all', returnsChildren: true, load: () => import('@/app/(app)/admin/reports/layout') },
  { file: 'src/app/(app)/admin/settings/layout.tsx', ability: 'system.read', returnsChildren: true, load: () => import('@/app/(app)/admin/settings/layout') },
  { file: 'src/app/(app)/admin/sites/layout.tsx', ability: 'sites.read_all', returnsChildren: true, load: () => import('@/app/(app)/admin/sites/layout') },
  { file: 'src/app/(app)/admin/telegram/layout.tsx', ability: 'telegram.manage', returnsChildren: true, load: () => import('@/app/(app)/admin/telegram/layout') },
  { file: 'src/app/(app)/admin/users/layout.tsx', ability: 'users.manage', returnsChildren: true, load: () => import('@/app/(app)/admin/users/layout') },
];

const APP_DIR = path.resolve(process.cwd(), 'src/app');
const ABILITY_CALL = 'requirePageAbility(';

/** Все файлы `src/app`, в которых встречается вызов гварда. */
function filesWithGuardCalls(): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (fs.readFileSync(full, 'utf8').includes(ABILITY_CALL)) found.push(full);
    }
  };
  walk(APP_DIR);
  return found;
}

/** Число вызовов `requirePageAbility(` во всём `src/app` (не число файлов). */
function countGuardCalls(): number {
  return filesWithGuardCalls().reduce(
    (total, file) => total + fs.readFileSync(file, 'utf8').split(ABILITY_CALL).length - 1,
    0
  );
}

describe('разделы админки ведут на /no-access без права (W27)', () => {
  beforeEach(() => {
    mocks.redirect.mockClear();
    mocks.session.user = { role: NO_RIGHT_ROLE };
  });

  it('таблица покрывает все вызовы requirePageAbility( в src/app', () => {
    const calls = countGuardCalls();
    expect(rows.length).toBe(calls);

    const scanned = filesWithGuardCalls().map((f) => path.relative(process.cwd(), f).replace(/\\/g, '/'));
    const table = rows.map((r) => r.file);
    expect([...table].sort()).toEqual(scanned.sort());
  });

  it.each(rows)('$file: без права — redirect на /no-access', async (row) => {
    const Layout = (await row.load()).default as LayoutComponent;
    await expect(Layout({ children: CHILDREN })).rejects.toThrow('REDIRECT:/no-access');
    expect(mocks.redirect).toHaveBeenCalledWith('/no-access');
  });

  it.each(rows)('$file: с правом — раздел отдаётся без редиректа', async (row) => {
    // Требуемое право действительно записано в исходнике раскладки.
    const source = fs.readFileSync(path.resolve(process.cwd(), row.file), 'utf8');
    expect(source).toContain(`requirePageAbility('${row.ability}')`);

    mocks.session.user = { role: FULL_RIGHT_ROLE };
    const Layout = (await row.load()).default as LayoutComponent;
    const element = await Layout({ children: CHILDREN });

    expect(mocks.redirect).not.toHaveBeenCalled();
    if (row.returnsChildren) {
      expect((element as { props: { children?: unknown } }).props.children).toBe(CHILDREN);
    } else {
      expect(element).toBeTruthy();
    }
  });
});
