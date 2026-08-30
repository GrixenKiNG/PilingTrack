/**
 * Идентификация оператора: есть ли у человека право сесть за рычаги сегодня.
 *
 * Проверяются не «какие-то документы», а те, что администратор пометил
 * обязательными (UserDocumentType.requiredForOperator): удостоверение
 * машиниста, медицинская справка, удостоверение по охране труда, отметка об
 * инструктаже. Список ведётся в справочнике, а не в коде: его состав диктует
 * законодательство и заказчик, и он пополняется без релиза.
 */

export type DocumentVerdict =
  | 'VALID' // действует
  | 'EXPIRING' // истекает в окне предупреждения
  | 'EXPIRED' // просрочен
  | 'MISSING'; // не заведён вовсе

export interface RequiredDocumentType {
  id: string;
  name: string;
  /** Бессрочные документы по сроку не проверяем. */
  requiresExpiry: boolean;
  /** За сколько дней предупреждать. */
  leadTimeDays: number;
  /** Без него к смене не допускаем. */
  requiredForOperator: boolean;
}

export interface OperatorDocumentRecord {
  typeId: string;
  number: string;
  expiresAt: Date | null;
}

export interface DocumentCheck {
  typeId: string;
  name: string;
  required: boolean;
  verdict: DocumentVerdict;
  number: string;
  expiresAt: Date | null;
  /** Дней до конца срока. Отрицательное — просрочено. null — бессрочный. */
  daysLeft: number | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Свод по документам оператора.
 *
 * ПОЧЕМУ БЕРЁМ САМЫЙ ПОЗДНИЙ ДОКУМЕНТ ТИПА. У человека за годы накапливается
 * несколько удостоверений одного вида — старое и продлённое. Право на работу
 * даёт то, что действует дольше; если брать первое попавшееся, продлённый
 * документ не спасёт от отказа в допуске.
 */
export function checkOperatorDocuments(
  types: RequiredDocumentType[],
  documents: OperatorDocumentRecord[],
  now: Date,
): DocumentCheck[] {
  return types.map((type) => {
    const owned = documents
      .filter((document) => document.typeId === type.id)
      .sort((a, b) => (b.expiresAt?.getTime() ?? Infinity) - (a.expiresAt?.getTime() ?? Infinity));
    const document = owned[0];

    if (!document) {
      return {
        typeId: type.id,
        name: type.name,
        required: type.requiredForOperator,
        verdict: 'MISSING',
        number: '',
        expiresAt: null,
        daysLeft: null,
      };
    }

    if (!type.requiresExpiry || !document.expiresAt) {
      return {
        typeId: type.id,
        name: type.name,
        required: type.requiredForOperator,
        verdict: 'VALID',
        number: document.number,
        expiresAt: document.expiresAt,
        daysLeft: null,
      };
    }

    const daysLeft = daysBetween(now, document.expiresAt);
    const verdict: DocumentVerdict = daysLeft < 0
      ? 'EXPIRED'
      : daysLeft <= type.leadTimeDays
        ? 'EXPIRING'
        : 'VALID';

    return {
      typeId: type.id,
      name: type.name,
      required: type.requiredForOperator,
      verdict,
      number: document.number,
      expiresAt: document.expiresAt,
      daysLeft,
    };
  });
}

/**
 * Допуск по документам. Отказ закрытый: обязательный документ, которого нет
 * либо который просрочен, останавливает смену. Истекающий — предупреждение:
 * человек ещё имеет право работать, но обязан узнать об этом заранее.
 */
export function isIdentityValid(checks: DocumentCheck[]): boolean {
  return !checks.some(
    (check) => check.required && (check.verdict === 'MISSING' || check.verdict === 'EXPIRED'),
  );
}
