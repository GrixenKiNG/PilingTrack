export interface CreateCrewCommand {
  name: string;
  operatorId: string;
  equipmentId: string;
  siteId: string;
  // Preferred: ASSISTANT user ids (linked + name-snapshotted). `assistantNames`
  // is the legacy free-text fallback kept for backward compatibility.
  assistantUserIds?: string[];
  assistantNames?: string[];
  userId?: string;
}

export interface UpdateCrewCommand {
  crewId: string;
  name?: string;
  operatorId?: string;
  equipmentId?: string;
  siteId?: string;
  assistantUserIds?: string[];
  assistantNames?: string[];
  isActive?: boolean;
  userId?: string;
}

export interface DeleteCrewCommand {
  crewId: string;
  userId?: string;
}
