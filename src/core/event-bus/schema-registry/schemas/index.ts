import type { SchemaDef } from '../registry';
import { crewEventSchemas } from './crew';
import { equipmentEventSchemas } from './equipment';
import { reportEventSchemas } from './report';
import { siteEventSchemas } from './site';
import { syncEventSchemas } from './sync';
import { systemEventSchemas } from './system';
import { telemetryEventSchemas } from './telemetry';

export function getEventSchemas(): SchemaDef[] {
  return [
    ...reportEventSchemas,
    ...crewEventSchemas,
    ...siteEventSchemas,
    ...equipmentEventSchemas,
    ...telemetryEventSchemas,
    ...syncEventSchemas,
    ...systemEventSchemas,
  ];
}
