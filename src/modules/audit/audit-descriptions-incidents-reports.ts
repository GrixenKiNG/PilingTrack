import { str, num, subject, withSubject, pileAcceptanceLabel, autoSubmitted, type AuditDescription } from './audit-description-helpers';

/** Тексты ленты: происшествия, осмотры, ТО, вход, отчёты, паспорта свай. */
export const INCIDENT_REPORT_DESCRIPTIONS: Record<string, AuditDescription> = {
  // Команда смены, которую исполнил администратор в роли оператора. Реальный
  // администратор — актор записи, роль — в metadata.
  'operator.acting-command': {
    level: 'audit',
    title: 'Действие администратора от имени оператора',
    message: 'Команда смены выполнена администратором в режиме «Действую как → Оператор».',
  },
  'incident.reported': {
    level: (m) => m.stopRequired === true ? 'warn' : 'audit',
    title: 'Происшествие заявлено', message: 'Сообщение о происшествии сохранено.',
  },
  'incident.reviewed': {
    level: 'audit', title: 'Происшествие разобрано', message: 'Вывод разбора происшествия сохранён.',
  },
  'inspection.template.created': {
    level: 'audit', title: 'Шаблон осмотра создан', message: (m) => withSubject('Создан шаблон осмотра', subject(m)),
  },
  'inspection.template.replaced': {
    level: 'audit', title: 'Шаблон осмотра заменён', message: (m) => withSubject('Прежний шаблон отключён и создан новый', subject(m)),
  },
  'inspection.template.deactivated': {
    level: 'audit', title: 'Шаблон осмотра отключён', message: 'Шаблон больше не используется для новых осмотров.',
  },
  'inspection.template.activated': {
    level: 'audit', title: 'Шаблон осмотра включён', message: 'Шаблон снова используется для новых осмотров.',
  },
  'inspection.started': {
    level: 'audit', title: 'Осмотр начат', message: 'Создана запись осмотра техники.',
  },
  'inspection.answers_saved': {
    level: 'audit', title: 'Ответы осмотра сохранены', message: 'Ответы на пункты осмотра изменены.',
  },
  'briefing.conducted': {
    level: 'audit', title: 'Инструктаж проведён', message: (m) => withSubject('В журнале зарегистрирован инструктаж', str(m, 'documentTitle')),
  },
  'briefing.signed': {
    level: 'audit', title: 'Инструктаж подтверждён', message: 'Участник подтвердил запись инструктажа.',
  },
  'equipment.document.created': {
    level: 'audit', title: 'Документ техники добавлен', message: (m) => withSubject('Добавлен документ техники', subject(m)),
  },
  'equipment.fuel.created': {
    level: 'audit', title: 'Запись топлива добавлена', message: 'В журнал топлива добавлены долив или остаток в баке.',
  },
  'maintenance.plan.created': {
    level: 'audit', title: 'Регламент ТО создан', message: (m) => withSubject('Создан регламент обслуживания', subject(m)),
  },
  'maintenance.scheduled': {
    level: 'audit', title: 'Наряд ТО создан автоматически', message: (m) => withSubject('Планировщик создал наряд ТО по регламенту', subject(m)),
  },
  'dlq.retried': {
    level: 'audit', title: 'Событие отправлено повторно', message: 'Необработанное событие снова поставлено в очередь.',
  },
  'dlq.discarded': {
    level: 'audit', title: 'Повтор события отменён', message: 'Принято решение не повторять необработанное событие.',
  },
  'media.deleted': {
    level: 'audit', title: 'Вложение удалено', message: 'Вложение помечено удалённым.',
  },
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

};
