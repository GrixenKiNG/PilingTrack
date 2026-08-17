/**
 * Подписка на заказы пересчёта готовности.
 *
 * Обработчик (`consumeReadinessProjectionEvent`) был написан, но нигде не
 * регистрировался: события `ReadinessSnapshotRequested` уходили в шину,
 * получали «нет обработчика», помечались обработанными и пропадали.
 *
 * Следствие видел пользователь: `CurrentReadiness` обновлялся только при
 * запуске смены — единственном пути, который пишет снимок напрямую. Закрытый
 * наряд ТО, выполненный осмотр, согласованный наряд-допуск и наступление новых
 * суток на экран не попадали. Машина висела с «100/100, рассчитано 10
 * августа», хотя сегодняшнего осмотра нет.
 *
 * Живёт в слое сборки: подписка связывает модуль готовности с шиной событий
 * отчётов, а modules/ и services/ по правилам проекта друг от друга зависеть
 * не могут (CLAUDE.md §1). Соединять их — работа композиционного слоя.
 */

import { on } from '@/services/reports/domain-events';
import { consumeReadinessProjectionEvent } from '@/modules/readiness/application/projection/consumer';

let registered = false;

export function registerReadinessProjectionHandler(): void {
  // Вызывается из нескольких мест старта (воркеры, серверный маршрут):
  // повторная подписка добавила бы второй обработчик на то же событие.
  if (registered) return;
  registered = true;
  on('ReadinessSnapshotRequested', async (event: { id?: string; type?: string }) => {
    await consumeReadinessProjectionEvent(event);
  });
}
