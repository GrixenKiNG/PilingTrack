import type { SchemaDef } from '../registry';

export const crewEventSchemas: SchemaDef[] = [
  {
    id: 'crew.created',
    version: 1,
    schema: {
      $id: 'crew.created.v1',
      type: 'object',
      required: ['id', 'operatorId', 'equipmentId', 'siteId', 'name'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        operatorId: { type: 'string', format: 'uuid' },
        equipmentId: { type: 'string', format: 'uuid' },
        siteId: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 200 },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'crew.updated',
    version: 1,
    schema: {
      $id: 'crew.updated.v1',
      type: 'object',
      required: ['id', 'changes', 'updatedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        changes: { type: 'array', items: { type: 'string' } },
        updatedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'crew.deactivated',
    version: 1,
    schema: {
      $id: 'crew.deactivated.v1',
      type: 'object',
      required: ['id', 'deactivatedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        reason: { type: 'string' },
        deactivatedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
];
