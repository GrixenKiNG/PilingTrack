/**
 * Telemetry simulator — emits realistic data for N pieces of equipment.
 *
 * Two phases:
 *   1. Provision:  create Equipment rows + DeviceKeys, save plaintext keys
 *                  to scripts/.telemetry-simulator-keys.json (gitignored).
 *   2. Run:        loop, push telemetry through /api/telemetry/ingest using
 *                  the X-Device-Key header — exactly like a real IoT device.
 *
 * Usage:
 *   # one-time setup
 *   npx tsx scripts/telemetry-simulator.ts provision --count=5 --site=<siteId>
 *
 *   # streaming
 *   npx tsx scripts/telemetry-simulator.ts run --interval=2000 \
 *     --base-url=http://localhost:3000 --center=55.751244,37.618423
 *
 * Why a script, not a service: lets us shape any traffic pattern (burst,
 * slow drift, dropouts) without recompiling the app, and keeps the
 * production code clean of test-only generators.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

interface SimulatedDevice {
  equipmentId: string;
  equipmentName: string;
  siteId: string | null;
  deviceKey: string; // plaintext, only known to the simulator
  // Live state, updated each tick:
  lat: number;
  lng: number;
  heading: number; // degrees, where the rig is currently "moving"
  pressureBar: number;
  vibrationG: number;
  pilesDriven: number;
  status: 'working' | 'idle' | 'moving';
}

interface KeysFile {
  siteId: string | null;
  center: { lat: number; lng: number };
  devices: Array<{
    equipmentId: string;
    equipmentName: string;
    siteId: string | null;
    deviceKey: string;
  }>;
}

const KEYS_PATH = join(__dirname, '.telemetry-simulator-keys.json');

// --------------------------------------------------------------------------
// CLI parsing
// --------------------------------------------------------------------------

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  const found = process.argv.find((a) => a.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`) || process.argv.includes(name);
}

// --------------------------------------------------------------------------
// Provisioning (talks to the DB directly)
// --------------------------------------------------------------------------

async function provision() {
  const count = parseInt(arg('count', '5') ?? '5', 10);
  const siteId = arg('site') ?? null;
  const centerRaw = arg('center', '55.751244,37.618423')!;
  const [latS, lngS] = centerRaw.split(',');
  const center = { lat: parseFloat(latS), lng: parseFloat(lngS) };
  const equipmentPrefix = arg('equipment-prefix', 'Sim') ?? 'Sim';

  const { db } = await import('@/lib/db');
  const { provisionDeviceKey } = await import('@/services/telemetry/device-key-service');

  console.log(`Provisioning ${count} simulated devices (siteId=${siteId ?? 'none'})...`);

  const devices: KeysFile['devices'] = [];
  for (let i = 1; i <= count; i++) {
    const equipmentName = `${equipmentPrefix}-${String(i).padStart(2, '0')}`;
    const equipment = await db.equipment.create({
      data: {
        name: equipmentName,
        model: 'Simulator',
        description: 'Auto-provisioned by telemetry-simulator',
      },
    });

    const minted = await provisionDeviceKey({
      name: `Simulator key for ${equipmentName}`,
      equipmentId: equipment.id,
      siteId,
    });

    devices.push({
      equipmentId: equipment.id,
      equipmentName,
      siteId,
      deviceKey: minted.key,
    });
    console.log(`  ✓ ${equipmentName}  →  ${equipment.id}  (key ${minted.key.slice(0, 12)}…)`);
  }

  const payload: KeysFile = { siteId, center, devices };
  writeFileSync(KEYS_PATH, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\nKeys file: ${KEYS_PATH}\nNow run:  npx tsx scripts/telemetry-simulator.ts run`);

  await db.$disconnect();
}

// --------------------------------------------------------------------------
// Run loop (HTTP only — no DB import)
// --------------------------------------------------------------------------

function loadKeys(): KeysFile {
  if (!existsSync(KEYS_PATH)) {
    throw new Error(`No keys file at ${KEYS_PATH}. Run 'provision' first.`);
  }
  return JSON.parse(readFileSync(KEYS_PATH, 'utf8'));
}

function initState(d: KeysFile['devices'][number], center: { lat: number; lng: number }): SimulatedDevice {
  return {
    ...d,
    lat: center.lat + (Math.random() - 0.5) * 0.002, // ~200 m
    lng: center.lng + (Math.random() - 0.5) * 0.002,
    heading: Math.random() * 360,
    pressureBar: 140 + Math.random() * 20,
    vibrationG: 0.8 + Math.random() * 0.4,
    pilesDriven: 0,
    status: 'idle',
  };
}

/** Mutate the device for the next tick (random walk + occasional state change). */
function stepDevice(d: SimulatedDevice) {
  // 5% chance to flip state
  if (Math.random() < 0.05) {
    d.status = (['working', 'idle', 'moving'] as const)[Math.floor(Math.random() * 3)];
  }

  if (d.status === 'moving') {
    // Drift heading a bit, then walk ~1-3 m
    d.heading = (d.heading + (Math.random() - 0.5) * 30 + 360) % 360;
    const stepM = 1 + Math.random() * 2;
    const dLat = (Math.cos((d.heading * Math.PI) / 180) * stepM) / 111_111;
    const dLng = (Math.sin((d.heading * Math.PI) / 180) * stepM) / (111_111 * Math.cos((d.lat * Math.PI) / 180));
    d.lat += dLat;
    d.lng += dLng;
    d.pressureBar = 100 + Math.random() * 10;
    d.vibrationG = 0.3 + Math.random() * 0.4;
  } else if (d.status === 'working') {
    d.pressureBar = 160 + Math.random() * 40 + (Math.random() < 0.02 ? 30 : 0); // occasional spike
    d.vibrationG = 1.5 + Math.random() * 1.5 + (Math.random() < 0.02 ? 1 : 0);
    if (Math.random() < 0.15) d.pilesDriven++;
  } else {
    d.pressureBar = 90 + Math.random() * 10;
    d.vibrationG = 0.1 + Math.random() * 0.2;
  }
}

