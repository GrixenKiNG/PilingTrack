import type { ReadinessBootstrapEnvelope } from '../contracts';

export function bootstrapEnvelope(
  requestId = 'request-test',
): ReadinessBootstrapEnvelope {
  return {
    data: {
      tenant: { timezone: 'Europe/Moscow' },
      actor: { id: 'actor-1', role: 'DISPATCHER', actingAs: null },
      featureFlags: {
        readiness_shifts_v1: true,
        readiness_permits_v1: true,
        readiness_audit_chain_v1: false,
      },
      selectors: {
        equipment: [{ id: 'equipment-1', name: 'Rig 1', model: null }],
        sites: [{ id: 'site-1', name: 'Site 1' }],
        actors: [{ id: 'actor-1', name: 'Dispatcher', role: 'DISPATCHER' }],
      },
      counts: {
        equipment: 1,
        sites: 1,
        activeCrews: 1,
        publishedRuleSets: 1,
        draftRuleSets: 0,
      },
      capabilities: {
        abilities: ['readiness.read', 'readiness.handover.decide'],
        screens: {
          readiness: true,
          fleet: true,
          shifts: true,
          permits: true,
          maintenance: true,
          reports: true,
          settings: true,
        },
        entities: {
          equipment: { read: true },
          inspection: { manage: false },
          defect: { manage: false },
          meter: { manage: false },
          maintenance: { manage: false },
          shift: { manage: false, prepareHandover: false, decideHandover: true },
          permit: { edit: false, approveDispatcher: true, approveAdmin: false },
          rules: { manage: false },
          audit: { read: true, export: false },
        },
        canActAsMechanic: false,
      },
    },
    meta: { requestId },
  };
}

