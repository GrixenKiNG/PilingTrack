import Ajv, { type ValidateFunction } from 'ajv';
import addFormats from 'ajv-formats';
import { logger } from '@/lib/logger';

function shouldLogSchemaRegistration(): boolean {
  return process.env.LOG_SCHEMA_REGISTRATION === 'true';
}

/** Новый тип принимает все значения старого (integer входит в number). Тип не задан — не сравниваем. */
function typeAccepts(newType: unknown, oldType: unknown): boolean {
  if (newType === undefined || oldType === undefined) return true;
  const next = ([] as unknown[]).concat(newType);
  return ([] as unknown[]).concat(oldType).every(
    (type) => next.includes(type) || (type === 'integer' && next.includes('number')),
  );
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
   *
   * ВНИМАНИЕ (21.10.2026): ни одно место публикации или обработки событий сейчас
   * не вызывает validate() — реестр при старте заполняется, но события им не
   * проверяются. Поэтому режим для неизвестной версии («схема не найдена»)
   * пока ни на что не влияет. Он fail-open: проверка пропускается с
   * предупреждением. Когда проверку подключат к публикации, для событий с
   * неизвестной версией нужен fail-closed — иначе неверная схема пропустит
   * любой payload. Подробности: night-logs/analysis-22.md.
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
    const oldProps = (oldSchema as { properties?: Record<string, { default?: unknown; type?: unknown }> }).properties || {};
    const newProps = (newSchema as { properties?: Record<string, { default?: unknown; type?: unknown }> }).properties || {};

    if (mode === 'BACKWARD' || mode === 'FULL') {
      for (const field of newRequired) {
        // default не спасает: Ajv работает без useDefaults, старое событие без поля не пройдёт.
        if (!oldRequired.includes(field)) {
          logger.warn('New required field — backward incompatible', { field });
          return false;
        }
      }
      for (const field of Object.keys(oldProps)) {
        if (newProps[field] && !typeAccepts(newProps[field].type, oldProps[field].type)) {
          logger.warn('Property type changed — backward incompatible', { field });
          return false;
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

    return true;
  }
}
