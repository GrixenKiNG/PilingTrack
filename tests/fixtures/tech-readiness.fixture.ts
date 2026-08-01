export const TECH_READINESS_TEST_TENANT = {
  id: 'test-tenant-readiness-primary',
  timezone: 'Europe/Moscow',
} as const;

export const TECH_READINESS_FOREIGN_TENANT = {
  id: 'test-tenant-readiness-foreign',
  timezone: 'Asia/Yekaterinburg',
} as const;

export const TECH_READINESS_USERS = {
  admin: {
    id: 'test-user-readiness-admin',
    name: 'Readiness Admin',
    role: 'ADMIN',
    tenantId: TECH_READINESS_TEST_TENANT.id,
  },
  mechanic: {
    id: 'test-user-readiness-mechanic',
    name: 'Readiness Mechanic',
    role: 'MECHANIC',
    tenantId: TECH_READINESS_TEST_TENANT.id,
  },
  dispatcher: {
    id: 'test-user-readiness-dispatcher-a',
    name: 'Readiness Dispatcher A',
    role: 'DISPATCHER',
    tenantId: TECH_READINESS_TEST_TENANT.id,
  },
  secondDispatcher: {
    id: 'test-user-readiness-dispatcher-b',
    name: 'Readiness Dispatcher B',
    role: 'DISPATCHER',
    tenantId: TECH_READINESS_TEST_TENANT.id,
  },
  operator: {
    id: 'test-user-readiness-operator',
    name: 'Readiness Operator',
    role: 'OPERATOR',
    tenantId: TECH_READINESS_TEST_TENANT.id,
  },
  foreignAdmin: {
    id: 'test-user-readiness-foreign-admin',
    name: 'Foreign Readiness Admin',
    role: 'ADMIN',
    tenantId: TECH_READINESS_FOREIGN_TENANT.id,
  },
} as const;

export const TECH_READINESS_ENTITIES = {
  equipmentId: 'test-equipment-readiness-001',
  foreignEquipmentId: 'test-equipment-readiness-foreign-001',
  shiftId: 'test-shift-readiness-001',
  handoverId: 'test-handover-readiness-001',
  normalPermitId: 'test-permit-readiness-normal-001',
  elevatedPermitId: 'test-permit-readiness-elevated-001',
  ruleSetId: 'test-rules-readiness-v1',
} as const;

export const TECH_READINESS_FILTERS = {
  equipmentId: TECH_READINESS_ENTITIES.equipmentId,
  status: 'ACCEPTED',
  from: '2026-07-01',
  to: '2026-07-31',
  sort: 'occurredAt.desc',
} as const;

export const TECH_READINESS_FLAGS = {
  READINESS_SHIFTS_V1: 'true',
  READINESS_PERMITS_V1: 'true',
  READINESS_AUDIT_CHAIN_V1: 'false',
} as const;

export function assertIsolatedTestFixture(value: string): void {
  if (!value.startsWith('test-')) {
    throw new Error(`Tech Readiness fixture must be isolated test data: ${value}`);
  }
}

Object.values(TECH_READINESS_USERS).forEach((user) => {
  assertIsolatedTestFixture(user.id);
  assertIsolatedTestFixture(user.tenantId);
});
Object.values(TECH_READINESS_ENTITIES).forEach(assertIsolatedTestFixture);
