'use client';

import { OperatorDashboardV3 } from '@/components/piling/operator-v3/operator-dashboard-v3';

/**
 * Экран оператора из сборки v2.8.0. Действующий экран — `/operator`,
 * соседние версии — `/operator/v2`, `/operator/v5`, `/operator/v7`,
 * `/operator/v10`. Все живут параллельно, пока владелец не выберет, что
 * оставить.
 */
export default function OperatorV3Page() {
  return <OperatorDashboardV3 />;
}
