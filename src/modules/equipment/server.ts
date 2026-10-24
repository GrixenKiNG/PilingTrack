/**
 * Серверный вход equipment для соседних модулей: только запись показания
 * наработки и топлива внутри чужой транзакции.
 *
 * Узкий нарочно. Фасад `@/modules/equipment` тянет весь модуль (ТО, регламенты,
 * топливо), а контуру оператора нужна одна команда; через фасад каждый его тест
 * начал бы зависеть от половины чужого графа.
 */
export { recordMeterReadingInTx } from './application/commands/meter-reading';
export { recordOperatorFuelInTx } from './application/commands/fuel-log';
