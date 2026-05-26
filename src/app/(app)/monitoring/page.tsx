'use client';

import { FleetDashboard } from '@/components/piling/monitoring/fleet-dashboard';
import { EquipmentAnalytics } from '@/components/piling/equipment-analytics';
import { usePilingStore } from '@/lib/store';

export default function MonitoringPage() {
  const role = usePilingStore((s) => s.currentUser?.role);
  // Аналитика за период требует права analytics.read — есть только у
  // администратора и диспетчера. Операторам показываем только живой статус.
  const canSeeAnalytics = role === 'ADMIN' || role === 'DISPATCHER';

  return (
    <>
      <FleetDashboard />
      {canSeeAnalytics && (
        <>
          <div className="mx-4 border-t border-slate-200 lg:mx-6" />
          <EquipmentAnalytics />
        </>
      )}
    </>
  );
}
