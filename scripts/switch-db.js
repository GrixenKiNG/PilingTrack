#!/usr/bin/env node
/**
 * Switch local DATABASE_URL between the dev DB (pilingtrack_test) and a
 * snapshot of prod (pilingtrack_prod_copy). Run with the dev server
 * stopped — Next.js caches env on boot.
 *
 *   npm run db:use-prod   → use prod snapshot (read-only mindset!)
 *   npm run db:use-dev    → back to the throwaway dev DB
 *   npm run db:status     → show which DB is currently active
 */

const fs = require('node:fs');
const path = require('node:path');

const ENV_FILE = path.join(__dirname, '..', '.env');
const DEV_DB = 'pilingtrack_test';
const PROD_COPY_DB = 'pilingtrack_prod_copy';

function readEnv() {
  return fs.readFileSync(ENV_FILE, 'utf8');
}

function currentDb(text) {
  const m = text.match(/^DATABASE_URL=postgresql:\/\/[^/]+\/([^?\s]+)/m);
  return m ? m[1] : null;
}

function swapDb(text, newDb) {
  // Swap DB segment on every DATABASE_URL* line (covers DATABASE_URL,
  // DATABASE_URL_POSTGRES, DATABASE_URL_PGBOUNCER, etc.).
  return text.replace(
    /^(DATABASE_URL[A-Z_]*=postgresql:\/\/[^/]+\/)[^?\s]+/gm,
    `$1${newDb}`
  );
}

const action = process.argv[2];
const text = readEnv();
const db = currentDb(text);

if (action === 'status') {
  const label = db === PROD_COPY_DB ? 'prod-snapshot' : db === DEV_DB ? 'dev' : 'unknown';
  console.log(`current DB: ${db}  (${label})`);
  process.exit(0);
}

const target =
  action === 'prod' ? PROD_COPY_DB :
  action === 'dev'  ? DEV_DB :
  null;

if (!target) {
  console.error('Usage: node scripts/switch-db.js [prod|dev|status]');
  process.exit(1);
}

if (db === target) {
  console.log(`already on ${target} — nothing to do`);
  process.exit(0);
}

fs.writeFileSync(ENV_FILE, swapDb(text, target));
console.log(`switched: ${db} → ${target}`);
console.log('restart `npm run dev` for the change to take effect');
