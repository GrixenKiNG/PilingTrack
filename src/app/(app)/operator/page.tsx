import type {Metadata} from 'next';
import {OperatorMobileApp} from '@/components/piling/operator-mobile/operator-mobile-app';
import {DeviceFrame} from '@/components/piling/operator-mobile/v7/device-frame';

export const metadata: Metadata = {title: 'Смена машиниста'};

/**
 * Рабочее место машиниста сваебойной установки.
 *
 * Смена от допуска до отправки отчёта: инструктаж, проверка знаний, приём
 * установки, осмотр, пуск, площадка, учёт выработки, послесменное обслуживание.
 * Данные берутся из общей базы и уходят в отчёт смены — тот же `Report`, что
 * заполняет администратор, поэтому выработка сразу видна в аналитике.
 *
 * Включено на бой 12.09.2026 решением владельца. Прежний экран
 * (`operator-dashboard.tsx` и его шаги в `components/piling/operator/`)
 * оставлен в коде как путь отхода: если новый контур подведёт, здесь
 * возвращается `OperatorDashboard`, а в нижнее меню — «Мониторинг» вместо
 * «Истории» (`icons/role-navigation.ts`).
 */
export default function OperatorPage() {
  // Корпус телефона добавляется только на широком экране: на устройстве, где
  // этот экран работает, обёртка не делает ничего. См. device-frame.css.
  return (
    <DeviceFrame>
      <OperatorMobileApp />
    </DeviceFrame>
  );
}
