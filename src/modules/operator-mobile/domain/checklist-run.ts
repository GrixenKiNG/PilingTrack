import type {ChecklistItem, ChecklistStage, OperatorAnswer} from './checklist-types';

export interface ChecklistAnswer {
  itemId: string;
  answer: OperatorAnswer;
  note?: string;
  /** Замеры пункта: долив жидкости, моточасы, время прогрева. */
  measures?: Record<string, number>;
  mediaIds?: string[];
}

export interface ChecklistProblem {
  itemId: string;
  message: string;
}

/**
 * Проверка заполнения чек-листа перед тем, как его закрыть.
 *
 * ПОЧЕМУ ПРОВЕРЯЕМ НА СЕРВЕРЕ, А НЕ ТОЛЬКО НА ЭКРАНЕ. Экран подсказывает,
 * сервер отвечает. Правило «неисправность требует фотографии» имеет смысл
 * только если его нельзя обойти, отправив запрос мимо формы.
 */
export function validateChecklistRun(
  items: ChecklistItem[],
  answers: ChecklistAnswer[],
): ChecklistProblem[] {
  const problems: ChecklistProblem[] = [];
  const byItem = new Map(answers.map((answer) => [answer.itemId, answer]));

  for (const item of items) {
    const answer = byItem.get(item.id);
    if (!answer) {
      problems.push({itemId: item.id, message: 'Пункт не заполнен'});
      continue;
    }

    const isIssue = answer.answer === 'REMARK' || answer.answer === 'FAULT';

    if (isIssue && !answer.note?.trim()) {
      problems.push({itemId: item.id, message: 'Опишите, что именно не так'});
    }

    if (isIssue && item.photoOnIssue && (answer.mediaIds?.length ?? 0) === 0) {
      problems.push({itemId: item.id, message: 'Приложите фотографию'});
    }

    if (item.measure) {
      const requiredOn = item.measure.requiredOn ?? (['OK', 'REMARK', 'FAULT'] as OperatorAnswer[]);
      const value = answer.measures?.[item.measure.key];
      if (requiredOn.includes(answer.answer) && !Number.isFinite(value)) {
        problems.push({itemId: item.id, message: `Укажите: ${item.measure.label}, ${item.measure.unit}`});
      }
    }
  }

  return problems;
}

/** Неисправности по пунктам, которые останавливают работу. */
export function blockingFaults(items: ChecklistItem[], answers: ChecklistAnswer[]): ChecklistItem[] {
  const faulted = new Set(
    answers.filter((answer) => answer.answer === 'FAULT').map((answer) => answer.itemId),
  );
  return items.filter((item) => item.blocking && faulted.has(item.id));
}

export interface DefectDraft {
  sourceKey: string;
  title: string;
  description: string;
  severity: 'NORMAL' | 'CRITICAL';
  mediaIds: string[];
}

/**
 * Замечания и неисправности превращаются в дефекты установки.
 *
 * ПОЧЕМУ АВТОМАТИЧЕСКИ. Замечание, которое живёт только внутри чек-листа, —
 * это замечание, о котором механик не узнает. Дефект — то место в системе, где
 * у проблемы появляется владелец и срок.
 *
 * ПОЧЕМУ sourceKey. «Этот пункт на этой установке» — устойчивый ключ. Незакрытая
 * течь на следующей смене попадёт в тот же дефект, а не заведёт третью копию.
 * Критичность считает правило, а не оператор: его дело — увидеть и описать.
 */
export function collectDefectDrafts(
  stage: ChecklistStage,
  equipmentId: string,
  items: ChecklistItem[],
  answers: ChecklistAnswer[],
): DefectDraft[] {
  const byItem = new Map(items.map((item) => [item.id, item]));

  return answers
    .filter((answer) => answer.answer === 'REMARK' || answer.answer === 'FAULT')
    .flatMap((answer) => {
      const item = byItem.get(answer.itemId);
      if (!item) return [];
      // Заголовком дефекта служит то, что увидел оператор, а не формулировка
      // пункта: «Кабина очищена» в списке неисправностей читается как насмешка.
      // Пункт уходит в описание — механику важно знать, на каком шаге нашли.
      const observed = answer.note?.trim();
      return [{
        sourceKey: `${equipmentId}:${stage}:${item.id}`,
        title: observed || item.text,
        description: `Пункт осмотра: ${item.text}.`,
        severity: (answer.answer === 'FAULT' && item.blocking ? 'CRITICAL' : 'NORMAL') as DefectDraft['severity'],
        mediaIds: answer.mediaIds ?? [],
      }];
    });
}
