export interface ReadinessEvidence {
  equipmentId: string;
  inspectionId: string | null;
  permitId: string | null;
  maintenanceRecordIds: string[];
  evaluatedAt: string;
}
