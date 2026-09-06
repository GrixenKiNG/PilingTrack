/**
 * Zod validation schemas for all API endpoints
 * Centralizes input validation across the entire API
 */

import { z } from 'zod';
// Чистый доменный модуль без зависимостей — безопасен и на клиенте, куда эти
// схемы тоже попадают.
import { DOWNTIME_MAX_HOURS, roundDowntimeHours } from '@/modules/reports/domain/downtime-hours';

// ============================================================
// Common schemas
// ============================================================

export const uuidSchema = z.string().uuid().max(50);
export const internalIdSchema = z.string().min(1).max(64);
export const dateSchema = z.string().date().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/));
export const timeSchema = z.string().regex(/^\d{2}:\d{2}$/).optional();

export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ============================================================
// Auth schemas
// ============================================================

export const loginSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(1, 'Password is required').max(100),
});

export const pinAuthSchema = z.object({
  pin: z.string().regex(/^\d{4,10}$/, 'PIN must contain 4 to 10 digits'),
});

// ============================================================
// User schemas
// ============================================================

const userBaseSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  name: z.string().min(1, 'Name is required').max(200),
  role: z.enum(['ADMIN', 'DISPATCHER', 'OPERATOR', 'ASSISTANT', 'MECHANIC', 'FOREMAN', 'SAFETY_ENGINEER']),
  pin: z
    .string()
    .regex(/^\d{4,10}$/, 'PIN must contain 4 to 10 digits')
    .optional()
    .or(z.literal('')),
  phone: z.string().max(30).optional(),
  password: z.string().trim().min(8, 'Password must contain at least 8 characters').max(100).optional(),
  isActive: z.boolean().optional(),
});

export const createUserSchema = userBaseSchema
  .extend({ isActive: z.boolean().default(true) })
  .refine((value) => Boolean(value.password?.trim() || value.pin?.trim()), {
    message: 'Password or PIN is required',
    path: ['password'],
  });

export const updateUserSchema = userBaseSchema.partial().extend({
  id: z.string().min(1, 'User ID is required'),
});

export const userAssignSchema = z.object({
  userId: internalIdSchema,
  siteId: internalIdSchema,
});

// ============================================================
// Site schemas
// ============================================================

export const createSiteSchema = z.object({
  name: z.string().min(1, 'Site name is required').max(200),
  plannedPiles: z.number().int().min(0).max(999999).optional(),
  plannedDrilling: z.number().int().min(0).max(999999).optional(),
  // Координаты площадки. Нужны погоде на экране оператора, когда телефон не
  // отдал геопозицию: без них показать ветер и температуру неоткуда.
  //
  // `nullable` обязателен: очистить ранее заданные координаты должно быть
  // можно, а `undefined` в PATCH-семантике означает «не трогать».
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['active', 'paused', 'completed']).default('active'),
  pilePlans: z.array(z.object({
    pileGradeId: z.string().min(1).max(64),
    count: z.number().int().min(1),
    metersPerUnit: z.number().min(0).optional(),
  })).max(100).default([]).optional(),
  drillingPlans: z.array(z.object({
    diameter: z.number().min(0).max(999),
    count: z.number().int().min(1),
    metersPerUnit: z.number().min(0).optional(),
  })).max(100).default([]).optional(),
});

/**
 * Правка объекта. Планы здесь БЕЗ `.default([])` — и это главное отличие от
 * создания.
 *
 * Значение по умолчанию подставляло пустой массив всякий раз, когда планы в
 * запросе не присылали. Маршрут проверял их на истинность, а пустой массив в
 * JavaScript истинный — поэтому ЛЮБОЕ сохранение объекта (даже переименование)
 * уходило в ветку «пришли новые планы»: план обнулялся, а его строки
 * удалялись. Пропущенное поле должно означать «не трогать», и только явный
 * пустой массив — «очистить».
 */
export const updateSiteSchema = createSiteSchema.partial().extend({
  isActive: z.boolean().optional(),
  completed: z.boolean().optional(),
  pilePlans: z.array(z.object({
    pileGradeId: z.string().min(1).max(64),
    count: z.number().int().min(1),
    metersPerUnit: z.number().min(0).optional(),
  })).max(100).optional(),
  drillingPlans: z.array(z.object({
    diameter: z.number().min(0).max(999),
    count: z.number().int().min(1),
    metersPerUnit: z.number().min(0).optional(),
  })).max(100).optional(),
});

