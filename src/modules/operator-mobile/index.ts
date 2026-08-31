/**
 * Серверный вход в модуль мобильного места машиниста.
 *
 * Отсюда импортируют маршруты API. Экранам сюда нельзя — они берут описания,
 * каталог, инструкцию и банк вопросов из `./contracts`, где нет ничего, что
 * тянет базу в браузер.
 */
export {queryOperatorMobileState} from './application/mobile-shift-query';
export {
  acknowledgeBriefing, submitKnowledgeTest, acceptEquipment, submitChecklist,
  logProduction, removeProduction, finishWork, closeShift, OperatorCommandError,
} from './application/mobile-shift-commands';
export type {ProductionEntry} from './application/mobile-shift-commands';

export * from './contracts';
