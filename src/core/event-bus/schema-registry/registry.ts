import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { logger } from '@/lib/logger';

function shouldLogSchemaRegistration(): boolean {
  return process.env.LOG_SCHEMA_REGISTRATION === 'true';
}

export type CompatibilityMode = 'BACKWARD' | 'FORWARD' | 'FULL' | 'NONE';

export interface SchemaDef {
  id: string;
  version: number;
  schema: object;
  compatibility: CompatibilityMode;
}

export interface SchemaInfo {
  id: string;
  version: number;
  compatibility: CompatibilityMode;
  registeredAt: string;
}

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
      logger.warn('Schema not found — validation skipped', { eventType, version });
      return true;
    }

    const valid = validateFn(payload);

    if (!valid) {
      const errors = (validateFn as ValidateFunction).errors;
      const error = new Error(
        `Event validation failed for ${key}: ${JSON.stringify(errors)}`
      );
      (error as Error & { errors?: unknown }).errors = errors;
      throw error;
    }

    return true;
  }

  getSchema(eventType: string, version: number): object | null {
    const key = `${eventType}.v${version}`;
    return this.schemas.get(key)?.schema || null;
  }

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

  getAllVersions(eventType: string): number[] {
    const versions: number[] = [];
    for (const [key] of this.schemas) {
      if (key.startsWith(`${eventType}.v`)) {
        versions.push(parseInt(key.split('.v')[1], 10));
      }
    }
    return versions.sort((a, b) => a - b);
  }

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

  private checkCompatibility(
    oldSchema: object,
    newSchema: object,
    mode: CompatibilityMode
  ): boolean {
    const oldRequired = (oldSchema as { required?: string[] }).required || [];
    const newRequired = (newSchema as { required?: string[] }).required || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const oldProps = (oldSchema as any).properties || {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped external/library boundary
    const newProps = (newSchema as any).properties || {};

    if (mode === 'BACKWARD' || mode === 'FULL') {
      for (const field of newRequired) {
        if (!oldRequired.includes(field)) {
          const prop = newProps[field];
          if (!prop || prop.default === undefined) {
            logger.warn('New required field without default — backward incompatible', { field });
            return false;
          }
        }
      }
    }

    if (mode === 'FORWARD' || mode === 'FULL') {
      for (const field of oldRequired) {
        if (!newRequired.includes(field) && !newProps[field]) {
          logger.warn('Removed required field — forward incompatible', { field });
          return false;
        }
      }
    }

    // suppress unused variable warning — oldProps reserved for future deeper checks
    void oldProps;

    return true;
  }
}