export const siteHierarchySchema = z.object({
  fieldName: z.string().min(1).max(200),
  clusterName: z.string().min(1).max(200),
  picketNumber: z.string().min(1).max(50),
});

// ============================================================
// Equipment schemas
// ============================================================

// Метаданные техпаспорта установки. Все поля опциональные —
// они заполняются операторами через диалог редактирования по мере
// сбора паспортов; служат расшифровкой того что я уже описал в
// schema.prisma (поля A/B/C).
// Помощник: текстовое поле, которое форма может прислать как
// undefined / '' / null. Все три варианта приводим к пустоте без 400.
const optStr = (max: number) =>
  z.preprocess(
    (v) => (v === null || v === '' ? undefined : v),
    z.string().max(max).optional(),
  );
// Числовое поле: пустая строка/null трактуются как undefined,
// иначе coerce → number (так выживают и формы, и API).
const optNum = (s: z.ZodNumber) =>
  z.preprocess(
    (v) => (v === null || v === '' || v === undefined ? undefined : v),
    z.coerce.number().pipe(s).optional(),
  );
const optDate = z.preprocess(
  (v) => (v === null || v === '' || v === undefined ? undefined : v),
  z.coerce.date().optional(),
);

const equipmentMetadataSchema = z.object({
  // A. Identification
  inventoryNumber:    optStr(100),
  registrationNumber: optStr(50),
  kind: z.enum(['PILE_DRIVER', 'DRILLING_RIG', 'VIBRO_HAMMER', 'HYBRID', 'OTHER']).optional(),
  baseVehicle:        optStr(200),
  serialNumber:       optStr(100),
  manufactureYear:    optNum(z.number().int().min(1950).max(2100)),
  vin:                optStr(50),
  // B. Technical specs (единый шаблон)
  weightTons:              optNum(z.number().nonnegative().max(2000)),
  weightWithEquipmentTons: optNum(z.number().nonnegative().max(2000)),
  heightMm: optNum(z.number().int().min(0).max(100_000)),
  lengthMm: optNum(z.number().int().min(0).max(100_000)),
  widthMm:  optNum(z.number().int().min(0).max(100_000)),
  engineBrand:        optStr(200),
  engineSerialNumber: optStr(100),
  enginePower:        optNum(z.number().int().min(0).max(10_000)),
  maxPileLength:      optNum(z.number().nonnegative().max(200)),
  maxDrillingDepth:   optNum(z.number().nonnegative().max(500)),
  hammerType:         optStr(200),
  hammerSerialNumber: optStr(100),
  hammerEnergyKj:     optNum(z.number().nonnegative().max(10_000)),
  hammerKind:         z.enum(['HYDRAULIC', 'DIESEL', 'NONE']).optional(),
  isCombined:         z.boolean().optional(),
  // C. Operation
  purchaseDate:           optDate,
  purchasePrice:          optNum(z.number().nonnegative().max(1_000_000_000)),
  engineHoursTotal:       optNum(z.number().int().min(0).max(1_000_000)),
  fuelTankLiters:         optNum(z.number().int().min(0).max(100_000)),
  nextMaintenanceAtHours: optNum(z.number().int().min(0).max(1_000_000)),
  nextMaintenanceDate:    optDate,
  homeBaseLocation:       optStr(200),
});

export const createEquipmentSchema = z.object({
  name: z.string().min(1, 'Equipment name is required').max(200),
  // Через optStr, как и остальные 26 полей установки: пустое поле формы
  // приходит как null, и голый z.string().optional() отвечал на него
  // «expected string, received null» — установку нельзя было завести, не
  // заполнив модель и описание, хотя оба необязательны.
  model: optStr(200),
  description: optStr(2000),
  qty: z.number().int().min(0).max(100).default(1),
  isActive: z.boolean().default(true),
}).extend(equipmentMetadataSchema.shape);

export const updateEquipmentSchema = createEquipmentSchema.partial();

// ============================================================
// Crew schemas
// ============================================================

const crewAssistantNamesSchema = z.array(z.string().max(200)).max(20);

