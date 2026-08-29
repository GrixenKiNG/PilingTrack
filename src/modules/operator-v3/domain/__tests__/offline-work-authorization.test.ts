import {generateKeyPairSync, sign} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  offlineAuthorizationClaims,
  serializeOfflineAuthorizationClaims,
  verifyOfflineWorkAuthorization,
  type OfflineAuthorityContext,
  type SignedOfflineWorkAuthorization,
} from '../offline-work-authorization';
import type {TrustedOperatorDevice} from '../trusted-operator-device';

const keys = generateKeyPairSync('ed25519');
const publicKeyPem = keys.publicKey.export({type: 'spki', format: 'pem'}).toString();

const device = (overrides: Partial<TrustedOperatorDevice> = {}): TrustedOperatorDevice => ({
  id: 'device-1', tenantId: 'tenant-1', operatorId: 'operator-1', keyId: 'key-1', publicKeyPem,
  state: 'ACTIVE', registeredAt: '2026-08-27T07:00:00.000Z', revokedAt: null, ...overrides,
});

function authorization(overrides: Partial<SignedOfflineWorkAuthorization> = {}): SignedOfflineWorkAuthorization {
  const unsigned: SignedOfflineWorkAuthorization = {
    authorizationId: 'authorization-1', authorizationVersion: 1, algorithm: 'Ed25519', keyId: 'key-1',
    tenantId: 'tenant-1', operatorId: 'operator-1', assignmentId: 'assignment-1', equipmentId: 'equipment-1',
    shiftId: 'shift-1', deviceId: 'device-1', rulesVersion: 'rules-1', readinessSnapshotId: 'snapshot-1',
    readinessDecision: 'ALLOWED', allowedCommands: ['record-production', 'start-break', 'finish-break'],
    issuedAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-27T12:00:00.000Z', signature: '',
    ...overrides,
  };
  const signature = sign(null, serializeOfflineAuthorizationClaims(offlineAuthorizationClaims(unsigned)), keys.privateKey);
  return {...unsigned, signature: signature.toString('base64url')};
}

const context = (overrides: Partial<OfflineAuthorityContext> = {}): OfflineAuthorityContext => ({
  tenantId: 'tenant-1', operatorId: 'operator-1', assignmentId: 'assignment-1', equipmentId: 'equipment-1',
  shiftId: 'shift-1', deviceId: 'device-1', rulesVersion: 'rules-1', commandName: 'record-production',
  serverReceivedAt: new Date('2026-08-27T09:00:00.000Z'), ...overrides,
});

describe('автономное разрешение работы operator/v3', () => {
  it('принимает подписанное разрешение только как предварительное', () => {
    expect(verifyOfflineWorkAuthorization(authorization(), device(), context())).toEqual({
      valid: true, code: 'AUTHORIZED', label: 'Предварительно разрешено без связи', preliminary: true,
      expiresAt: '2026-08-27T12:00:00.000Z',
    });
  });

  it.each([
    [{equipmentId: 'equipment-2'}, {}, 'AUTHORIZATION_SCOPE_MISMATCH'],
    [{rulesVersion: 'rules-2'}, {}, 'AUTHORIZATION_RULES_CHANGED'],
    [{commandName: 'start-shift'}, {}, 'AUTHORIZATION_COMMAND_FORBIDDEN'],
    [{serverReceivedAt: new Date('2026-08-27T12:00:00.001Z')}, {}, 'AUTHORIZATION_EXPIRED'],
    [{}, {state: 'REVOKED', revokedAt: '2026-08-27T08:30:00.000Z'}, 'DEVICE_REVOKED'],
  ] as const)('отклоняет недействительную область, срок или устройство', (contextOverride, deviceOverride, code) => {
    expect(verifyOfflineWorkAuthorization(authorization(), device(deviceOverride), context(contextOverride))).toMatchObject({valid: false, code});
  });

  it('не принимает изменение подписанного содержимого', () => {
    const signed = authorization();
    const changed = {...signed, allowedCommands: [...signed.allowedCommands, 'start-shift']};
    expect(verifyOfflineWorkAuthorization(changed, device(), context({commandName: 'start-shift'}))).toMatchObject({
      valid: false, code: 'AUTHORIZATION_SIGNATURE_INVALID',
    });
  });

  it('не позволяет выдать разрешение дольше восьми часов', () => {
    const tooLong = authorization({expiresAt: '2026-08-27T16:00:00.001Z'});
    expect(verifyOfflineWorkAuthorization(tooLong, device(), context())).toMatchObject({
      valid: false, code: 'AUTHORIZATION_DURATION_INVALID',
    });
  });
});
