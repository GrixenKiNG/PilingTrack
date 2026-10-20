import { formatRuDate } from '@/lib/format';
import { type FeedbackEventLevel, ROLE_LABELS } from '@/lib/types';

export type Meta = Record<string, unknown>;

/**
 * Как показать событие человеку. `level` и `message` — функции там, где текст
 * или срочность зависят от metadata; в остальных случаях просто строки.
 *
 * `level` определяет приоритет в ленте (см. recordAuditEvent), поэтому у всех
 * событий, кроме тех, где срочность назначена осознанно, он остаётся `audit`.
 */
export interface AuditDescription {
  level: FeedbackEventLevel | ((meta: Meta) => FeedbackEventLevel);
  title: string | ((meta: Meta) => string);
  message: string | ((meta: Meta) => string);
}

// ────────────────────────────────────────────
// Чтение metadata
// ────────────────────────────────────────────

/** Значение по пути вида `after.name`; недостающее звено даёт undefined, а не бросок. */
export function pick(meta: Meta, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Meta)[key] : undefined),
    meta,
  );
}

export function str(meta: Meta, path: string): string | null {
  const value = pick(meta, path);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function num(meta: Meta, path: string): number | null {
  const value = pick(meta, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Дата из metadata (Date или ISO-строка) → «ДД.ММ.ГГГГ»; иначе null. */
export function dateAt(meta: Meta, path: string): string | null {
  const value = pick(meta, path);
  const iso = value instanceof Date ? value.toISOString() : typeof value === 'string' ? value : null;
  if (!iso) return null;
  const formatted = formatRuDate(iso);
  return formatted === '—' ? null : formatted;
}

/**
 * Название затронутой записи. Команды кладут его по-разному: напрямую (`name`)
 * или внутри снимка до/после изменения — поэтому ищем во всех трёх местах.
 */
export function subject(meta: Meta): string | null {
  return str(meta, 'name') ?? str(meta, 'after.name') ?? str(meta, 'before.name');
}

/** «Текст: «Название».» — либо только текст, если названия в metadata не оказалось. */
export function withSubject(text: string, name: string | null): string {
  return name ? `${text}: «${name}».` : `${text}.`;
}

export function roleLabel(meta: Meta, path: string): string | null {
  const role = str(meta, path);
  if (!role) return null;
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
}

// Те же названия, что владелец видит на вкладках «Справочников», — иначе одна
// и та же сущность читается в двух местах по-разному.
export const DICTIONARY_TITLES: Record<string, string> = {
  pileGrade: 'Сваи',
  drillingType: 'Бурение',
  downtimeReason: 'Простои',
};

export function dictionaryLine(meta: Meta, verb: string, name: string | null): string {
  const title = DICTIONARY_TITLES[str(meta, 'type') ?? ''];
  const where = title ? `Справочник «${title}»` : 'Справочник';
  return name ? `${where}: ${verb} «${name}».` : `${where}: ${verb}.`;
}

// Проекции читают на витринах и в аналитике, а коды витрин (`site-daily`,
// `report-analytics`) владельцу ничего не говорят: в ленте должны стоять те же
// названия, что и на экране (F-R34-23).
export const PROJECTION_LABELS: Record<string, string> = {
  'site-daily': 'Сводка по объектам за день',
  'site-weekly': 'Недельный тренд по объектам',
  'report-analytics': 'Аналитика отчётов',
};

// Решение по свае в ленте читают словами, а не значением перечисления
// («NEEDS_REDRIVE» владельцу не говорит ничего).
export const PILE_ACCEPTANCE_LABELS: Record<string, string> = {
  PENDING: 'не разобрана',
  ACCEPTED: 'принята',
  NEEDS_REDRIVE: 'на добивку',
};

export function pileAcceptanceLabel(value: string | null): string | null {
  return value ? (PILE_ACCEPTANCE_LABELS[value] ?? value) : null;
}

// Вид техники и состояние допуска в ленте читают словами, а не кодами схемы
// («PILE_DRIVER, DENIED» владельцу не говорит ничего). Подписи совпадают с
// матрицей допусков (src/components/piling/to/readiness/screens/equipment-permit-labels.ts),
// но services/ не может зависеть от components/ — словари скопированы локально (F-R34-25).
export const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  PILE_DRIVER: 'Сваебойная установка',
  DRILLING_RIG: 'Буровая установка',
  VIBRO_HAMMER: 'Вибропогружатель',
  HYBRID: 'Комбинированная установка',
  OTHER: 'Прочая техника',
};

export const PERMIT_STATUS_LABELS: Record<string, string> = {
  ALLOWED: 'допущен',
  LIMITED: 'ограничен',
  DENIED: 'не допущен',
};

// Поля настроек так, как они называются на экране («Настройки организации»).
// Список переключателей уведомлений живёт в modules/settings, а services/ не
// может зависеть от modules/ (CLAUDE.md §1): уведомления подписаны общим словом,
// но направление переключателя показываем — «выключили оповещения об опасных
// дефектах» читается иначе, чем «включили сводки».
export const SETTINGS_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['companyName', 'название компании'],
  ['inn', 'ИНН'],
  ['timezone', 'часовой пояс'],
  ['dateFormat', 'формат даты'],
  ['units', 'единицы'],
  ['currency', 'валюта'],
];

/** Поля настроек, которые в этом событии действительно изменились. */
export function changedSettingsFields(meta: Meta): string[] {
  const fields = SETTINGS_FIELD_LABELS
    .filter(([key]) => pick(meta, `before.${key}`) !== pick(meta, `after.${key}`))
    .map(([, label]) => label);
  const toggles = notificationChangeLabel(meta);
  if (toggles) fields.push(toggles);
  return fields;
}

/** «уведомления (включено: 1, выключено: 2)» — либо null, если переключатели не трогали. */
export function notificationChangeLabel(meta: Meta): string | null {
  const before = pick(meta, 'before.notifications');
  const after = pick(meta, 'after.notifications');
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null) return null;

  const prev = before as Record<string, unknown>;
  const next = after as Record<string, unknown>;
  let on = 0;
  let off = 0;
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (prev[key] === next[key]) continue;
    if (next[key] === true) on += 1;
    else if (next[key] === false) off += 1;
  }

  const parts: string[] = [];
  if (on) parts.push(`включено: ${on}`);
  if (off) parts.push(`выключено: ${off}`);
  return parts.length ? `уведомления (${parts.join(', ')})` : null;
}

