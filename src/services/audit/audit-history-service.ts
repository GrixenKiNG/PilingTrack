import { db } from '@/lib/db';
import { requireTenantId } from '@/lib/tenant-scope';

/** Normalized history entry — matches OpsHistoryEntry consumed by OpsHistoryList. */
export interface AuditHistoryEntry {
  id: string;
  action: string;
  title: string;
  meta: string | null;
  at: string;
  changes?: Array<{ label: string; before: string; after: string }>;
}

const ACTION_LABELS: Record<string, string> = {
  'crew.created': 'Бригада создана',
  'crew.updated': 'Бригада изменена',
  'crew.deleted': 'Бригада удалена',
  'site.created': 'Объект создан',
  'site.updated': 'Объект изменён',
  'site.deactivated': 'Объект архивирован',
  'site.completed': 'Объект отмечен выполненным',
  'site.completion_cleared': 'Отметка выполнения снята',
  'site.deleted': 'Объект удалён',
  'user.created': 'Пользователь создан',
  'user.updated': 'Пользователь изменён',
  'user.deleted': 'Пользователь удалён',
  // Виды документов, документы работника и допуски к технике пишутся в тот же
  // контур `users` (см. services/users/user-documents.ts и
  // api/safety/equipment-permits). Без этих строк панель карточки показывала
  // машинный код вида «user.document.updated».
  'user.document_type.created': 'Заведён вид документа работника',
  'user.document_type.updated': 'Изменён вид документа работника',
  'user.document_type.deleted': 'Удалён вид документа работника',
  'user.document.created': 'Документ работника добавлен',
  'user.document.updated': 'Документ работника изменён',
  'user.document.deleted': 'Документ работника удалён',
  'user.equipment_permit.saved': 'Допуск к технике выдан или изменён',
  'user.equipment_permit.deleted': 'Допуск к технике удалён',
  'dictionary.created': 'Элемент создан',
  'dictionary.renamed': 'Переименован',
  'dictionary.archived': 'Архивирован',
  'dictionary.restored': 'Восстановлен',
  'dictionary.length_updated': 'Длина изменена',
  'dictionary.section_updated': 'Сечение изменено',
  'dictionary.deleted': 'Удалён',
};

const FIELD_LABELS: Record<string, string> = {
  name: 'Название',
  isActive: 'Активность',
  siteId: 'Объект',
  operatorId: 'Оператор',
  equipmentId: 'Установка',
  plannedPiles: 'План свай',
  plannedDrilling: 'План бурения',
  role: 'Роль',
  email: 'Email',
  lengthMm: 'Длина, мм',
  sectionOrDiameter: 'Сечение',
  // Поля событий по документам работника и допускам к технике.
  expiresAt: 'Действует до',
  typeId: 'Вид документа',
  equipmentKind: 'Вид техники',
  status: 'Статус',
  // Состав помощников бригады (metadata `assistants`): без подписи поле
  // пропускалось диффом и смена помощника выглядела как «ничего не менялось».
  assistants: 'Помощники',
};

// Fields that change on every save but carry no evidentiary meaning.
const NOISE = new Set(['id', 'createdAt', 'updatedAt', 'force', 'deactivated']);

function toMap(rows: Array<{ id: string; name: string | null }>): Record<string, string> {
  const m: Record<string, string> = {};
  for (const r of rows) if (r.name) m[r.id] = r.name;
  return m;
}

function formatAt(d: Date): string {
  return d.toLocaleString('ru-RU', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/**
 * Reads the change history for one entity from the FeedbackEvent log (where
 * recordAuditEvent persists), keyed by scope + targetId. Resolves actor and
 * id-valued fields to human names so the panel reads in Russian.
 */
export async function getEntityHistory(
  scope: string,
  targetId: string,
  tenantId: string | null | undefined,
  limit = 20,
): Promise<AuditHistoryEntry[]> {
  // Карты имён сужены по организации смотрящего. Раньше они грузились
  // целиком: открытие истории любой записи вытягивало всех пользователей,
  // все объекты и всю технику системы. Идентификатор из другой организации
  // теперь останется идентификатором — это правильнее, чем показать чужое имя.
  const tenantScope = { tenantId: requireTenantId(tenantId) };
  const events = await db.feedbackEvent.findMany({
    where: { scope, targetId },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 100),
  });
  if (events.length === 0) return [];

  // Name maps for resolving actor + id-valued change fields (small tables).
  const [users, sites, equipment] = await Promise.all([
    db.user.findMany({ where: tenantScope, select: { id: true, name: true } }),
    db.site.findMany({ where: tenantScope, select: { id: true, name: true } }),
    db.equipment.findMany({ where: tenantScope, select: { id: true, name: true } }),
  ]);
  const userMap = toMap(users);
  const siteMap = toMap(sites);
  const equipMap = toMap(equipment);

  const renderValue = (field: string, value: unknown): string => {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) {
      // Списки (состав помощников) рисуем именами через запятую; элементы —
      // строки имён или объекты вида { name }.
      const names = value
        .map((item) => (typeof item === 'string' ? item : (item as { name?: unknown } | null)?.name))
        .filter((name): name is string => typeof name === 'string' && name !== '');
      return names.length > 0 ? names.join(', ') : '—';
    }
    if (field === 'isActive') return value ? 'Да' : 'Нет';
    if (field === 'siteId') return siteMap[String(value)] ?? String(value);
    if (field === 'operatorId') return userMap[String(value)] ?? String(value);
    if (field === 'equipmentId') return equipMap[String(value)] ?? String(value);
    return String(value);
  };

  const diff = (before: Record<string, unknown>, after: Record<string, unknown>) => {
    const out: Array<{ label: string; before: string; after: string }> = [];
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (NOISE.has(key) || !(key in FIELD_LABELS)) continue;
      if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
      out.push({ label: FIELD_LABELS[key], before: renderValue(key, before[key]), after: renderValue(key, after[key]) });
    }
    return out;
  };

  return events.map((e) => {
    const meta = (e.metadata ?? {}) as Record<string, unknown>;
    const before = meta.before as Record<string, unknown> | undefined;
    const after = meta.after as Record<string, unknown> | undefined;
    return {
      id: e.id,
      action: e.action,
      title: ACTION_LABELS[e.action] ?? e.action,
      meta: e.actorId ? userMap[e.actorId] ?? 'Пользователь' : 'Система',
      at: formatAt(e.createdAt),
      changes: before && after ? diff(before, after) : undefined,
    };
  });
}
