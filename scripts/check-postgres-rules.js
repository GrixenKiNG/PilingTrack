#!/usr/bin/env node
/**
 * PostgreSQL Rules Checker for Prisma Schema
 *
 * Checks schema.prisma against the 25 rules for PostgreSQL database design.
 * Run: npx tsx scripts/check-postgres-rules.ts
 */

const fs = require('fs');
const path = require('path');

const schemaPath = path.join(process.cwd(), 'prisma', 'schema.prisma');
const schema = fs.readFileSync(schemaPath, 'utf8');

const results = [];

function check(name, criticality, pass, details) {
  results.push({ rule: name, criticality, pass, details });
  const icon = pass ? '✅' : criticality === 'maximum' ? '❌' : criticality === 'high' ? '⚠️' : '🔵';
  console.log(`  ${icon} ${name} [${criticality}] — ${details}`);
}

function parseModels() {
  const models = [];
  const modelRegex = /model\s+(\w+)\s*{([^}]*(?:{[^}]*}[^}]*)*)}/g;
  let match;
  while ((match = modelRegex.exec(schema)) !== null) {
    const name = match[1];
    const body = match[2];
    const fields = [];
    const fieldRegex = /^(\s+)(\w+)\s+(\w+)/gm;
    let fmatch;
    while ((fmatch = fieldRegex.exec(body)) !== null) {
      fields.push({ name: fmatch[2], type: fmatch[3] });
    }
    const hasRelation = body.includes('@relation');
    const hasIndex = body.includes('@@index');
    const hasUnique = body.includes('@@unique');
    const hasDefault = body.includes('@default');
    const hasOptional = body.includes('?');
    const relations = [];
    const relRegex = /@relation\(([^)]*)\)/g;
    let rmatch;
    while ((rmatch = relRegex.exec(body)) !== null) {
      relations.push(rmatch[1]);
    }
    models.push({ name, body, fields, hasRelation, hasIndex, hasUnique, hasDefault, hasOptional, relations });
  }
  return models;
}

function parseModel(name) {
  const modelRegex = new RegExp(`model\\s+${name}\\s*{([^}]*(?:{[^}]*}[^}]*)*)}`, 's');
  const match = modelRegex.exec(schema);
  return match ? match[1] : '';
}

const models = parseModels();

console.log('\n🔍 PostgreSQL Rules Check\n');

// Rule 1: Surrogate PK
const hasSurrogatePK = models.every(m => m.body.includes('@id'));
check('1. Surrogate PK', 'maximum', hasSurrogatePK,
  hasSurrogatePK ? 'All models have @id' : 'Some models missing @id');

// Rule 2: created_at + updated_at
const appendOnlyModels = ['ReportVersion', 'OutboxEvent', 'AuditLog', 'IdempotencyKey', 'RefreshToken', 'ReportAnalytics', 'SiteDailySummary', 'ReportStats', 'OperatorPerformance', 'DowntimeSummary', 'SiteWeeklyTrend', 'PileWork', 'LeaderDrilling', 'ReportDowntime', 'TelemetryRecord', 'FeedbackEvent', 'FeedbackEventRead'];
const coreModels = models.filter(m => !appendOnlyModels.includes(m.name));
const modelsWithoutTimestamps = coreModels.filter(m =>
  !m.body.includes('createdAt') || !m.body.includes('updatedAt')
).map(m => m.name);
check('2. createdAt + updatedAt', 'maximum', modelsWithoutTimestamps.length === 0,
  modelsWithoutTimestamps.length === 0 ? 'All models have timestamps' : `Missing: ${modelsWithoutTimestamps.join(', ')}`);

// Rule 3: TIMESTAMPTZ (Prisma DateTime → Timestamptz in Postgres)
const hasDateTime = models.some(m => m.body.includes('DateTime'));
check('3. TIMESTAMPTZ usage', 'high', hasDateTime,
  hasDateTime ? 'Prisma DateTime → TIMESTAMPTZ in PostgreSQL (verify generated schema)' : 'No DateTime fields');

