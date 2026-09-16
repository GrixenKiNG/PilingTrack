import type {Metadata} from 'next';
import {OperatorV10App} from '@/components/piling/operator-mobile/v10/operator-v10-app';
import './operator-v10.css';

export const metadata: Metadata = {title: 'Модуль оператора v10'};

/**
 * Модуль оператора v10 — экран смены машиниста на живых данных.
 *
 * Читает `/api/operator/mobile/state` — тот же источник, что у рабочего экрана
 * `/operator`. Действия, затрагивающие смену целиком (приём установки,
 * подтверждение готовности, закрытие смены), уходят тем же командным маршрутом
 * `/api/operator/mobile/command`.
 *
 * Маршрут намеренно лежит вне группы `(app)`: её раскладка добавляет свою шапку
 * и нижнюю навигацию, а у модуля они собственные — тёмные, как на эталоне.
 */
export default function OperatorV10Page() {
  return (
    <div className="ov10">
      <OperatorV10App />
    </div>
  );
}