// Поля карточки установки так, как они называются на экране. Снимок, который
// кладёт api/equipment, содержит только изменившиеся поля — подпись получает
// ровно то, что поправили (F-R34-14).
export const EQUIPMENT_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['name', 'название'],
  ['model', 'модель'],
  ['description', 'описание'],
  ['qty', 'количество'],
  ['isActive', 'статус работы'],
];

/** Поля карточки установки, которые в этом событии действительно изменились. */
export function changedEquipmentFields(meta: Meta): string[] {
  return EQUIPMENT_FIELD_LABELS
    .filter(([key]) => pick(meta, `before.${key}`) !== pick(meta, `after.${key}`))
    .map(([, label]) => label);
}

// Вид и состояние наряда ТО — перечисления схемы («TO2», «IN_PROGRESS» ничего
// не говорят владельцу). Подписи совпадают с экраном нарядов
// (src/components/piling/maintenance/maintenance-labels.ts), но services/ не
// может зависеть от components/ — словари скопированы локально.
export const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  EO: 'ЕО',
  TO1: 'ТО-1',
  TO2: 'ТО-2',
  TO3: 'ТО-3',
  SEASONAL: 'сезонное',
  REPAIR: 'ремонт',
  FAULT: 'неисправность',
  SCHEDULED: 'плановое ТО',
  INSPECTION: 'осмотр',
};

export const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
  PLANNED: 'запланировано',
  ASSIGNED: 'назначено',
  IN_PROGRESS: 'в работе',
  ON_HOLD: 'приостановлено',
  DONE: 'выполнено',
  CANCELLED: 'отменено',
};

