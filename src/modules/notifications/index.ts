/**
 * Notifications Module — доставка алертов из outbox в Telegram.
 *
 * Тут только серверный код (база, Redis, Telegram): в клиентские компоненты не импортировать.
 */
export { deliverQueuedAlert } from './application/durable-alert-delivery';
