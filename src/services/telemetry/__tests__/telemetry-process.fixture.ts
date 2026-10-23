// Real process boundary for telemetry-reliability.integration.ts; no DB mocks.
import { TelemetryBuffer } from '../telemetry-buffer';
import { ingestTelemetry, telemetryBuffer } from '@/modules/telemetry';
import type { TelemetryRecord } from '../telemetry-ingestion-service';
import { db } from '@/lib/db';

type Command = { id: number; action: string; records?: TelemetryRecord[] };
let buffer = telemetryBuffer;
process.on('message', async (command: Command) => {
  try {
    const ids: string[] = [];
    if (command.action === 'overflow') {
      buffer = new TelemetryBuffer({ maxBufferSize: 4, maxBatchSize: 2, flushIntervalMs: 60_000 });
      // Deliberately open the real breaker; this is fault injection, not a DB outage.
      for (let i = 0; i < 5; i++) {
        await buffer.getCircuitBreaker().execute(async () => { throw new Error('injected outage'); }).catch(() => undefined);
      }
    }
    for (const record of command.records ?? []) {
      const hydrated = { ...record, timestamp: record.timestamp ? new Date(record.timestamp) : undefined };
      if (buffer === telemetryBuffer) ids.push(await ingestTelemetry(hydrated));
      else await buffer.ingest(hydrated);
    }
    if (command.action === 'flush') {
      buffer.getCircuitBreaker().reset();
      await buffer.flush();
    }
    if (command.action === 'shutdown') {
      await buffer.shutdown();
      await db.$disconnect();
    }
    process.send?.({ id: command.id, pid: process.pid, ids, stats: buffer.getStats() });
  } catch (error) {
    process.send?.({ id: command.id, error: error instanceof Error ? error.message : String(error) });
  }
});
process.send?.({ ready: true, pid: process.pid });
