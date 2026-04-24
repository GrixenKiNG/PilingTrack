/**
 * Event Schema Registry — Ajv-based validation with versioning
 *
 * Guarantees:
 * - Every event is validated against its schema before publish
 * - Schemas are versioned (eventType + version)
 * - Backward compatibility checks on registration
 * - Graceful degradation: missing schema = warning, not error
 */

import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { logger } from '@/lib/logger';

function shouldLogSchemaRegistration(): boolean {
  return process.env.LOG_SCHEMA_REGISTRATION === 'true';
}

// ============================================================
// Types
// ============================================================

export type CompatibilityMode = 'BACKWARD' | 'FORWARD' | 'FULL' | 'NONE';

export interface SchemaDef {
  id: string;           // e.g. "report.created"
  version: number;
  schema: object;       // JSON Schema
  compatibility: CompatibilityMode;
}

export interface SchemaInfo {
  id: string;
  version: number;
  compatibility: CompatibilityMode;
  registeredAt: string;
}

// ============================================================
// Schema Registry
// ============================================================

export class SchemaRegistry {
  private ajv: Ajv;
  private schemas: Map<string, SchemaDef>;
  private registeredAt: Map<string, string>;

  constructor() {
    this.ajv = new Ajv({
      strict: true,
      allErrors: true,
      coerceTypes: false,
    });
    addFormats(this.ajv);

    this.schemas = new Map();
    this.registeredAt = new Map();
  }

  /**
   * Register a new schema version.
   * Validates backward compatibility before registration.
   */
  register(def: SchemaDef): void {
    const key = `${def.id}.v${def.version}`;

    // Check compatibility with previous version
    if (def.compatibility !== 'NONE' && def.version > 1) {
      const prevVersion = def.version - 1;
      const prevSchema = this.schemas.get(`${def.id}.v${prevVersion}`);

      if (prevSchema) {
        const compatible = this.checkCompatibility(prevSchema.schema, def.schema, def.compatibility);
        if (!compatible) {
          throw new Error(
            `Schema ${key} is not ${def.compatibility}-compatible with v${prevVersion}`
          );
        }
      }
    }

    // Add to Ajv
    this.ajv.addSchema(def.schema, key);
    this.schemas.set(key, def);
    this.registeredAt.set(key, new Date().toISOString());

    if (shouldLogSchemaRegistration()) {
      logger.debug('Schema registered', { eventType: def.id, version: def.version });
    }
  }

  /**
   * Validate event payload against its schema.
   * Returns true if valid, throws on failure.
   */
  validate(eventType: string, version: number, payload: unknown): boolean {
    const key = `${eventType}.v${version}`;
    const validateFn = this.ajv.getSchema(key);

    if (!validateFn) {
      // Graceful degradation — schema not found
      logger.warn('Schema not found — validation skipped', { eventType, version });
      return true;
    }

    const valid = validateFn(payload);

    if (!valid) {
      const errors = (validateFn as ValidateFunction).errors;
      const error = new Error(
        `Event validation failed for ${key}: ${JSON.stringify(errors)}`
      );
      (error as any).errors = errors;
      throw error;
    }

    return true;
  }

  /**
   * Get schema definition by type and version.
   */
  getSchema(eventType: string, version: number): object | null {
    const key = `${eventType}.v${version}`;
    return this.schemas.get(key)?.schema || null;
  }

  /**
   * Get latest version number for an event type.
   */
  getLatestVersion(eventType: string): number {
    let maxVersion = 0;
    for (const [key] of this.schemas) {
      if (key.startsWith(`${eventType}.v`)) {
        const version = parseInt(key.split('.v')[1], 10);
        if (version > maxVersion) maxVersion = version;
      }
    }
    return maxVersion;
  }

  /**
   * Get all registered versions for an event type.
   */
  getAllVersions(eventType: string): number[] {
    const versions: number[] = [];
    for (const [key] of this.schemas) {
      if (key.startsWith(`${eventType}.v`)) {
        versions.push(parseInt(key.split('.v')[1], 10));
      }
    }
    return versions.sort((a, b) => a - b);
  }

  /**
   * Get all registered schema info.
   */
  getAllSchemas(): SchemaInfo[] {
    const result: SchemaInfo[] = [];
    for (const [key, def] of this.schemas) {
      result.push({
        id: def.id,
        version: def.version,
        compatibility: def.compatibility,
        registeredAt: this.registeredAt.get(key) || '',
      });
    }
    return result;
  }

  /**
   * Check backward compatibility between two schemas.
   */
  private checkCompatibility(
    oldSchema: object,
    newSchema: object,
    mode: CompatibilityMode
  ): boolean {
    const oldRequired = (oldSchema as any).required || [];
    const newRequired = (newSchema as any).required || [];
    const oldProps = (oldSchema as any).properties || {};
    const newProps = (newSchema as any).properties || {};

    // BACKWARD: new schema can read data written with old schema
    // → new required fields must have defaults, removed required fields OK
    if (mode === 'BACKWARD' || mode === 'FULL') {
      // New required fields must have been optional before
      for (const field of newRequired) {
        if (!oldRequired.includes(field)) {
          // New required field — backward incompatible unless it has a default
          const prop = newProps[field];
          if (!prop || prop.default === undefined) {
            logger.warn('New required field without default — backward incompatible', { field });
            return false;
          }
        }
      }
    }

    // FORWARD: old schema can read data written with new schema
    // → old required fields must still exist, added fields OK if optional
    if (mode === 'FORWARD' || mode === 'FULL') {
      for (const field of oldRequired) {
        if (!newRequired.includes(field) && !newProps[field]) {
          logger.warn('Removed required field — forward incompatible', { field });
          return false;
        }
      }
    }

    return true;
  }
}

// ============================================================
// Singleton + Schema Registration
// ============================================================

export const schemaRegistry = new SchemaRegistry();

// Track if schemas have been registered to prevent duplicates
let _schemasRegistered = false;

/**
 * Register all known event schemas.
 * Called once on application startup.
 * Idempotent — safe to call multiple times.
 */
export function registerAllEventSchemas(): void {
  if (_schemasRegistered) return; // Already registered — skip

  // Import schemas dynamically to avoid circular deps
  const schemas = getEventSchemas();

  for (const schema of schemas) {
    try {
      schemaRegistry.register(schema);
    } catch {
      // Schema may already be registered — skip duplicates
    }
  }

  _schemasRegistered = true;
  if (shouldLogSchemaRegistration()) {
    logger.info('All event schemas registered', { count: schemas.length });
  }
}

function getEventSchemas(): SchemaDef[] {
  return [
    // ── Report Events ──
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

    // ── Crew Events ──
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

    // ── Site Events ──
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

    // ── Equipment Events ──
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

    // ── Telemetry Events ──
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

    // ── Sync Events ──
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

    // ── System Events ──
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
}
