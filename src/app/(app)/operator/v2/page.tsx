'use client';

import { OperatorShiftV2 } from '@/components/piling/operator-v2/operator-shift-v2';
import { usePilingStore } from '@/lib/store';

/**
 * Модуль-кандидат экрана оператора. Действующий экран — `/operator`.
 * Оба живут параллельно, пока владелец не выберет, какой оставить.
 */
export default function OperatorV2Page() {
  const user = usePilingStore((state) => state.currentUser);
  if (!user) return null;
  if (user.role !== 'OPERATOR') {
    return <p className="p-4">Экран доступен только машинисту</p>;
  }
  return (
    <OperatorShiftV2 />
  );
}
