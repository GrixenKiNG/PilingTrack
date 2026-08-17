import {ReadinessCommandError} from '../../application/command-pipeline/errors';
import {assertPermitTransition} from './transitions';
import type {WorkPermitContent, WorkPermitRecord} from './types';

/** Опасных факторов в наряде: больше — это уже не наряд, а список литературы. */
const MAX_HAZARDS = 20;

const trimName = (value: string) => value.trim().replace(/\s+/g, ' ');

/**
 * Ответственное лицо: либо учётная запись, либо просто ФИО, либо ни того ни
 * другого (для необязательных ролей). ФИО требуется всегда, когда роль
 * заполнена, — иначе в подписанном документе останется голый идентификатор.
 */
function validateResponsible(
  role: string, userId: string | null, name: string, required: boolean,
): {userId: string | null; name: string} {
  const trimmed = trimName(name);
  if (!trimmed) {
    if (required) throw new ReadinessCommandError('VALIDATION_ERROR', 422, `Укажите: ${role}`);
    // Пустая роль — это пустая роль целиком: учётку без имени не храним,
    // иначе в наряде осталась бы ссылка, которую нечем показать.
    return {userId: null, name: ''};
  }
  if (trimmed.length > 200) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, `${role}: не длиннее 200 символов`);
  }
  return {userId: userId || null, name: trimmed};
}

export function validatePermitContent(content: WorkPermitContent): WorkPermitContent {
  const scope = content.scope.trim();
  if (scope.length < 3 || scope.length > 4000) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Описание работ: от 3 до 4000 символов');
  }
  const title = trimName(content.title);
  if (title.length < 3 || title.length > 200) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Наименование работ: от 3 до 200 символов');
  }
  if (!content.workTypeId) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Выберите вид работ');
  }
  const location = trimName(content.location);
  if (location.length < 2 || location.length > 200) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Место работы: от 2 до 200 символов');
  }
  // Объект в макете без звёздочки — необязателен: наряд бывает и на базе, вне
  // стройплощадки.
  const objectName = trimName(content.objectName);
  if (objectName.length > 200) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Объект: не длиннее 200 символов');
  }
  // Дубли факторов схлопываем: «открытый огонь» дважды ничего не добавляет к
  // безопасности, но засоряет печатную форму.
  const hazards: string[] = [];
  for (const raw of content.hazards) {
    const hazard = trimName(raw);
    if (!hazard) continue;
    if (hazard.length > 120) {
      throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Опасный фактор: не длиннее 120 символов');
    }
    if (!hazards.some((item) => item.toLocaleLowerCase('ru') === hazard.toLocaleLowerCase('ru'))) {
      hazards.push(hazard);
    }
  }
  if (hazards.length > MAX_HAZARDS) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, `Опасных факторов не больше ${MAX_HAZARDS}`);
  }
  // Обязателен только производитель работ (решение владельца 16.08.2026):
  // наблюдающего и ответственного за безопасность назначают не всегда, а
  // ответственность за это берёт на себя оформляющий.
  const producer = validateResponsible('производитель работ', content.producerUserId, content.producerName, true);
  const observer = validateResponsible('наблюдающий', content.observerUserId, content.observerName, false);
  const safety = validateResponsible('ответственный за безопасность', content.safetyUserId, content.safetyName, false);
  if (content.shiftId) {
    throw new ReadinessCommandError(
      'VALIDATION_ERROR', 422,
      'Привязка наряда к смене пока недоступна',
    );
  }
  if (!Number.isFinite(content.validFrom.getTime()) || !Number.isFinite(content.validTo.getTime())) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Некорректные даты действия наряда');
  }
  if (content.validTo <= content.validFrom) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'Дата окончания должна быть позже даты начала');
  }
  return {
    ...content, scope, title, location, objectName, hazards, shiftId: null,
    producerUserId: producer.userId, producerName: producer.name,
    observerUserId: observer.userId, observerName: observer.name,
    safetyUserId: safety.userId, safetyName: safety.name,
  };
}

