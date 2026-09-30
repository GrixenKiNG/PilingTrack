import { db } from '@/lib/db';
import { formatRuDate } from '@/lib/format';
import { logger } from '@/lib/logger';
import { ROLE_LABELS, type FeedbackEventLevel } from '@/lib/types';
import { recordFeedbackEvent } from '@/services/feedback/feedback-event-service';

export interface AuditEvent {
  action: string;
  scope: string;
  actorId?: string | null;
  targetId?: string | null;
  tenantId?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

type Meta = Record<string, unknown>;

/**
 * Как показать событие человеку. `level` и `message` — функции там, где текст
 * или срочность зависят от metadata; в остальных случаях просто строки.
 *
 * `level` определяет приоритет в ленте (см. recordAuditEvent), поэтому у всех
 * событий, кроме тех, где срочность назначена осознанно, он остаётся `audit`.
 */
interface AuditDescription {
  level: FeedbackEventLevel | ((meta: Meta) => FeedbackEventLevel);
  title: string | ((meta: Meta) => string);
  message: string | ((meta: Meta) => string);
}

// ────────────────────────────────────────────
// Чтение metadata
// ────────────────────────────────────────────

/** Значение по пути вида `after.name`; недостающее звено даёт undefined, а не бросок. */
function pick(meta: Meta, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (node, key) => (node && typeof node === 'object' ? (node as Meta)[key] : undefined),
    meta,
  );
}

