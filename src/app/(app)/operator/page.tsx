'use client';

import { OperatorDashboard } from '@/components/piling/operator-dashboard';

/**
 * Рабочее место машиниста — действующее исполнение.
 *
 * Новый контур смены (`operator-mobile`) в коде есть и покрыт тестами, но на
 * бой не выпущен: решение владельца от 12.09.2026 — сначала доработать, потом
 * включать. Пока машинист работает на прежнем экране, к которому привык.
 *
 * Чтобы включить новый контур, здесь возвращается `OperatorMobileApp` из
 * `@/components/piling/operator-mobile/operator-mobile-app` — и вместе с ним
 * нужно вернуть пункт «История» в нижнее меню (`icons/role-navigation.ts`).
 */
export default function OperatorPage() {
  return <OperatorDashboard />;
}