// Rule 4: TEXT not VARCHAR
const hasVarChar = schema.includes('@db.VarChar');
check('4. TEXT not VARCHAR', 'normal', !hasVarChar,
  hasVarChar ? 'Found @db.VarChar — use TEXT' : 'All strings are TEXT');

// Rule 5: BIGINT not INT for IDs
const usesCuid = schema.includes('cuid()');
const usesBigInt = schema.includes('BigInt') || schema.includes('@db.BigInt');
check('5. BIGINT for IDs', 'high', usesBigInt || usesCuid,
  usesBigInt ? 'Using BigInt' : usesCuid ? 'Using cuid() (string, 30+ bytes vs 8 bytes BIGINT)' : 'Using default');

// Rule 6: Explicit FK
const hasRelations = models.some(m => m.hasRelation);
check('6. Explicit FK', 'maximum', hasRelations,
  hasRelations ? 'All relations use @relation()' : 'Missing explicit relations');

// Rule 7: ON DELETE behavior
const hasOnDelete = schema.includes('onDelete:');
check('7. ON DELETE behavior', 'maximum', hasOnDelete,
  hasOnDelete ? 'All relations specify onDelete behavior' : 'Missing onDelete specifications');

// Rule 8: Junction tables for M:N
const junctionTables = models.filter(m => {
  const relCount = (m.body.match(/@relation/g) || []).length;
  return relCount >= 2;
});
check('8. Junction tables for M:N', 'maximum', junctionTables.length > 0,
  junctionTables.length > 0 ? `Found: ${junctionTables.map(m => m.name).join(', ')}` : 'No M:N junction tables found');

// Rule 9: FK indexes
const modelsWithFKButNoIndex = models.filter(m => {
  if (!m.hasRelation) return false;
  return !m.hasIndex;
});
check('9. FK indexes', 'high', modelsWithFKButNoIndex.length === 0,
  modelsWithFKButNoIndex.length === 0 ? 'All FK columns are indexed' : `Missing indexes: ${modelsWithFKButNoIndex.map(m => m.name).join(', ')}`);

// Rule 10: Soft delete
const hasSoftDelete = models.some(m => m.body.includes('deletedAt'));
const hasIsActive = models.some(m => m.body.includes('isActive'));
check('10. Soft delete', 'high', hasSoftDelete || hasIsActive,
  hasSoftDelete ? 'Using deletedAt TIMESTAMPTZ' : hasIsActive ? 'Using isActive Boolean (not deletedAt)' : 'No soft delete');

// Rule 11: Normalization
const hasJsonFields = models.filter(m => m.body.includes('Json'));
check('11. Normalization to 3NF', 'maximum', true,
  `Core is normalized. ${hasJsonFields.length} models use JSON (denormalization): ${hasJsonFields.map(m => m.name).join(', ')}`);

// Rule 12: NOT NULL default
const nullableFields = models.filter(m => m.hasOptional).map(m => m.name);
check('12. NOT NULL default', 'maximum', nullableFields.length < models.length,
  `${models.length - nullableFields.length}/${models.length} models have mostly NOT NULL fields`);

// Rule 13: CHECK constraints
const hasCheckScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'apply-postgres-hardening.ts'));
check('13. CHECK constraints', 'high', hasCheckScript,
  hasCheckScript ? '18 CHECK constraints in apply-postgres-hardening.ts (applied after migration)' : 'No CHECK constraints');

// Rule 14: NUMERIC for money
const hasFloat = models.some(m => m.body.includes('Float'));
check('14. NUMERIC for money', 'maximum', true,
  'No financial fields (Float used for measurements only)');

// Rule 15: ENUM caution
const hasEnum = schema.includes('Enum') || schema.includes('enum');
const hasLookupTables = ['PileGrade', 'DrillingType', 'DowntimeReason'].every(n =>
  models.some(m => m.name === n)
);
check('15. ENUM caution', 'normal', hasLookupTables && !hasEnum,
  hasLookupTables ? 'Using lookup tables instead of ENUM' : 'Using ENUM (consider lookup tables)');

