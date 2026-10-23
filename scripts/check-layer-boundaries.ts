/**
 * Layer boundary check.
 *
 * Enforces the architecture rules from CLAUDE.md:
 *   - core/       — infrastructure; must not depend on modules/, services/,
 *                   app/, or components/.
 *   - modules/X/  — DDD domain; may depend on core/ and on its own module
 *                   subtree and another module public API, but NOT on app/, components/,
 *                   or another module internals.
 *   - app/, components/ — may import modules only through the public API
 *                   (@/modules/<x>); modules/ may not add imports from services/.
 *   - services/   — cross-cutting glue; may depend on core/ and modules/,
 *                   but NOT on app/ or components/.
 *
 * Reports violations as `file:line  bad-import  reason` and exits 1 on any.
 *
 * Why a custom script instead of eslint-plugin-import? Because ESLint is
 * currently broken in this repo (eslint 10 vs eslint-plugin-react). This
 * runs standalone via tsx and is wired into CI in the same job as tests.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {isPublicModuleEntry, isModuleServerEntry} from './lib/module-boundaries';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.resolve(ROOT, 'src');

type Layer = 'core' | 'services' | 'modules' | 'app' | 'components' | 'lib' | 'workers' | 'mobile' | 'other';

function classify(file: string): { layer: Layer; module?: string } {
  // file is absolute, normalise to forward slashes for matching.
  const rel = path.relative(SRC, file).replace(/\\/g, '/');
  if (rel.startsWith('core/'))     return { layer: 'core' };
  if (rel.startsWith('services/')) return { layer: 'services' };
  if (rel.startsWith('modules/')) {
    const moduleName = rel.split('/')[1];
    return { layer: 'modules', module: moduleName };
  }
  if (rel.startsWith('app/'))        return { layer: 'app' };
  if (rel.startsWith('components/')) return { layer: 'components' };
  if (rel.startsWith('lib/'))        return { layer: 'lib' };
  if (rel.startsWith('workers/'))    return { layer: 'workers' };
  if (rel.startsWith('mobile/'))     return { layer: 'mobile' };
  return { layer: 'other' };
}

const FORBIDDEN: Record<Layer, Layer[]> = {
  core:     ['modules', 'services', 'app', 'components'],
  services: ['app', 'components'],
  modules:  ['app', 'components'],
  // Top layers are unrestricted; lib is shared; workers/mobile have their
  // own conventions outside the modules/services/core triad.
  app: [], components: [], lib: [], workers: [], mobile: [], other: [],
};

interface Violation {
  file: string;
  line: number;
  importPath: string;
  reason: string;
}

/**
 * Every module specifier in a file, with the 1-based line it sits on.
 *
 * Uses the TypeScript scanner rather than a regex: the previous regex was
 * anchored per line, so a multi-line `import {\n  a,\n} from '@/x'` was never
 * seen (the line carrying `from` starts with `}`). That silently hid real
 * violations AND made baseline entries look "fixed" when an import was merely
 * reformatted. preProcessFile also covers side-effect imports, `export ... from`,
 * dynamic `import()` and `require()` for free.
 */
function importSpecifiers(text: string): { line: number; importPath: string }[] {
  const pre = ts.preProcessFile(text, /* readImportFiles */ true, /* detectJavaScriptImports */ true);
  return pre.importedFiles.map((ref) => ({
    line: text.slice(0, ref.pos).split('\n').length,
    importPath: ref.fileName,
  }));
}

async function walk(dir: string, out: string[]) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name === 'generated') continue;
      await walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
}

function resolveAlias(importPath: string): string | null {
  // Map @/X → src/X and ./../ relative resolution is left to the caller.
  if (importPath.startsWith('@/')) return path.join(SRC, importPath.slice(2));
  return null;
}

/**
 * Direction between the fleet-readiness modules: dependencies go DOWN only,
 * readiness -> inspections -> equipment -> audit/settings. A module absent from
 * this table is not constrained. Existing reverse imports sit in the baseline
 * (it may only shrink); new ones fail. Target scheme: docs/adr (module relations).
 */
const MODULE_DEPENDENCIES: Record<string, readonly string[]> = {
  equipment: ['audit', 'settings'],
  inspections: ['equipment', 'audit', 'settings'],
  readiness: ['inspections', 'equipment', 'users', 'audit', 'settings'],
};

