/**
 * Сторож: глобальный `db` внутри колбэка транзакции (T-GLOBAL-DB-IN-TX-GUARD).
 *
 * R85 (`docs/audits/hermes-night/R85-global-db-inside-tx.md`): обёртка транзакции
 * помечает область «`app.current_tenant` уже выставлен» через `AsyncLocalStorage`
 * (`runWithGucApplied`, `src/core/security/tenant-rls.ts`), и пометка накрывает
 * ВЕСЬ код из колбэка, включая запросы через глобальный `db`. Такой запрос уходит
 * другим соединением без `set_config` тенанта: под строгим RLS чтение молча видит
 * ноль строк, запись падает `42501`, а запись в таблицу без RLS утекает из
 * транзакции. Ровно поэтому с 25.09.2026 молча не доходили PDF отчётов в Telegram.
 *
 * Тест разбирает исходники через TypeScript Compiler API (пакет `typescript`):
 *   • обходит все `src/**\/*.ts(x)`, кроме `__tests__/`, `*.test.*`, `src/generated/`;
 *   • ищет вызовы `<что угодно>.$transaction(<стрелочная функция | function-выражение>)`;
 *   • внутри ТЕЛА колбэка (включая вложенные функции) ищет обращения к имени,
 *     которым в этом файле импортирован `db` из `@/lib/db` (учитывает `db as prisma`).
 *
 * Параметр `tx` и прочие имена не считаются; не считаются обращение к имени как
 * к свойству (`x.db`), имя свойства в литерале (`{ db: … }`), объявление имени
 * (параметр, `const db = …`, импорт) и упоминание имени внутри узла ТИПА
 * (`tx as typeof db`, `const t: typeof db = tx`): в типе Name указывает на форму
 * клиента (TypeQuery), а не на сам клиент. Обращения в выражениях (`db.x`,
 * `f(db)`, `const c = db`) считаются, как и раньше.
 *
 * Пределы: сторож видит только ЛЕКСИЧЕСКИЕ обращения к `db` в теле колбэка.
 * Вызов функции, которая сама обращается к глобальному `db`, он не ловит — ровно
 * так была устроена ошибка R85 (`sendDocument` → `getConfigs`): в колбэке стоял
 * вызов помощника, а глобальный клиент доставался уже внутри него.
 *
 * Результат сверяется с KNOWN: тест ЗЕЛЁНЫЙ на текущем коде и КРАСНЫЙ на любом
 * новом вхождении. Запись в KNOWN — приглашение к разбору, а не разрешение.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

// happy-dom подменяет import.meta.url не-file-схемой, поэтому корень берём из cwd:
// vitest запускается из корня проекта (там же, где vitest.config.ts).
const ROOT = path.resolve(process.cwd());
const SRC = path.join(ROOT, 'src');

/**
 * Уже существующие вхождения. После разбора `tx as typeof db` — это упоминание
 * `db` в позиции ТИПА, а не обращение к клиенту, — сторож такие строки не считает,
 * и список пуст. Любое новое вхождение означает настоящее обращение к глобальному
 * клиенту внутри транзакции; добавлять сюда запись без разбора нельзя.
 */
const KNOWN: Record<string, string> = {};

/**
 * `parseDiagnostics` есть у узла во время выполнения, но не в публичном типе
 * `SourceFile`; берём его через явное сужение — это единственный доступный способ
 * отличить разобранный файл от файла, который TypeScript разобрал «наполовину».
 */
type SourceFileWithDiagnostics = ts.SourceFile & { parseDiagnostics?: ts.Diagnostic[] };

/** Локальные имена, которыми в файле импортирован `db` из '@/lib/db' (учитывает `db as prisma`). */
function dbLocalNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const specifier = statement.moduleSpecifier;
    if (!ts.isStringLiteral(specifier) || specifier.text !== '@/lib/db') continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly || !clause.namedBindings) continue;
    if (!ts.isNamedImports(clause.namedBindings)) continue;
    for (const element of clause.namedBindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === 'db') names.add(element.name.text);
    }
  }
  return names;
}

/**
 * Упоминание имени внутри узла ТИПА (`tx as typeof db`, `const t: typeof db = tx`,
 * `Foo<typeof db>`): в типе `db` задаёт лишь форму клиента (TypeQuery), обращения
 * к нему нет. Проверку ведём по предкам до границы выражения: встретили узел типа
 * раньше, чем выражение/инструкцию, — значит это позиция ТИПА, а не обращение.
 */
function isInsideTypeContext(id: ts.Identifier): boolean {
  let node: ts.Node | undefined = id.parent;
  while (node) {
    if (ts.isTypeNode(node) || ts.isTypeQueryNode(node)) return true;
    if (ts.isExpression(node) || ts.isStatement(node)) return false;
    node = node.parent;
  }
  return false;
}

/** Обращение к имени, а не имя свойства (`x.db`), ключ литерала (`{ db: … }`) или объявление имени. */
function isReferenceToDb(id: ts.Identifier, names: Set<string>): boolean {
  if (!names.has(id.text)) return false;
  if (isInsideTypeContext(id)) return false;
  const parent = id.parent;
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
  if (ts.isPropertyAssignment(parent) && parent.name === id) return false;
  if (ts.isPropertySignature(parent) && parent.name === id) return false;
  if (ts.isParameter(parent) && parent.name === id) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === id) return false;
  if (ts.isBindingElement(parent) && parent.name === id) return false;
  return true;
}