export const createCrewSchema = z.object({
  name: z.string().max(200).optional().or(z.literal('')),
  operatorId: internalIdSchema,
  equipmentId: internalIdSchema,
  siteId: internalIdSchema,
  assistantNames: crewAssistantNamesSchema.default([]),
  assistantUserIds: z.array(internalIdSchema).max(20).optional(),
  assistantsCount: z.number().int().min(0).max(20).default(0),
  isActive: z.boolean().optional().default(true),
});

export const updateCrewSchema = z.object({
  name: z.string().min(1, 'Crew name is required').max(200).optional(),
  operatorId: internalIdSchema.optional(),
  equipmentId: internalIdSchema.optional(),
  siteId: internalIdSchema.optional(),
  assistantNames: crewAssistantNamesSchema.optional(),
  assistantUserIds: z.array(internalIdSchema).max(20).optional(),
  assistantsCount: z.number().int().min(0).max(20).optional(),
  isActive: z.boolean().optional(),
});

export const crewAssignSchema = z.object({
  crewId: internalIdSchema,
  siteId: internalIdSchema,
});

// ============================================================
// Report schemas
// ============================================================

export const reportUpsertSchema = z.object({
  id: internalIdSchema.optional(),
  reportId: internalIdSchema.optional(),
  siteId: internalIdSchema,
  crewId: internalIdSchema.optional(),
  userId: internalIdSchema.optional(),
  equipmentId: internalIdSchema.optional(),
  // Optional end-of-shift engine-hours reading. Feeds the rig's MeterReading
  // journal so hour-based PM planning has data without a separate workflow.
  engineHours: z.number().int().min(0).max(500_000).optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Invalid date format (YYYY-MM-DD)'),
  shiftType: z.enum(['DAY', 'NIGHT']).default('DAY'),
  shiftStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  shiftEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  status: z.enum(['draft', 'submitted']).default('draft'),
  // Optimistic-concurrency token: the report version the client based its
  // edit on. When present, the save fails with 409 if the stored row has
  // advanced (someone else saved meanwhile). Absent → no check (offline /
  // legacy clients keep last-write-wins, no false conflicts).
  version: z.number().int().nonnegative().optional(),
  piles: z.array(z.object({
    pileGradeId: internalIdSchema,
    count: z.number().int().min(1, 'Count must be at least 1'),
    picketId: internalIdSchema.optional(),
  })).max(100).default([]),
  drillings: z.array(z.object({
    typeId: internalIdSchema,
    count: z.number().int().min(1).max(9999).optional(),
    metersPerUnit: z.number().min(0).max(9999).optional(),
    meters: z.number().min(0).max(99999),
    diameter: z.number().min(0).max(999).optional(),
    picketId: internalIdSchema.optional(),
  })).max(100).default([]),
  downtimes: z.array(z.object({
    reasonId: internalIdSchema,
    // Простой измеряется полными часами: неполный округляется вверх (правило
    // и причина — reports/domain/downtime-hours). Колонка осталась Float ради
    // ранее записанных дробных значений — переписывать историю не стали.
    // Ноль допустим: «простоя не было» — законный ответ при правке.
    duration: z.number().min(0).max(DOWNTIME_MAX_HOURS).transform(roundDowntimeHours),
    comment: z.string().max(1000).optional(),
  })).max(50).default([]),
  comment: z.string().max(2000).optional(),
  assistantReport: z.object({
    name: z.string().max(200),
    piles: z.array(z.object({
      pileGradeId: internalIdSchema,
      count: z.number().int().min(0).max(9999),
    })).max(100).default([]),
  }).optional(),
});

export const reportQuerySchema = z.object({
  siteId: internalIdSchema.optional(),
  crewId: internalIdSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
  status: z.enum(['draft', 'submitted']).optional(),
});

// ============================================================
// Dictionary schemas
// ============================================================

export const dictionaryItemSchema = z.object({
  type: z.string().max(50),
  name: z.string().min(1).max(200),
  code: z.string().max(50).optional(),
  isActive: z.boolean().default(true),
});

// ============================================================
// Telegram schemas
// ============================================================

export const telegramConfigSchema = z.object({
  label: z.string().min(1).max(200),
  botToken: z.string().min(1).max(500),
  chatId: z.string().min(1).max(500),
  enabled: z.boolean().default(true),
});

// ============================================================
// Analytics schemas
// ============================================================

