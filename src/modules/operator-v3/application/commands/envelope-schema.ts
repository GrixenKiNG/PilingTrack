import {createHash} from 'node:crypto';
import {z} from 'zod';
import {canonicalize} from '@/modules/readiness/domain/audit/canonicalize';

const printableAscii = /^[\x21-\x7E]+$/;

export const operatorCommandEnvelopeSchema = z.object({
  commandId: z.string().min(16).max(128).regex(printableAscii, 'Идентификатор команды содержит недопустимые символы'),
  aggregateId: z.string().min(1).max(191).optional(),
  expectedVersion: z.number().int().min(0),
  deviceId: z.string().trim().min(3).max(191),
  deviceSequence: z.number().int().positive(),
  occurredAt: z.string().datetime({offset: true}),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export type OperatorCommandEnvelope = z.infer<typeof operatorCommandEnvelopeSchema>;

const id = z.string().trim().min(1).max(191);
const timestamp = z.string().datetime({offset: true});
const shiftEquipment = {shiftId: id, equipmentId: id};

const newSpecPayloadSchemas: Readonly<Record<string, z.ZodType>> = {
  'start-checklist': z.object({executionId: id, ...shiftEquipment, templateId: id}).strict(),
  'save-checklist-answer': z.object({
    executionId: id,
    answer: z.object({
      itemId: id,
      result: z.enum(['PASS', 'FAIL', 'NA', 'VALUE']),
      value: z.union([z.number(), z.string(), z.null()]),
      note: z.string().trim().max(2000).nullable(),
      mediaIds: z.array(id).max(20),
      answeredAt: timestamp,
    }).strict(),
  }).strict(),
  'complete-checklist': z.object({executionId: id}).strict(),
  'submit-knowledge-test': z.object({
    ...shiftEquipment,
    correctAnswers: z.number().int().min(0).max(5),
    totalQuestions: z.literal(5),
    passed: z.boolean(),
  }).strict().superRefine((value, context) => {
    if (value.passed !== (value.correctAnswers >= 4)) {
      context.addIssue({code: 'custom', path: ['passed'], message: 'Результат теста не совпадает с числом правильных ответов'});
    }
  }),
  'capture-weather': z.object({
    ...shiftEquipment,
    temperatureC: z.number().min(-80).max(80),
    windSpeedMps: z.number().min(0).max(100),
    windGustMps: z.number().min(0).max(150),
    precipitation: z.enum(['NONE', 'RAIN', 'SNOW', 'HAIL', 'MIXED']),
    visibilityMeters: z.number().min(0).max(100_000),
    thunderstorm: z.boolean(),
    observedAt: timestamp,
    source: z.enum(['SITE', 'DEVICE', 'WEATHER_SERVICE']),
  }).strict(),
  'confirm-site-check': z.object({
    ...shiftEquipment,
    confirmed: z.literal(true),
    issues: z.array(z.string().trim().min(1).max(500)).max(50),
    mediaIds: z.array(id).max(20),
  }).strict(),
  'record-startup': z.object({...shiftEquipment, meterHours: z.number().min(0), startedAt: timestamp}).strict(),
  'record-warmup': z.object({
    ...shiftEquipment,
    coolantTemperatureC: z.number().min(-80).max(180),
    hydraulicTemperatureC: z.number().min(-80).max(180),
    confirmedAt: timestamp,
  }).strict(),
  'complete-function-check': z.object({
    ...shiftEquipment,
    checks: z.array(z.object({code: id, result: z.enum(['PASS', 'FAIL', 'NA'])}).strict()).min(1).max(100),
    completedAt: timestamp,
  }).strict(),
  'record-maintenance-action': z.object({
    ...shiftEquipment,
    actionCode: id,
    result: z.enum(['DONE', 'NOT_REQUIRED', 'PROBLEM']),
    quantity: z.number().min(0).nullable(),
    unit: z.string().trim().min(1).max(32).nullable(),
    note: z.string().trim().max(2000).nullable(),
    mediaIds: z.array(id).max(20),
  }).strict(),
  'record-fluid-reading': z.object({
    ...shiftEquipment,
    fluidType: id,
    level: z.enum(['LOW', 'NORMAL', 'HIGH']),
    addedQuantity: z.number().min(0).nullable(),
    unit: z.string().trim().min(1).max(32).nullable(),
    note: z.string().trim().max(2000).nullable(),
    mediaIds: z.array(id).max(20),
  }).strict(),
  'record-pile-driving': z.object({
    ...shiftEquipment,
    pileId: id,
    depthMeters: z.number().positive(),
    startedAt: timestamp,
    finishedAt: timestamp,
  }).strict(),
  'record-leader-drilling': z.object({
    ...shiftEquipment,
    holeId: id,
    depthMeters: z.number().positive(),
    startedAt: timestamp,
    finishedAt: timestamp,
  }).strict(),
};

export function operatorCommandEnvelopeSchemaFor(commandName: string) {
  const payloadSchema = newSpecPayloadSchemas[commandName];
  return payloadSchema ? operatorCommandEnvelopeSchema.extend({payload: payloadSchema}) : operatorCommandEnvelopeSchema;
}

export function operatorCommandChecksum(envelope: OperatorCommandEnvelope): string {
  return createHash('sha256').update(canonicalize({
    aggregateId: envelope.aggregateId ?? null,
    commandId: envelope.commandId,
    deviceId: envelope.deviceId,
    deviceSequence: envelope.deviceSequence,
    expectedVersion: envelope.expectedVersion,
    occurredAt: envelope.occurredAt,
    payload: envelope.payload,
  }), 'utf8').digest('hex');
}
