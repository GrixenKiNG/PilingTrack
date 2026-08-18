/**
 * Сужение по организации — проверка «падать, а не снимать фильтр».
 *
 * Здесь две части. Первая проверяет сам страж. Вторая обходит исходники и
 * запрещает шаблон, из-за которого страж однажды обошли: условное применение
 * фильтра. `if (tenantId) where.tenantId = tenantId` выглядит осторожно, а
 * ведёт себя наоборот — пустой тенант убирает условие, и выборка становится
 * общей по всем организациям. Тем же способом в мае утекли строки через
 * `IS NULL OR tenantId` (CLAUDE.md, раздел про resource-access-service).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, sep } from 'path';
import { requireTenantId } from '@/lib/tenant-scope';
import { ServiceError } from '@/lib/service-error';

describe('requireTenantId', () => {
  it('возвращает тенант, когда он есть', () => {
    expect(requireTenantId('orion')).toBe('orion');
  });

  it('обрезает пробелы по краям', () => {
    expect(requireTenantId('  orion  ')).toBe('orion');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['пустая строка', ''],
    ['одни пробелы', '   '],
  ])('%s — отказ, а не молчаливое отсутствие фильтра', (_label, value) => {
    expect(() => requireTenantId(value)).toThrow('Контекст организации не определён');
  });

  it('отказ несёт код 400 — это ошибка запроса, а не поломка сервера', () => {
    try {
      requireTenantId(null);
      throw new Error('ожидался отказ');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceError);
      expect((error as ServiceError).status).toBe(400);
    }
  });
});

// ---------------------------------------------------------------------------

/** Условное применение тенантного фильтра — то, что нельзя возвращать. */
const FAIL_OPEN_PATTERNS: Array<{ re: RegExp; why: string }> = [
  {
    re: /if\s*\(\s*!?!?tenantId\s*\)\s*\{?\s*(?:where|filter)\w*\.tenantId\s*=/,
    why: 'фильтр ставится только при истинном тенанте — пустой снимает его совсем',
  },
  {
    re: /(?:where|filter)\w*\s*=\s*tenantId\s*\?\s*\{\s*tenantId\s*\}\s*:\s*\{\s*\}/,
    why: 'без тенанта условие пустое, то есть выборка по всем организациям',
  },
  {
    re: /IS\s+NULL\s+OR\s+"?tenantId/i,
    why: 'сырой SQL с IS NULL OR — ровно тот шаблон, что дал утечку в мае',
  },
];

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'generated' || entry === 'node_modules' || entry === '__tests__') continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) acc.push(full);
  }
  return acc;
}

describe('фильтр по организации нигде не применяется условно', () => {
  const root = join(process.cwd(), 'src');
  const files = sourceFiles(root);

  it('обходит исходники, а не пустой список', () => {
    expect(files.length).toBeGreaterThan(300);
  });

  it.each(FAIL_OPEN_PATTERNS)('запрещено: $why', ({ re }) => {
    const hits: string[] = [];
    for (const file of files) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          // Комментарии пропускаем: этот же запрет описан словами и в самом
          // помощнике, и здесь — иначе проверка ловила бы собственный текст.
          const code = line.trim();
          if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) return;
          if (re.test(line)) {
            hits.push(`${file.split(sep).slice(-3).join('/')}:${i + 1}  ${line.trim()}`);
          }
        });
    }

    expect(hits).toEqual([]);
  });
});
