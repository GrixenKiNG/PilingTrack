import type {Metadata} from 'next';
import {OperatorNextApp} from '@/components/piling/operator-next/operator-next-app';
import './operator-next.css';

export const metadata: Metadata = {title: 'Смена машиниста — следующее поколение'};

/**
 * Шестая версия экрана машиниста — `/operator/next`.
 *
 * Маршрут намеренно лежит ВНЕ группы `(app)`: её раскладка добавляет свою шапку
 * и нижнюю навигацию, а у рабочего места машиниста они собственные — крупные и
 * рассчитанные на перчатку. Так же сделан маршрут v7.
 *
 * Версия собирает лучшее из пяти действующих (`/operator`, v2, v5, v7, v10) и
 * работает на тех же живых данных: состояние читается из
 * `/api/operator/mobile/state`, команды уходят в `/api/operator/mobile/command`
 * через общий клиент `operator-mobile/api.ts`. Своей копии серверной логики,
 * очереди или справочников здесь нет.
 */
export default function OperatorNextPage() {
  return (
    <div className="onx">
      <OperatorNextApp />
    </div>
  );
}
