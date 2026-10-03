#!/usr/bin/env node
// Read-only metadata inventory. Age bands do not authorize deletion.
const fs = require('node:fs');
const path = require('node:path');

const summary = {
  scannedAt: new Date().toISOString(),
  status: 'complete', partial: false, files: 0, bytes: 0, errors: 0,
  ignored: { directories: 0, symlinks: 0, nonPdf: 0, other: 0 },
  oldestMtime: null, newestMtime: null,
  byAge: { under1Hour: 0, from1To24Hours: 0, from1To7Days: 0, atLeast7Days: 0 },
  ageIsDeletionEligibility: false,
};

try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--root') throw new Error('invalid_arguments');
  const rootInput = args[1];
  const root = path.resolve(rootInput);
  if (!path.isAbsolute(rootInput) || /^[/\\]{2}/.test(rootInput)
      || path.basename(root) !== 'pdf-results') throw new Error('invalid_root');
  const rootStat = fs.lstatSync(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('invalid_root_type');
  const now = Date.now();
  for (const name of fs.readdirSync(root)) {
    try {
      const stat = fs.lstatSync(path.join(root, name));
      if (stat.isSymbolicLink()) { summary.ignored.symlinks += 1; continue; }
      if (stat.isDirectory()) { summary.ignored.directories += 1; continue; }
      if (!stat.isFile()) { summary.ignored.other += 1; continue; }
      if (!name.toLowerCase().endsWith('.pdf')) { summary.ignored.nonPdf += 1; continue; }
      summary.files += 1;
      summary.bytes += stat.size;
      const mtime = stat.mtime.toISOString();
      summary.oldestMtime = !summary.oldestMtime || mtime < summary.oldestMtime ? mtime : summary.oldestMtime;
      summary.newestMtime = !summary.newestMtime || mtime > summary.newestMtime ? mtime : summary.newestMtime;
      const ageHours = Math.max(0, now - stat.mtimeMs) / 3_600_000;
      const band = ageHours < 1 ? 'under1Hour' : ageHours < 24 ? 'from1To24Hours'
        : ageHours < 168 ? 'from1To7Days' : 'atLeast7Days';
      summary.byAge[band] += 1;
    } catch {
      summary.errors += 1;
    }
  }
} catch (error) {
  summary.errors += 1;
  summary.reason = error.code || (
    ['invalid_arguments', 'invalid_root', 'invalid_root_type'].includes(error.message)
      ? error.message : 'scan_failed'
  );
}
if (summary.errors > 0) {
  summary.status = 'partial';
  summary.partial = true;
  process.exitCode = 1;
}
process.stdout.write(JSON.stringify(summary) + '\n');
