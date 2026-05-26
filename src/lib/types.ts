// ============================================================
// Piling Platform - Shared Types
// ============================================================

// Enums — 4 roles
export type UserRole = 'ADMIN' | 'DISPATCHER' | 'OPERATOR' | 'ASSISTANT';
export type ReportStatus = 'draft' | 'submitted';

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер',
  OPERATOR: 'Оператор',
  ASSISTANT: 'Помощник',
};

// ============================================================
// AUTH
// ============================================================

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AuthResponse {
  user: {
    id: string;
    email: string;
    name: string;
    role: UserRole;
  };
}

export type FeedbackEventLevel = 'info' | 'success' | 'warn' | 'error' | 'audit';
export type FeedbackEventAudience = 'ALL' | 'OPERATIONS' | 'USER';
export type FeedbackEventPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface FeedbackEventDTO {
  id: string;
  level: FeedbackEventLevel;
  priority: FeedbackEventPriority;
  scope: string;
  action: string;
  title: string;
  message: string;
  audience: FeedbackEventAudience;
  actorId: string | null;
  actorName: string | null;
  actorRole: string | null;
  targetId: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  readAt: string | null;
  acknowledgedAt: string | null;
  unread: boolean;
  source: 'server' | 'client';
  createdAt: string;
}

// ============================================================
// USERS
// ============================================================

export interface UserDTO {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  isActive: boolean;
}

export interface CreateUserPayload {
  email: string;
  password: string;
  name: string;
  role: UserRole;
}

// ============================================================
// SITES (hierarchy)
// ============================================================

export interface SiteDTO {
  id: string;
  name: string;
  isActive: boolean;
  plannedPiles: number;
  plannedDrilling: number;
}

export interface SiteWithTreeDTO extends SiteDTO {
  fields: PileFieldDTO[];
  pilePlans?: SitePilePlanDTO[];
  drillingPlans?: SiteDrillingPlanDTO[];
}

export interface PileFieldDTO {
  id: string;
  name: string;
  siteId: string;
  clusters: ClusterDTO[];
}

export interface ClusterDTO {
  id: string;
  name: string;
  fieldId: string;
  pickets: PicketDTO[];
}

export interface PicketDTO {
  id: string;
  name: string;
  clusterId: string;
}

export interface SiteFlatDTO {
  id: string;
  name: string;
}

// ============================================================
// SITE PLANS
// ============================================================

export interface SitePilePlanDTO {
  id: string;
  siteId: string;
  pileGradeId: string;
  count: number;
  metersPerUnit: number;
  pileGrade: PileGradeDTO;
}

export interface SiteDrillingPlanDTO {
  id: string;
  siteId: string;
  diameter: number;
  count: number;
  metersPerUnit: number;
}

// ============================================================
// DICTIONARIES
// ============================================================

export interface PileGradeDTO {
  id: string;
  name: string;
  isActive: boolean;
}

export interface DrillingTypeDTO {
  id: string;
  name: string;
  isActive: boolean;
}

export interface DowntimeReasonDTO {
  id: string;
  name: string;
  isActive: boolean;
}

// ============================================================
// REPORTS
// ============================================================

export interface CreateReportPayload {
  reportId: string;
  userId: string;
  siteId: string;
  date: string; // YYYY-MM-DD
  shiftStart?: string;
  shiftEnd?: string;
  equipmentId?: string;
  piles: {
    picketId?: string;
    pileGradeId: string;
    count: number;
  }[];
  drillings: {
    picketId?: string;
    typeId: string;
    count?: number;
    metersPerUnit?: number;
    meters: number;
  }[];
  downtimes: {
    reasonId: string;
    duration: number;
    comment?: string;
  }[];
}

export interface ReportDTO {
  id: string;
  reportId: string;
  userId: string;
  siteId: string;
  date: string;
  shiftStart: string | null;
  shiftEnd: string | null;
  status: ReportStatus;
  lastEditedById: string | null;
  lastEditedByName: string | null;
  lastEditedByRole: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string };
  site: { id: string; name: string };
  equipment: { id: string; name: string } | null;
  piles: (PileWorkDTO & { pileGrade: PileGradeDTO })[];
  drillings: (LeaderDrillingDTO & { type: DrillingTypeDTO })[];
  downtimes: (ReportDowntimeDTO & { reason: DowntimeReasonDTO })[];
}

