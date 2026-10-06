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
 * `.ts`/`.tsx`/`index.ts`. Сами пакеты не обходим, но у каждого пакета из
 * статического графа читаем `node_modules/<pkg>/package.json` и считаем
 * нарушением `next` в его `dependencies`/`peerDependencies` (кроме
 * необязательного peer — `peerDependenciesMeta.next.optional === true`):
 * такой пакет тоже упадёт при загрузке в образе без `node_modules/next`.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { builtinModules } from 'node:module';
import * as ts from 'typescript';

// happy-dom подменяет import.meta.url не-file-схемой, поэтому корень берём из cwd:
// vitest запускается из корня проекта (там же, где vitest.config.ts).
const ROOT = path.resolve(process.cwd());
const ENTRY = 'src/workers/unified-worker.ts';

/**
 * Уже существующие нарушения, найденные сторожем при первом запуске.
 * Ключ — путь файла от корня, значения — какие специфики он импортирует.
 * Чинить их в этой задаче нельзя: каждая запись — отдельный дефект,
 * который надо разобрать самостоятельно. Прямой импорт `next*` —
 * «F-R87-CHAIN-METADATA-b: разобрать», пакет, зависящий от `next`, —
 * «T-WORKER-PKG-NEXT-DEPS: разобрать».
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

/**
 * Пакеты, которые требуют `next` при загрузке. Не только сам `next`: 01.10.2026
 * воркер упал на старте из-за `@sentry/nextjs` (он загружает `next/constants`),
 * а сторож тогда смотрел только на `next`. В воркере вместо него — `@sentry/node`.
 */
function isNextSpecifier(specifier: string): boolean {
  return specifier === 'next'
    || specifier.startsWith('next/')
    || specifier.startsWith('@next/')
    || specifier === '@sentry/nextjs'
    || specifier.startsWith('@sentry/nextjs/');
}

const BUILTIN_MODULES = new Set(builtinModules);

/** Встроенный модуль node: `fs`, `node:fs`, `node:fs/promises` — в node_modules его нет. */
function isBuiltinSpecifier(specifier: string): boolean {
  const bare = specifier.startsWith('node:') ? specifier.slice('node:'.length) : specifier;
  return BUILTIN_MODULES.has(bare) || BUILTIN_MODULES.has(bare.split('/')[0]);
}

type SpecifierPackage =
  | { kind: 'package'; name: string }
  | { kind: 'builtin' }
  | { kind: 'local' };

/**
 * Пакет из специфика: `zod` → `zod`, `@sentry/node/x` → `@sentry/node`.
 * Встроенный модуль node (`node:fs`) и локальный путь (`@/…`, `./…`) — не пакет.
 */
function packageFromSpecifier(specifier: string): SpecifierPackage {
  if (specifier.startsWith('.') || specifier.startsWith('@/') || specifier.startsWith('/')) {
    return { kind: 'local' };
  }
  if (isBuiltinSpecifier(specifier)) return { kind: 'builtin' };
  const segments = specifier.split('/');
  return specifier.startsWith('@')
    ? { kind: 'package', name: segments.slice(0, 2).join('/') }
    : { kind: 'package', name: segments[0] };
}

interface PackageManifest {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  peerDependenciesMeta?: Record<string, { optional?: boolean }>;
}

/**
 * Пакет требует `next` при загрузке. Необязательный peer не в счёт
 * (`peerDependenciesMeta.next.optional === true`): без `next` пакет работает.
 */
function requiresNext(manifest: PackageManifest): boolean {
  if (manifest.dependencies?.next !== undefined) return true;
  if (manifest.peerDependencies?.next !== undefined) {
    return manifest.peerDependenciesMeta?.next?.optional !== true;
  }
  return false;
}

