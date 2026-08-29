import {generateKeyPairSync, sign, type KeyObject} from 'node:crypto';
import {describe, expect, it} from 'vitest';
import {
  offlineAuthorizationClaims,
  serializeOfflineAuthorizationClaims,
  type OfflineAuthorityContext,
  type SignedOfflineWorkAuthorization,
} from '../offline-work-authorization';
import {
  verifyServerSignedOfflineWorkAuthorization,
  type ServerAuthorizationKeyResolver,
} from '../server-offline-work-authorization';
import type {TrustedOperatorDevice} from '../trusted-operator-device';

const serverKeys = generateKeyPairSync('ed25519');
const deviceKeys = generateKeyPairSync('ed25519');
const serverPublicKeyPem = serverKeys.publicKey.export({type: 'spki', format: 'pem'}).toString();
const devicePublicKeyPem = deviceKeys.publicKey.export({type: 'spki', format: 'pem'}).toString();

const resolveServerKey: ServerAuthorizationKeyResolver = (keyId) => keyId === 'server-authorization-key-1' ? {
  keyId,
  algorithm: 'Ed25519',
  publicKeyPem: serverPublicKeyPem,
  state: 'ACTIVE',
  tenantId: 'tenant-1',
} : null;

const device: TrustedOperatorDevice = {
  id: 'device-1', tenantId: 'tenant-1', operatorId: 'operator-1', keyId: 'device-command-key-1',
  publicKeyPem: devicePublicKeyPem, state: 'ACTIVE', registeredAt: '2026-08-27T07:00:00.000Z', revokedAt: null,
};

const context: OfflineAuthorityContext = {
  tenantId: 'tenant-1', operatorId: 'operator-1', assignmentId: 'assignment-1', equipmentId: 'equipment-1',
  shiftId: 'shift-1', deviceId: 'device-1', rulesVersion: 'rules-1', commandName: 'record-production',
  serverReceivedAt: new Date('2026-08-27T09:00:00.000Z'),
};

function authorization(privateKey: KeyObject): SignedOfflineWorkAuthorization {
  const unsigned: SignedOfflineWorkAuthorization = {
    authorizationId: 'authorization-1', authorizationVersion: 1, algorithm: 'Ed25519', keyId: 'server-authorization-key-1',
    tenantId: 'tenant-1', operatorId: 'operator-1', assignmentId: 'assignment-1', equipmentId: 'equipment-1',
    shiftId: 'shift-1', deviceId: 'device-1', rulesVersion: 'rules-1', readinessSnapshotId: 'snapshot-1',
    readinessDecision: 'ALLOWED', allowedCommands: ['record-production'], issuedAt: '2026-08-27T08:00:00.000Z',
    expiresAt: '2026-08-27T12:00:00.000Z', signature: '',
  };
  return {...unsigned, signature: sign(null, serializeOfflineAuthorizationClaims(offlineAuthorizationClaims(unsigned)), privateKey).toString('base64url')};
}

describe('серверная подпись автономного разрешения', () => {
  it('принимает пакет, подписанный отдельным доверенным серверным ключом', () => {
    expect(verifyServerSignedOfflineWorkAuthorization(authorization(serverKeys.privateKey), device, resolveServerKey, context)).toMatchObject({valid: true, code: 'AUTHORIZED'});
  });

  it('отклоняет пакет, подписанный ключом команд операторского устройства', () => {
    expect(verifyServerSignedOfflineWorkAuthorization(authorization(deviceKeys.privateKey), device, resolveServerKey, context)).toMatchObject({valid: false, code: 'AUTHORIZATION_SIGNATURE_INVALID'});
  });

  it('не принимает идентификатор ключа устройства как серверный ключ разрешения', () => {
    const signed = {...authorization(deviceKeys.privateKey), keyId: 'device-command-key-1'};
    expect(verifyServerSignedOfflineWorkAuthorization(signed, device, resolveServerKey, context)).toMatchObject({valid: false, code: 'AUTHORIZATION_SIGNING_KEY_NOT_TRUSTED'});
  });
});
