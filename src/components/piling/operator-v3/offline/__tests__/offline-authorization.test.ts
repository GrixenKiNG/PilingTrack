import {beforeAll, describe, expect, it} from 'vitest';
import type {SignedOfflineWorkAuthorization} from '@/modules/operator-v3/domain/offline-work-authorization';
import {verifyBrowserOfflineAuthorization, type BrowserOfflineAuthorityContext} from '../offline-authorization';

let keys: CryptoKeyPair;
let publicKeySpki = '';

function base64Url(value: ArrayBuffer): string {
  let binary = '';
  for (const byte of new Uint8Array(value)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const context: BrowserOfflineAuthorityContext = {
  tenantId: 'tenant-1', operatorId: 'operator-1', assignmentId: 'assignment-1', equipmentId: 'equipment-1',
  shiftId: 'shift-1', deviceId: 'device-1', rulesVersion: 'rules-1', commandName: 'record-production',
  trustedServerTime: new Date('2026-08-27T09:00:00.000Z'),
};

async function authorization(overrides: Partial<SignedOfflineWorkAuthorization> = {}): Promise<SignedOfflineWorkAuthorization> {
  const value: SignedOfflineWorkAuthorization = {
    authorizationId: 'authorization-1', authorizationVersion: 1, algorithm: 'Ed25519', keyId: 'server-key-1',
    tenantId: 'tenant-1', operatorId: 'operator-1', assignmentId: 'assignment-1', equipmentId: 'equipment-1', shiftId: 'shift-1',
    deviceId: 'device-1', rulesVersion: 'rules-1', readinessSnapshotId: 'snapshot-1', readinessDecision: 'ALLOWED',
    allowedCommands: ['record-production'], issuedAt: '2026-08-27T08:00:00.000Z', expiresAt: '2026-08-27T12:00:00.000Z', signature: '',
    ...overrides,
  };
  const {algorithm: _algorithm, keyId: _keyId, signature: _signature, ...claims} = value;
  value.signature = base64Url(await crypto.subtle.sign({name: 'Ed25519'}, keys.privateKey, new TextEncoder().encode(canonical(claims))));
  return value;
}

beforeAll(async () => {
  keys = await crypto.subtle.generateKey({name: 'Ed25519'}, true, ['sign', 'verify']) as CryptoKeyPair;
  publicKeySpki = base64Url(await crypto.subtle.exportKey('spki', keys.publicKey));
});

describe('клиентская проверка разрешения работы без связи', () => {
  it('принимает только пакет отдельного доверенного серверного ключа', async () => {
    const result = await verifyBrowserOfflineAuthorization(await authorization(), () => ({keyId: 'server-key-1', algorithm: 'Ed25519', publicKeySpki, state: 'ACTIVE', tenantId: 'tenant-1'}), context);
    expect(result).toMatchObject({valid: true, code: 'AUTHORIZED', preliminary: true});
  });

  it('отклоняет просроченный пакет по доверенному серверному времени', async () => {
    const result = await verifyBrowserOfflineAuthorization(await authorization({expiresAt: '2026-08-27T08:30:00.000Z'}), () => ({keyId: 'server-key-1', algorithm: 'Ed25519', publicKeySpki, state: 'ACTIVE', tenantId: 'tenant-1'}), context);
    expect(result).toMatchObject({valid: false, code: 'AUTHORIZATION_EXPIRED'});
  });

  it('отклоняет пакет другой смены до проверки подписи', async () => {
    const result = await verifyBrowserOfflineAuthorization(await authorization({shiftId: 'shift-2'}), () => ({keyId: 'server-key-1', algorithm: 'Ed25519', publicKeySpki, state: 'ACTIVE', tenantId: 'tenant-1'}), context);
    expect(result).toMatchObject({valid: false, code: 'AUTHORIZATION_SCOPE_MISMATCH'});
  });
});
