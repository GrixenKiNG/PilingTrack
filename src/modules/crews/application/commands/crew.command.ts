export interface CreateCrewCommand {
  name: string;
  operatorId: string;
  equipmentId: string;
  siteId: string;
  userId?: string;
}

export interface UpdateCrewCommand {
  crewId: string;
  name?: string;
  isActive?: boolean;
  userId?: string;
}

export interface DeleteCrewCommand {
  crewId: string;
  userId?: string;
  force?: boolean; // if true, delete linked reports too
}
