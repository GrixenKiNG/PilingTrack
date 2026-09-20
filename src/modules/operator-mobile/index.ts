/**
 * Серверный вход в модуль мобильного места машиниста.
 *
 * Отсюда импортируют маршруты API. Экранам сюда нельзя — они берут описания,
 * каталог, инструкцию и банк вопросов из `./contracts`, где нет ничего, что
 * тянет базу в браузер.
 */
export {queryOperatorMobileState} from './application/mobile-shift-query';
export {
  acknowledgeBriefing, confirmPpe, submitKnowledgeTest, acceptEquipment, submitChecklist,
  logProduction, correctProduction, reportIncident, finishWork, closeShift, submitReport,
  OperatorCommandError,
} from './application/mobile-shift-commands';
export type {ProductionEntry} from './application/mobile-shift-commands';

export * from './contracts';
export {queryAssistantState} from './application/assistant-query';
export {listBriefingJournal} from './application/briefing-journal-query';
export type {
  BriefingJournalFilters, BriefingJournalRow,
} from './application/briefing-journal-query';
