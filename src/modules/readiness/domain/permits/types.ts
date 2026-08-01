export type WorkPermitRisk = 'NORMAL' | 'ELEVATED';
export type WorkPermitState = 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'EXPIRED' | 'REVOKED';
export type WorkPermitApprovalRole = 'DISPATCHER' | 'ADMIN';

export interface WorkPermitApprovalRecord {
  role: WorkPermitApprovalRole;
  approvedById: string;
  permitVersion: number;
  valid: boolean;
}

export interface WorkPermitRecord {
  id: string;
  tenantId: string;
  equipmentId: string;
  shiftId: string | null;
  risk: WorkPermitRisk;
  state: WorkPermitState;
  scope: string;
  validFrom: Date;
  validTo: Date;
  timezone: string;
  authorId: string;
  lastEditedById: string;
  version: number;
  approvals: WorkPermitApprovalRecord[];
}

export interface WorkPermitContent {
  equipmentId: string;
  shiftId?: string | null;
  risk: WorkPermitRisk;
  scope: string;
  validFrom: Date;
  validTo: Date;
}
