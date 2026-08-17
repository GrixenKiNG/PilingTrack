import {appendAuditEvent} from './append-audit';
import {PrismaAuditRepository} from './audit-repository';
import type {AppendAuditInput} from '../../domain/audit/types';
import type {ReadinessTransaction} from '../tenant-transaction';

/**
 * Записать событие в цепочку аудита контура готовности.
 *
 * Функция жила в `core/infrastructure/audit-log-service.ts` — и тянула оттуда
 * четыре импорта из `modules/readiness`: транзакцию, тип входа, репозиторий и
 * саму запись. Правило слоёв проекта (CLAUDE.md: `core/` — инфраструктура и не
 * зависит от вышележащих слоёв) нарушалось ровно этой обёрткой в пять строк,
 * а линтер сообщал об этом четырьмя предупреждениями `no-restricted-imports`.
 *
 * Ничего общеинфраструктурного в ней нет: и зависимости, и все вызывающие —
 * код готовности. Поэтому она переехала сюда, к своим соседям, а `core/` снова
 * ничего не знает о модулях. Общий `recordAuditLog` (нецепочечный, на голом
 * `db.auditLog`) остался в core — он и правда общий.
 */
export function recordChainedReadinessAudit(
  tx: ReadinessTransaction,
  entry: AppendAuditInput,
) {
  return appendAuditEvent(new PrismaAuditRepository(tx), entry);
}
