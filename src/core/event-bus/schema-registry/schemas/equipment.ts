import type { SchemaDef } from '../registry';

export const equipmentEventSchemas: SchemaDef[] = [
  {
    id: 'equipment.created',
    version: 1,
    schema: {
      $id: 'equipment.created.v1',
      type: 'object',
      required: ['id', 'name', 'model', 'qty'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        model: { type: 'string', maxLength: 200 },
        qty: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'equipment.updated',
    version: 1,
    schema: {
      $id: 'equipment.updated.v1',
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
    id: 'equipment.deleted',
    version: 1,
    schema: {
      $id: 'equipment.deleted.v1',
      type: 'object',
      required: ['id', 'deletedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        deletedAt: { type: 'string', format: 'date-time' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
];
