import {z} from 'zod';
import {DEFECT_SEVERITIES, DEFECT_STATUSES} from '../../domain/defects/types';

const identifier = z.string().trim().min(1).max(128);

export const createDefectSchema = z.object({
  equipmentId: identifier,
  severity: z.enum(DEFECT_SEVERITIES),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().max(4000).optional(),
  // Узел агрегата: «Гидросистема — распределитель вращения».
  node: z.string().trim().max(200).optional(),
  inspectionId: identifier.optional(),
  shiftId: identifier.optional(),
}).strict();

/**
 * Разбор диспетчером. Серьёзность можно уточнить: оператор в поле не всегда
 * различает «подтекает» и «течёт», а от уровня зависит допуск к работе.
 */
export const triageDefectSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  maintenanceRecordId: identifier.optional(),
  comment: z.string().trim().max(2000).optional(),
}).strict();

export const resolveDefectSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  resolution: z.string().trim().min(3).max(2000),
}).strict();

/** Отклонение всегда с причиной: «отклонён без объяснения» — тупик для оператора. */
export const rejectDefectSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  reason: z.string().trim().min(3).max(2000),
}).strict();

export const listDefectsQuerySchema = z.object({
  equipmentId: identifier.optional(),
  status: z.enum(DEFECT_STATUSES).optional(),
  severity: z.enum(DEFECT_SEVERITIES).optional(),
  openOnly: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  cursor: z.string().trim().max(256).optional(),
}).strict();

export type CreateDefectPayload = z.infer<typeof createDefectSchema>;
export type TriageDefectPayload = z.infer<typeof triageDefectSchema>;
export type ResolveDefectPayload = z.infer<typeof resolveDefectSchema>;
export type RejectDefectPayload = z.infer<typeof rejectDefectSchema>;
