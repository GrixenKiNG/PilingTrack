'use client';

/**
 * Live monitoring map — `/monitoring`.
 *
 * Client-only because Leaflet needs `window`. The component itself is
 * lazy-loaded so the rest of the route tree isn't paying for Leaflet
 * unless the user navigates here.
 */

import dynamic from 'next/dynamic';

const MonitoringMap = dynamic(
  () => import('@/components/piling/monitoring-map').then((m) => m.MonitoringMap),
  { ssr: false, loading: () => <div className="p-6 text-sm text-muted-foreground">Загрузка карты…</div> }
);

export default function MonitoringPage() {
  return <MonitoringMap />;
}
