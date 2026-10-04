import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

const methods = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
export function apiRouteInventory(root = join(process.cwd(), 'src/app/api')): string[] {
  const rows: string[] = [];
  function walk(directory: string) {
    for (const entry of readdirSync(directory, {withFileTypes: true})) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.name === 'route.ts') {
        const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
        const path = '/api/' + relative(root, file).replace(/\\/g, '/').replace(/route\.ts$/, '').replace(/\/$/, '');
        const route = path === '/api/' ? '/api' : path;
        const add = (name: string) => { if (methods.has(name)) rows.push(name + ' ' + route); };
        for (const statement of source.statements) {
          if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
            for (const item of statement.exportClause.elements) add(item.name.text);
          } else if (ts.canHaveModifiers(statement) && ts.getModifiers(statement)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
            if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
              if (ts.isIdentifier(declaration.name)) add(declaration.name.text);
            }
            if (ts.isFunctionDeclaration(statement) && statement.name) add(statement.name.text);
          }
        }
      }
    }
  }
  walk(root);
  return rows.sort();
}

export function inventoryDifference(actual: readonly string[], expected: readonly string[]) {
  return {
    missing: actual.filter(key => !expected.includes(key)),
    obsolete: expected.filter(key => !actual.includes(key)),
    duplicates: expected.filter((key, index) => expected.indexOf(key) !== index),
  };
}
