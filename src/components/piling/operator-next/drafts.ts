/**
 * Черновики, которые обязаны пережить переходы по экранам.
 *
 * ПОЧЕМУ ОНИ ЖИВУТ ВЫШЕ ЭКРАНОВ. Введённое машинистом не должно теряться, пока
 * сервер не принял запись или она не легла в очередь (правило 6 задания). Пока
 * черновики лежали в состоянии самих форм, любой переход размонтировал форму
 * вместе с содержимым: вкладка «Техника» и обратно, «Назад к смене», уход в
 * обязательный чек-лист ТБ — и набранное исчезало.
 *
 * ПРИНАДЛЕЖНОСТЬ — ПАРА «ПОЛЬЗОВАТЕЛЬ + СМЕНА» (ревью №4, пункт C). Планшет на
 * установке общий: при смене пользователя в уже открытой оболочке черновики
 * прежнего не показываются, не сохраняются под новым и не отправляются. Пока
 * пользователь неизвестен, пользовательские черновики не читаются и не
 * пишутся вовсе — общего хранилища «anon» нет.
 */
import {DEFAULT_SET_BLOWS} from '@/modules/operator-mobile/domain/pile-passport';
import type {ChecklistStage, OperatorAnswer} from '@/modules/operator-mobile/contracts';

export type WorkMode = 'NONE' | 'PILES' | 'DRILLING' | 'DOWNTIME' | 'PASSPORT';

/** Виды форм, у которых свои поля (у паспорта сваи — своя форма и свой черновик). */
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

/**
 * Черновик паспорта сваи — объект в памяти оболочки.
 *
 * РЕВЬЮ №4, ПУНКТ A1. Раньше значения снимались с полей общей формы по DOM и
 * возвращались кликами: при недоступном хранилище обходной экран терял паспорт,
 * а восстановление залогов зависело от синхронности обновлений React. Теперь
 * паспорт — такой же черновик в памяти, как выработка и осмотр: форма получает
 * значениями и отдаёт изменения обратно. Числа хранятся строками — ровно тем,
 * что человек видит в полях.
 */
export interface PassportDraftData {
  grade: string;
  number: string;
  designHead: string;
  actualHead: string;
  depth: string;
  sets: {blows: string; penetration: string; dropHeight: string}[];
  designRefusal: string;
  totalBlows: string;
  blowsLastMeter: string;
  dropHeight: string;
  planDeviation: string;
  tilt: string;
  redriven: boolean;
  followerUsed: boolean;
  headCutOff: boolean;
  note: string;
}

export interface Drafts {
  /** Кому и какой смене принадлежат черновики. Пара сменилась — начинаем заново. */
  userId: string | null;
  shiftId: string | null;
  work: WorkDraft;
  /** Заметка «что оставить себе на завтра» на экране закрытия. */
  closeNote: string;
  /** Ответы осмотров по этапам: этап → пункт → черновик. */
  checklists: Partial<Record<ChecklistStage, ChecklistDrafts>>;
  /** Паспорт сваи; `null` — ещё не заводили. */
  passport: PassportDraftData | null;
}

export const emptyFormFields = (): FormFields => ({
  reference: '', count: '', metersPerUnit: '', started: '', ended: '', comment: '',
});

export const emptyWorkDraft = (): WorkDraft => ({
  mode: 'NONE',
  forms: {PILES: emptyFormFields(), DRILLING: emptyFormFields(), DOWNTIME: emptyFormFields()},
});

/** Пустой черновик паспорта: одна строка залога — как в самой форме. */
export const emptyPassportDraft = (): PassportDraftData => ({
  grade: '',
  number: '',
  designHead: '',
  actualHead: '',
  depth: '',
  sets: [{blows: String(DEFAULT_SET_BLOWS), penetration: '', dropHeight: ''}],
  designRefusal: '',
  totalBlows: '',
  blowsLastMeter: '',
  dropHeight: '',
  planDeviation: '',
  tilt: '',
  redriven: false,
  followerUsed: false,
  headCutOff: false,
  note: '',
});

export const emptyDrafts = (
  userId: string | null = null,
  shiftId: string | null = null,
): Drafts => ({
  userId,
  shiftId,
  work: emptyWorkDraft(),
  closeNote: '',
  checklists: {},
  passport: null,
});

/** Ключ пары для признаков загрузки — тем же составом, что и ключ хранилища. */
export function draftScopeKey(userId: string | null, shiftId: string | null): string {
  return `${userId ?? ''}::${shiftId ?? ''}`;
}

/** Черновики той же пары; пользователь или смена сменились — начинаем с чистого листа. */
export function draftsForScope(drafts: Drafts, userId: string | null, shiftId: string | null): Drafts {
  return drafts.userId === userId && drafts.shiftId === shiftId
    ? drafts
    : emptyDrafts(userId, shiftId);
}

/**
 * Паспорт после подтверждённой отправки.
 *
 * Отправленные строки залогов и отметки уходят; «константы проекта» — марка,
 * проектные величины, высота падения — остаются: подряд бьют одинаковые сваи по
 * одному проекту, и перевыбирать их каждый раз — лишние касания в перчатке.
 */
export function passportAfterSubmit(draft: PassportDraftData): PassportDraftData {
  return {
    ...emptyPassportDraft(),
    grade: draft.grade,
    designHead: draft.designHead,
    designRefusal: draft.designRefusal,
    dropHeight: draft.dropHeight,
  };
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
