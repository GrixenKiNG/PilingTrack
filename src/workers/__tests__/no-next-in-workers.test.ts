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
import * as ts from 'typescript';

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

function staticSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (!statement.importClause?.isTypeOnly && ts.isStringLiteral(statement.moduleSpecifier)) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    } else if (ts.isExportDeclaration(statement)) {
      if (
        !statement.isTypeOnly &&
        statement.moduleSpecifier &&
        ts.isStringLiteral(statement.moduleSpecifier)
      ) {
        specifiers.push(statement.moduleSpecifier.text);
      }
    } else if (
      ts.isImportEqualsDeclaration(statement) &&
      ts.isExternalModuleReference(statement.moduleReference)
    ) {
      const reference = statement.moduleReference.expression;
      if (reference && ts.isStringLiteral(reference)) specifiers.push(reference.text);
    }
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

describe('извлечение статических импортов через исходный текст', () => {
  it('находит side-effect импорт перед обычным импортом (T-WORKER-GRAPH-AST)', () => {
    expect(staticSpecifiers("import 'next/server';\nimport { x } from './safe';")).toEqual([
      'next/server',
      './safe',
    ]);
  });

  it('находит side-effect импорт перед реэкспортом', () => {
    expect(staticSpecifiers("import 'next/server';\nexport { x } from './safe';")).toEqual([
      'next/server',
      './safe',
    ]);
  });

  it('пропускает import type и export type', () => {
    expect(staticSpecifiers("import type { X } from './import-type';\nexport type { Y } from './export-type';")).toEqual(
      [],
    );
  });

  it('находит многострочный import со списком имён', () => {
    expect(staticSpecifiers("import {\n  a,\n  b\n} from './safe';")).toEqual(['./safe']);
  });

  it('не находит импорт внутри комментария', () => {
    expect(staticSpecifiers("// import 'next/server';\n/* export { x } from 'next/server'; */")).toEqual([]);
  });

  it('считает import-equals с require статическим импортом', () => {
    expect(staticSpecifiers("import worker = require('./worker');")).toEqual(['./worker']);
  });

  it('не обходит динамический import()', () => {
    expect(staticSpecifiers("void import('next/server');")).toEqual([]);
  });
});

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