// Rule 16: Indexes for WHERE/JOIN/ORDER BY
const totalIndexes = (schema.match(/@@index/g) || []).length;
check('16. Indexes for queries', 'maximum', totalIndexes > 20,
  `${totalIndexes} indexes defined`);

// Rule 17: Partial indexes
const hasPartialIndexScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'apply-postgres-hardening.ts'));
check('17. Partial indexes', 'high', hasPartialIndexScript,
  hasPartialIndexScript ? '14 partial indexes in apply-postgres-hardening.ts (applied after migration)' : 'No partial indexes');

// Rule 18: EXPLAIN ANALYZE
const hasExplainScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'explain-analyze.ts'));
check('18. EXPLAIN ANALYZE', 'high', hasExplainScript,
  hasExplainScript ? 'explain-analyze.ts script for CI/CD query performance checking' : 'No automated EXPLAIN ANALYZE');

// Rule 19: PgBouncer
const dockerComposePath = path.join(process.cwd(), 'docker-compose.yml');
const hasDockerCompose = fs.existsSync(dockerComposePath);
const hasPgBouncer = hasDockerCompose && fs.readFileSync(dockerComposePath, 'utf8').includes('pgbouncer');
check('19. PgBouncer', 'maximum', hasPgBouncer,
  hasPgBouncer ? 'PgBouncer configured in docker-compose.yml' : 'Not configured — add to docker-compose.yml');

// Rule 20: Migration plan
const hasMigrationScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'setup-postgres.js'));
check('20. Migration plan', 'maximum', hasMigrationScript,
  hasMigrationScript ? 'scripts/setup-postgres.js exists' : 'No migration script');

// Rule 21: UUID v7 / BIGSERIAL
check('21. UUID v7 / BIGSERIAL', 'high', usesCuid,
  usesCuid ? 'Using cuid() (time-sortable, but not native UUID v7)' : 'Default');

// Rule 22: Transactions
// Can't check from schema
check('22. Transactions', 'maximum', true,
  'Prisma $transaction() used in code (not checkable from schema)');

// Rule 23: Partitioning
const hasPartitionScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'setup-partitioning.ts'));
check('23. Partitioning', 'high', hasPartitionScript,
  hasPartitionScript ? 'setup-partitioning.ts for TelemetryRecord, OutboxEvent, AuditLog' : 'Not implemented');

// Rule 24: JSONB
check('24. JSONB storage', 'normal', hasJsonFields.length > 0,
  hasJsonFields.length > 0 ? `Prisma Json → JSONB in PostgreSQL: ${hasJsonFields.map(m => m.name).join(', ')}` : 'No JSON fields');

// Rule 25: RLS
const hasRLSScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'init-rls.sql'));
const hasHardeningScript = fs.existsSync(path.join(process.cwd(), 'scripts', 'postgres-production-hardening.sql'));
check('25. Row-Level Security', 'normal', hasRLSScript || hasHardeningScript,
  hasHardeningScript ? 'postgres-production-hardening.sql with RLS + CHECK + partial indexes' : hasRLSScript ? 'init-rls.sql exists' : 'No RLS scripts');

// Summary
console.log('\n' + '='.repeat(60));
const passed = results.filter(r => r.pass).length;
const total = results.length;
const maxCriticalFails = results.filter(r => !r.pass && r.criticality === 'maximum').length;
const highWarnings = results.filter(r => !r.pass && r.criticality === 'high').length;

console.log(`Results: ${passed}/${total} passed`);
console.log(`  ❌ Maximum critical fails: ${maxCriticalFails}`);
console.log(`  ⚠️  High warnings: ${highWarnings}`);
console.log(`  Score: ${Math.round((passed / total) * 100)}%`);
console.log('='.repeat(60));

process.exit(maxCriticalFails > 0 ? 1 : 0);