/** Тело колбэка обходим рекурсивно: вложенные функции — тоже помеченная область. */
function collectDbRefs(
  node: ts.Node,
  names: Set<string>,
  sourceFile: ts.SourceFile,
  lines: Set<number>,
): void {
  if (ts.isIdentifier(node) && isReferenceToDb(node, names)) {
    lines.add(sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1);
  }
  ts.forEachChild(node, (child) => collectDbRefs(child, names, sourceFile, lines));
}

function unwrapParens(node: ts.Expression | undefined): ts.Expression | undefined {
  let current = node;
  while (current && ts.isParenthesizedExpression(current)) current = current.expression;
  return current;
}

/** Строки (1-based) обращений к импортированному `db` внутри тел `$transaction(<функция>)`. */
function findGlobalDbInTxInFile(sourceFile: ts.SourceFile): number[] {
  const names = dbLocalNames(sourceFile);
  if (names.size === 0) return [];
  const lines = new Set<number>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === '$transaction'
    ) {
      const callback = unwrapParens(node.arguments[0]);
      if (callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        collectDbRefs(callback.body, names, sourceFile, lines);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return [...lines].sort((a, b) => a - b);
}

function findGlobalDbInTx(sourceText: string, fileName = 'source.ts'): number[] {
  return findGlobalDbInTxInFile(
    ts.createSourceFile(
      fileName,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  );
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir)) {
    if (entry === 'generated' || entry === 'node_modules' || entry === '__tests__') continue;
    const full = path.join(dir, entry);
    if (fs.statSync(full).isDirectory()) sourceFiles(full, acc);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) acc.push(full);
  }
  return acc;
}

/** Обход src/**; возвращает ещё и файлы с ошибками разбора — иначе сторож слеп. */
function scanSources(): { files: string[]; findings: string[]; parseErrors: string[] } {
  const files = sourceFiles(SRC);
  const findings: string[] = [];
  const parseErrors: string[] = [];

  for (const file of files) {
    const relativePath = path.relative(ROOT, file).split(path.sep).join('/');
    const sourceFile: SourceFileWithDiagnostics = ts.createSourceFile(
      relativePath,
      fs.readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    if ((sourceFile.parseDiagnostics ?? []).length > 0) parseErrors.push(relativePath);
    for (const line of findGlobalDbInTxInFile(sourceFile)) findings.push(`${relativePath}:${line}`);
  }

  return { files, findings: findings.sort(), parseErrors };
}

describe('разбор исходника на глобальный db внутри транзакции', () => {
  it('находит db внутри колбэка $transaction', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    await db.user.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([4]);
  });

  it('не считает параметр tx и обращения через него', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    await tx.user.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([]);
  });

  it('не считает db вне колбэка', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  const rows = await db.user.findMany();',
      '  return db.$transaction(async (tx) => {',
      '    await tx.user.findMany();',
      '    return rows;',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([]);
  });

  it('находит db, импортированный под другим именем (import { db as prisma })', () => {
    const source = [
      "import { db as prisma } from '@/lib/db';",
      'async function f() {',
      '  return prisma.$transaction(async (tx) => {',
      '    await prisma.user.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([4]);
  });

  it('находит db во вложенной функции внутри колбэка', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    async function inner() {',
      '      await db.user.findMany();',
      '    }',
      '    await inner();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([5]);
  });

  it('находит function-выражение в роли колбэка', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'const run = () => db.$transaction(async function (tx) {',
      '  await db.user.findMany();',
      '});',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([3]);
  });

  it('не считает db как имя свойства или ключ литерала', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    const other = { db: tx };',
      '    await other.db.user.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([]);
  });

  it('не считает db в позиции типа (tx as typeof db)', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    await g(tx as typeof db);',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([]);
  });

  it('не считает db в аннотации типа (const t: typeof db = tx)', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    const t: typeof db = tx;',
      '    await t.user.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([]);
  });

  it('находит реальное обращение db внутри колбэка', () => {
    const source = [
      "import { db } from '@/lib/db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    await db.site.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([4]);
  });

  it('не считает db, импортированный не из @/lib/db', () => {
    const source = [
      "import { db } from '@/lib/other-db';",
      'async function f() {',
      '  return db.$transaction(async (tx) => {',
      '    await db.user.findMany();',
      '  });',
      '}',
    ].join('\n');
    expect(findGlobalDbInTx(source)).toEqual([]);
  });
});

describe('глобальный db не вызывается изнутри транзакций (T-GLOBAL-DB-IN-TX-GUARD)', () => {
  it('найденные вхождения совпадают с KNOWN', { timeout: 20000 }, () => {
    const { files, findings, parseErrors } = scanSources();

    // Обход обязан быть непустым и без ошибок разбора: неразобранный файл — слепое
    // место сторожа, а не отсутствие нарушения.
    expect(files.length).toBeGreaterThan(300);
    expect(parseErrors).toEqual([]);

    expect(findings).toEqual(Object.keys(KNOWN).sort());
  });
});
