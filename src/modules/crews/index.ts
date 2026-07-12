/**
 * Crews Module — DDD Bounded Context
 */

// Domain
export { CrewAggregate } from './domain/crew.aggregate';
export type { CrewInfo, CrewCreateData } from './domain/crew.aggregate';
export { createCrewEvent } from './domain/crew.events';

// Application — Commands
export {
  createCrew,
  updateCrew,
  deleteCrew,
} from './application/commands/crew-command.service';
export type { CreateCrewCommand, UpdateCrewCommand, DeleteCrewCommand } from './application/commands/crew.command';

// Application — Queries
export {
  getAccessibleCrews,
  getCrewById,
  getCrewForOperator,
} from './application/queries/crew-query.service';

// Infrastructure
export { getCrewRepository } from './infrastructure/crew.repository';
