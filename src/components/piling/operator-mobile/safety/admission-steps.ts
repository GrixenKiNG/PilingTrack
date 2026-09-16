import type {OperatorMobileState} from '@/modules/operator-mobile/contracts';

/**
 * Шаги допуска к смене — один список на все модули оператора.
 *
 * ЗАЧЕМ ОБЩИЙ. Вкладку «ТБ» просили одинаковой в `/operator`, `/operator/v2`,
 * `/operator/v7` и `/operator/v10`. Четыре копии условия «пройден ли шаг»
 * разошлись бы на первой же правке, и человек увидел бы в двух сборках разный
 * ответ на вопрос «допущен ли я». Вид у модулей свой, а факт — один.
 *
 * ПОЧЕМУ ПЯТЬ, А НЕ ТРИ. Первые три шага — действия человека: СИЗ, инструкция,
 * знания. Четвёртый и пятый действиями НЕ являются:
 *
 *  • «Подпись» — не отдельное нажатие, а отметка, которая ложится в журнал
 *    вместе с «Ознакомлен». Заводить под неё вторую кнопку значило бы просить
 *    человека подтвердить подтверждение; строка показывает факт и ведёт туда
 *    же, куда шаг ознакомления.
 *  • «Допуск к смене» — решение СЕРВЕРА. Пока `phase` держится на `IDENTITY`,
 *    допуска нет, сколько бы галочек ни стояло выше: сервер считает его по
 *    своим правилам, и экран не вправе объявить допуск за него.
 */

export type AdmissionStepId = 'PPE' | 'BRIEFING' | 'KNOWLEDGE' | 'SIGNATURE' | 'ADMISSION';

export interface AdmissionStep {
  id: AdmissionStepId;
  /** Номер в списке — тот же, что видит человек на экране. */
  n: number;
  title: string;
  /** Пояснение под названием. */
  hint: string;
  done: boolean;
  /** Короткий итог справа: «Выполнено», «Не выполнено», «Ожидает». */
  note: string;
  /**
   * Куда ведёт нажатие. `null` — строка не нажимается: под ней нет действия,
   * которое человек мог бы совершить сам.
   */
  opens: 'PPE' | 'BRIEFING' | 'KNOWLEDGE' | null;
}

export function admissionSteps(state: OperatorMobileState): AdmissionStep[] {
  const {ppe, briefing, knowledge} = state.identity;
  // Подпись существует ровно тогда, когда в журнале лежит отметка о действующей
  // редакции инструкции. Своего поля у неё нет и быть не должно.
  const signed = briefing.ok && briefing.acknowledgedAt !== null;
  const admitted = state.phase !== 'IDENTITY';

  return [
    {
      id: 'PPE',
      n: 1,
      title: 'СИЗ',
      hint: 'Проверка средств индивидуальной защиты',
      done: ppe.confirmed,
      note: ppe.confirmed
        ? (ppe.missing.length > 0 ? `Не хватает: ${ppe.missing.length}` : 'Выполнено')
        : 'Не выполнено',
      opens: 'PPE',
    },
    {
      id: 'BRIEFING',
      n: 2,
      title: 'Ознакомление с инструкциями',
      hint: briefing.title,
      done: briefing.ok,
      note: briefing.ok ? 'Выполнено' : 'Не выполнено',
      opens: 'BRIEFING',
    },
    {
      id: 'KNOWLEDGE',
      n: 3,
      title: 'Проверка знаний по ТБ',
      hint: knowledge.validUntil
        ? `Действует до ${formatDate(knowledge.validUntil)}`
        : 'Проверка не пройдена',
      done: knowledge.ok,
      note: knowledge.ok ? (knowledge.lastResult ?? 'Пройдено') : 'Не выполнено',
      opens: 'KNOWLEDGE',
    },
    {
      id: 'SIGNATURE',
      n: 4,
      title: 'Подпись',
      hint: 'Подтверждение прохождения',
      done: signed,
      note: signed
        ? `Подтверждена ${formatDate(briefing.acknowledgedAt)}`
        : 'Не выполнено',
      // Своего экрана у подписи нет: она ставится вместе с ознакомлением.
      opens: 'BRIEFING',
    },
    {
      id: 'ADMISSION',
      n: 5,
      title: 'Допуск к смене',
      hint: 'Решение ответственного',
      done: admitted,
      note: admitted ? 'Разрешён' : 'Ожидает',
      opens: null,
    },
  ];
}

/** Чего не хватает для допуска — словами, для строки состояния. */
export function admissionBlockers(steps: AdmissionStep[]): string[] {
  return steps
    .filter((step) => step.id !== 'ADMISSION' && !step.done)
    .map((step) => step.title);
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('ru-RU');
}
