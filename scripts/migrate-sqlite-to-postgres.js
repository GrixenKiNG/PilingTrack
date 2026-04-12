const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TABLES = [
  'pileGrade',
  'drillingType',
  'downtimeReason',
  'equipment',
  'site',
  'user',
  'telegramConfig',
  'sitePilePlan',
  'siteDrillingPlan',
  'pileField',
  'cluster',
  'picket',
  'userSiteAssignment',
  'crew',
  'crewAssistant',
  'report',
  'pileWork',
  'leaderDrilling',
  'reportDowntime',
];

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

function ensureEnvLoaded() {
  const projectRoot = process.cwd();
  loadEnvFile(path.join(projectRoot, '.env'));
  loadEnvFile(path.join(projectRoot, '.env.local'));
  loadEnvFile(path.join(projectRoot, '.env.production'));
  loadEnvFile(path.join(projectRoot, '.env.production.local'));
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseArgs(argv) {
  const flags = new Set(argv.slice(2));

  return {
    dryRun: flags.has('--dry-run'),
    verifyOnly: flags.has('--verify-only'),
    forceResetTarget: flags.has('--force-reset-target'),
  };
}

function summarizeCounts(counts) {
  return TABLES.map((table) => `${table}: ${counts[table] ?? 0}`).join(', ');
}

function summarizeChecksums(checksums) {
  return TABLES.map((table) => `${table}: ${checksums[table] ?? 'n/a'}`).join(', ');
}

function getNonEmptyTables(counts) {
  return TABLES.filter((table) => (counts[table] ?? 0) > 0);
}

function diffCounts(sourceCounts, targetCounts) {
  return TABLES.filter((table) => (sourceCounts[table] ?? 0) !== (targetCounts[table] ?? 0)).map(
    (table) =>
      `${table}: sqlite=${sourceCounts[table] ?? 0}, postgres=${targetCounts[table] ?? 0}`
  );
}

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((accumulator, key) => {
        accumulator[key] = normalizeValue(value[key]);
        return accumulator;
      }, {});
  }

  return value;
}

