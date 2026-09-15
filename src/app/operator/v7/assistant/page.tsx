import type {Metadata} from 'next';
import {AssistantV7App} from '@/components/piling/operator-mobile/v7/assistant-v7-app';
import '../operator-v7.css';

export const metadata: Metadata = {title: 'Помощник машиниста — модуль v7'};

/**
 * Рабочее место помощника машиниста в мобильной оболочке модуля оператора.
 *
 * Данные живые: `/api/assistant/state` и `/api/assistant/command` — те же
 * адреса, что у рабочего экрана `/assistant`. Доступ тот же: роль `ASSISTANT`.
 *
 * Маршрут лежит вне группы `(app)`: её раскладка добавляет свою шапку и нижнюю
 * навигацию, а у модуля они собственные.
 */
export default function AssistantV7Page() {
  return (
    <div className="ov7">
      <AssistantV7App />
    </div>
  );
}