interface TelemetryEvent {
  type: string;
  value: number;
  unit?: string;
  latitude?: number;
  longitude?: number;
  metadata?: Record<string, unknown>;
  timestamp: string;
}

function buildBatch(d: SimulatedDevice): TelemetryEvent[] {
  const now = new Date().toISOString();
  const events: TelemetryEvent[] = [
    {
      type: 'equipment_gps',
      value: 1,
      latitude: d.lat,
      longitude: d.lng,
      timestamp: now,
      metadata: { status: d.status, heading: Math.round(d.heading) },
    },
    { type: 'pressure', value: +d.pressureBar.toFixed(1), unit: 'bar', timestamp: now },
    { type: 'vibration', value: +d.vibrationG.toFixed(2), unit: 'g', timestamp: now },
  ];

  // pile_strike: emit only when status flips to a new pile (working state, occasional)
  if (d.status === 'working' && Math.random() < 0.1) {
    events.push({
      type: 'pile_strike',
      value: 1,
      unit: 'count',
      timestamp: now,
      metadata: { totalSoFar: d.pilesDriven },
    });
  }

  return events;
}

async function pushOne(baseUrl: string, d: SimulatedDevice): Promise<{ accepted: number } | null> {
  const batch = buildBatch(d);
  try {
    const res = await fetch(`${baseUrl}/api/telemetry/ingest`, {
      method: 'PATCH', // batch endpoint
      headers: {
        'Content-Type': 'application/json',
        'X-Device-Key': d.deviceKey,
      },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`  ✗ ${d.equipmentName}: HTTP ${res.status} — ${text.slice(0, 120)}`);
      return null;
    }
    return (await res.json()) as { accepted: number };
  } catch (err) {
    console.warn(`  ✗ ${d.equipmentName}: ${(err as Error).message}`);
    return null;
  }
}

async function run() {
  const keys = loadKeys();
  const baseUrl = arg('base-url', 'http://localhost:3000')!.replace(/\/$/, '');
  const interval = parseInt(arg('interval', '2000') ?? '2000', 10);
  const limit = arg('limit'); // optional: stop after N ticks
  const maxTicks = limit ? parseInt(limit, 10) : Infinity;

  const devices = keys.devices.map((d) => initState(d, keys.center));
  console.log(`Simulating ${devices.length} devices → ${baseUrl}  every ${interval} ms`);
  console.log(`Site: ${keys.siteId ?? 'none'}   center: ${keys.center.lat}, ${keys.center.lng}`);
  console.log('Ctrl+C to stop.\n');

  let tick = 0;
  const start = Date.now();
  let totalAccepted = 0;

  // graceful shutdown
  let stopped = false;
  process.on('SIGINT', () => {
    console.log('\nStopping...');
    stopped = true;
  });

  while (!stopped && tick < maxTicks) {
    tick++;
    const tickStart = Date.now();

    for (const d of devices) stepDevice(d);
    const results = await Promise.all(devices.map((d) => pushOne(baseUrl, d)));
    const accepted = results.reduce((acc, r) => acc + (r?.accepted ?? 0), 0);
    totalAccepted += accepted;

    if (tick % 5 === 0 || tick === 1) {
      const rate = totalAccepted / Math.max(1, (Date.now() - start) / 1000);
      console.log(
        `tick=${tick}  pushed=${accepted}/${devices.length * 3}  total=${totalAccepted}  rate=${rate.toFixed(1)}/s`
      );
    }

    const elapsed = Date.now() - tickStart;
    const wait = Math.max(0, interval - elapsed);
    await new Promise((r) => setTimeout(r, wait));
  }

  console.log(`\nFinished. ${tick} ticks, ${totalAccepted} events accepted.`);
}

// --------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------

async function main() {
  const cmd = process.argv[2];
  if (cmd === 'provision') return provision();
  if (cmd === 'run') return run();

  console.log(`Usage:
  npx tsx scripts/telemetry-simulator.ts provision --count=5 [--site=<id>] [--center=lat,lng]
  npx tsx scripts/telemetry-simulator.ts run [--base-url=http://localhost:3000] [--interval=2000] [--limit=N]`);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
