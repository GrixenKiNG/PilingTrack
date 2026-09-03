/**
 * Доказательства, на которых стоит снимок готовности.
 *
 * ПОЧЕМУ ССЫЛКИ ТИПИЗИРОВАНЫ. Идентификаторы разных сущностей снаружи
 * неразличимы: id журнала ЕО (`Inspection`) и id предсменного чек-листа
 * машиниста (`OperatorChecklistExecution`) — одинаковые строки из разных
 * таблиц. Пока тип жил отдельным полем-приложением к `inspectionId`, любой
 * потребитель мог взять id и открыть его «как осмотр»: на чек-листе машиниста
 * это давало страницу чужой сущности, то есть 404. Ссылка теперь носит свой
 * тип с собой — `{type, id}`, и перепутать их нельзя по построению.
 */

export type EvidenceReferenceType =
  | 'EQUIPMENT'
  | 'INSPECTION'
  | 'OPERATOR_CHECKLIST'
  | 'PERMIT'
  | 'MAINTENANCE';

/** Ссылка на исходную запись: тип и идентификатор неразделимы. */
export interface EvidenceReference {
  type: EvidenceReferenceType;
  id: string;
}

export interface ReadinessEvidence {
  /**
   * Типизированные ссылки на всё, на чём стоит вывод. Единственный источник
   * истины для «что это за запись и куда её открыть».
   */
  references: EvidenceReference[];

  // --- Плоские поля ниже оставлены намеренно. ---
  //
  // Снимки готовности неизменяемы (триггеры запрещают UPDATE/DELETE), поэтому
  // снимки, сделанные до появления `references`, навсегда останутся с плоскими
  // полями — читатель обязан понимать обе формы. Убрать их из записи новых
  // снимков тоже нельзя: разбор на клиенте считает снимок без `inspectionId`
  // или `permitId` испорченным. Поэтому пишем и то, и другое; плоские поля —
  // совместимость, `references` — источник истины.

  equipmentId: string;
  inspectionId: string | null;
  /**
   * Из какой таблицы `inspectionId`. `null` — либо осмотра нет, либо снимок
   * сделан до появления поля: тогда ссылку не строим, потому что проверить,
   * куда она ведёт, нечем.
   */
  inspectionSource: 'INSPECTION' | 'OPERATOR_CHECKLIST' | null;
  permitId: string | null;
  maintenanceRecordIds: string[];
  evaluatedAt: string;
}

/**
 * Собирает типизированные ссылки из уже разрешённых идентификаторов.
 *
 * Осмотр попадает в список только вместе со своим типом: без него ссылка
 * неотличима от чужой сущности, а «ссылка непонятно куда» хуже её отсутствия.
 */
export interface ResolvedEvidenceIds {
  equipmentId: string;
  inspectionId: string | null;
  inspectionSource: 'INSPECTION' | 'OPERATOR_CHECKLIST' | null;
  permitId: string | null;
  maintenanceRecordIds: string[];
}

/**
 * Собирает доказательство целиком: типизированные ссылки и совместимые плоские
 * поля. Одна точка сборки — чтобы две формы одного факта не разъехались.
 * `evaluatedAt` добавляет расчёт, у него своё время.
 */
export function buildEvidence(input: ResolvedEvidenceIds): Omit<ReadinessEvidence, 'evaluatedAt'> {
  return {...input, references: buildEvidenceReferences(input)};
}

export function buildEvidenceReferences(input: {
  equipmentId: string;
  inspectionId: string | null;
  inspectionSource: 'INSPECTION' | 'OPERATOR_CHECKLIST' | null;
  permitId: string | null;
  maintenanceRecordIds: readonly string[];
}): EvidenceReference[] {
  const references: EvidenceReference[] = [{type: 'EQUIPMENT', id: input.equipmentId}];
  if (input.inspectionId && input.inspectionSource) {
    references.push({type: input.inspectionSource, id: input.inspectionId});
  }
  if (input.permitId) references.push({type: 'PERMIT', id: input.permitId});
  for (const id of input.maintenanceRecordIds) references.push({type: 'MAINTENANCE', id});
  return references;
}
