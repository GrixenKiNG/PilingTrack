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
 *
 * Уже зарегистрированная версия — не ошибка (повторный вызов, другой путь
 * запуска): её пропускаем. Любая другая ошибка (несовместимая версия, битая
 * схема) раньше глоталась комментарием «уже зарегистрирована», а флаг
 * выставлялся всё равно: схема молча пропадала, и повторить было нельзя. Теперь
 * ошибки собираются, остальные схемы регистрируются, и в конце выбрасывается
 * одно исключение со всеми причинами. Флаг при сбое не выставляется, следующий
 * вызов попробует снова. Места запуска воркеров это исключение ловят и пишут
 * предупреждение, так что запуск не падает, но причина видна.
 */
export function registerAllEventSchemas(): void {
  if (_schemasRegistered) return;

  const schemas = getEventSchemas();
  const failures: string[] = [];

  for (const schema of schemas) {
    if (schemaRegistry.getSchema(schema.id, schema.version)) continue;
    try {
      schemaRegistry.register(schema);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length > 0) {
    throw new Error(`Не удалось зарегистрировать схемы событий (${failures.length}): ${failures.join('; ')}`);
  }

  _schemasRegistered = true;
  if (shouldLogSchemaRegistration()) {
    logger.info('All event schemas registered', { count: schemas.length });
  }
}
