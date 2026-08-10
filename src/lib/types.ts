// ============================================================
// Piling Platform - Shared Types
// ============================================================

export type UserRole =
  | 'ADMIN'
  | 'DISPATCHER'
  | 'OPERATOR'
  | 'ASSISTANT'
  | 'MECHANIC'
  | 'FOREMAN'
  | 'SAFETY_ENGINEER';
export type ReportStatus = 'draft' | 'submitted';

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'Администратор',
  DISPATCHER: 'Диспетчер',
  OPERATOR: 'Оператор',
  ASSISTANT: 'Помощник',
  MECHANIC: 'Механик',
  FOREMAN: 'Мастер',
  SAFETY_ENGINEER: 'Инженер ОТ',
};

/**
 * Роли, которые администратор может исполнять временно, не выходя из своей
 * учётной записи. Пока «Механика», «Мастера» и «Инженера ОТ» в организации
 * физически нет, их работу делает администратор: он переключается на роль,
 * и действие уходит в журнал с пометкой, от чьего имени оно совершено
 * (`actingAs`), а не как обычное действие администратора.
 *
 * Когда появится живой человек, ему заводят учётную запись с этой ролью —
 * права переходят к нему, а список ниже трогать не нужно.
 *
 * Это единственный источник правды: и серверная проверка
 * (`api/readiness/_shared/request-context.ts`), и загрузка модуля
 * (`api/readiness/bootstrap`) сверяются с ним. Строковых сравнений
 * с 'MECHANIC' в коде быть не должно — так режим и разъезжался.
 */
export const ACTING_ROLES = [
  'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER',
  // Диспетчер и оператор — живые роли, и обычно администратору замещать их не
  // нужно. Но владелец должен уметь провести смену целиком в одиночку: ночью,
  // в выходной, при болезни диспетчера. Без этих двух пунктов администратор не
  // мог ни открыть смену, ни принять передачу — эти права есть только у них.
  // Замещение подписывается в журнале, поэтому «кто на самом деле нажал»
  // остаётся видно.
  'DISPATCHER', 'OPERATOR',
] as const;
export type ActingRole = (typeof ACTING_ROLES)[number];

/** Принимает `unknown`: используется и как валидатор ответа сервера. */
export function isActingRole(value: unknown): value is ActingRole {
  return typeof value === 'string' && (ACTING_ROLES as readonly string[]).includes(value);
}

/** Администратор видит всё и может исполнять любую из ролей выше. */
export function canActAs(role: string, actingAs: string | null | undefined): boolean {
  if (actingAs === null || actingAs === undefined) return true;
  return role === 'ADMIN' && isActingRole(actingAs);
}

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

export interface OperationalUserDTO extends UserDTO {
  phone: string;
  createdAt: string;
  assignedSites: Array<{ id: string; name: string }>;
  activeCrew: {
    id: string;
    name: string;
    equipmentName: string | null;
    siteName: string | null;
  } | null;
  reportCount: number;
  canHardDelete: boolean;
  lastReportAt: string | null;
  lastLoginAt: string | null;
  lastActivityAt: string | null;
  lastActivitySource: 'login' | 'report' | 'profile' | null;
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
  completionDate?: string | null;
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
  /** Pile length in millimetres; null = unknown. Source of truth for м.п. (see lib/pile-length). */
  lengthMm?: number | null;
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
  /** Version the client loaded; sent back for optimistic-concurrency (409 on conflict). */
  version?: number;
  date: string; // YYYY-MM-DD
  shiftStart?: string;
  shiftEnd?: string;
  equipmentId?: string;
  /** Optional end-of-shift engine-hours reading → rig's MeterReading journal. */
  engineHours?: number;
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
  /** Optimistic-concurrency token round-tripped to upsert; absent on legacy rows. */
  version?: number;
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
  /** Computed server-side in one batched media query (listReportsForReview). */
  hasPhotos?: boolean;
  /** First completed photo of the report, for the list thumbnail. */
  thumbnailMediaId?: string | null;
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
  userId?: string | null;
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
  | 'admin-users';
