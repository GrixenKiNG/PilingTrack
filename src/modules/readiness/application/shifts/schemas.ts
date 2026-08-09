import {z} from 'zod';

const strictObject = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const expectedVersion = z.number().int().positive().optional();
const instant = z.string().datetime({offset: true});

export const createShiftSchema = strictObject({
  equipmentId: z.string().min(1).max(191),
  type: z.enum(['DAY', 'NIGHT']),
  plannedStartAt: instant.nullable().optional(),
  plannedEndAt: instant.nullable().optional(),
});
export const updateShiftSchema = strictObject({
  expectedVersion,
  type: z.enum(['DAY', 'NIGHT']).optional(),
  plannedStartAt: instant.nullable().optional(),
  plannedEndAt: instant.nullable().optional(),
}).refine((value) => Object.keys(value).some((key) => key !== 'expectedVersion'), 'A substantive field is required');
export const versionedShiftSchema = strictObject({expectedVersion});
export const cancelShiftSchema = strictObject({expectedVersion, reason: z.string().min(3).max(1000)});
export const submitHandoverSchema = strictObject({
  expectedVersion,
  summary: z.string().min(3).max(4000),
  evidence: z.record(z.string(), z.unknown()).optional(),
});
export const acceptHandoverSchema = strictObject({expectedVersion});
export const reworkHandoverSchema = strictObject({expectedVersion, reason: z.string().min(3).max(1000)});
export const declineShiftSchema = strictObject({expectedVersion, reason: z.string().min(3).max(1000)});

export type CreateShiftPayload = z.infer<typeof createShiftSchema>;
export type UpdateShiftPayload = z.infer<typeof updateShiftSchema>;
export type SubmitHandoverPayload = z.infer<typeof submitHandoverSchema>;
