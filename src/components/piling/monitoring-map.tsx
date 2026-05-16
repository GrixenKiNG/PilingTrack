'use client';

/**
 * MonitoringMap — live map of equipment positions for the active tenant.
 *
 * Data flow:
 *   1. on mount, fetch equipment list + the last hour of telemetry.
 *   2. open the WS connection (existing `wss://.../ws` endpoint).
 *   3. on each `type=telemetry` packet, mutate the in-memory state and
 *      move the corresponding marker via setLatLng — no React re-render
 *      for the map itself (the marker layer is owned by Leaflet).
 *
 * Leaflet is imported only inside useEffect: it touches `window` at
 * module load, so it must not be evaluated during SSR. The page that
 * mounts this component uses `dynamic({ ssr: false })` for the same
 * reason.
 */

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, Marker, CircleMarker } from 'leaflet';

const DEFAULT_CENTER: [number, number] = [55.751244, 37.618423]; // Moscow fallback
const DEFAULT_ZOOM = 14;
const OFFLINE_AFTER_MS = 60_000;

type EquipmentStatus = 'working' | 'idle' | 'moving' | 'offline';

interface Equipment {
  id: string;
  name: string;
}

interface EquipmentState extends Equipment {
  lat: number | null;
  lng: number | null;
  status: EquipmentStatus;
  pressureBar: number | null;
  vibrationG: number | null;
  lastSeen: number; // epoch ms
  marker: Marker | null;
  haloMarker: CircleMarker | null;
}

interface TelemetryWireRecord {
  type: string;
  value: number;
  unit?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  metadata?: Record<string, unknown> | null;
  timestamp: string | number;
}

const STATUS_COLOR: Record<EquipmentStatus, string> = {
  working: '#16a34a', // green-600
  idle: '#9ca3af', // gray-400
  moving: '#2563eb', // blue-600
  offline: '#dc2626', // red-600
};

