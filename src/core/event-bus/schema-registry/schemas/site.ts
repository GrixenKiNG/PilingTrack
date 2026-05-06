import type { SchemaDef } from '../registry';

export const siteEventSchemas: SchemaDef[] = [
  {
    id: 'site.created',
    version: 1,
    schema: {
      $id: 'site.created.v1',
      type: 'object',
      required: ['id', 'name', 'tenantId'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        name: { type: 'string', minLength: 1, maxLength: 200 },
        tenantId: { type: 'string', format: 'uuid' },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'site.updated',
    version: 1,
    schema: {
      $id: 'site.updated.v1',
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
    id: 'site.deleted',
    version: 1,
    schema: {
      $id: 'site.deleted.v1',
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
