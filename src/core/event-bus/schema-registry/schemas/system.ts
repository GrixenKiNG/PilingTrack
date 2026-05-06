import type { SchemaDef } from '../registry';

export const systemEventSchemas: SchemaDef[] = [
  {
    id: 'system.degraded',
    version: 1,
    schema: {
      $id: 'system.degraded.v1',
      type: 'object',
      required: ['component', 'previousStatus', 'currentStatus', 'detectedAt'],
      properties: {
        component: { type: 'string' },
        previousStatus: { type: 'string' },
        currentStatus: { type: 'string' },
        detectedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'system.recovered',
    version: 1,
    schema: {
      $id: 'system.recovered.v1',
      type: 'object',
      required: ['component', 'previousStatus', 'currentStatus', 'recoveredAt'],
      properties: {
        component: { type: 'string' },
        previousStatus: { type: 'string' },
        currentStatus: { type: 'string' },
        recoveredAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
];
