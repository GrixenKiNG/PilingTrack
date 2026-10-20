import { pick, str, num, subject, withSubject, roleLabel, dictionaryLine, EQUIPMENT_KIND_LABELS, PERMIT_STATUS_LABELS, changedSettingsFields, channelLine, hierarchyLine, type AuditDescription } from './audit-description-helpers';

/** Тексты ленты: объекты, бригады, справочники, пользователи, настройки, Telegram. */
export const ADMIN_DESCRIPTIONS: Record<string, AuditDescription> = {
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

};
