import type {Metadata} from 'next';
import {OperatorMobileApp} from '@/components/piling/operator-mobile/operator-mobile-app';

export const metadata: Metadata = {title: 'Смена машиниста'};

/**
 * Рабочее место машиниста сваебойной установки.
 *
 * Смена от допуска до отправки отчёта: инструктаж, проверка знаний, приём
 * установки, осмотр, пуск, площадка, учёт выработки, послесменное обслуживание.
 * Данные берутся из общей базы и уходят в отчёт смены — тот же `Report`, что
 * заполняет администратор, поэтому выработка сразу видна в аналитике.
 */
export default function OperatorPage() {
  return <OperatorMobileApp />;
}