function str(meta: Meta, path: string): string | null {
  const value = pick(meta, path);
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function num(meta: Meta, path: string): number | null {
  const value = pick(meta, path);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Дата из metadata (Date или ISO-строка) → «ДД.ММ.ГГГГ»; иначе null. */
function dateAt(meta: Meta, path: string): string | null {
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
function subject(meta: Meta): string | null {
  return str(meta, 'name') ?? str(meta, 'after.name') ?? str(meta, 'before.name');
}

/** «Текст: «Название».» — либо только текст, если названия в metadata не оказалось. */
function withSubject(text: string, name: string | null): string {
  return name ? `${text}: «${name}».` : `${text}.`;
}

function roleLabel(meta: Meta, path: string): string | null {
  const role = str(meta, path);
  if (!role) return null;
  return ROLE_LABELS[role as keyof typeof ROLE_LABELS] ?? role;
}

// Те же названия, что владелец видит на вкладках «Справочников», — иначе одна
// и та же сущность читается в двух местах по-разному.
const DICTIONARY_TITLES: Record<string, string> = {
  pileGrade: 'Сваи',
  drillingType: 'Бурение',
  downtimeReason: 'Простои',
};

function dictionaryLine(meta: Meta, verb: string, name: string | null): string {
  const title = DICTIONARY_TITLES[str(meta, 'type') ?? ''];
  const where = title ? `Справочник «${title}»` : 'Справочник';
  return name ? `${where}: ${verb} «${name}».` : `${where}: ${verb}.`;
}

// Проекции читают на витринах и в аналитике, а коды витрин (`site-daily`,
// `report-analytics`) владельцу ничего не говорят: в ленте должны стоять те же
// названия, что и на экране (F-R34-23).
const PROJECTION_LABELS: Record<string, string> = {
  'site-daily': 'Сводка по объектам за день',
  'site-weekly': 'Недельный тренд по объектам',
  'report-analytics': 'Аналитика отчётов',
};

// Решение по свае в ленте читают словами, а не значением перечисления
// («NEEDS_REDRIVE» владельцу не говорит ничего).
const PILE_ACCEPTANCE_LABELS: Record<string, string> = {
  PENDING: 'не разобрана',
  ACCEPTED: 'принята',
  NEEDS_REDRIVE: 'на добивку',
};

function pileAcceptanceLabel(value: string | null): string | null {
  return value ? (PILE_ACCEPTANCE_LABELS[value] ?? value) : null;
}

// Вид техники и состояние допуска в ленте читают словами, а не кодами схемы
// («PILE_DRIVER, DENIED» владельцу не говорит ничего). Подписи совпадают с
// матрицей допусков (src/components/piling/to/readiness/screens/equipment-permit-labels.ts),
// но services/ не может зависеть от components/ — словари скопированы локально (F-R34-25).
const EQUIPMENT_KIND_LABELS: Record<string, string> = {
  PILE_DRIVER: 'Сваебойная установка',
  DRILLING_RIG: 'Буровая установка',
  VIBRO_HAMMER: 'Вибропогружатель',
  HYBRID: 'Комбинированная установка',
  OTHER: 'Прочая техника',
};

const PERMIT_STATUS_LABELS: Record<string, string> = {
  ALLOWED: 'допущен',
  LIMITED: 'ограничен',
  DENIED: 'не допущен',
};

// Поля настроек так, как они называются на экране («Настройки организации»).
// Список переключателей уведомлений живёт в modules/settings, а services/ не
// может зависеть от modules/ (CLAUDE.md §1): уведомления подписаны общим словом,
// но направление переключателя показываем — «выключили оповещения об опасных
// дефектах» читается иначе, чем «включили сводки».
const SETTINGS_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['companyName', 'название компании'],
  ['inn', 'ИНН'],
  ['timezone', 'часовой пояс'],
  ['dateFormat', 'формат даты'],
  ['units', 'единицы'],
  ['currency', 'валюта'],
];

/** Поля настроек, которые в этом событии действительно изменились. */
function changedSettingsFields(meta: Meta): string[] {
  const fields = SETTINGS_FIELD_LABELS
    .filter(([key]) => pick(meta, `before.${key}`) !== pick(meta, `after.${key}`))
    .map(([, label]) => label);
  const toggles = notificationChangeLabel(meta);
  if (toggles) fields.push(toggles);
  return fields;
}

/** «уведомления (включено: 1, выключено: 2)» — либо null, если переключатели не трогали. */
function notificationChangeLabel(meta: Meta): string | null {
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
const EQUIPMENT_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['name', 'название'],
  ['model', 'модель'],
  ['description', 'описание'],
  ['qty', 'количество'],
  ['isActive', 'статус работы'],
];

/** Поля карточки установки, которые в этом событии действительно изменились. */
function changedEquipmentFields(meta: Meta): string[] {
  return EQUIPMENT_FIELD_LABELS
    .filter(([key]) => pick(meta, `before.${key}`) !== pick(meta, `after.${key}`))
    .map(([, label]) => label);
}

// Вид и состояние наряда ТО — перечисления схемы («TO2», «IN_PROGRESS» ничего
// не говорят владельцу). Подписи совпадают с экраном нарядов
// (src/components/piling/maintenance/maintenance-labels.ts), но services/ не
// может зависеть от components/ — словари скопированы локально.
const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
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

const MAINTENANCE_STATUS_LABELS: Record<string, string> = {
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
const MAINTENANCE_FIELD_LABELS: ReadonlyArray<readonly [string, string]> = [
  ['cost', 'стоимость'],
  ['laborHours', 'трудозатраты'],
  ['engineHoursAtService', 'моточасы'],
  ['workDone', 'выполненные работы'],
  ['cancelReason', 'причина отмены'],
];

function maintenanceTypeLabel(value: string | null): string | null {
  return value ? (MAINTENANCE_TYPE_LABELS[value] ?? value) : null;
}

function maintenanceStatusLabel(value: string | null): string | null {
  return value ? (MAINTENANCE_STATUS_LABELS[value] ?? value) : null;
}

/**
 * Поля наряда, которые в этом событии действительно изменились. Статус — не
 * просто поле: в ленте видно, из какого состояния наряд перевели, поэтому он
 * идёт переходом («в работе → выполнено»), а не голым словом «статус».
 */
function changedMaintenanceFields(meta: Meta): string[] {
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
function channelLine(verb: string, meta: Meta, tokenUpdated = false): string {
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
const HIERARCHY_TYPE_LINES: Record<string, { created: string; deleted: string }> = {
  field: { created: 'Добавлено поле', deleted: 'Удалено поле' },
  cluster: { created: 'Добавлен куст', deleted: 'Удалён куст' },
  picket: { created: 'Добавлен пикет', deleted: 'Удалён пикет' },
};

function hierarchyLine(verb: 'created' | 'deleted', meta: Meta): string {
  const line = HIERARCHY_TYPE_LINES[str(meta, 'type') ?? ''];
  const what = line ? line[verb] : verb === 'created' ? 'Добавлен элемент схемы объекта' : 'Удалён элемент схемы объекта';
  const name = str(meta, 'name');
  return name ? `${what} «${name}».` : `${what}.`;
}

// Черновик сменного отчёта сдаёт не оператор, а планировщик — он закрывает
// смену по истечении производственных суток. Событие несёт признак autoClosed,
// а не человека за действием (F-R34-18). Оба признака разбираются в текстах
// ниже, поэтому проверка вынесена сюда.
function autoSubmitted(meta: Meta): boolean {
  return pick(meta, 'data.autoClosed') === true;
}

// ────────────────────────────────────────────
// Действие → человеческий текст
// ────────────────────────────────────────────

/**
 * Ленту читает владелец, а не программист: машинный код действия
 * («user.document_type.created») и фраза «Событие аудита в контуре users» не
 * сообщают ему ни что произошло, ни с чем. Журнал, который невозможно
 * прочитать, контролем не является.
 *
 * Добавляя новый recordAuditEvent, добавьте сюда строку — иначе событие снова
 * уедет в общий default и в ленте появится машинный код.
 */
const AUDIT_DESCRIPTIONS: Record<string, AuditDescription> = {
  // ── Вход и выход ──
  'auth.login.succeeded': {
    level: 'success',
    title: 'Успешный вход',
    message: 'Пользователь успешно вошёл в систему.',
  },
  'auth.login.failed': {
    level: 'warn',
    title: 'Ошибка входа',
    message: 'Попытка входа завершилась ошибкой авторизации.',
  },
  'auth.login.rate_limited': {
    level: 'warn',
    title: 'Слишком много попыток входа',
    message: 'Сработало ограничение по частоте попыток входа.',
  },
  // Маршрут выхода пишет короткое имя; длинное оставлено для совместимости.
  'auth.logout': {
    level: 'info',
    title: 'Выход выполнен',
    message: 'Сессия пользователя была завершена.',
  },
  'auth.logout.succeeded': {
    level: 'info',
    title: 'Выход выполнен',
    message: 'Сессия пользователя была завершена.',
  },
  'auth.pin.succeeded': {
    level: 'audit',
    title: 'Вход по ПИН-коду',
    message: (m) => {
      const email = str(m, 'email');
      return email ? `Вход по ПИН-коду выполнен: ${email}.` : 'Вход по ПИН-коду выполнен.';
    },
  },
  'auth.pin.failed': {
    level: 'audit',
    title: 'Неверный ПИН-код',
    message: 'Попытка входа по ПИН-коду отклонена.',
  },
  'auth.pin.rate_limited': {
    level: 'audit',
    title: 'Слишком много попыток ПИН-кода',
    message: (m) => {
      const retryAfter = num(m, 'retryAfter');
      return retryAfter === null
        ? 'Вход по ПИН-коду временно заблокирован по частоте попыток.'
        : `Вход по ПИН-коду временно заблокирован, повтор через ${retryAfter} с.`;
    },
  },

  // ── Отчёты ──
  'report.created': {
    level: 'success',
    title: 'Отчёт создан',
    message: 'Новый производственный отчёт сохранён в системе.',
  },
  'report.updated': {
    level: 'info',
    title: 'Отчёт обновлён',
    message: 'Отчёт был изменён и повторно сохранён.',
  },
  // Доменные события отчёта приходят вторым следом — из обработчика outbox, а
  // не из команды, поэтому имена у них в исходном виде (PascalCase).
  ReportCreated: {
    level: 'audit',
    title: 'Отчёт создан',
    message: 'Создание отчёта зарегистрировано в журнале событий.',
  },
  ReportUpdated: {
    level: 'audit',
    title: 'Отчёт изменён',
    message: 'Изменение отчёта зарегистрировано в журнале событий.',
  },
  ReportSubmitted: {
    level: 'audit',
    title: (m) => (autoSubmitted(m) ? 'Отчёт сдан автоматически при закрытии смены' : 'Отчёт сдан'),
    message: (m) => {
      // Автосдачу сделал планировщик: подписывать запись оператором неправда, а
      // без его имени непонятно, чей отчёт закрылся. Актора у такой записи нет
      // (actorId: null), поэтому владельца отчёта называем в тексте.
      if (!autoSubmitted(m)) return 'Отчёт передан на проверку.';
      const name = str(m, 'operatorName');
      return name
        ? `Смена закрыта автоматически: отчёт оператора ${name} сдан системой.`
        : 'Смена закрыта автоматически: отчёт сдан системой.';
    },
  },
  ReportVersionCreated: {
    level: 'audit',
    title: 'Создана версия отчёта',
    message: (m) => {
      const version = num(m, 'version');
      return version === null
        ? 'Сохранена новая версия отчёта.'
        : `Сохранена версия отчёта № ${version}.`;
    },
  },

  // ── Сваи ──
  // Решение мастера перетирает прежнее: acceptance/acceptedById/acceptedAt —
  // те же колонки, и второе решение стирает первое (F-R34-16). Снимок «before»
  // в metadata — единственное место, где видно, что сваю сперва приняли, а
  // потом отправили на добивку.
  'pile.passport.decided': {
    level: 'audit',
    title: 'Решение по свае',
    message: (m) => {
      const pile = str(m, 'pileNumber');
      const where = pile ? `Свая «${pile}»` : 'Свая';
      const beforeRaw = str(m, 'before.acceptance');
      const afterRaw = str(m, 'after.acceptance');
      const after = pileAcceptanceLabel(afterRaw);
      // Переход показываем только когда прежнее решение уже было: «PENDING» —
      // это «ещё не решали», а не предыдущее решение мастера.
      if (beforeRaw && beforeRaw !== 'PENDING' && afterRaw && beforeRaw !== afterRaw) {
        return `${where}: решение изменено — ${pileAcceptanceLabel(beforeRaw)} → ${after}.`;
      }
      return after ? `${where}: ${after}.` : `${where}: решение мастера записано.`;
    },
  },

  // ── Объекты ──
  'site.created': {
    level: 'audit',
    title: 'Объект создан',
    message: (m) => withSubject('Создан объект', subject(m)),
  },
  'site.updated': {
    level: 'audit',
    title: 'Объект изменён',
    message: (m) => withSubject('Изменён объект', subject(m)),
  },
  'site.deleted': {
    level: 'audit',
    title: 'Объект удалён',
    message: (m) => withSubject('Удалён объект', subject(m)),
  },
  'site.activated': {
    level: 'audit',
    title: 'Объект снова в работе',
    message: (m) => withSubject('Объект возвращён в работу', subject(m)),
  },
  'site.deactivated': {
    level: 'audit',
    title: 'Объект выведен из работы',
    message: (m) => withSubject('Объект выведен из работы', subject(m)),
  },
  'site.completed': {
    level: 'info',
    title: 'Объект отмечен выполненным',
    message: 'Работы на объекте отмечены как завершённые.',
  },
  'site.completion_cleared': {
    level: 'info',
    title: 'Отметка выполнения снята',
    message: 'Объект возвращён в работу.',
  },
  'site.user_assigned': {
    level: 'audit',
    title: 'Доступ к объекту открыт',
    message: 'Сотрудник закреплён за объектом.',
  },
  'site.user_unassigned': {
    level: 'audit',
    title: 'Доступ к объекту закрыт',
    message: 'Сотрудник откреплён от объекта.',
  },
  // Схема объекта: поле/куст/пикет. Строки после удаления уже нет, а пикет —
  // ключ привязки выработки (PileWork.picketId), поэтому создание и удаление
  // узла должны быть видно в ленте (F-R34-15).
  'site.hierarchy.created': {
    level: 'audit',
    title: 'Элемент схемы объекта добавлен',
    message: (m) => hierarchyLine('created', m),
  },
  'site.hierarchy.deleted': {
    level: 'audit',
    title: 'Элемент схемы объекта удалён',
    message: (m) => hierarchyLine('deleted', m),
  },

  // ── Бригады ──
  'crew.created': {
    level: 'audit',
    title: 'Бригада создана',
    message: (m) => withSubject('Создана бригада', subject(m)),
  },
  'crew.updated': {
    level: 'audit',
    title: 'Бригада изменена',
    message: (m) => withSubject('Изменён состав бригады', subject(m)),
  },
  'crew.deleted': {
    level: 'audit',
    title: 'Бригада расформирована',
    message: (m) => withSubject('Расформирована бригада', subject(m)),
  },

  // ── Справочники ──
  'dictionary.created': {
    level: 'audit',
    title: 'Справочник дополнен',
    message: (m) => dictionaryLine(m, 'добавлена запись', subject(m)),
  },
  'dictionary.renamed': {
    level: 'audit',
    title: 'Запись справочника переименована',
    message: (m) => {
      const from = str(m, 'before.name');
      const to = str(m, 'after.name');
      return from && to
        ? dictionaryLine(m, `запись «${from}» переименована в`, to)
        : dictionaryLine(m, 'переименована запись', subject(m));
    },
  },
  'dictionary.deleted': {
    level: 'audit',
    title: 'Запись справочника удалена',
    message: (m) => dictionaryLine(m, 'удалена запись', subject(m)),
  },
  'dictionary.archived': {
    level: 'audit',
    title: 'Запись справочника скрыта',
    message: (m) => dictionaryLine(m, 'скрыта запись', subject(m)),
  },
  'dictionary.restored': {
    level: 'audit',
    title: 'Запись справочника возвращена',
    message: (m) => dictionaryLine(m, 'возвращена запись', subject(m)),
  },
  'dictionary.length_updated': {
    level: 'audit',
    title: 'Изменена длина марки сваи',
    message: (m) => {
      // Длина хранится в миллиметрах, а читают её в метрах — по ней считается м.п.
      const mm = num(m, 'after.lengthMm');
      const length = mm === null ? 'не указана' : `${Number((mm / 1000).toFixed(2))} м`;
      const name = subject(m);
      return name ? `Марка сваи «${name}»: длина ${length}.` : `Длина марки сваи: ${length}.`;
    },
  },
  'dictionary.section_updated': {
    level: 'audit',
    title: 'Изменено сечение марки сваи',
    message: (m) => {
      const section = str(m, 'after.sectionOrDiameter') ?? 'не указано';
      const name = subject(m);
      return name
        ? `Марка сваи «${name}»: сечение (диаметр) ${section}.`
        : `Сечение (диаметр) марки сваи: ${section}.`;
    },
  },

  // ── Пользователи ──
  'user.created': {
    level: 'audit',
    title: 'Пользователь создан',
    message: (m) => {
      const email = str(m, 'email');
      const role = roleLabel(m, 'role');
      if (email && role) return `Заведена учётная запись ${email}, роль «${role}».`;
      return email ? `Заведена учётная запись ${email}.` : 'Заведена новая учётная запись.';
    },
  },
  'user.updated': {
    level: 'audit',
    title: 'Пользователь изменён',
    message: (m) => {
      const email = str(m, 'after.email') ?? str(m, 'before.email');
      const who = email ? `Изменена учётная запись ${email}` : 'Изменена учётная запись';
      // Смена роли меняет права, поэтому её видно в самой строке, а не только в metadata.
      const before = roleLabel(m, 'before.role');
      const after = roleLabel(m, 'after.role');
      return before && after && before !== after ? `${who}, роль: ${before} → ${after}.` : `${who}.`;
    },
  },
  'user.deleted': {
    level: 'audit',
    title: 'Пользователь удалён',
    message: (m) => {
      const email = str(m, 'email');
      return email ? `Удалена учётная запись ${email}.` : 'Удалена учётная запись.';
    },
  },

  // ── Виды документов работника ──
  'user.document_type.created': {
    level: 'audit',
    title: 'Заведён вид документа работника',
    message: (m) => withSubject('Добавлен вид документа', subject(m)),
  },
  'user.document_type.updated': {
    level: 'audit',
    title: 'Изменён вид документа работника',
    message: (m) => withSubject('Изменён вид документа', subject(m)),
  },
  'user.document_type.deleted': {
    level: 'audit',
    title: 'Удалён вид документа работника',
    message: (m) => withSubject('Удалён вид документа', subject(m)),
  },

  // ── Документы работника ──
  // Работник ведёт их сам, поэтому запись в журнале — единственное, что
  // показывает диспетчеру, кто и когда трогал срок действия.
  'user.document.created': {
    level: 'info',
    title: 'Документ работника добавлен',
    message: (m) =>
      m.selfService ? 'Работник приложил свой документ.' : 'Документ работника заведён администратором.',
  },
  'user.document.updated': {
    level: (m) => (m.selfService ? 'warn' : 'info'),
    title: 'Документ работника изменён',
    message: (m) =>
      m.selfService
        ? 'Работник изменил собственный документ — проверьте срок действия.'
        : 'Документ работника изменён администратором.',
  },
  'user.document.deleted': {
    level: 'warn',
    title: 'Документ работника удалён',
    message: (m) =>
      m.selfService ? 'Работник удалил собственный документ.' : 'Документ работника удалён администратором.',
  },
  // Строка матрицы перезаписывается и удаляется целиком (см. modules/safety/
  // equipment-permits): кто и когда выдал или снял допуск, помнит только лента.
  'user.equipment_permit.saved': {
    level: 'audit',
    title: 'Допуск к технике выдан или изменён',
    message: (m) => {
      const kind = str(m, 'equipmentKind');
      const status = str(m, 'status');
      const kindText = kind ? (EQUIPMENT_KIND_LABELS[kind] ?? kind) : '—';
      const statusText = status ? (PERMIT_STATUS_LABELS[status] ?? status) : '—';
      return `Допуск работника к технике: ${kindText}, ${statusText}.`;
    },
  },
  'user.equipment_permit.deleted': {
    level: 'warn',
    title: 'Допуск к технике удалён',
    message: 'Строка матрицы допусков удалена администратором.',
  },

  // ── Настройки организации ──
  // Часовой пояс задаёт границы производственных суток и периоды отчётов,
  // переключатель уведомления — объём оповещений: без строки в ленте смена
  // настроек неотличима от «никто не менял».
  'settings.updated': {
    level: 'audit',
    title: 'Настройки изменены',
    message: (m) => {
      const fields = changedSettingsFields(m);
      return fields.length
        ? `Изменены настройки: ${fields.join(', ')}.`
        : 'Настройки организации сохранены.';
    },
  },

  // ── Каналы оповещений Telegram ──
  // Канал решает, кто получит сообщение о дефекте или простое, поэтому в ленте
  // должно быть видно, какой чат завели, поправили или удалили. Токена бота в
  // metadata нет ни в каком виде (снимок собирает api/telegram/configs):
  // виден только факт его замены.
  'telegram.config.created': {
    level: 'audit',
    title: 'Канал оповещений создан',
    message: (m) => channelLine('Создан канал оповещений', m),
  },
  'telegram.config.updated': {
    level: 'audit',
    title: 'Канал оповещений изменён',
    message: (m) => channelLine('Изменён канал оповещений', m, pick(m, 'tokenUpdated') === true),
  },
  'telegram.config.deleted': {
    level: 'warn',
    title: 'Канал оповещений удалён',
    message: (m) => channelLine('Удалён канал оповещений', m),
  },

  // ── Техника: карточка установки ──
  // Выведенная из эксплуатации установка перестаёт допускаться к работе, а
  // удаление уничтожает карточку целиком: без следа в ленте и то, и другое
  // неотличимо от «никто не менял» (F-R34-14). Внутренних id в тексте нет —
  // только название, модель и то, что видно на экране.
  'equipment.created': {
    level: 'audit',
    title: 'Установка заведена',
    message: (m) => withSubject('Заведена установка', subject(m)),
  },
  'equipment.updated': {
    level: 'audit',
    title: 'Установка изменена',
    message: (m) => {
      const name = subject(m);
      const where = name ? `Установка «${name}»` : 'Установка';
      const fields = changedEquipmentFields(m);
      return fields.length
        ? `${where}: изменено — ${fields.join(', ')}.`
        : `${where}: изменения сохранены.`;
    },
  },
  'equipment.retired': {
    level: 'audit',
    title: 'Установка выведена из эксплуатации',
    message: (m) => withSubject('Установка выведена из эксплуатации', subject(m)),
  },
  'equipment.deleted': {
    level: 'warn',
    title: 'Установка удалена',
    message: (m) => {
      const model = str(m, 'before.model');
      const what = model ? `Удалена установка (${model})` : 'Удалена установка';
      return withSubject(what, subject(m));
    },
  },

  // ── Техника: моточасы ──
  // Запись показания двигает наработку (Equipment.engineHoursTotal) и сроки
  // ТО, поэтому в ленте нужна пара «внёс — стёр»: без первой строки удаление
  // читается перевёрнуто (F-R72-FEED-METER-MAINT). Название установки и
  // значение — без внутренних id.
  'meter.reading.added': {
    level: 'info',
    title: 'Показание моточасов внесено',
    message: (m) => {
      const hours = num(m, 'after.engineHours');
      const value = hours === null ? '' : ` ${hours} м/ч`;
      const equipment = subject(m);
      return equipment
        ? `Внесено показание моточасов${value} — «${equipment}».`
        : `Внесено показание моточасов${value}.`;
    },
  },
  // Удаление показания меняет наработку (Equipment.engineHoursTotal) и сроки
  // ТО, а самой строки показания после этого уже нет: кто и какую цифру стёр,
  // видно только здесь. Название установки и снятое значение — без внутренних
  // id (F-R34-13).
  'meter.reading.deleted': {
    level: 'warn',
    title: 'Показание моточасов удалено',
    message: (m) => {
      const hours = num(m, 'before.engineHours');
      const value = hours === null ? '' : ` ${hours} м/ч`;
      return withSubject(`Удалено показание моточасов${value}`, subject(m));
    },
  },

  // ── Техника: удаление записи топлива, регламента ТО и документа ──
  // Самих строк после удаления не остаётся, а по ним считают расход топлива,
  // сроки обслуживания и допуск машины к работе: в ленте должно быть видно, у
  // какой установки что именно убрали (F-R39-3). Внутренних id в тексте нет.
  'equipment.fuel.deleted': {
    level: 'warn',
    title: 'Запись о топливе удалена',
    message: (m) => {
      const liters = num(m, 'before.litersAdded');
      const date = dateAt(m, 'before.recordedAt');
      const volume = liters === null ? '' : ` ${liters} л`;
      const when = date ? ` от ${date}` : '';
      return withSubject(`Удалена запись о топливе${volume}${when}`, subject(m));
    },
  },
  'maintenance.plan.deleted': {
    level: 'warn',
    title: 'Регламент ТО удалён',
    message: (m) => {
      const plan = str(m, 'before.title');
      const hours = num(m, 'before.intervalHours');
      const days = num(m, 'before.intervalDays');
      const interval = hours !== null ? `каждые ${hours} м/ч` : days !== null ? `каждые ${days} дн.` : null;
      const what = plan ? `Удалён регламент «${plan}»` : 'Удалён регламент ТО';
      return withSubject(interval ? `${what}, ${interval}` : what, subject(m));
    },
  },
  'equipment.document.deleted': {
    level: 'warn',
    title: 'Документ установки удалён',
    message: (m) => {
      const title = str(m, 'before.title');
      const expires = dateAt(m, 'before.expiresAt');
      const what = title ? `Удалён документ «${title}»` : 'Удалён документ установки';
      return withSubject(expires ? `${what} (срок до ${expires})` : what, subject(m));
    },
  },

  // ── Пересборка проекций ──
  // Пересборка меняет цифры витрин и аналитики по одному запросу, и без строки
  // в ленте на вопрос «почему у меня другие числа, чем вчера» ответить нечем:
  // запись называет, какие витрины пересобрали и сколько строк записали, и
  // оставляет актора (F-R34-23). Имена проекций — по-русски, без кодов схемы.
  'projections.rebuilt': {
    level: 'audit',
    title: 'Проекции пересобраны',
    message: (m) => {
      const names = Array.isArray(m.names)
        ? m.names.map((name) => PROJECTION_LABELS[String(name)] ?? String(name))
        : [];
      const what = names.length ? `Пересобраны проекции: ${names.join(', ')}` : 'Проекции пересобраны';
      const rows = num(m, 'rowsWritten');
      return rows === null ? `${what}.` : `${what} — записано строк: ${rows}.`;
    },
  },

  // ── Техника: наряды ТО ──
  // Заведение, правка/закрытие/отмена и приёмка наряда не оставляли следа
  // (F-R34-12). Правку стоимости, трудозатрат и моточасов после закрытия в
  // другом месте не увидеть: строка хранит только последнее значение, а
  // принятый наряд вообще закрыт на изменение. Внутренних id в тексте нет —
  // только название наряда и человеческие подписи вида и состояния.
  'maintenance.created': {
    level: 'audit',
    title: 'Наряд ТО заведён',
    message: (m) => {
      const name = subject(m);
      const type = maintenanceTypeLabel(str(m, 'after.type'));
      const what = name ? `Создан наряд ТО «${name}»` : 'Создан наряд ТО';
      return type ? `${what} (${type}).` : `${what}.`;
    },
  },
  'maintenance.updated': {
    level: 'audit',
    title: 'Наряд ТО изменён',
    message: (m) => {
      const name = subject(m);
      const where = name ? `Наряд ТО «${name}»` : 'Наряд ТО';
      const fields = changedMaintenanceFields(m);
      return fields.length
        ? `${where}: изменено — ${fields.join(', ')}.`
        : `${where}: изменения сохранены.`;
    },
  },
  'maintenance.accepted': {
    level: 'audit',
    title: 'Наряд ТО принят',
    message: (m) => {
      const name = subject(m);
      return name ? `Наряд ТО «${name}» принят администратором.` : 'Наряд ТО принят администратором.';
    },
  },
  // Удаление наряда ТО не оставляло следа нигде, хотя создание, правка и
  // приёмка того же наряда писались (F-R72-FEED-METER-MAINT). Удалить можно и
  // открытый наряд, который держит блокер по ремонту, поэтому в ленте нужен
  // снимок до удаления: вид ТО, состояние, плановая дата и установка. Внутренних
  // id в тексте нет.
  'maintenance.record.deleted': {
    level: 'warn',
    title: 'Наряд ТО удалён',
    message: (m) => {
      const name = subject(m);
      const type = maintenanceTypeLabel(str(m, 'before.type'));
      const status = maintenanceStatusLabel(str(m, 'before.status'));
      const scheduled = dateAt(m, 'before.scheduledAt');
      const equipment = str(m, 'before.equipmentName');
      const what = name ? `Удалён наряд ТО «${name}»` : 'Удалён наряд ТО';
      const details = [type, status, scheduled ? `плановая дата ${scheduled}` : null]
        .filter(Boolean)
        .join(', ');
      const line = details ? `${what} (${details})` : what;
      return equipment ? `${line}: установка «${equipment}».` : `${line}.`;
    },
  },

  // ── Осмотры: завершение ──
  // Завершение осмотра — самый «допусковый» акт в системе: считается балл
  // состояния, закрывается наряд ТО, пишутся моточасы и заводятся дефекты, — а
  // следа в ленте не было вовсе (F-R72-FEED-INSPECTION). Срочность зависит от
  // итога: неполный балл означает найденные неисправности (тем же признаком
  // считается `findings` в готовности — `readiness-facts.ts`), а заведённые
  // дефекты держат блокер. В тексте — название установки, уровень осмотра и
  // балл, без внутренних id.
  'inspection.completed': {
    level: (m) => {
      const score = num(m, 'after.healthScore');
      const defects = num(m, 'after.defectCount');
      return (score !== null && score < 100) || (defects !== null && defects > 0) ? 'warn' : 'info';
    },
    title: 'Осмотр завершён',
    message: (m) => {
      const equipment = subject(m);
      const level = maintenanceTypeLabel(str(m, 'after.level'));
      const score = num(m, 'after.healthScore');
      const defects = num(m, 'after.defectCount');
      const result = [level, score === null ? null : `балл ${score}%`].filter(Boolean).join(', ');
      const what = equipment ? `Осмотр завершён — «${equipment}»` : 'Осмотр завершён';
      const line = result ? `${what}: ${result}` : what;
      return defects === null ? `${line}.` : `${line}, дефектов ${defects}.`;
    },
  },
};

/**
 * Экспортируется ради разового пересчёта старых строк ленты
 * (`scripts/backfill-audit-feed-text.ts`): тексты должны считаться той же
 * функцией, что пишет новые события, иначе история разойдётся с текущей лентой.
 */
export function describeAuditEvent(event: AuditEvent) {
  const description = AUDIT_DESCRIPTIONS[event.action];
  if (!description) {
    return {
      level: 'audit' as FeedbackEventLevel,
      title: event.action,
      message: `Событие аудита в контуре ${event.scope}.`,
    };
  }

  const meta = event.metadata ?? {};
  return {
    level: typeof description.level === 'function' ? description.level(meta) : description.level,
    title: typeof description.title === 'function' ? description.title(meta) : description.title,
    message: typeof description.message === 'function' ? description.message(meta) : description.message,
  };
}

/**
 * Лента `/admin` рисует «Инициатора» только при заполненном `actorName`
 * (feedback-center.tsx), поэтому одного `id` для читаемого следа мало.
 * Имя и роль — украшение записи: сбой их чтения не повод терять событие,
 * поэтому здесь глушится только он, а не запись следа целиком.
 */
async function resolveActor(event: AuditEvent) {
  if (!event.actorId) return null;

  try {
    const user = await db.user.findUnique({
      where: { id: event.actorId },
      select: { name: true, role: true },
    });
    return user ? { id: event.actorId, name: user.name, role: user.role } : { id: event.actorId };
  } catch (error) {
    logger.warn('audit.actor_lookup_failed', {
      actorId: event.actorId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { id: event.actorId };
  }
}

export async function recordAuditEvent(event: AuditEvent): Promise<void> {
  logger.info('audit', event as unknown as Record<string, unknown>);

  try {
    const description = describeAuditEvent(event);
    await recordFeedbackEvent({
      level: description.level,
      priority:
        description.level === 'warn'
          ? 'HIGH'
          : description.level === 'success'
            ? 'LOW'
            : 'MEDIUM',
      scope: event.scope,
      action: event.action,
      title: description.title,
      message: description.message,
      audience: 'OPERATIONS',
      actor: await resolveActor(event),
      targetId: event.targetId || null,
      requestId: event.requestId || null,
      metadata: event.metadata || null,
    });
  } catch (error) {
    // Запись следа не должна ронять основное действие — но и пропадать
    // бесследно тоже: без этой строки отказ ленты не оставлял ничего в логах.
    logger.warn('audit.feedback_write_failed', {
      action: event.action,
      scope: event.scope,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
