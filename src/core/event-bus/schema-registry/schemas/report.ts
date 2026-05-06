import type { SchemaDef } from '../registry';

export const reportEventSchemas: SchemaDef[] = [
  {
    id: 'report.created',
    version: 1,
    schema: {
      $id: 'report.created.v1',
      type: 'object',
      required: ['id', 'userId', 'siteId', 'date', 'status', 'version', 'updatedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        siteId: { type: 'string', format: 'uuid' },
        date: { type: 'string', format: 'date' },
        status: { type: 'string', enum: ['draft', 'submitted'] },
        version: { type: 'integer', minimum: 1 },
        updatedAt: { type: 'string', format: 'date-time' },
        piles: {
          type: 'array',
          items: {
            type: 'object',
            required: ['pileGradeId', 'count'],
            properties: {
              pileGradeId: { type: 'string' },
              count: { type: 'integer', minimum: 0 },
            },
          },
        },
        drillings: {
          type: 'array',
          items: {
            type: 'object',
            required: ['typeId', 'meters'],
            properties: {
              typeId: { type: 'string' },
              meters: { type: 'number', minimum: 0 },
            },
          },
        },
        downtimes: {
          type: 'array',
          items: {
            type: 'object',
            required: ['reasonId', 'duration'],
            properties: {
              reasonId: { type: 'string' },
              duration: { type: 'number', minimum: 0 },
            },
          },
        },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'report.updated',
    version: 1,
    schema: {
      $id: 'report.updated.v1',
      type: 'object',
      required: ['id', 'version', 'updatedAt'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        version: { type: 'integer', minimum: 1 },
        updatedAt: { type: 'string', format: 'date-time' },
        status: { type: 'string', enum: ['draft', 'submitted'] },
        changes: {
          type: 'array',
          items: { type: 'string' },
        },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'report.submitted',
    version: 1,
    schema: {
      $id: 'report.submitted.v1',
      type: 'object',
      required: ['id', 'userId', 'submittedAt', 'version'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        submittedAt: { type: 'string', format: 'date-time' },
        version: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
  {
    id: 'report.deleted',
    version: 1,
    schema: {
      $id: 'report.deleted.v1',
      type: 'object',
      required: ['id', 'userId', 'deletedAt', 'version'],
      properties: {
        id: { type: 'string', format: 'uuid' },
        userId: { type: 'string', format: 'uuid' },
        deletedAt: { type: 'string', format: 'date-time' },
        version: { type: 'integer', minimum: 1 },
      },
      additionalProperties: false,
    },
    compatibility: 'BACKWARD',
  },
];
