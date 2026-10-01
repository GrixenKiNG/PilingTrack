/**
 * Сторож статического графа воркеров (F-R87-CHAIN-METADATA-b).
 *
 * Образ `Dockerfile.workers` собирается без пакета `next` (после `npm prune
 * --omit=dev` каталог `node_modules/next` удаляется), а `unified-worker`
 * запускается из исходников через `tsx`. Любой статический импорт `next` или
 * `next/…` в его графе — это падение процесса при старте, то есть на бою
 * встают outbox, PDF, Telegram и планировщики. Так и случилось, когда
 * `append-audit.ts` потянул `@/lib/request-context` с `next/server`.
 *
 * Тест обходит только статические импорты/реэкспорты (без `import type` и без
 * динамических `import()`), резолвит `@/` → `src/`, относительные пути и
 * `.ts`/`.tsx`/`index.ts`, пакеты не обходит.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// happy-dom подменяет import.meta.url не-file-схемой, поэтому корень берём из cwd:
// vitest запускается из корня проекта (там же, где vitest.config.ts).
const ROOT = path.resolve(process.cwd());
const ENTRY = 'src/workers/unified-worker.ts';

/**
 * Уже существующие нарушения, найденные сторожем при первом запуске.
 * Ключ — путь файла от корня, значения — какие `next*` он импортирует.
 * Чинить их в этой задаче нельзя: каждая запись — отдельный дефект,
 * который надо разобрать самостоятельно (F-R87-CHAIN-METADATA-b: разобрать).
 */
const KNOWN_VIOLATIONS: Record<string, string[]> = {};

const IMPORT_RE = /import\s+(?!type\b)(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g;
const EXPORT_RE = /export\s+(?!type\b)[\s\S]*?\sfrom\s+['"]([^'"]+)['"]/g;

/** Убираем комментарии, чтобы примеры импортов в докблоках не считались кодом. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function staticSpecifiers(source: string): string[] {
  const clean = stripComments(source);
  const specifiers: string[] = [];
  for (const re of [IMPORT_RE, EXPORT_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(clean)) !== null) specifiers.push(match[1]);
  }
  return specifiers;
}

function resolveFile(base: string): string | null {
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.json`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
    path.join(base, 'index.js'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function isNextSpecifier(specifier: string): boolean {
  return specifier === 'next' || specifier.startsWith('next/');
}

function walkWorkerGraph(): { visited: number; violations: string[]; unresolved: string[] } {
  const visited = new Set<string>();
  const violations: string[] = [];
  const unresolved: string[] = [];
  const queue = [path.join(ROOT, ENTRY)];

  while (queue.length > 0) {
    const file = queue.shift() as string;
    const relative = path.relative(ROOT, file).split(path.sep).join('/');
    if (visited.has(relative)) continue;
    visited.add(relative);

    for (const specifier of staticSpecifiers(fs.readFileSync(file, 'utf8'))) {
      if (isNextSpecifier(specifier)) {
        violations.push(`${relative} -> ${specifier}`);
        continue;
      }
      let target: string | null = null;
      if (specifier.startsWith('@/')) {
        target = resolveFile(path.join(ROOT, 'src', specifier.slice(2)));
      } else if (specifier.startsWith('.')) {
        target = resolveFile(path.resolve(path.dirname(file), specifier));
      } else {
        continue; // пакет (node_modules) — не обходим
      }
      if (!target) {
        unresolved.push(`${relative} -> ${specifier}`);
        continue;
      }
      const targetRelative = path.relative(ROOT, target).split(path.sep).join('/');
      if (!visited.has(targetRelative)) queue.push(target);
    }
  }

  return { visited: visited.size, violations, unresolved };
}

describe('граф воркеров не тянет next (F-R87-CHAIN-METADATA-b)', () => {
  it('ни один файл статического графа unified-worker не импортирует next', () => {
    const { visited, violations, unresolved } = walkWorkerGraph();

    // Граф обязан быть непустым и разрешённым: нерезолвнутый локальный импорт
    // означает слепое место обхода, а не отсутствие нарушения.
    expect(visited).toBeGreaterThan(100);
    expect([...unresolved].sort()).toEqual([]);

    const expected = Object.entries(KNOWN_VIOLATIONS)
      .flatMap(([file, specifiers]) => specifiers.map((specifier) => `${file} -> ${specifier}`))
      .sort();
    expect([...violations].sort()).toEqual(expected);
  });
});
