const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const projectRoot = process.cwd();

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    const value = rawValue.replace(/^['"]|['"]$/g, '');

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

function loadKnownEnvFiles() {
  for (const fileName of ['.env', '.env.local', '.env.production', '.env.production.local', '.env.docker']) {
    loadEnvFile(path.join(projectRoot, fileName));
  }
}

function resolveSqliteFile(databaseUrl) {
  if (!databaseUrl.startsWith('file:')) {
    return null;
  }

  const filePath = databaseUrl.slice('file:'.length);

  if (path.isAbsolute(filePath)) {
    return filePath;
  }

  return path.join(projectRoot, filePath.replace(/^\.\//, ''));
}

function check(name, passed, details) {
  const marker = passed ? 'PASS' : 'FAIL';
  console.log(`[${marker}] ${name}${details ? ` - ${details}` : ''}`);
  return passed;
}

function main() {
  loadKnownEnvFiles();

  const results = [];
  const databaseUrl = process.env.DATABASE_URL || '';
  const databaseUrlPostgres = process.env.DATABASE_URL_POSTGRES || '';
  const sessionSecret = process.env.SESSION_SECRET || process.env.AUTH_SECRET || '';

  results.push(check('SESSION_SECRET configured', Boolean(sessionSecret), sessionSecret ? 'present' : 'missing'));
  results.push(
    check('DATABASE_URL_POSTGRES configured', Boolean(databaseUrlPostgres), databaseUrlPostgres || 'missing')
  );

  const sqliteFile = resolveSqliteFile(databaseUrl);
  results.push(
    check(
      'SQLite source database accessible',
      Boolean(sqliteFile && fs.existsSync(sqliteFile)),
      sqliteFile || 'missing or not a sqlite file URL'
    )
  );

  try {
    const version = execFileSync('docker', ['--version'], { encoding: 'utf8' }).trim();
    results.push(check('Docker CLI available', true, version));
  } catch (error) {
    results.push(check('Docker CLI available', false, 'docker command not found'));
  }

  try {
    execFileSync('docker', ['info'], { encoding: 'utf8', stdio: 'pipe' });
    results.push(check('Docker daemon available', true, 'ready'));
  } catch (error) {
    results.push(check('Docker daemon available', false, 'not running or inaccessible'));
  }

  const passed = results.every(Boolean);
  if (!passed) {
    process.exit(1);
  }
}

main();
