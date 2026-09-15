import type {Metadata} from 'next';
import {OperatorV7App} from '@/components/piling/operator-mobile/v7/operator-v7-app';
import './operator-v7.css';

export const metadata: Metadata = {title: 'Модуль оператора v7'};

/**
 * Модуль оператора по визуализации — на живых данных.
 *
 * В отличие от `/operator/module` (самодостаточный HTML-прототип с
 * демонстрационными данными) и от макетов v2/v5, этот экран читает настоящее
 * состояние смены из `/api/operator/mobile/state` — тот же источник, что у
 * рабочего экрана `/operator`. Действий не выполняет: см. пояснение в
 * `operator-v7-app.tsx`.
 *
 * Маршрут намеренно лежит вне группы `(app)`: её раскладка добавляет свою
 * шапку и нижнюю навигацию, а у модуля они собственные.
 */
export default function OperatorV7Page() {
  return (
    <div className="ov7">
      <OperatorV7App />
    </div>
  );
}