/** Манифест установленного пакета; `null` — пакета (или его package.json) в node_modules нет. */
function readPackageManifest(name: string): PackageManifest | null {
  const manifestPath = path.join(ROOT, 'node_modules', name, 'package.json');
  if (!fs.existsSync(manifestPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as PackageManifest;
  } catch {
    return null;
  }
}

/** Специфики динамических `import('…')` со строковым литералом — во всём файле. */
function dynamicSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.ts', source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length > 0
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
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

    const source = fs.readFileSync(file, 'utf8');
    // Динамический import() не обходим (код грузится только по требованию), но
    // прямой динамический импорт запрещённого пакета — та же поломка, только позже.
    for (const specifier of dynamicSpecifiers(source)) {
      if (isNextSpecifier(specifier)) violations.push(`${relative} -> ${specifier} (dynamic)`);
    }
    for (const specifier of staticSpecifiers(source)) {
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
        // Пакет не обходим, но читаем его манифест: пакет с `next` в
        // dependencies/peerDependencies упадёт при загрузке в образе без
        // node_modules/next — та же поломка, что и прямой импорт `next`.
        const dependency = packageFromSpecifier(specifier);
        if (dependency.kind === 'package') {
          const manifest = readPackageManifest(dependency.name);
          if (!manifest) unresolved.push(`${relative} -> ${specifier}`);
          else if (requiresNext(manifest)) violations.push(`${relative} -> ${specifier}`);
        }
        continue;
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

describe('разбор пакета из специфика (T-WORKER-PKG-NEXT-DEPS)', () => {
  it('берёт имя пакета без подпути', () => {
    expect(packageFromSpecifier('zod')).toEqual({ kind: 'package', name: 'zod' });
    expect(packageFromSpecifier('dotenv/config')).toEqual({ kind: 'package', name: 'dotenv' });
  });

  it('берёт scope-пакет из специфика с подпутём', () => {
    expect(packageFromSpecifier('@sentry/node/x')).toEqual({ kind: 'package', name: '@sentry/node' });
    expect(packageFromSpecifier('@prisma/adapter-pg')).toEqual({
      kind: 'package',
      name: '@prisma/adapter-pg',
    });
  });

  it('считает встроенные модули node не пакетом', () => {
    expect(packageFromSpecifier('node:fs')).toEqual({ kind: 'builtin' });
    expect(packageFromSpecifier('fs')).toEqual({ kind: 'builtin' });
    expect(packageFromSpecifier('node:async_hooks')).toEqual({ kind: 'builtin' });
    expect(packageFromSpecifier('node:fs/promises')).toEqual({ kind: 'builtin' });
  });

  it('считает локальные пути не пакетом', () => {
    expect(packageFromSpecifier('@/lib/trace-context')).toEqual({ kind: 'local' });
    expect(packageFromSpecifier('../worker')).toEqual({ kind: 'local' });
    expect(packageFromSpecifier('./safe')).toEqual({ kind: 'local' });
  });
});

describe('пакет требует next (T-WORKER-PKG-NEXT-DEPS)', () => {
  it('нарушение: next в dependencies', () => {
    expect(requiresNext({ dependencies: { next: '16.0.0' } })).toBe(true);
  });

  it('нарушение: next в peerDependencies без пометки optional', () => {
    expect(requiresNext({ peerDependencies: { next: '>=14' } })).toBe(true);
    expect(
      requiresNext({ peerDependencies: { next: '>=14' }, peerDependenciesMeta: { next: { optional: false } } }),
    ).toBe(true);
  });

  it('не нарушение: next только как необязательный peer', () => {
    expect(
      requiresNext({ peerDependencies: { next: '>=14' }, peerDependenciesMeta: { next: { optional: true } } }),
    ).toBe(false);
  });

  it('не нарушение: next нет ни в dependencies, ни в peerDependencies', () => {
    expect(requiresNext({ dependencies: { zod: '4.0.0' } })).toBe(false);
    expect(requiresNext({})).toBe(false);
  });
});

describe('граф воркеров не тянет next (F-R87-CHAIN-METADATA-b)', () => {
  it('ни один файл статического графа unified-worker не импортирует next', () => {
    const { visited, violations, unresolved } = walkWorkerGraph();

    // Граф обязан быть непустым и разрешённым: нерезолвнутый локальный импорт
    // или импорт пакета, которого нет в node_modules, означает слепое место
    // обхода, а не отсутствие нарушения.
    expect(visited).toBeGreaterThan(100);
    expect([...unresolved].sort()).toEqual([]);

    const expected = Object.entries(KNOWN_VIOLATIONS)
      .flatMap(([file, specifiers]) => specifiers.map((specifier) => `${file} -> ${specifier}`))
      .sort();
    expect([...violations].sort()).toEqual(expected);
  });
});
