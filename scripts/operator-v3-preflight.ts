import {existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {extname, join, relative, resolve} from 'node:path';
import ts from 'typescript';

const ROOT = resolve(process.cwd());
const FRONTEND_ROOT = join(ROOT, 'src/components/piling/operator-v3');
const ROUTE_ROOT = join(ROOT, 'src/app/(app)/operator/v3');

const REQUIRED_ARTIFACTS = [
  'src/app/(app)/operator/v3/page.tsx',
  'src/app/api/operator/v3/workplace/route.ts',
  'src/app/api/operator/v3/commands/[command]/route.ts',
  'prisma/migrations/20260826110000_operator_v3_safety_incident/migration.sql',
  'src/modules/operator-v3/domain/safety-incident.ts',
  'src/modules/operator-v3/infrastructure/safety-incident-repository.ts',
  'src/components/piling/operator-v3/forms/defect-form.tsx',
  'src/components/piling/operator-v3/forms/safety-incident-form.tsx',
  'src/components/piling/operator-v3/forms/photo-form.tsx',
  'src/components/piling/operator-v3/safe-stop-panel.tsx',
  'tests/integration/operator-v3-safety.spec.ts',
  'prisma/migrations/20260826120000_operator_v3_production_intervals/migration.sql',
  'src/modules/operator-v3/domain/work-interval.ts',
  'src/modules/operator-v3/application/commands/production-commands.ts',
  'src/modules/operator-v3/infrastructure/work-interval-repository.ts',
  'src/components/piling/operator-v3/forms/production-entry-form.tsx',
  'src/components/piling/operator-v3/forms/work-interval-form.tsx',
  'src/components/piling/operator-v3/shift-journal.tsx',
  'tests/integration/operator-v3-production-intervals.spec.ts',
  'src/modules/operator-v3/application/commands/repair-commands.ts',
  'src/components/piling/operator-v3/forms/maintenance-form.tsx',
  'tests/integration/operator-v3-repair.spec.ts',
  'prisma/migrations/20260826140000_operator_v3_shift_report_identity/migration.sql',
  'src/modules/operator-v3/application/commands/completion-commands.ts',
  'src/components/piling/operator-v3/forms/shift-report-form.tsx',
  'src/components/piling/operator-v3/forms/handover-form.tsx',
  'src/components/piling/operator-v3/forms/corrective-action-form.tsx',
  'tests/integration/operator-v3-completion.spec.ts',
  'src/modules/operator-v3/application/sync/sync-commands.ts',
  'src/modules/operator-v3/infrastructure/device-sync-repository.ts',
  'src/app/api/operator/v3/sync/route.ts',
  'src/app/api/operator/v3/events/route.ts',
  'src/components/piling/operator-v3/offline/operator-v3-db.ts',
  'src/components/piling/operator-v3/offline/local-crypto.ts',
  'src/components/piling/operator-v3/offline/command-envelope.ts',
  'src/components/piling/operator-v3/offline/command-queue.ts',
  'src/components/piling/operator-v3/offline/queue-synchronizer.ts',
  'src/components/piling/operator-v3/offline/attachment-store.ts',
  'src/components/piling/operator-v3/offline/draft-store.ts',
  'src/components/piling/operator-v3/use-connectivity.ts',
  'src/components/piling/operator-v3/cross-tab-channel.ts',
  'src/components/piling/operator-v3/sync-queue-panel.tsx',
  'tests/integration/operator-v3-offline.spec.ts',
  'prisma/migrations/20260826150000_operator_v3_offline_authority/migration.sql',
  'src/modules/operator-v3/domain/offline-work-authorization.ts',
  'src/modules/operator-v3/domain/trusted-operator-device.ts',
  'src/app/api/operator/v3/offline-authorization/route.ts',
  'src/components/piling/operator-v3/offline/offline-authorization.ts',
  'e2e/operator-v3/operator-evidence.spec.ts',
  'e2e/operator-v3/operator-safety.spec.ts',
  'e2e/operator-v3/operator-offline.spec.ts',
] as const;

const VISIBLE_ATTRIBUTES = new Set(['alt', 'aria-description', 'aria-label', 'placeholder', 'title']);
const ALLOWED_LATIN_TEXT = [/^PilingTrack$/u];

export interface PreflightFinding {
  file: string;
  line?: number;
  message: string;
}

function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory()
      ? sourceFiles(path)
      : ['.ts', '.tsx'].includes(extname(path)) && !path.includes('__tests__') ? [path] : [];
  });
}