export const analyticsQuerySchema = z.object({
  siteId: uuidSchema.optional(),
  dateFrom: dateSchema.optional(),
  dateTo: dateSchema.optional(),
});

// ============================================================
// AI Recognition schemas
// ============================================================

export const recognizeImageSchema = z.object({
  image: z.string().min(1, 'Image data is required'),
  type: z.enum(['report', 'document', 'plan']).default('report'),
});

// ============================================================
// Type exports (inferred from schemas)
// ============================================================

// ============================================================
// Equipment manage schemas (POST/PUT/DELETE)
// ============================================================

export const equipmentManageSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().min(1, 'Equipment name is required').max(200),
  model: optStr(200),
  description: optStr(2000),
  qty: z.coerce.number().int().min(1).max(100).default(1),
  isActive: z.boolean().default(true),
}).extend(equipmentMetadataSchema.shape);

export type EquipmentMetadataInput = z.infer<typeof equipmentMetadataSchema>;

export const equipmentIdSchema = z.object({
  id: internalIdSchema,
});

// ============================================================
// Dictionary manage schemas
// ============================================================

export const dictionaryManageSchema = z.object({
  id: internalIdSchema.optional(),
  type: z.enum(['PileGrade', 'DrillingType', 'DowntimeReason']),
  name: z.string().min(1, 'Name is required').max(200),
  code: z.string().max(50).optional().or(z.literal('')),
  isActive: z.boolean().default(true),
});

export const dictionaryIdSchema = z.object({
  id: internalIdSchema,
});

// ============================================================
// Site manage schemas (PUT/DELETE)
// ============================================================

export const siteManageSchema = z.object({
  id: internalIdSchema,
  name: z.string().min(1, 'Site name is required').max(200).optional(),
  plannedPiles: z.coerce.number().int().min(0).max(999999).optional(),
  plannedDrilling: z.coerce.number().min(0).max(999999).optional(),
  description: z.string().max(2000).optional(),
  status: z.enum(['ACTIVE', 'PAUSED', 'COMPLETED']).optional(),
  isActive: z.boolean().optional(),
});

// ============================================================
// Site assign schemas
// ============================================================

export const siteAssignSchema = z.object({
  userId: internalIdSchema,
});

// ============================================================
// Report admin upsert schema (same as regular but with userId)
// ============================================================

export const reportAdminUpsertSchema = reportUpsertSchema.extend({
  userId: internalIdSchema,
  crewId: internalIdSchema.optional(),
});

// ============================================================
// Site hierarchy schemas
// ============================================================

export const siteHierarchyItemSchema = z.object({
  parentId: internalIdSchema.optional(),
  name: z.string().min(1, 'Name is required').max(200),
  type: z.enum(['field', 'cluster', 'picket']),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

export const siteHierarchyDeleteSchema = z.object({
  type: z.enum(['field', 'cluster', 'picket']),
  itemId: internalIdSchema,
});

// ============================================================
// Recognize image schema
// ============================================================

export const recognizeImageDataSchema = z.object({
  image: z.string().min(1, 'Image data is required'),
  type: z.enum(['report', 'document', 'plan']).default('report'),
});

// ============================================================
// ID schema for DELETE operations
// ============================================================

export const deleteIdSchema = z.object({
  id: internalIdSchema,
});

// ============================================================
// Type exports (inferred from schemas)
// ============================================================

export type LoginInput = z.infer<typeof loginSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateSiteInput = z.infer<typeof createSiteSchema>;
export type UpdateSiteInput = z.infer<typeof updateSiteSchema>;
export type CreateEquipmentInput = z.infer<typeof createEquipmentSchema>;
export type EquipmentManageInput = z.infer<typeof equipmentManageSchema>;
export type CreateCrewInput = z.infer<typeof createCrewSchema>;
export type ReportUpsertInput = z.infer<typeof reportUpsertSchema>;
export type ReportAdminUpsertInput = z.infer<typeof reportAdminUpsertSchema>;
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
export type TelegramConfigInput = z.infer<typeof telegramConfigSchema>;
export type DictionaryManageInput = z.infer<typeof dictionaryManageSchema>;
export type SiteAssignInput = z.infer<typeof siteAssignSchema>;
export type SiteHierarchyInput = z.infer<typeof siteHierarchySchema>;
export type RecognizeImageInput = z.infer<typeof recognizeImageSchema>;
