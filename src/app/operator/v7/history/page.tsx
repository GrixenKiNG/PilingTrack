import type {Metadata} from 'next';
import {HistoryV7App} from '@/components/piling/operator-mobile/v7/history-v7-app';
import '../operator-v7.css';

export const metadata: Metadata = {title: 'История смен — модуль v7'};

/**
 * История смен в мобильной оболочке модуля оператора.
 *
 * Данные живые: `/api/reports/my` — тот же источник, что у настольной
 * «Истории» (`/history`). Выборку ограничивает сервер по правам смотрящего.
 */
export default function HistoryV7Page() {
  return (
    <div className="ov7">
      <HistoryV7App />
    </div>
  );
}
