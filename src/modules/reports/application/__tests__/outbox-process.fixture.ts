import { db } from '@/lib/db';
import { publishOutboxEvents } from '../outbox-publisher';

const owner = new URL(process.env.INTEGRATION_DATABASE_URL_OWNER || 'http://invalid');
if (owner.hostname !== '127.0.0.1' || owner.pathname !== '/codex_test' || !/^codex-pg-[a-f0-9]{12}$/.test(process.env.INTEGRATION_DB_CONTAINER || '')) throw new Error('Owned disposable database required');
const aggregateId = process.env.NIGHT_OUTBOX_AGGREGATE_ID;
const tenantId = process.env.NIGHT_OUTBOX_TENANT_ID;
if (!aggregateId || !tenantId) throw new Error('Fixture event required');

async function main() {
  const processed = await publishOutboxEvents(async event => {
    if (event.aggregateId !== aggregateId) throw new Error('Unexpected fixture event');
    if (process.env.NIGHT_OUTBOX_MODE === 'fail') throw new Error('Injected publication failure');
    await db.auditLog.upsert({
      where: { id: aggregateId + '-restart-marker' },
      create: { id: aggregateId + '-restart-marker', tenantId, entity: 'Report', entityId: aggregateId, action: 'night.outbox.marker' },
      update: { action: 'night.outbox.marker' },
    });
    // Abrupt death after a committed side effect, before the outbox claim.
    if (process.env.NIGHT_OUTBOX_MODE === 'crash') process.exit(23);
  }, 'NightOutboxFault');
  await db.$disconnect();
  process.stdout.write(JSON.stringify({ processed }) + '\n');
}
main().then(() => process.exit(0), error => {
  let message = error instanceof Error ? error.message : String(error);
  for (const [key, value] of Object.entries(process.env)) if (/PASSWORD|SECRET|DATABASE_URL/.test(key) && value) message = message.split(value).join('[redacted]');
  process.stderr.write(message + '\n');
  process.exit(1);
});
