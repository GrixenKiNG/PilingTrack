#!/usr/bin/env node
// Blocks Claude Code Edit/Write on .env* and on EXISTING prisma/migrations files.
// Receives tool call JSON on stdin, writes decision JSON to stdout.
//
// Why "existing" and not the whole directory: the danger is rewriting a migration
// that has already been applied — Prisma stores a checksum per migration, and
// editing an applied file makes `migrate deploy` fail on prod. Creating a NEW
// migration folder cannot break anything, because it has never been applied
// anywhere. Guarding the whole path also blocked ordinary, requested schema work
// (hit 2026-08-16, permit work types).

const fs = require('fs');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { tool_input } = JSON.parse(input);
    const filePath = (tool_input?.file_path || '').replace(/\\/g, '/');

    const isEnv = /(?:^|\/)\.env(\.[^/]*)?$/.test(filePath);
    // Only an already-written migration is protected; a brand-new one is normal work.
    const isMigration = /prisma\/migrations\//.test(filePath)
      && fs.existsSync(tool_input.file_path);

    if (isEnv || isMigration) {
      const kind = isEnv ? '.env file' : 'applied migration';
      process.stdout.write(JSON.stringify({
        decision: 'block',
        reason: `Protected ${kind}: ${filePath} — edit manually if intentional`,
      }));
    } else {
      process.stdout.write(JSON.stringify({ decision: 'approve' }));
    }
  } catch {
    // Unparseable input → don't block
    process.stdout.write(JSON.stringify({ decision: 'approve' }));
  }
});
