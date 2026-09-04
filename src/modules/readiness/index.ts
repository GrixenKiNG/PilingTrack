export * from './domain/readiness-rules';
export * from './domain/readiness-score';
export {
  buildReadinessFacts,
  type ReadinessFactsInput,
} from './application/readiness-facts';
export type { ReadinessRulesState } from './application/readiness-rules-service';
// Здесь только то, что безопасно на клиенте: этот барьер импортируют
// клиентские компоненты контура ТО ради правил и подсчёта баллов. Всё, что
// трогает базу или отправку, ввозится маршрутами напрямую из
// `application/**` — экспорт такого модуля отсюда утаскивает `lib/db` в
// клиентский бандл и роняет приложение целиком (поймано 04.09.2026).
