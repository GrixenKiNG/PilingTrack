import type { SchemaDef } from '../registry';

export const telemetryEventSchemas: SchemaDef[] = [
  {
    id: 'telemetry.recorded',
    version: 1,
    schema: {
      $id: 'telemetry.recorded.v1',
      type: 'object',
      required: ['equipmentId', 'type', 'value', 'timestamp'],
      properties: {
        equipmentId: { type: 'string', format: 'uuid' },
        siteId: { type: 'string', format: 'uuid' },
        type: { type: 'string', maxLength: 50 },
        value: { type: 'number' },
        unit: { type: 'string', maxLength: 20 },
        timestamp: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
];
