#!/usr/bin/env node
// Runs eslint --fix on a single .ts/.tsx file after Claude edits it.
// Skips all other file types silently.

const { spawnSync } = require('child_process');

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  try {
    const { tool_input } = JSON.parse(input);
    const filePath = tool_input?.file_path || '';

    if (!/\.(ts|tsx)$/.test(filePath)) return;

    const result = spawnSync(
      'npx',
      ['eslint', '--fix', '--max-warnings=0', filePath],
      { encoding: 'utf8', cwd: process.cwd() },
    );

    if (result.status !== 0) {
      const output = (result.stdout || '') + (result.stderr || '');
      if (output.trim()) process.stderr.write(`ESLint: ${output.trim()}\n`);
    }
  } catch {
    // Unparseable input → skip silently
  }
});
