/**
 * Client-safe entry: pure data and functions, no database, no node:*.
 * Purity is enforced by src/modules/__tests__/client-entry-purity.test.ts.
 */
export {
  getConsumables,
} from './domain/consumables';
export {
  computeHealthScore,
} from './domain/inspection-logic';
export {
  getLubeMap,
} from './domain/lubrication-maps';
export type {
  LubePoint,
} from './domain/lubrication-maps';
export {
  diffInspectionStates,
  type StateAnswer,
} from './domain/state-diff';