function hasForbiddenLatinText(value: string): boolean {
  const text = value.replace(/\s+/gu, ' ').trim();
  if (!/[A-Za-z]{3,}/u.test(text)) return false;
  return !ALLOWED_LATIN_TEXT.some((pattern) => pattern.test(text));
}

function isRenderedText(node: ts.Node): boolean {
  let child: ts.Node = node;
  let cursor: ts.Node | undefined = node.parent;
  while (cursor) {
    if (ts.isConditionalExpression(cursor) && cursor.condition === child) return false;
    if (ts.isBinaryExpression(cursor)) {
      if (cursor.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken || cursor.right !== child) return false;
    }
    if (ts.isCallExpression(cursor) || ts.isPropertyAccessExpression(cursor)
      || ts.isArrayLiteralExpression(cursor) || ts.isObjectLiteralExpression(cursor)) return false;
    if (ts.isJsxAttribute(cursor)) return VISIBLE_ATTRIBUTES.has(cursor.name.getText());
    if (ts.isJsxExpression(cursor)) {
      return !ts.isJsxAttribute(cursor.parent);
    }
    if (ts.isVariableDeclaration(cursor) || ts.isFunctionLike(cursor)) return false;
    child = cursor;
    cursor = cursor.parent;
  }
  return false;
}

export function findForeignVisibleText(file: string): PreflightFinding[] {
  const sourceText = readFileSync(file, 'utf8');
  const scriptKind = extname(file) === '.tsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, scriptKind);
  const findings: PreflightFinding[] = [];
  const report = (node: ts.Node, value: string) => {
    if (!hasForbiddenLatinText(value)) return;
    const {line} = source.getLineAndCharacterOfPosition(node.getStart(source));
    findings.push({
      file: relative(ROOT, file),
      line: line + 1,
      message: `Обнаружен иностранный пользовательский текст: «${value.replace(/\s+/gu, ' ').trim()}»`,
    });
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) report(node, node.text);
    if (ts.isJsxAttribute(node) && VISIBLE_ATTRIBUTES.has(node.name.getText(source))) {
      if (node.initializer && ts.isStringLiteral(node.initializer)) report(node.initializer, node.initializer.text);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && isRenderedText(node)) {
      report(node, node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return findings;
}

export function runOperatorV3Preflight(): PreflightFinding[] {
  const findings: PreflightFinding[] = [];
  for (const artifact of REQUIRED_ARTIFACTS) {
    if (!existsSync(join(ROOT, artifact))) findings.push({file: artifact, message: 'Отсутствует обязательный выпускной артефакт'});
  }
  for (const file of [...sourceFiles(FRONTEND_ROOT), ...sourceFiles(ROUTE_ROOT)]) {
    findings.push(...findForeignVisibleText(file));
  }
  return findings;
}

function main(): void {
  const findings = runOperatorV3Preflight();
  if (findings.length === 0) {
    console.log('Операторский модуль v3 прошёл предварительную выпускную проверку.');
    return;
  }
  console.error(`Операторский модуль v3 не готов к выпуску: найдено замечаний — ${findings.length}.`);
  for (const finding of findings) {
    console.error(`- ${finding.file}${finding.line ? `:${finding.line}` : ''}: ${finding.message}`);
  }
  process.exitCode = 1;
}

if (require.main === module) main();
