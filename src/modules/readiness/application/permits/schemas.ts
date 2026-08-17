import {z} from 'zod';

const offsetTimestamp = z.string().datetime({offset: true});
const identifier = z.string().trim().min(1).max(128);

// Границы содержания наряда. Держатся заодно со схемой правки, чтобы форма
// создания и форма редактирования не разъехались по допустимым длинам.
const title = z.string().trim().min(3).max(200);
const scope = z.string().trim().min(3).max(4000);
const place = z.string().trim().max(200);
const hazards = z.array(z.string().trim().min(1).max(120)).max(20);
// Ответственное лицо: учётка необязательна (у наблюдающего её может не быть),
// ФИО — обычная строка. Что из этого обязательно, решает домен, а не схема:
// правило «обязателен только производитель работ» одно на создание и правку.
const personId = identifier.nullable();
const personName = z.string().trim().max(200);

export const createWorkPermitSchema = z.object({
  equipmentId: identifier,
  shiftId: z.null().optional(),
  workTypeId: identifier,
  risk: z.enum(['NORMAL', 'ELEVATED']),
  title,
  scope,
  location: place,
  objectName: place.optional(),
  hazards: hazards.optional(),
  producerUserId: personId.optional(),
  producerName: personName,
  observerUserId: personId.optional(),
  observerName: personName.optional(),
  safetyUserId: personId.optional(),
  safetyName: personName.optional(),
  validFrom: offsetTimestamp,
  validTo: offsetTimestamp,
}).strict();

export const updateWorkPermitSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  equipmentId: identifier.optional(),
  shiftId: z.null().optional(),
  workTypeId: identifier.optional(),
  risk: z.enum(['NORMAL', 'ELEVATED']).optional(),
  title: title.optional(),
  scope: scope.optional(),
  location: place.optional(),
  objectName: place.optional(),
  hazards: hazards.optional(),
  producerUserId: personId.optional(),
  producerName: personName.optional(),
  observerUserId: personId.optional(),
  observerName: personName.optional(),
  safetyUserId: personId.optional(),
  safetyName: personName.optional(),
  validFrom: offsetTimestamp.optional(),
  validTo: offsetTimestamp.optional(),
}).strict().refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), {
  message: 'At least one permit field is required',
});

export const versionedCommandSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
}).strict();

export const revokeWorkPermitSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  reason: z.string().trim().min(3).max(1000),
}).strict();

export type CreateWorkPermitPayload = z.infer<typeof createWorkPermitSchema>;
export type UpdateWorkPermitPayload = z.infer<typeof updateWorkPermitSchema>;
