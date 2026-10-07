'use client';

import { FleetDashboard } from '@/components/piling/monitoring/fleet-dashboard';
import { EquipmentAnalytics } from '@/components/piling/equipment-analytics';
import { useAbility } from '@/lib/use-ability';

export default function MonitoringPage() {
  // Аналитика за период требует права analytics.read. Право выдано админу,
  // диспетчеру и мастеру — блок проверяем по праву, а не по собственной роли.
  const canSeeAnalytics = useAbility('analytics.read');

  return (
    <>
      <FleetDashboard />
      {canSeeAnalytics && (
        <>
          <div className="mx-4 border-t border-border lg:mx-6" />
          <EquipmentAnalytics />
        </>
      )}
    </>
  );
}
