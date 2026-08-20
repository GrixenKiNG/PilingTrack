/**
 * Полномочия контура готовности и значения по умолчанию «роль → права».
 *
 * Список вынесен из `application/capabilities.ts` в домен, потому что теперь у
 * него два потребителя: проверка прав в приложении и редактируемая матрица
 * доступов (`domain/access-matrix.ts`). Домену нельзя зависеть от приложения,
 * поэтому общий словарь живёт здесь, а `capabilities.ts` его переэкспортирует —
 * все прежние импорты продолжают работать.
 */

export const READINESS_ABILITIES = [
  'readiness.read',
  'readiness.shift.manage',
  'readiness.handover.prepare',
  'readiness.handover.decide',
  // Допуск смены к пуску и отказ в допуске. Отделено от приёмки передачи
  // 20.08.2026: раньше пуск смены требовал `readiness.handover.decide`, и
  // выдача оператору права принимать технику молча дала бы ему ещё и право
  // выпускать машину на линию. Разные решения — разные полномочия.
  'readiness.shift.authorize',
  // Письменное разрешение выпустить машину, которой контур запретил пуск.
  // Отдельно от `shift.authorize`: обычный допуск подтверждает, что всё в
  // порядке, а это — осознанное исключение под ответственность выдавшего.
  'readiness.shift.waive',
  'readiness.inspection.manage',
  // Зафиксировать замечание может любой, кто работает со сменой; разбирать,
  // закрывать и отклонять — только диспетчер, механик и администратор.
  'readiness.defect.report',
  'readiness.defect.manage',
  'readiness.meter.manage',
  'readiness.maintenance.manage',
  'readiness.permit.edit',
  'readiness.permit.approve_dispatcher',
  'readiness.permit.approve_admin',
  'readiness.rules.manage',
  'readiness.audit.read',
  'readiness.audit.export',
] as const;

export type ReadinessAbility = (typeof READINESS_ABILITIES)[number];

export const READINESS_ROLE_LIST = [
  'ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER',
] as const;

export type ReadinessRole = (typeof READINESS_ROLE_LIST)[number];

/**
 * Значения по умолчанию. Действуют, пока организация не опубликовала свою
 * матрицу; после публикации это лишь образец для сравнения «что изменили».
 */
export const ROLE_ABILITIES: Record<ReadinessRole, readonly ReadinessAbility[]> = {
  // Администратор — все полномочия модуля, на то он и администратор.
  //
  // Список берётся из READINESS_ABILITIES, а не перечисляется руками: иначе
  // новое полномочие пришлось бы не забыть добавить и сюда, а «забыли» здесь
  // означает молчаливый отказ администратору.
  //
  // Ограничивает его не отсутствие прав, а режим «Действую как»: в роли
  // механика он получает ровно права механика. Кто действовал и от чьего
  // имени — видно в журнале. Правило «повышенный риск подписывают двое разных
  // людей» тоже не страдает: оно проверяет человека, а не роль
  // (`domain/permits/approval-policy.ts`).
  ADMIN: READINESS_ABILITIES,
  DISPATCHER: [
    'readiness.read',
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.handover.decide',
    'readiness.shift.authorize',
    'readiness.shift.waive',
    'readiness.permit.approve_dispatcher',
    'readiness.audit.read',
  ],
  OPERATOR: [
    'readiness.read',
    'readiness.shift.manage',
    'readiness.handover.prepare',
    // Приёмка смены: работают в основном в одну смену, а при второй технику
    // принимает следующий оператор, а не диспетчер. Свою собственную передачу
    // принять нельзя — это проверяет команда, а не список прав.
    'readiness.handover.decide',
    // Ежесменный осмотр ведёт тот, кто управляет машиной. Право не расширяет
    // доступ: `startToInspection` пропускает оператора только на уровень ЕО и
    // только на его установку по бригаде. Ограничение стоит там намеренно —
    // эту матрицу администратор правит и публикует на ходу.
    'readiness.inspection.manage',
    'readiness.defect.report',
  ],
  ASSISTANT: ['readiness.defect.report'],
  MECHANIC: [
    'readiness.read',
    // Механик возвращает технику после ремонта — это та же передача смены,
    // что готовит оператор.
    'readiness.handover.prepare',
    'readiness.permit.edit',
    'readiness.inspection.manage',
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.meter.manage',
    'readiness.maintenance.manage',
  ],
  // Мастер отвечает за ход работ на участке: видит контур и фиксирует
  // замечания, но не закрывает дефекты и не решает по допуску.
  FOREMAN: [
    'readiness.read',
    'readiness.defect.report',
    'readiness.audit.read',
  ],
  // Инженер ОТ — охрана труда: осмотры и наряды-допуски, разбор замечаний по
  // безопасности. Смену не запускает и не принимает.
  SAFETY_ENGINEER: [
    'readiness.read',
    'readiness.permit.edit',
    'readiness.inspection.manage',
    'readiness.defect.report',
    'readiness.defect.manage',
    'readiness.audit.read',
  ],
};
