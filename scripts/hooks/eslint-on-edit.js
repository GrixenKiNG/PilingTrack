#!/usr/bin/env node
// Runs eslint --fix on a single .ts/.tsx file after Claude edits it.
// Uses the ESLint Node API (no subprocess/npx overhead).

let input = '';
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', async () => {
  try {
    const { tool_input } = JSON.parse(input);
    const filePath = tool_input?.file_path || '';

    if (!/\.(ts|tsx)$/.test(filePath)) return;

    const { ESLint } = require('eslint');
    const eslint = new ESLint({ fix: true });
    const results = await eslint.lintFiles([filePath]);
    await ESLint.outputFixes(results);

    const formatter = await eslint.loadFormatter('stylish');
    const output = await formatter.format(results);
    if (output.trim()) process.stderr.write(output + '\n');
  } catch {
    // ESLint not available or unparseable input → skip silently
  }
});
