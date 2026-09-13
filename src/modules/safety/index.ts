/**
 * Safety Module — охрана труда и допуск работников.
 *
 * Модуль СВОДНЫЙ: своих таблиц у него нет и заводить их не нужно. Документы
 * работников живут в `users`, инструктажи и проверка знаний — в
 * `BriefingRecord`, происшествия и наряды — в `readiness`. Здесь только чтение
 * и сведение: вопрос «кто допущен сегодня» не имеет своего хранилища и иметь
 * его не должен — иначе появится второе мнение о допуске, расходящееся с тем,
 * по которому сервер пускает смену.
 */

export { querySafetyClearanceOverview } from './application/clearance-overview-query';
export { querySelfSafetyView } from './application/self-clearance-query';
export type { SelfSafetyView, SelfBriefingRecord } from './application/self-clearance-query';
export type {
  SafetyClearanceOverview,
  SafetyClearanceRow,
  KnowledgeStatus,
} from './application/clearance-overview-query';
