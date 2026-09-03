export interface ReadinessEvidence {
  equipmentId: string;
  inspectionId: string | null;
  /**
   * Из какой таблицы `inspectionId`.
   *
   * Журнал ЕО/ТО механика (`Inspection`) и предсменный чек-лист машиниста
   * (`OperatorChecklistExecution`) — разные сущности с неразличимыми
   * снаружи идентификаторами. Без этого поля экран вёл «Открыть осмотр»
   * на страницу журнала для обоих и на чек-листе получал 404.
   *
   * `null` — либо осмотра нет, либо снимок сделан до появления поля.
   * Старые снимки поэтому ссылки не получают: отсутствие ссылки лучше
   * ссылки, ведущей в никуда.
   */
  inspectionSource: 'INSPECTION' | 'OPERATOR_CHECKLIST' | null;
  permitId: string | null;
  maintenanceRecordIds: string[];
  evaluatedAt: string;
}
