'use client';

import { OperatorShiftV2 } from '@/components/piling/operator-v2/operator-shift-v2';
import { DeviceFrame } from '@/components/piling/operator-mobile/v7/device-frame';

/**
 * Модуль-кандидат экрана оператора. Действующий экран — `/operator`.
 * Оба живут параллельно, пока владелец не выберет, какой оставить.
 */
export default function OperatorV2Page() {
  return (
    <DeviceFrame>
      <OperatorShiftV2 />
    </DeviceFrame>
  );
}
