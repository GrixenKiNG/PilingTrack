const { execFileSync } = require('node:child_process');

const projectRoot = process.cwd();
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const args = new Set(process.argv.slice(2));

function runScript(scriptName) {
  console.log(`\n=== ${scriptName} ===`);
  execFileSync(npmCommand, ['run', scriptName], {
    cwd: projectRoot,
    stdio: 'inherit',
    env: process.env,
  });
}

function main() {
  const scripts = [
    'stage:doctor',
    ...(args.has('--skip-up') ? [] : ['stage:postgres:up']),
    'db:push:postgres',
    'db:migrate:data:postgres:dry-run',
    ...(args.has('--dry-run-only')
      ? []
      : ['db:migrate:data:postgres', 'db:migrate:data:postgres:verify']),
  ];

  for (const scriptName of scripts) {
    runScript(scriptName);
  }

  console.log('\nStage PostgreSQL cutover pipeline completed successfully.');
}

main();