function checkImport(fromInfo: { layer: Layer; module?: string }, importPath: string): string | null {
  const aliased = resolveAlias(importPath);
  if (!aliased) return null; // npm package or relative — skip.

  const toInfo = classify(aliased);
  if (FORBIDDEN[fromInfo.layer]?.includes(toInfo.layer)) {
    return `${fromInfo.layer}/ may not import from ${toInfo.layer}/`;
  }
  if (fromInfo.layer === 'components' && isModuleServerEntry(importPath)) {
    return 'components/ may not import module server entry points';
  }
  // Ratchet: the unfinished services/ -> modules/ migration is frozen, so new
  // imports in the legacy direction are refused; old ones stay in the baseline.
  if (fromInfo.layer === 'modules' && toInfo.layer === 'services') {
    return 'modules/ may not import from services/ (migration frozen)';
  }
  if ((fromInfo.layer === 'app' || fromInfo.layer === 'components')
      && toInfo.layer === 'modules' && !isPublicModuleEntry(importPath)) {
    return `${fromInfo.layer}/ may not import module internals (use @/modules/<x>)`;
  }
  if (fromInfo.layer === 'modules' && toInfo.layer === 'modules'
      && fromInfo.module && toInfo.module && fromInfo.module !== toInfo.module) {
    const allowed = MODULE_DEPENDENCIES[fromInfo.module];
    if (allowed && !allowed.includes(toInfo.module)) {
      return `modules/${fromInfo.module} may not depend on modules/${toInfo.module} (direction: readiness -> inspections -> equipment)`;
    }
  }
  // CLAUDE.md allows public module APIs; internal implementation paths stay private.
  if (fromInfo.layer === 'modules' && toInfo.layer === 'modules'
      && fromInfo.module && toInfo.module && fromInfo.module !== toInfo.module
      && !isPublicModuleEntry(importPath)) {
    return `modules/${fromInfo.module} may not import from modules/${toInfo.module} (cross-module)`;
  }
  return null;
}

async function main() {
  const files: string[] = [];
  await walk(SRC, files);

  const violations: Violation[] = [];
  for (const file of files) {
    const fromInfo = classify(file);
    if (!['core', 'services', 'modules', 'app', 'components'].includes(fromInfo.layer)) continue;

    const text = await fs.readFile(file, 'utf8');
    for (const { line, importPath } of importSpecifiers(text)) {
      const reason = checkImport(fromInfo, importPath);
      if (reason) {
        violations.push({ file: path.relative(ROOT, file), line, importPath, reason });
      }
    }
  }

  // Baseline: existing violations are accepted (kept as a sorted snapshot
  // in scripts/.layer-boundaries-baseline.txt). NEW violations fail CI.
  // Refactor an existing line → drop it from the baseline. Run with --update
  // to regenerate the baseline after intentional cleanup.
  const baselinePath = path.join(ROOT, 'scripts', '.layer-boundaries-baseline.txt');
  const fingerprint = (v: Violation) =>
    `${v.file.replace(/\\/g, '/')}|${v.importPath}|${v.reason}`;
  const current = new Set(violations.map(fingerprint));

  if (process.argv.includes('--update')) {
    // Ratchet: the snapshot may only shrink. Grandfathering a new violation
    // needs an explicit --allow-new, so a routine refresh cannot hide one.
    let previous = new Set<string>();
    try {
      previous = new Set((await fs.readFile(baselinePath, 'utf8')).split(/\r?\n/).filter(Boolean));
    } catch {
      // No baseline yet — nothing to compare against.
    }
    const added = Array.from(current).filter((line) => !previous.has(line));
    if (added.length > 0 && previous.size > 0 && !process.argv.includes('--allow-new')) {
      console.error(`✗ --update refused: ${added.length} violation(s) are not in the baseline (it may only shrink):`);
      for (const line of added) console.error(`  ${line}`);
      console.error('Fix them, or pass --allow-new to grandfather them on purpose.');
      process.exit(1);
    }
    const sorted = Array.from(current).sort();
    await fs.writeFile(baselinePath, sorted.join('\n') + '\n', 'utf8');
    console.log(`Baseline updated: ${sorted.length} entries written to`);
    console.log(`  ${path.relative(ROOT, baselinePath)}`);
    process.exit(0);
  }

  let baseline = new Set<string>();
  try {
    const text = await fs.readFile(baselinePath, 'utf8');
    baseline = new Set(text.split(/\r?\n/).filter(Boolean));
  } catch {
    // No baseline yet — first run. Treat all current as new.
  }

  const newViolations = violations.filter((v) => !baseline.has(fingerprint(v)));
  const fixedSinceBaseline = Array.from(baseline).filter((line) => !current.has(line));

  if (fixedSinceBaseline.length > 0) {
    console.log(`✓ ${fixedSinceBaseline.length} baseline violation(s) fixed since last snapshot.`);
    console.log(`  Run "npx tsx scripts/check-layer-boundaries.ts --update" to refresh the snapshot.\n`);
  }

  if (newViolations.length === 0) {
    console.log(`✓ Layer boundaries: ${current.size} grandfathered, 0 new.`);
    process.exit(0);
  }

  console.error(`✗ ${newViolations.length} NEW layer violation(s) (not in baseline):\n`);
  for (const v of newViolations) {
    console.error(`  ${v.file}:${v.line}  ${v.importPath}\n    ${v.reason}\n`);
  }
  console.error('Either fix the import or, if intentional, run --update to grandfather it.');
  process.exit(1);
}

main().catch((e) => { console.error('ERROR', e); process.exit(2); });
