import type {DocumentCheck} from './operator-admission';

/**
 * Препятствия к работе — единственное место, где решается «можно или нельзя».
 *
 * ПОЧЕМУ ОДИН СПИСОК. Запретов много и они разной природы: просроченная
 * медсправка, трещина в мачте, ветер 22 м/с, машина выведена из эксплуатации.
 * Если каждый экран решает сам, оператор получает разные ответы на один
 * вопрос и в конце концов находит экран, который его пропускает. Здесь запрет
 * считается один раз и предъявляется везде одинаково.
 *
 * ПОЧЕМУ У КАЖДОГО ЗАПРЕТА ЕСТЬ «ЧТО ДЕЛАТЬ». Оператор в семь утра на морозе
 * не будет разбираться в формулировке. Экран обязан сказать не только «нельзя»,
 * но и «позвони диспетчеру» либо «заведи дефект».
 */
export type BlockerCode =
  | 'DOCUMENT_INVALID'
  | 'NO_EQUIPMENT_ADMISSION'
  | 'EQUIPMENT_INACTIVE'
  | 'CRITICAL_DEFECT'
  | 'BLOCKING_FAULT'
  | 'WIND_STOP';

export type BlockerSeverity = 'STOP' | 'WARN';

export interface WorkBlocker {
  code: BlockerCode;
  severity: BlockerSeverity;
  title: string;
  detail: string;
  /** Что сделать, чтобы снять. Пишем действием, а не описанием состояния. */
  resolution: string;
}

/** Порог, при котором работы прекращают. Из руководств Liebherr LB 20 / LRH 100. */
export const WIND_STOP_MS = 20;

export interface BlockerInput {
  documents: DocumentCheck[];
  /** Оператор закреплён за этой установкой (бригада). */
  hasEquipmentAdmission: boolean;
  equipmentActive: boolean;
  equipmentName: string;
  /** Открытые дефекты уровня CRITICAL по этой установке. */
  criticalDefectTitles: string[];
  /** Пункты чек-листа со статусом «неисправность», помеченные блокирующими. */
  blockingFaultTexts: string[];
  windMs: number | null;
  /** Коды, снятые письменным разрешением диспетчера на эту смену. */
  waivedCodes: BlockerCode[];
}

export function collectBlockers(input: BlockerInput): WorkBlocker[] {
  const blockers: WorkBlocker[] = [];

  const invalidDocuments = input.documents.filter(
    (document) => document.required
      && (document.verdict === 'MISSING' || document.verdict === 'EXPIRED'),
  );
  if (invalidDocuments.length > 0) {
    blockers.push({
      code: 'DOCUMENT_INVALID',
      severity: 'STOP',
      title: 'Нет действующего допуска',
      detail: invalidDocuments
        .map((document) => `${document.name}: ${document.verdict === 'MISSING' ? 'не заведён' : 'просрочен'}`)
        .join('; '),
      resolution: 'Сообщите диспетчеру. Работать без действующего допуска нельзя.',
    });
  }

  if (!input.hasEquipmentAdmission) {
    blockers.push({
      code: 'NO_EQUIPMENT_ADMISSION',
      severity: 'STOP',
      title: 'Вы не закреплены за этой установкой',
      detail: `${input.equipmentName} не числится за вами на сегодня.`,
      resolution: 'Попросите диспетчера закрепить установку за вами.',
    });
  }

  if (!input.equipmentActive) {
    blockers.push({
      code: 'EQUIPMENT_INACTIVE',
      severity: 'STOP',
      title: 'Установка выведена из эксплуатации',
      detail: `${input.equipmentName} отмечена как неактивная.`,
      resolution: 'Уточните у диспетчера, на какой машине работать.',
    });
  }

  if (input.criticalDefectTitles.length > 0) {
    blockers.push({
      code: 'CRITICAL_DEFECT',
      severity: 'STOP',
      title: 'Критическая неисправность не устранена',
      detail: input.criticalDefectTitles.join('; '),
      resolution: 'Эксплуатация запрещена до закрытия дефекта механиком.',
    });
  }

  if (input.blockingFaultTexts.length > 0) {
    blockers.push({
      code: 'BLOCKING_FAULT',
      severity: 'STOP',
      title: 'Неисправность на осмотре',
      detail: input.blockingFaultTexts.join('; '),
      resolution: 'Дефект уже заведён. Дождитесь решения диспетчера.',
    });
  }

  if (input.windMs !== null && input.windMs >= WIND_STOP_MS) {
    blockers.push({
      code: 'WIND_STOP',
      severity: 'STOP',
      title: `Ветер ${Math.round(input.windMs)} м/с`,
      detail: `Порог прекращения работ — ${WIND_STOP_MS} м/с.`,
      resolution: 'Опустите стрелу и дождитесь ослабления ветра.',
    });
  }

  // Разрешение диспетчера не удаляет препятствие, а понижает его до
  // предупреждения: причина никуда не делась, и оператор должен её видеть.
  return blockers.map((blocker) => (
    input.waivedCodes.includes(blocker.code)
      ? {...blocker, severity: 'WARN' as const, resolution: 'Работа разрешена диспетчером под его ответственность.'}
      : blocker
  ));
}

export function isWorkAllowed(blockers: WorkBlocker[]): boolean {
  return !blockers.some((blocker) => blocker.severity === 'STOP');
}
