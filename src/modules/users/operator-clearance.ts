/**
 * Допуск оператора к смене по документам — чистая оценка, без обращений к базе.
 *
 * ЗАЧЕМ. Документы работников в системе завелись 15.08.2026, но их никто не
 * спрашивал перед работой: удостоверение машиниста могло быть просрочено полгода,
 * а смена всё равно запускалась. Фаза «Допуск к работе» на экране оператора
 * проверяла только назначение на машину — то есть проверяла не то, что называла.
 *
 * ПОЧЕМУ ЗДЕСЬ, А НЕ В ЗАПРОСЕ. Ту же оценку показывает экран оператора и
 * выносит серверная команда пуска. Разъехавшись, они дали бы «допущен» на экране
 * и отказ по нажатию — худший вид ошибки для человека в шесть утра.
 *
 * ГРАНИЦА ОТВЕТСТВЕННОСТИ. Какие документы обязательны, решает администратор
 * (`UserDocumentType.requiredForOperator`), а не эта функция: перечень задаётся
 * законодательством и заказчиком и меняется без релиза.
 */

import { documentExpiry, type DocumentExpiryStatus } from '@/lib/document-expiry';

export interface RequiredDocumentType {
  id: string;
  name: string;
  /** Окно предупреждения вида документа: у каждого своё. */
  leadTimeDays: number;
}

export interface HeldDocument {
  typeId: string;
  /** null — бессрочный документ. */
  expiresAt: Date | string | null;
}

export type ClearanceReason = 'missing' | 'expired' | 'expiring';

export interface ClearanceIssue {
  typeId: string;
  typeName: string;
  reason: ClearanceReason;
  /** Готовая строка для экрана: технических имён оператор не видит. */
  label: string;
  /** Дней до конца срока; отрицательное — просрочен. null у отсутствующего. */
  daysLeft: number | null;
}

/**
 * Строка карточки «Личный допуск»: вид документа и его состояние — включая
 * благополучное.
 *
 * Препятствия и предупреждения говорят только о плохом, а оператору перед
 * сменой надо показать, что допуск ЕСТЬ: «✓ удостоверение действительно,
 * ✓ медсправка действительна». Иначе экран допуска либо пуст, либо ругается —
 * третьего состояния у него не было.
 */
export interface ClearanceDocument {
  typeId: string;
  typeName: string;
  status: DocumentExpiryStatus | 'missing';
  /** Срок действия, ISO. null — бессрочный или документа нет вовсе. */
  expiresAt: string | null;
  daysLeft: number | null;
}

export interface OperatorClearance {
  /** Допущен: ни одного препятствия. Предупреждения допуску не мешают. */
  cleared: boolean;
  blockers: ClearanceIssue[];
  warnings: ClearanceIssue[];
  /** Все обязательные виды документов с их состоянием — для карточки допуска. */
  documents: ClearanceDocument[];
}

const dayWord = (days: number) => {
  const abs = Math.abs(days) % 100;
  const tail = abs % 10;
  if (abs > 10 && abs < 20) return 'дней';
  if (tail === 1) return 'день';
  if (tail >= 2 && tail <= 4) return 'дня';
  return 'дней';
};

/**
 * Из нескольких документов одного вида берём тот, что действует дольше.
 *
 * У человека вполне может лежать и старое просроченное удостоверение, и новое:
 * решает свежее. Бессрочный документ побеждает любой срочный.
 */
function bestDocument(documents: readonly HeldDocument[]): HeldDocument | null {
  let best: HeldDocument | null = null;
  let bestTime = -Infinity;
  for (const document of documents) {
    if (document.expiresAt == null || document.expiresAt === '') return document;
    const time = new Date(document.expiresAt).getTime();
    if (Number.isNaN(time)) continue;
    if (time > bestTime) { bestTime = time; best = document; }
  }
  return best;
}

/**
 * @param required виды документов, отмеченные администратором как обязательные
 * @param held документы работника (любых видов, лишние игнорируются)
 */
export function evaluateOperatorClearance(
  required: readonly RequiredDocumentType[],
  held: readonly HeldDocument[],
  now: Date = new Date(),
): OperatorClearance {
  const blockers: ClearanceIssue[] = [];
  const warnings: ClearanceIssue[] = [];
  const documents: ClearanceDocument[] = [];

  for (const type of required) {
    const own = held.filter((document) => document.typeId === type.id);
    const document = bestDocument(own);

    // Документа нет вовсе. Это препятствие, а не предупреждение: обязательным
    // его назвал администратор, и работать без него нельзя.
    if (!document) {
      documents.push({
        typeId: type.id, typeName: type.name, status: 'missing',
        expiresAt: null, daysLeft: null,
      });
      blockers.push({
        typeId: type.id, typeName: type.name, reason: 'missing', daysLeft: null,
        label: `Нет документа: ${type.name}`,
      });
      continue;
    }

    const expiry = documentExpiry(document.expiresAt, type.leadTimeDays, now);
    documents.push({
      typeId: type.id,
      typeName: type.name,
      status: expiry.status,
      expiresAt: document.expiresAt == null || document.expiresAt === ''
        ? null
        : new Date(document.expiresAt).toISOString(),
      daysLeft: expiry.daysLeft,
    });
    if (expiry.status === 'expired') {
      const days = Math.abs(expiry.daysLeft ?? 0);
      blockers.push({
        typeId: type.id, typeName: type.name, reason: 'expired', daysLeft: expiry.daysLeft,
        label: `Просрочен: ${type.name} — ${days} ${dayWord(days)}`,
      });
    } else if (expiry.status === 'expiring') {
      const days = expiry.daysLeft ?? 0;
      warnings.push({
        typeId: type.id, typeName: type.name, reason: 'expiring', daysLeft: expiry.daysLeft,
        label: `Истекает: ${type.name} — через ${days} ${dayWord(days)}`,
      });
    }
  }

  return { cleared: blockers.length === 0, blockers, warnings, documents };
}
