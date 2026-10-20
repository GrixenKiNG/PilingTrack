import { str, num, dateAt, subject, withSubject, PROJECTION_LABELS, changedEquipmentFields, maintenanceTypeLabel, maintenanceStatusLabel, changedMaintenanceFields, type AuditDescription } from './audit-description-helpers';

/** Тексты ленты: техника, счётчики, топливо, ТО, осмотры. */
export const EQUIPMENT_DESCRIPTIONS: Record<string, AuditDescription> = {
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
