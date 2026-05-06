import type { SchemaDef } from '../registry';

export const syncEventSchemas: SchemaDef[] = [
  {
    id: 'sync.completed',
    version: 1,
    schema: {
      $id: 'sync.completed.v1',
      type: 'object',
      required: ['deviceId', 'userId', 'changesApplied', 'changesPulled', 'syncDurationMs'],
      properties: {
        deviceId: { type: 'string' },
        userId: { type: 'string', format: 'uuid' },
        changesApplied: { type: 'integer', minimum: 0 },
        changesPulled: { type: 'integer', minimum: 0 },
        conflictsResolved: { type: 'integer', minimum: 0 },
        syncDurationMs: { type: 'integer', minimum: 0 },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'sync.failed',
    version: 1,
    schema: {
      $id: 'sync.failed.v1',
      type: 'object',
      required: ['deviceId', 'userId', 'error', 'attempts'],
      properties: {
        deviceId: { type: 'string' },
        userId: { type: 'string', format: 'uuid' },
        error: { type: 'string' },
        attempts: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'sync.conflict_resolved',
    version: 1,
    schema: {
      $id: 'sync.conflict_resolved.v1',
      type: 'object',
      required: ['deviceId', 'reportId', 'strategy', 'resolvedAt'],
      properties: {
        deviceId: { type: 'string' },
        reportId: { type: 'string', format: 'uuid' },
        strategy: { type: 'string', enum: ['server_wins', 'client_wins', 'field_merge'] },
        resolvedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
];
