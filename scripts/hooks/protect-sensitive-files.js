#!/usr/bin/env node
// Blocks Claude Code Edit/Write on .env* and prisma/migrations/** paths.
// Receives tool call JSON on stdin, writes decision JSON to stdout.

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { tool_input } = JSON.parse(input);
    const filePath = (tool_input?.file_path || '').replace(/\\/g, '/');

    const isEnv = /(?:^|\/)\.env(\.[^/]*)?$/.test(filePath);
    const isMigration = /prisma\/migrations\//.test(filePath);

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