export function MonitoringMap() {
  const mapElRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const stateRef = useRef<Map<string, EquipmentState>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const offlineTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [selected, setSelected] = useState<EquipmentState | null>(null);
  const [tick, setTick] = useState(0); // forces side-panel re-render on telemetry
  const [connectionState, setConnectionState] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');

  // ------------------------------------------------------------------
  // Mount: load Leaflet, fetch initial data, open WS
  // ------------------------------------------------------------------
  useEffect(() => {
    let disposed = false;
    const cleanups: Array<() => void> = [];

    (async () => {
      const L = (await import('leaflet')).default;
      await import('leaflet/dist/leaflet.css');
      if (disposed || !mapElRef.current) return;

      const map = L.map(mapElRef.current, {
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        zoomControl: true,
      });

      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap',
      }).addTo(map);

      mapRef.current = map;
      cleanups.push(() => map.remove());

      // ----- Initial data -----
      try {
        const eqRes = await fetch('/api/equipment?limit=100', { credentials: 'include' });
        const eqData = await eqRes.json();
        const equipment: Equipment[] = eqData?.data ?? [];
        for (const e of equipment) {
          stateRef.current.set(e.id, {
            id: e.id,
            name: e.name,
            lat: null,
            lng: null,
            status: 'offline',
            pressureBar: null,
            vibrationG: null,
            lastSeen: 0,
            marker: null,
            haloMarker: null,
          });
        }
      } catch (err) {
        console.warn('monitoring: equipment fetch failed', err);
      }

      try {
        const from = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const to = new Date().toISOString();
        const tRes = await fetch(
          `/api/telemetry?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&limit=2000`,
          { credentials: 'include' }
        );
        const tData = await tRes.json();
        const records: Array<{ equipmentId: string; type: string; value: number; latitude: number | null; longitude: number | null; timestamp: string; metadata: Record<string, unknown> | null }> = tData?.records ?? [];
        // Records come newest-first usually; replay in chronological order
        // so the *latest* value wins.
        for (const r of [...records].reverse()) {
          applyRecord(stateRef.current, r.equipmentId, {
            type: r.type,
            value: r.value,
            latitude: r.latitude,
            longitude: r.longitude,
            metadata: r.metadata,
            timestamp: r.timestamp,
          });
        }
        // Materialize markers for everything we already know a position for
        for (const eq of stateRef.current.values()) {
          ensureMarker(L, map, eq, () => setSelected(eq));
        }
        if (mapBoundsAreUseful(stateRef.current)) {
          fitToMarkers(L, map, stateRef.current);
        }
      } catch (err) {
        console.warn('monitoring: telemetry fetch failed', err);
      }

      // ----- WebSocket -----
      const wsUrl = process.env.NEXT_PUBLIC_WS_URL || `ws://${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      cleanups.push(() => ws.close());

      ws.addEventListener('open', () => setConnectionState('connected'));
      ws.addEventListener('close', () => setConnectionState('disconnected'));
      ws.addEventListener('error', () => setConnectionState('disconnected'));

      ws.addEventListener('message', (ev) => {
        let msg: any;
        try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : ''); } catch { return; }
        // WS server wraps server events in { type: 'event', event: {...} }.
        // Telemetry uses the lighter envelope { type: 'telemetry', ... } that
        // ws-server.ts emits from CHANNEL_TELEMETRY.
        const inner = msg?.type === 'telemetry' ? msg : msg?.event?.type === 'telemetry' ? msg.event : null;
        if (!inner) return;

        const equipmentId: string = inner.equipmentId;
        if (!equipmentId) return;
        let eq = stateRef.current.get(equipmentId);
        if (!eq) {
          eq = {
            id: equipmentId,
            name: equipmentId.slice(0, 8),
            lat: null, lng: null, status: 'offline',
            pressureBar: null, vibrationG: null, lastSeen: 0,
            marker: null, haloMarker: null,
          };
          stateRef.current.set(equipmentId, eq);
        }

        for (const rec of (inner.records as TelemetryWireRecord[]) ?? []) {
          applyRecord(stateRef.current, equipmentId, rec);
        }

        // sync marker
        if (eq.lat != null && eq.lng != null) {
          ensureMarker(L, map, eq, () => setSelected(eq!));
          eq.marker!.setLatLng([eq.lat, eq.lng]);
          eq.haloMarker!.setLatLng([eq.lat, eq.lng]);
          eq.haloMarker!.setStyle({ color: STATUS_COLOR[eq.status], fillColor: STATUS_COLOR[eq.status] });
        }

        if (selected?.id === equipmentId) setTick((n) => n + 1);
      });
    })();

    // Offline transition: any device unseen for >60s becomes red.
    offlineTimerRef.current = setInterval(() => {
      const now = Date.now();
      let changed = false;
      for (const eq of stateRef.current.values()) {
        if (eq.lastSeen > 0 && now - eq.lastSeen > OFFLINE_AFTER_MS && eq.status !== 'offline') {
          eq.status = 'offline';
          if (eq.haloMarker) eq.haloMarker.setStyle({ color: STATUS_COLOR.offline, fillColor: STATUS_COLOR.offline });
          changed = true;
        }
      }
      if (changed) setTick((n) => n + 1);
    }, 15_000);
    cleanups.push(() => offlineTimerRef.current && clearInterval(offlineTimerRef.current));

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = computeTotals(stateRef.current);

  return (
    <div className="relative h-[calc(100vh-4rem)] w-full">
      {/* Map fills the viewport below the app header */}
      <div ref={mapElRef} className="absolute inset-0 z-0" />

      {/* Status bar */}
      <div className="absolute left-3 top-3 z-10 flex flex-wrap items-center gap-2 rounded-lg border bg-background/95 px-3 py-2 shadow-sm backdrop-blur">
        <Dot color={STATUS_COLOR.working} /><span className="text-xs">Работа: <b>{totals.working}</b></span>
        <Dot color={STATUS_COLOR.moving} /><span className="text-xs">В движении: <b>{totals.moving}</b></span>
        <Dot color={STATUS_COLOR.idle} /><span className="text-xs">Простой: <b>{totals.idle}</b></span>
        <Dot color={STATUS_COLOR.offline} /><span className="text-xs">Нет связи: <b>{totals.offline}</b></span>
        <span className={`ml-2 rounded px-2 py-0.5 text-[10px] uppercase tracking-wide ${
          connectionState === 'connected' ? 'bg-emerald-100 text-emerald-700' :
          connectionState === 'connecting' ? 'bg-amber-100 text-amber-700' :
          'bg-rose-100 text-rose-700'
        }`}>
          {connectionState === 'connected' ? 'live' : connectionState === 'connecting' ? '…' : 'offline'}
        </span>
      </div>

      {/* Side panel */}
      {selected && (
        <aside className="absolute right-3 top-3 z-10 w-72 rounded-xl border bg-background p-4 shadow-lg">
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="text-base font-semibold">{selected.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{statusLabel(selected.status)}</div>
            </div>
            <button onClick={() => setSelected(null)} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Закрыть">✕</button>
          </div>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Давление" value={selected.pressureBar != null ? `${selected.pressureBar.toFixed(1)} бар` : '—'} />
            <Row label="Вибрация" value={selected.vibrationG != null ? `${selected.vibrationG.toFixed(2)} g` : '—'} />
            <Row label="GPS" value={selected.lat != null ? `${selected.lat.toFixed(5)}, ${selected.lng!.toFixed(5)}` : '—'} />
            <Row label="Обновлено" value={selected.lastSeen ? new Date(selected.lastSeen).toLocaleTimeString('ru-RU') : '—'} />
          </dl>
          {/* tick is referenced just to silence the unused-var lint; the
              actual re-render is what we wanted. */}
          <span className="hidden" data-tick={tick} />
        </aside>
      )}
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers (pure, no React)
// --------------------------------------------------------------------------

function applyRecord(map: Map<string, EquipmentState>, equipmentId: string, r: TelemetryWireRecord) {
  const eq = map.get(equipmentId);
  if (!eq) return;
  const ts = typeof r.timestamp === 'string' ? new Date(r.timestamp).getTime() : r.timestamp;
  if (Number.isFinite(ts)) eq.lastSeen = Math.max(eq.lastSeen, ts);

  switch (r.type) {
    case 'equipment_gps':
      if (r.latitude != null && r.longitude != null) {
        eq.lat = r.latitude; eq.lng = r.longitude;
      }
      if (r.metadata?.status && typeof r.metadata.status === 'string') {
        const s = r.metadata.status as EquipmentStatus;
        if (s === 'working' || s === 'idle' || s === 'moving') eq.status = s;
      }
      break;
    case 'pressure':
      eq.pressureBar = r.value;
      break;
    case 'vibration':
      eq.vibrationG = r.value;
      break;
  }
}

function ensureMarker(
  L: typeof import('leaflet'),
  map: LeafletMap,
  eq: EquipmentState,
  onClick: () => void
) {
  if (eq.marker) return;
  if (eq.lat == null || eq.lng == null) return;
  const color = STATUS_COLOR[eq.status];
  eq.haloMarker = L.circleMarker([eq.lat, eq.lng], {
    radius: 14, color, fillColor: color, fillOpacity: 0.15, weight: 2,
  }).addTo(map);
  eq.marker = L.marker([eq.lat, eq.lng], {
    title: eq.name,
    riseOnHover: true,
  }).addTo(map);
  eq.marker.bindTooltip(eq.name, { permanent: false, direction: 'top' });
  eq.marker.on('click', onClick);
  eq.haloMarker.on('click', onClick);
}

function computeTotals(map: Map<string, EquipmentState>) {
  const t = { working: 0, idle: 0, moving: 0, offline: 0 };
  for (const eq of map.values()) t[eq.status]++;
  return t;
}

function mapBoundsAreUseful(map: Map<string, EquipmentState>): boolean {
  let n = 0;
  for (const eq of map.values()) if (eq.lat != null && eq.lng != null) n++;
  return n >= 1;
}

function fitToMarkers(L: typeof import('leaflet'), map: LeafletMap, state: Map<string, EquipmentState>) {
  const pts: [number, number][] = [];
  for (const eq of state.values()) if (eq.lat != null && eq.lng != null) pts.push([eq.lat, eq.lng]);
  if (pts.length === 0) return;
  if (pts.length === 1) {
    map.setView(pts[0], 17);
    return;
  }
  const bounds = L.latLngBounds(pts);
  map.fitBounds(bounds, { padding: [50, 50], maxZoom: 18 });
}

function statusLabel(s: EquipmentStatus): string {
  return s === 'working' ? 'В работе' : s === 'idle' ? 'Простой' : s === 'moving' ? 'В движении' : 'Нет связи';
}

function Dot({ color }: { color: string }) {
  return <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
