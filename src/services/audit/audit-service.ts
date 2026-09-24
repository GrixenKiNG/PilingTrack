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
  title: string;
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
    title: 'Отчёт сдан',
    message: 'Отчёт передан на проверку.',
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
    message: (m) => `Допуск работника к технике: ${str(m, 'equipmentKind') ?? '—'}, ${str(m, 'status') ?? '—'}.`,
  },
  'user.equipment_permit.deleted': {
    level: 'warn',
    title: 'Допуск к технике удалён',
    message: 'Строка матрицы допусков удалена администратором.',
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
    title: description.title,
    message: typeof description.message === 'function' ? description.message(meta) : description.message,
  };
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
      actor: event.actorId ? { id: event.actorId } : null,
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
