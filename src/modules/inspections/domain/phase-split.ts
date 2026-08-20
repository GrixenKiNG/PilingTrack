/**
 * Разделение ежесменного чек-листа на осмотр до работ и осмотр после работ.
 *
 * ЗАЧЕМ. ЕО — это не один осмотр, а два: перед пуском машину принимают, в конце
 * смены сдают. Руководства так и написаны: у Liebherr LRH 100 есть раздел
 * «После смены», у Woltman-PVE 50PR — «После смены», у Jintai SD-20 — «После
 * работы», у гидромолота PVE 7NL — «Контроль в процессе работы» и «После
 * окончания смены». Отдельного послесменного шаблона заводить не нужно: он уже
 * лежит внутри собранного чек-листа, его надо только отделить.
 *
 * ПОЧЕМУ ПО ЗАГОЛОВКУ РАЗДЕЛА, А НЕ ПО ПРИЗНАКУ В БАЗЕ. Признак пришлось бы
 * проставить руками в 60 разделах девяти шаблонов, и каждый новый шаблон
 * механика заводился бы без него — молча, с послесменным осмотром из нуля
 * пунктов. Заголовки же администратор пишет по-русски и осмысленно; правило
 * читает ровно те слова, которыми люди и называют конец смены. Если формулировка
 * не опознана, раздел остаётся предсменным — то есть спрашивается, а не теряется.
 *
 * «В ПРОЦЕССЕ РАБОТЫ» — К ПОСЛЕСМЕННОМУ. Температуру масла и стук в бегунке
 * нельзя проверить до пуска, а пункты обязательные: сегодня они висят в
 * предсменном осмотре и не дают его закрыть иначе как выдуманным ответом.
 * Спрашиваем о них тогда, когда на них есть ответ.
 */
export type ShiftInspectionPhase = 'PRE_SHIFT' | 'POST_SHIFT';
export type SectionPhase = 'PRE_SHIFT' | 'DURING_WORK' | 'POST_SHIFT';

const normalize = (title: string) =>
  title.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');

const POST_SHIFT_PATTERNS = [
  /после (окончания )?(смены|работ)/,
  /по окончании (смены|работ)/,
  /(в )?конце смены/,
];

const DURING_WORK_PATTERNS = [/в процессе работы/, /во время работы/];

/** К какой половине смены относится раздел чек-листа. */
export function sectionPhase(title: string): SectionPhase {
  const text = normalize(title);
  if (POST_SHIFT_PATTERNS.some((pattern) => pattern.test(text))) return 'POST_SHIFT';
  if (DURING_WORK_PATTERNS.some((pattern) => pattern.test(text))) return 'DURING_WORK';
  return 'PRE_SHIFT';
}

/**
 * Пункты одной фазы смены.
 *
 * Предсменный осмотр — только разделы приёмки. Послесменный — разделы конца
 * смены вместе с контролем в процессе работы.
 */
export function itemsForPhase<T extends { sectionTitle: string }>(
  items: readonly T[],
  phase: ShiftInspectionPhase,
): T[] {
  if (phase === 'PRE_SHIFT') {
    return items.filter((item) => sectionPhase(item.sectionTitle) === 'PRE_SHIFT');
  }
  // Порядок вопросов повторяет порядок работ: сначала то, что наблюдали в
  // смену, потом то, что делают при постановке машины. Сборка блоков даёт
  // другой порядок (база раньше молота), и без этого «После смены» базы
  // спрашивалось бы раньше, чем контроль в процессе работы молота.
  const during = items.filter((item) => sectionPhase(item.sectionTitle) === 'DURING_WORK');
  const after = items.filter((item) => sectionPhase(item.sectionTitle) === 'POST_SHIFT');
  return [...during, ...after];
}
