import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * `@/modules/<x>/client` попадает в браузерный пакет. Если по статическим
 * импортам от него дотянуться до базы или до node:*, приложение упадёт целиком
 * (так было с барьером readiness 04.09.2026). Тест обходит граф импортов
 * каждого client.ts и ищет запрещённое.
 */
const SRC = path.resolve(__dirname, '../..');
const FORBIDDEN = [
  /^@\/lib\/db(\/|$)/,
  /^@\/generated\//,
  /^@prisma\//,
  /^node:/,
  /^next\/server$/,
  /^server-only$/,
  /^(fs|crypto|child_process|path)$/,
];
// `import type` / `export type` стираются при сборке и в пакет не попадают.
const EDGE = /(?:^|\n)\s*(?:import|export)\s+(type\s+)?(?:[^'";]*?\s+from\s+)?'([^']+)'/g;

function resolve(spec: string, from: string): string | null {
  const base = spec.startsWith('@/') ? path.join(SRC, spec.slice(2)) : spec.startsWith('.') ? path.resolve(path.dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts'), path.join(base, 'index.tsx')]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function violations(entry: string): string[] {
  const seen = new Set<string>();
  const found: string[] = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(EDGE)) {
      if (match[1]) continue;
      const spec = match[2];
      if (FORBIDDEN.some((re) => re.test(spec))) {
        found.push(`${path.relative(SRC, file)} -> ${spec}`);
        continue;
      }
      const next = resolve(spec, file);
      if (next) stack.push(next);
    }
  }
  return found;
}

const entries = fs
  .readdirSync(path.join(SRC, 'modules'), { withFileTypes: true })
  .filter((d) => d.isDirectory() && fs.existsSync(path.join(SRC, 'modules', d.name, 'client.ts')))
  .map((d) => d.name);

describe('client-entry модулей чист от базы и node', () => {
  it('есть что проверять', () => {
    expect(entries.length).toBeGreaterThan(0);
  });
  it.each(entries)('%s/client.ts', (name) => {
    expect(violations(path.join(SRC, 'modules', name, 'client.ts'))).toEqual([]);
  });
});
