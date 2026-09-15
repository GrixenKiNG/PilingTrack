import type {Metadata} from 'next';
import {SafetyV7App} from '@/components/piling/operator-mobile/v7/safety-v7-app';
import '../operator-v7.css';

export const metadata: Metadata = {title: 'ТБ и допуски — модуль v7'};

/**
 * «ТБ и допуски» — личный раздел работника в мобильной оболочке.
 *
 * Данные живые: `/api/safety/my-clearance`. Маршрут отдаёт только своё —
 * выборка сужена идентификатором из сессии, параметра `userId` у него нет.
 * Полный раздел для инженера ОТ остаётся на `/admin/safety`.
 */
export default function SafetyV7Page() {
  return (
    <div className="ov7">
      <SafetyV7App />
    </div>
  );
}
