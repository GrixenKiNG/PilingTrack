import { PrismaClient } from '../src/generated/postgres-client';

const db = new PrismaClient();

async function main() {
  console.log('=== DATABASE STATE ===\n');
  
  const tables = [
    'tenant', 'user', 'site', 'pileField', 'cluster', 'picket',
    'equipment', 'crew', 'pileGrade', 'drillingType', 'downtimeReason',
    'report', 'pileWork', 'leaderDrilling', 'reportDowntime',
    'reportVersion', 'reportAudit', 'auditLog',
    'outboxEvent', 'deviceSyncState', 'idempotencyKey',
    'reportAnalytics', 'siteDailySummary', 'operatorPerformance',
    'telemetryRecord', 'media', 'feedbackEvent',
    'tenantInvoice', 'siteUser', 'crewAssistant', 'crewEquipment'
  ];
  
  for (const table of tables) {
    try {
      const count = await (db as any)[table].count();
      console.log(`  ${table}: ${count}`);
    } catch {
      // table doesn't exist
    }
  }
}

main().then(() => db.$disconnect()).catch(console.error);
