import type {Metadata} from 'next';
import {BriefingJournalPrint} from '@/components/piling/briefings/briefing-journal-print';
import './print.css';

export const metadata: Metadata = {title: 'Журнал инструктажей'};

/**
 * Печатная форма журнала инструктажей. Открывается из вкладки «Инструктажи»
 * (`/admin/safety?view=briefings`) в новой вкладке с периодом в адресе.
 *
 * Маршрут намеренно лежит вне группы `(app)`: её раскладка добавляет шапку и
 * навигацию, а они попали бы на лист вместе с документом.
 *
 * Данные берутся тем же `/api/briefings/journal`, что и экран, — право
 * проверяет сервер. Отдельной защиты у страницы нет и быть не должно: без
 * сессии запрос вернёт 401, и лист останется пустым с честной ошибкой.
 */
export default function BriefingJournalPrintPage() {
  return <BriefingJournalPrint />;
}
