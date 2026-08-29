import {createPublicKey, verify} from 'node:crypto';
import {canonicalize} from '@/modules/readiness/domain/audit/canonicalize';
import {
  assertTrustedOperatorDevice,
  type TrustedOperatorDevice,
  type TrustedDeviceFailureCode,
} from './trusted-operator-device';

export const OFFLINE_AUTHORIZATION_ALGORITHM = 'Ed25519' as const;
export const MAX_OFFLINE_AUTHORIZATION_MILLISECONDS = 8 * 60 * 60 * 1000;
const ALLOWED_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1000;

export type OfflineAuthorizationReadiness = 'ALLOWED' | 'ALLOWED_WITH_NOTES';

export interface OfflineWorkAuthorizationClaims {
  authorizationId: string;
  authorizationVersion: 1;
  tenantId: string;
  operatorId: string;
  assignmentId: string;
  equipmentId: string;
  shiftId: string;
  deviceId: string;
  rulesVersion: string;
  readinessSnapshotId: string;
  readinessDecision: OfflineAuthorizationReadiness;
  allowedCommands: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface SignedOfflineWorkAuthorization extends OfflineWorkAuthorizationClaims {
  algorithm: typeof OFFLINE_AUTHORIZATION_ALGORITHM;
  keyId: string;
  signature: string;
}

export interface OfflineAuthorityContext {
  tenantId: string;
  operatorId: string;
  assignmentId: string;
  equipmentId: string;
  shiftId: string;
  deviceId: string;
  rulesVersion: string;
  commandName: string;
  serverReceivedAt: Date;
}

export type OfflineAuthorityFailureCode = TrustedDeviceFailureCode
  | 'AUTHORIZATION_FORMAT_INVALID'
  | 'AUTHORIZATION_SCOPE_MISMATCH'
  | 'AUTHORIZATION_RULES_CHANGED'
  | 'AUTHORIZATION_COMMAND_FORBIDDEN'
  | 'AUTHORIZATION_NOT_YET_VALID'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_DURATION_INVALID'
  | 'AUTHORIZATION_SIGNATURE_INVALID';

export type OfflineAuthorityDecision =
  | {valid: true; code: 'AUTHORIZED'; label: 'Предварительно разрешено без связи'; preliminary: true; expiresAt: string}
  | {valid: false; code: OfflineAuthorityFailureCode; label: string; preliminary: true; expiresAt: string | null};

export function offlineAuthorizationClaims(
  authorization: SignedOfflineWorkAuthorization,
): OfflineWorkAuthorizationClaims {
  return {
    authorizationId: authorization.authorizationId,
    authorizationVersion: authorization.authorizationVersion,
    tenantId: authorization.tenantId,
    operatorId: authorization.operatorId,
    assignmentId: authorization.assignmentId,
    equipmentId: authorization.equipmentId,
    shiftId: authorization.shiftId,
    deviceId: authorization.deviceId,
    rulesVersion: authorization.rulesVersion,
    readinessSnapshotId: authorization.readinessSnapshotId,
    readinessDecision: authorization.readinessDecision,
    allowedCommands: [...authorization.allowedCommands],
    issuedAt: authorization.issuedAt,
    expiresAt: authorization.expiresAt,
  };
}

export function serializeOfflineAuthorizationClaims(
  claims: OfflineWorkAuthorizationClaims,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(canonicalize(claims));
}

function rejected(
  code: OfflineAuthorityFailureCode,
  label: string,
  authorization: SignedOfflineWorkAuthorization | null,
): OfflineAuthorityDecision {
  return {valid: false, code, label, preliminary: true, expiresAt: authorization?.expiresAt ?? null};
}

function validIsoTime(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

export function verifyOfflineWorkAuthorization(
  authorization: SignedOfflineWorkAuthorization,
  device: TrustedOperatorDevice | null,
  context: OfflineAuthorityContext,
): OfflineAuthorityDecision {
  if (authorization.authorizationVersion !== 1 || authorization.algorithm !== OFFLINE_AUTHORIZATION_ALGORITHM
    || !authorization.authorizationId || !authorization.readinessSnapshotId || authorization.allowedCommands.length === 0) {
    return rejected('AUTHORIZATION_FORMAT_INVALID', 'Автономное разрешение имеет неподдерживаемый формат', authorization);
  }

  try {
    assertTrustedOperatorDevice(device, {
      tenantId: context.tenantId,
      operatorId: context.operatorId,
      deviceId: context.deviceId,
      keyId: authorization.keyId,
    });
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
      return rejected(error.code as TrustedDeviceFailureCode, error instanceof Error ? error.message : 'Устройство не прошло проверку', authorization);
    }
    return rejected('DEVICE_NOT_TRUSTED', 'Устройство не прошло проверку', authorization);
  }

  const sameScope = authorization.tenantId === context.tenantId
    && authorization.operatorId === context.operatorId
    && authorization.assignmentId === context.assignmentId
    && authorization.equipmentId === context.equipmentId
    && authorization.shiftId === context.shiftId
    && authorization.deviceId === context.deviceId;
  if (!sameScope) {
    return rejected('AUTHORIZATION_SCOPE_MISMATCH', 'Автономное разрешение выдано для другой смены, установки или назначения', authorization);
  }
  if (authorization.rulesVersion !== context.rulesVersion) {
    return rejected('AUTHORIZATION_RULES_CHANGED', 'Правила готовности изменились. Требуется новая проверка связи', authorization);
  }
  if (!authorization.allowedCommands.includes(context.commandName)) {
    return rejected('AUTHORIZATION_COMMAND_FORBIDDEN', 'Это действие не разрешено выполнять без связи', authorization);
  }

  const issuedAt = validIsoTime(authorization.issuedAt);
  const expiresAt = validIsoTime(authorization.expiresAt);
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt
    || expiresAt - issuedAt > MAX_OFFLINE_AUTHORIZATION_MILLISECONDS) {
    return rejected('AUTHORIZATION_DURATION_INVALID', 'Срок автономного разрешения задан некорректно', authorization);
  }
  const serverTime = context.serverReceivedAt.getTime();
  if (!Number.isFinite(serverTime) || serverTime + ALLOWED_CLOCK_SKEW_MILLISECONDS < issuedAt) {
    return rejected('AUTHORIZATION_NOT_YET_VALID', 'Срок автономного разрешения ещё не начался', authorization);
  }
  if (serverTime > expiresAt) {
    return rejected('AUTHORIZATION_EXPIRED', 'Срок работы без связи истёк. Безопасно остановите установку', authorization);
  }

  let signatureValid = false;
  try {
    const signature = Buffer.from(authorization.signature, 'base64url');
    signatureValid = signature.length > 0 && verify(
      null,
      serializeOfflineAuthorizationClaims(offlineAuthorizationClaims(authorization)),
      createPublicKey(device.publicKeyPem),
      signature,
    );
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return rejected('AUTHORIZATION_SIGNATURE_INVALID', 'Подпись автономного разрешения недействительна', authorization);
  }

  return {
    valid: true,
    code: 'AUTHORIZED',
    label: 'Предварительно разрешено без связи',
    preliminary: true,
    expiresAt: authorization.expiresAt,
  };
}
