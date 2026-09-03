import type {Metadata} from 'next';
import {AssistantApp} from '@/components/piling/operator-mobile/assistant-app';

export const metadata: Metadata = {title: 'Помощник машиниста'};

/**
 * Рабочее место помощника машиниста — стропальщика на свайной площадке.
 *
 * Инструктаж по стропальным работам, проверка знаний и свои допуски со
 * сроками. Смены здесь нет: её ведёт машинист, закреплённый за установкой.
 */
export default function AssistantPage() {
  return <AssistantApp />;
}