/**
 * Слепок содержания для ответа на вопрос «изменилось ли хоть что-нибудь».
 *
 * Раньше поля перечислялись прямо в условии через `||`. С шестью полями это
 * читалось; с семнадцатью превратилось бы в ловушку: добавил поле в наряд,
 * забыл дописать строку в сравнение — и правка этого поля молча отвечает
 * «нечего сохранять», а главное, НЕ аннулирует подписи, оставляя согласованным
 * наряд с изменённым содержанием.
 *
 * Тип `Record<keyof WorkPermitContent, unknown>` делает забывчивость
 * невозможной: пропущенное поле — ошибка компиляции, а не тихий дефект.
 */
function contentFingerprint(content: WorkPermitContent): string {
  const fields: Record<keyof WorkPermitContent, unknown> = {
    equipmentId: content.equipmentId,
    shiftId: content.shiftId ?? null,
    workTypeId: content.workTypeId,
    risk: content.risk,
    title: content.title,
    scope: content.scope,
    location: content.location,
    objectName: content.objectName,
    hazards: content.hazards,
    producerUserId: content.producerUserId,
    producerName: content.producerName,
    observerUserId: content.observerUserId,
    observerName: content.observerName,
    safetyUserId: content.safetyUserId,
    safetyName: content.safetyName,
    validFrom: content.validFrom.getTime(),
    validTo: content.validTo.getTime(),
  };
  return JSON.stringify(fields);
}

/*
  Третьим параметром здесь был `actorId`, который функция не использовала ни
  разу с момента появления: кто правит наряд, решает слой команд, а домен
  считает только новое содержание и судьбу подписей. Все вызывающие честно
  передавали значение в никуда. Убран.
*/
export function editPermit(
  permit: WorkPermitRecord,
  patch: Partial<WorkPermitContent>,
): {content: WorkPermitContent; version: number; state: 'DRAFT'; invalidatesApprovals: boolean} {
  assertPermitTransition(permit.state, 'edit');
  const content = validatePermitContent({
    equipmentId: patch.equipmentId ?? permit.equipmentId,
    shiftId: patch.shiftId === undefined ? permit.shiftId : patch.shiftId,
    workTypeId: patch.workTypeId === undefined ? permit.workTypeId : patch.workTypeId,
    risk: patch.risk ?? permit.risk,
    title: patch.title ?? permit.title,
    scope: patch.scope ?? permit.scope,
    location: patch.location ?? permit.location,
    objectName: patch.objectName ?? permit.objectName,
    hazards: patch.hazards ?? permit.hazards,
    producerUserId: patch.producerUserId === undefined ? permit.producerUserId : patch.producerUserId,
    producerName: patch.producerName ?? permit.producerName,
    observerUserId: patch.observerUserId === undefined ? permit.observerUserId : patch.observerUserId,
    observerName: patch.observerName ?? permit.observerName,
    safetyUserId: patch.safetyUserId === undefined ? permit.safetyUserId : patch.safetyUserId,
    safetyName: patch.safetyName ?? permit.safetyName,
    validFrom: patch.validFrom ?? permit.validFrom,
    validTo: patch.validTo ?? permit.validTo,
  });
  // Сохранённое содержание сравниваем тем же слепком напрямую: оно само в своё
  // время прошло через validatePermitContent, то есть уже подрезано и без
  // дублей. Поэтому лишний прогон валидации здесь не нужен — и был бы вреден,
  // ведь наряды до 16.08.2026 её не прошли бы вовсе (нет вида работ).
  const changed = contentFingerprint(content) !== contentFingerprint(permit);
  if (!changed) {
    throw new ReadinessCommandError('VALIDATION_ERROR', 422, 'В наряде нечего сохранять — изменений нет');
  }
  return {
    content,
    version: permit.version + 1,
    state: 'DRAFT',
    invalidatesApprovals: permit.approvals.some((item) => item.valid),
  };
}
