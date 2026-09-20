import type {ChecklistItem, ChecklistStage, OperatorAnswer} from './checklist-types';

export interface ChecklistAnswer {
  itemId: string;
  answer: OperatorAnswer;
  note?: string;
  /** Замеры пункта: долив жидкости, время прогрева, остаток топлива. */
  measures?: Record<string, number>;
  mediaIds?: string[];
}

export interface ChecklistProblem {
  itemId: string;
  message: string;
}

/** Нужен ли замер при этом ответе. Долив спрашиваем только при замечании. */
export function measureRequired(item: ChecklistItem, answer: OperatorAnswer): boolean {
  if (!item.measure) return false;
  const on = item.measure.requiredOn ?? (['OK', 'REMARK', 'FAULT'] as OperatorAnswer[]);
  return on.includes(answer);
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

    if (item.measure && measureRequired(item, answer.answer)) {
      const value = answer.measures?.[item.measure.key];
      const {min, max, label, unit} = item.measure;
      if (!Number.isFinite(value)) {
        problems.push({itemId: item.id, message: `Укажите: ${label}, ${unit}`});
      } else if (
        (min !== undefined && (value as number) < min)
        || (max !== undefined && (value as number) > max)
      ) {
        // Границы проверяет сервер, а не только экран: значение уходит в отчёт
        // диспетчеру, и «1290 %» там появиться не должно ни при какой опечатке.
        problems.push({
          itemId: item.id,
          message: `${label}: допустимо от ${min ?? 0} до ${max ?? '∞'} ${unit}`,
        });
      }
    }
  }

  return problems;
}

export interface DefectDraft {
  sourceKey: string;
  title: string;
  description: string;
  severity: 'NORMAL' | 'HIGH';
  mediaIds: string[];
}

/**
 * Замечания и неисправности превращаются в дефекты установки.
 *
 * ПОЧЕМУ АВТОМАТИЧЕСКИ. Замечание, которое живёт только внутри чек-листа, —
 * это замечание, о котором механик не узнает. Дефект — то место в системе, где
 * у проблемы появляется владелец и срок, и именно его закрытие само снимает
 * предупреждение с экрана оператора.
 *
 * ПОЧЕМУ НЕ CRITICAL. В продукте CRITICAL означает «эксплуатация запрещена», а
 * запрещать по ответу в телефоне мы не беремся: проверить состояние машины
 * программе нечем. Худшее, что ставит осмотр, — HIGH «устранить как можно
 * скорее»; красное предупреждение при этом видят оба.
 *
 * ПОЧЕМУ sourceKey. «Этот пункт на этой установке» — устойчивый ключ. Незакрытая
 * течь на следующей смене попадёт в тот же дефект, а не заведёт третью копию.
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
      const observed = answer.note?.trim();
      return [{
        sourceKey: `${equipmentId}:${stage}:${item.id}`,
        title: observed || item.text,
        description: `Пункт осмотра: ${item.text}.`,
        severity: (answer.answer === 'FAULT' && item.severity === 'ALERT'
          ? 'HIGH'
          : 'NORMAL') as DefectDraft['severity'],
        mediaIds: answer.mediaIds ?? [],
      }];
    });
}