export interface ReportListItemDTO {
  id: string;
  siteId: string;
  siteName: string;
  date: string;
  status: ReportStatus;
  totalPiles: number;
  totalPileMeters?: number;
  totalDrillingCount?: number;
  totalDrilling: number;
  totalDowntime: number;
  createdAt: string;
}

export interface PileWorkDTO {
  id: string;
  picketId: string | null;
  pileGradeId: string;
  count: number;
}

export interface LeaderDrillingDTO {
  id: string;
  picketId: string | null;
  typeId: string;
  count: number;
  metersPerUnit: number;
  meters: number;
}

export interface ReportDowntimeDTO {
  id: string;
  reasonId: string;
  duration: number;
  comment: string | null;
}

// ============================================================
// ANALYTICS
// ============================================================

export interface SiteAnalyticsDTO {
  siteId: string;
  siteName: string;
  plannedPiles: number;
  actualPiles: number;
  plannedPileMeters: number;
  actualPileMeters: number;
  plannedDrillingCount: number;
  actualDrillingCount: number;
  plannedDrilling: number;
  actualDrilling: number;
  pileProgress: number;
  drillingProgress: number;
  totalReports: number;
  totalDowntime: number;
}

// ============================================================
// TELEGRAM
// ============================================================

export interface TelegramConfigDTO {
  id: string;
  label: string;
  botToken: string;
  chatId: string;
  enabled: boolean;
}

export interface CreateTelegramConfigPayload {
  label: string;
  botToken: string;
  chatId: string;
  enabled?: boolean;
}

// ============================================================
// EQUIPMENT
// ============================================================

export type EquipmentKindDTO =
  | 'PILE_DRIVER'
  | 'DRILLING_RIG'
  | 'VIBRO_HAMMER'
  | 'HYBRID'
  | 'OTHER';

/**
 * Unified passport template. All optional — operators fill these in
 * progressively via the multi-tab edit dialog. null = explicitly empty,
 * undefined = not loaded.
 */
export interface EquipmentMetadata {
  // A. Identification
  inventoryNumber?: string | null;
  registrationNumber?: string | null;
  kind?: EquipmentKindDTO;
  baseVehicle?: string | null;
  serialNumber?: string | null;
  manufactureYear?: number | null;
  vin?: string | null;
  // B. Technical specs
  weightTons?: number | null;
  weightWithEquipmentTons?: number | null;
  heightMm?: number | null;
  lengthMm?: number | null;
  widthMm?: number | null;
  engineBrand?: string | null;
  engineSerialNumber?: string | null;
  enginePower?: number | null;
  maxPileLength?: number | null;
  maxDrillingDepth?: number | null;
  hammerType?: string | null;
  hammerSerialNumber?: string | null;
  hammerEnergyKj?: number | null;
  // C. Operation
  purchaseDate?: string | null;
  purchasePrice?: number | null;
  engineHoursTotal?: number | null;
  nextMaintenanceAtHours?: number | null;
  nextMaintenanceDate?: string | null;
  homeBaseLocation?: string | null;
}

export interface EquipmentDTO extends EquipmentMetadata {
  id: string;
  name: string;
  model: string;
  qty: number;
  isActive: boolean;
  description: string;
}

export interface CreateEquipmentPayload extends EquipmentMetadata {
  name: string;
  model?: string;
  qty?: number;
  description?: string;
}

// ============================================================
// CREWS — with named assistants
// ============================================================

export interface CrewAssistantDTO {
  id: string;
  crewId: string;
  name: string;
}

export interface CrewDTO {
  id: string;
  name: string;
  isActive: boolean;
  operatorId: string;
  equipmentId: string;
  siteId: string;
  operator: { id: string; name: string } | null;
  equipment: { id: string; name: string } | null;
  site: { id: string; name: string } | null;
  assistants: CrewAssistantDTO[];
}

export interface CreateCrewPayload {
  operatorId: string;
  equipmentId: string;
  siteId: string;
  name?: string;
  assistantNames?: string[];
}

// ============================================================
// APP STATE
// ============================================================

export type AppPage =
  | 'login'
  | 'operator-dashboard'
  | 'report-form'
  | 'report-history'
  | 'admin-dashboard'
  | 'admin-sites'
  | 'admin-equipment'
  | 'admin-crews'
  | 'admin-dictionaries'
  | 'admin-reports'
  | 'admin-telegram'
  | 'admin-dlq'
  | 'admin-analytics'
  | 'admin-equipment-analytics'
  | 'admin-users';
