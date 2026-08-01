import {z} from 'zod';

const offsetTimestamp = z.string().datetime({offset: true});
const identifier = z.string().trim().min(1).max(128);

export const createWorkPermitSchema = z.object({
  equipmentId: identifier,
  shiftId: z.null().optional(),
  risk: z.enum(['NORMAL', 'ELEVATED']),
  scope: z.string().trim().min(3).max(4000),
  validFrom: offsetTimestamp,
  validTo: offsetTimestamp,
}).strict();

export const updateWorkPermitSchema = z.object({
  expectedVersion: z.number().int().positive().optional(),
  equipmentId: identifier.optional(),
  shiftId: z.null().optional(),
  risk: z.enum(['NORMAL', 'ELEVATED']).optional(),
  scope: z.string().trim().min(3).max(4000).optional(),
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
