export interface CreateCrewCommand {
  name: string;
  operatorId: string;
  equipmentId: string;
  siteId: string;
  assistantNames?: string[];
  userId?: string;
}

export interface UpdateCrewCommand {
  crewId: string;
  name?: string;
  operatorId?: string;
  equipmentId?: string;
  siteId?: string;
  assistantNames?: string[];
  isActive?: boolean;
  userId?: string;
}

export interface DeleteCrewCommand {
  crewId: string;
  userId?: string;
}
