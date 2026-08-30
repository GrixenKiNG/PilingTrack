import type {Metadata} from 'next';
import {OperatorMobileApp} from '@/components/piling/operator-mobile/operator-mobile-app';

export const metadata: Metadata = {
  title: 'Смена машиниста',
  viewport: {width: 'device-width', initialScale: 1, maximumScale: 1, viewportFit: 'cover'},
};

/**
 * Мобильное рабочее место машиниста сваебойной установки.
 *
 * Маршрут намеренно лежит вне группы `(app)`: её раскладка добавляет шапку и
 * нижнюю навигацию для монитора, а здесь весь экран принадлежит одной задаче —
 * пройти смену от допуска до сдачи. Онлайн-режим: сеть нужна на каждом шаге.
 */
export default function OperatorMobilePage() {
  return <OperatorMobileApp />;
}
