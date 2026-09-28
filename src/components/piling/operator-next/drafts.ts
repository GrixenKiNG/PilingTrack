/**
 * Черновики, которые обязаны пережить переходы по экранам.
 *
 * ПОЧЕМУ ОНИ ЖИВУТ ВЫШЕ ЭКРАНОВ. Введённое машинистом не должно теряться, пока
 * сервер не принял запись или она не легла в очередь (правило 6 задания). Пока
 * черновики лежали в состоянии самих форм, любой переход размонтировал форму
 * вместе с содержимым: вкладка «Техника» и обратно, «Назад к смене», уход в
 * обязательный чек-лист ТБ — и набранное исчезало.
 *
 * Ключ — смена и вид формы. Новому машинисту и новой смене старые черновики не
 * достаются: пароль к чужому вводу тут не нужен.
 */
import type {ChecklistStage, OperatorAnswer} from '@/modules/operator-mobile/contracts';

export type WorkMode = 'NONE' | 'PILES' | 'DRILLING' | 'DOWNTIME' | 'PASSPORT';

/** Виды форм, у которых свои поля (паспорт сваи — готовая форма со своим состоянием). */
export type FormMode = 'PILES' | 'DRILLING' | 'DOWNTIME';

export interface FormFields {
  reference: string;
  count: string;
  metersPerUnit: string;
  started: string;
  ended: string;
  comment: string;
}

export interface WorkDraft {
  /** Какая форма открыта. `NONE` — список действий. */
  mode: WorkMode;
  /** Поля по каждому виду формы: переключение видов не стирает соседние. */
  forms: Record<FormMode, FormFields>;
}

/**
 * Черновик ответа на один пункт осмотра.
 *
 * ПОЧЕМУ ОН ТОЖЕ ЖИВЁТ ВЫШЕ ЭКРАНА. Ответы осмотра терялись при «Назад» и
 * возврате: `key={checklist.stage}` пересоздавал экран вместе с ответами
 * (находка Д2 аудита). Держим их по этапу — как поля форм по виду формы.
 */
export interface ChecklistDraft {
  answer?: OperatorAnswer;
  note: string;
  measures: Record<string, string>;
  mediaIds: string[];
  uploading: boolean;
  uploadError: string | null;
}

/** Ответы одного этапа: пункт → черновик. */
export type ChecklistDrafts = Record<string, ChecklistDraft>;

export const emptyChecklistDraft = (): ChecklistDraft => ({
  note: '', measures: {}, mediaIds: [], uploading: false, uploadError: null,
});

export interface Drafts {
  /** Смена, которой принадлежат черновики. Меняется — черновики обнуляются. */
  shiftId: string | null;
  work: WorkDraft;
  /** Заметка «что оставить себе на завтра» на экране закрытия. */
  closeNote: string;
  /** Ответы осмотров по этапам: этап → пункт → черновик. */
  checklists: Partial<Record<ChecklistStage, ChecklistDrafts>>;
}

export const emptyFormFields = (): FormFields => ({
  reference: '', count: '', metersPerUnit: '', started: '', ended: '', comment: '',
});

export const emptyWorkDraft = (): WorkDraft => ({
  mode: 'NONE',
  forms: {PILES: emptyFormFields(), DRILLING: emptyFormFields(), DOWNTIME: emptyFormFields()},
});

export const emptyDrafts = (shiftId: string | null = null): Drafts => ({
  shiftId,
  work: emptyWorkDraft(),
  closeNote: '',
  checklists: {},
});

/** Черновики той же смены; смена сменилась — начинаем с чистого листа. */
export function draftsForShift(drafts: Drafts, shiftId: string | null): Drafts {
  return drafts.shiftId === shiftId ? drafts : emptyDrafts(shiftId);
}

/** Есть ли в форме что-то, набранное человеком. */
export function isFormDirty(fields: FormFields): boolean {
  return Boolean(
    fields.reference || fields.count || fields.metersPerUnit
    || fields.started || fields.ended || fields.comment,
  );
}

/** Есть ли незаписанный черновик хоть в одной форме. */
export function hasDirtyDraft(drafts: Drafts): boolean {
  return (Object.keys(drafts.work.forms) as FormMode[])
    .some((mode) => isFormDirty(drafts.work.forms[mode]));
}
