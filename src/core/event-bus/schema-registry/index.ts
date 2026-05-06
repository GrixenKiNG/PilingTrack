/**
 * Event Schema Registry — Ajv-based validation with versioning.
 *
 * Public API:
 *   schemaRegistry            — singleton instance
 *   registerAllEventSchemas() — call once at startup
 *   SchemaDef, SchemaInfo, CompatibilityMode (types)
 *   SchemaRegistry            — class for tests / advanced usage
 *
 * Schemas are split by domain under ./schemas/.
 */

import { logger } from '@/lib/logger';
import { SchemaRegistry } from './registry';
import { getEventSchemas } from './schemas';

export { SchemaRegistry } from './registry';
export type { CompatibilityMode, SchemaDef, SchemaInfo } from './registry';

export const schemaRegistry = new SchemaRegistry();

let _schemasRegistered = false;

function shouldLogSchemaRegistration(): boolean {
  return process.env.LOG_SCHEMA_REGISTRATION === 'true';
}

/**
 * Register all known event schemas.
 * Called once on application startup. Idempotent.
 */
export function registerAllEventSchemas(): void {
  if (_schemasRegistered) return;

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
