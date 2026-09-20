/**
 * Команды мобильного места оператора.
 *
 * ПОЧЕМУ ЭТО БОЧКА, А НЕ КОД. Файл дорос до 1728 строк, и в нём рядом лежали
 * допуск, приёмка техники, осмотр, выработка, происшествия и закрытие смены —
 * шесть несвязанных обязанностей. Разрезан по ним (`./commands/*`), а имя
 * файла осталось: наружу модуль виден только через `modules/operator-mobile`,
 * и трогать фасад ради перестановки внутренностей незачем.
 *
 * ПОЧЕМУ ВСЁ В ОДНОЙ ТРАНЗАКЦИИ НА ТЕНАНТА. Строгие политики RLS на бою
 * пропускают запись только внутри транзакции с установленным
 * `app.current_tenant`. Общий помощник взят из модуля готовности намеренно:
 * второй способ открывать тенантную транзакцию означал бы второй набор правил
 * доступа, а их в продукте уже два и этого достаточно.
 *
 * ПОЧЕМУ clientCommandId. Сеть на площадке рвётся посреди запроса. Телефон
 * повторит отправку, и без ключа команды в журнале появится второй осмотр либо
 * вторая пачка свай. Ключ приходит с телефона и уникален в базе — повтор
 * возвращает прежний результат вместо дубля.
 */

export {OperatorCommandError} from './commands/shared';

export {confirmPpe, acknowledgeBriefing, submitKnowledgeTest} from './commands/admission';
export type {BriefingAudience} from './commands/admission';

export {acceptEquipment} from './commands/equipment';
export {submitChecklist} from './commands/checklist';

export {logProduction} from './commands/production';
export {correctProduction} from './commands/production-corrections';
export type {PileDrivingSetEntry, PilePassportEntry, ProductionEntry} from './commands/production';

export {reportIncident} from './commands/incidents';
export {finishWork, closeShift, submitReport} from './commands/shift-close';
