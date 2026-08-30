/**
 * Серверный вход в модуль мобильного места машиниста.
 *
 * Отсюда импортируют маршруты API. Экранам сюда нельзя — они берут описания и
 * каталог из `./contracts`, где нет ничего, что тянет базу в браузер.
 */
export {queryOperatorMobileState} from './application/mobile-shift-query';
export {
  acceptEquipment, submitChecklist, logProduction, requestClosing, closeShift,
  OperatorCommandError,
} from './application/mobile-shift-commands';
export type {ProductionEntry} from './application/mobile-shift-commands';

export * from './contracts';