function createHash(payload) {
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function createTableChecksums(rowsByTable) {
  const checksums = {};

  for (const table of TABLES) {
    const rows = (rowsByTable[table] ?? [])
      .map((row) => normalizeValue(row))
      .map((row) => JSON.stringify(row))
      .sort();

    checksums[table] = createHash(rows.join('\n'));
  }

  return checksums;
}

function diffChecksums(sourceChecksums, targetChecksums) {
  return TABLES.filter(
    (table) => (sourceChecksums[table] ?? '') !== (targetChecksums[table] ?? '')
  ).map(
    (table) =>
      `${table}: sqlite=${sourceChecksums[table] ?? 'n/a'}, postgres=${targetChecksums[table] ?? 'n/a'}`
  );
}

function createDatasetChecksum(checksums) {
  return createHash(TABLES.map((table) => `${table}:${checksums[table] ?? ''}`).join('\n'));
}

async function loadRowsByTable(client) {
  const rows = {};

  for (const table of TABLES) {
    rows[table] = await client[table].findMany();
  }

  return rows;
}

function getCountsFromRows(rowsByTable) {
  const counts = {};

  for (const table of TABLES) {
    counts[table] = rowsByTable[table]?.length ?? 0;
  }

  return counts;
}

async function loadCounts(client) {
  const counts = {};

  for (const table of TABLES) {
    counts[table] = await client[table].count();
  }

  return counts;
}

async function loadChecksums(client) {
  const rowsByTable = await loadRowsByTable(client);

  return {
    rowsByTable,
    checksums: createTableChecksums(rowsByTable),
  };
}

async function resetTarget(tx) {
  for (const table of [...TABLES].reverse()) {
    await tx[table].deleteMany();
  }
}

async function insertRows(tx, rowsByTable) {
  for (const table of TABLES) {
    const rows = rowsByTable[table] ?? [];
    if (!rows.length) {
      continue;
    }

    await tx[table].createMany({ data: rows });
  }
}

async function createClients() {
  const { PrismaClient: SqlitePrismaClient } = require('@prisma/client');
  let PostgresPrismaClient;

  try {
    ({ PrismaClient: PostgresPrismaClient } = require('../src/generated/postgres-client'));
  } catch (error) {
    throw new Error(
      'Postgres Prisma client not found. Run "npm run db:generate:postgres" before data migration.'
    );
  }

  return {
    source: new SqlitePrismaClient({ log: ['warn', 'error'] }),
    target: new PostgresPrismaClient({ log: ['warn', 'error'] }),
  };
}

async function main() {
  const options = parseArgs(process.argv);

  ensureEnvLoaded();
  requireEnv('DATABASE_URL');
  requireEnv('DATABASE_URL_POSTGRES');

  const { source, target } = await createClients();

  try {
    const sourceRows = await loadRowsByTable(source);
    const sourceCounts = getCountsFromRows(sourceRows);
    const sourceChecksums = createTableChecksums(sourceRows);
    const sourceDatasetChecksum = createDatasetChecksum(sourceChecksums);
    const targetCountsBefore = await loadCounts(target);
    const nonEmptyTargetTables = getNonEmptyTables(targetCountsBefore);

    console.log(`Source SQLite counts: ${summarizeCounts(sourceCounts)}`);
    console.log(`Target PostgreSQL counts: ${summarizeCounts(targetCountsBefore)}`);
    console.log(`Source SQLite dataset checksum: ${sourceDatasetChecksum}`);

    if (options.dryRun) {
      const { checksums: targetChecksumsBefore } = await loadChecksums(target);
      const targetDatasetChecksumBefore = createDatasetChecksum(targetChecksumsBefore);

      if (nonEmptyTargetTables.length) {
        console.log(
          `Dry run: target is not empty. Reset would affect tables: ${nonEmptyTargetTables.join(', ')}`
        );
      } else {
        console.log('Dry run: target is empty and ready for migration.');
      }

      console.log(`Target PostgreSQL dataset checksum: ${targetDatasetChecksumBefore}`);

      return;
    }

    if (options.verifyOnly) {
      const diffs = diffCounts(sourceCounts, targetCountsBefore);
      const { checksums: targetChecksumsBefore } = await loadChecksums(target);
      const checksumDiffs = diffChecksums(sourceChecksums, targetChecksumsBefore);
      const targetDatasetChecksumBefore = createDatasetChecksum(targetChecksumsBefore);

      if (diffs.length || checksumDiffs.length) {
        const errors = [];

        if (diffs.length) {
          errors.push(`Count mismatches: ${diffs.join('; ')}`);
        }

        if (checksumDiffs.length) {
          errors.push(`Checksum mismatches: ${checksumDiffs.join('; ')}`);
        }

        throw new Error(`Verification failed. ${errors.join('. ')}`);
      }

      console.log(`Target PostgreSQL dataset checksum: ${targetDatasetChecksumBefore}`);
      console.log('Verification passed. SQLite and PostgreSQL counts match.');
      return;
    }

    if (nonEmptyTargetTables.length && !options.forceResetTarget) {
      throw new Error(
        `Target PostgreSQL database is not empty. Re-run with --force-reset-target to continue. Affected tables: ${nonEmptyTargetTables.join(', ')}`
      );
    }

    await target.$transaction(async (tx) => {
      if (nonEmptyTargetTables.length) {
        await resetTarget(tx);
      }

      await insertRows(tx, sourceRows);
    });

    const targetCountsAfter = await loadCounts(target);
    const { checksums: targetChecksumsAfter } = await loadChecksums(target);
    const targetDatasetChecksumAfter = createDatasetChecksum(targetChecksumsAfter);
    const diffs = diffCounts(sourceCounts, targetCountsAfter);
    const checksumDiffs = diffChecksums(sourceChecksums, targetChecksumsAfter);

    if (diffs.length || checksumDiffs.length) {
      const errors = [];

      if (diffs.length) {
        errors.push(`Count mismatches: ${diffs.join('; ')}`);
      }

      if (checksumDiffs.length) {
        errors.push(`Checksum mismatches: ${checksumDiffs.join('; ')}`);
      }

      throw new Error(`Post-migration verification failed. ${errors.join('. ')}`);
    }

    console.log(`PostgreSQL counts after migration: ${summarizeCounts(targetCountsAfter)}`);
    console.log(`PostgreSQL table checksums: ${summarizeChecksums(targetChecksumsAfter)}`);
    console.log(`PostgreSQL dataset checksum: ${targetDatasetChecksumAfter}`);
    console.log('SQLite -> PostgreSQL migration completed successfully.');
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