// Поля наряда, которые читают в ленте словами. Примечание о закрытии — это
// «выполненные работы» (закрытие в DONE) и «причина отмены» (отмена): обе
// пишутся ровно в момент закрытия и после него уже не меняются.
export const MAINTENANCE_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['cost', 'стоимость'],
  ['laborHours', 'трудозатраты'],
  ['engineHoursAtService', 'моточасы'],
  ['workDone', 'выполненные работы'],
  ['cancelReason', 'причина отмены'],
];

export function maintenanceTypeLabel(value: string | null): string | null {
  return value ? (MAINTENANCE_TYPE_LABELS[value] ?? value) : null;
}

export function maintenanceStatusLabel(value: string | null): string | null {
  return value ? (MAINTENANCE_STATUS_LABELS[value] ?? value) : null;
}

/**
 * Поля наряда, которые в этом событии действительно изменились. Статус — не
 * просто поле: в ленте видно, из какого состояния наряд перевели, поэтому он
 * идёт переходом («в работе → выполнено»), а не голым словом «статус».
 */
export function changedMaintenanceFields(meta: Meta): string[] {
  const fields: string[] = [];
  const beforeStatus = str(meta, 'before.status');
  const afterStatus = str(meta, 'after.status');
  if (beforeStatus !== afterStatus) {
    const from = maintenanceStatusLabel(beforeStatus);
    const to = maintenanceStatusLabel(afterStatus);
    fields.push(from && to && from !== to ? `статус: ${from} → ${to}` : 'статус');
  }
  for (const [key, label] of MAINTENANCE_FIELD_LABELS) {
    if (pick(meta, `before.${key}`) !== pick(meta, `after.${key}`)) fields.push(label);
  }
  return fields;
}

/** «Канал оповещений «Чат» (чат -100…): оповещения включены.» — без внутренних id. */
export function channelLine(verb: string, meta: Meta, tokenUpdated = false): string {
  const label = str(meta, 'label');
  const chatId = str(meta, 'chatId');
  const name = label ? `«${label}»` : 'Telegram';
  const chat = chatId ? ` (чат ${chatId})` : '';
  const state = pick(meta, 'enabled') === false ? 'оповещения выключены' : 'оповещения включены';
  const token = tokenUpdated ? ', токен бота заменён' : '';
  return `${verb}: ${name}${chat} — ${state}${token}.`;
}

// Элементы схемы объекта (поле/куст/пикет) называются по-разному, и род слова
// в фразе от них зависит: «Добавлен пикет», но «Добавлено поле». Пикет — ключ
// привязки выработки (PileWork.picketId), поэтому в ленте должно быть видно,
// какой именно узел схемы завели или убрали (F-R34-15). Внутренних id в тексте
// нет: itemId остаётся только в metadata.
export const HIERARCHY_TYPE_LINES: Record<string, { created: string; deleted: string }> = {
  field: { created: 'Добавлено поле', deleted: 'Удалено поле' },
  cluster: { created: 'Добавлен куст', deleted: 'Удалён куст' },
  picket: { created: 'Добавлен пикет', deleted: 'Удалён пикет' },
};

export function hierarchyLine(verb: 'created' | 'deleted', meta: Meta): string {
  const line = HIERARCHY_TYPE_LINES[str(meta, 'type') ?? ''];
  const what = line ? line[verb] : verb === 'created' ? 'Добавлен элемент схемы объекта' : 'Удалён элемент схемы объекта';
  const name = str(meta, 'name');
  return name ? `${what} «${name}».` : `${what}.`;
}

// Черновик сменного отчёта сдаёт не оператор, а планировщик — он закрывает
// смену по истечении производственных суток. Событие несёт признак autoClosed,
// а не человека за действием (F-R34-18). Оба признака разбираются в текстах
// ниже, поэтому проверка вынесена сюда.
export function autoSubmitted(meta: Meta): boolean {
  return pick(meta, 'data.autoClosed') === true;
}

// ────────────────────────────────────────────
// Действие → человеческий текст
// ────────────────────────────────────────────

