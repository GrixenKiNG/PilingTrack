import {createPublicKey, verify} from 'node:crypto';
import {
  MAX_OFFLINE_AUTHORIZATION_MILLISECONDS,
  OFFLINE_AUTHORIZATION_ALGORITHM,
  offlineAuthorizationClaims,
  serializeOfflineAuthorizationClaims,
  type OfflineAuthorityContext,
  type SignedOfflineWorkAuthorization,
} from './offline-work-authorization';
import type {TrustedOperatorDevice, TrustedDeviceFailureCode} from './trusted-operator-device';

const ALLOWED_CLOCK_SKEW_MILLISECONDS = 5 * 60 * 1000;

export interface TrustedServerAuthorizationKey {
  keyId: string;
  algorithm: typeof OFFLINE_AUTHORIZATION_ALGORITHM;
  publicKeyPem: string;
  state: 'ACTIVE' | 'REVOKED';
  tenantId: string | null;
}

export type ServerAuthorizationKeyResolver = (keyId: string) => TrustedServerAuthorizationKey | null;

export type ServerOfflineAuthorityFailureCode = TrustedDeviceFailureCode
  | 'AUTHORIZATION_FORMAT_INVALID'
  | 'AUTHORIZATION_SCOPE_MISMATCH'
  | 'AUTHORIZATION_RULES_CHANGED'
  | 'AUTHORIZATION_COMMAND_FORBIDDEN'
  | 'AUTHORIZATION_NOT_YET_VALID'
  | 'AUTHORIZATION_EXPIRED'
  | 'AUTHORIZATION_DURATION_INVALID'
  | 'AUTHORIZATION_SIGNING_KEY_NOT_TRUSTED'
  | 'AUTHORIZATION_SIGNATURE_INVALID';

export type ServerOfflineAuthorityDecision =
  | {valid: true; code: 'AUTHORIZED'; label: 'Предварительно разрешено без связи'; preliminary: true; expiresAt: string}
  | {valid: false; code: ServerOfflineAuthorityFailureCode; label: string; preliminary: true; expiresAt: string | null};

function rejected(code: ServerOfflineAuthorityFailureCode, label: string, authorization: SignedOfflineWorkAuthorization): ServerOfflineAuthorityDecision {
  return {valid: false, code, label, preliminary: true, expiresAt: authorization.expiresAt || null};
}

function validIsoTime(value: string): number | null {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function validateDeviceIdentity(device: TrustedOperatorDevice | null, context: OfflineAuthorityContext): {code: TrustedDeviceFailureCode; label: string} | null {
  if (!device || device.id !== context.deviceId) return {code: 'DEVICE_NOT_TRUSTED', label: 'Телефон оператора не зарегистрирован для работы без связи'};
  if (device.state !== 'ACTIVE' || device.revokedAt) return {code: 'DEVICE_REVOKED', label: 'Разрешение устройства отозвано'};
  if (device.tenantId !== context.tenantId || device.operatorId !== context.operatorId) return {code: 'DEVICE_SCOPE_MISMATCH', label: 'Устройство зарегистрировано для другого оператора или организации'};
  return null;
}

export function verifyServerSignedOfflineWorkAuthorization(
  authorization: SignedOfflineWorkAuthorization,
  device: TrustedOperatorDevice | null,
  resolveServerKey: ServerAuthorizationKeyResolver,
  context: OfflineAuthorityContext,
): ServerOfflineAuthorityDecision {
  if (authorization.authorizationVersion !== 1 || authorization.algorithm !== OFFLINE_AUTHORIZATION_ALGORITHM
    || !authorization.authorizationId || !authorization.readinessSnapshotId || authorization.allowedCommands.length === 0) {
    return rejected('AUTHORIZATION_FORMAT_INVALID', 'Автономное разрешение имеет неподдерживаемый формат', authorization);
  }

  const deviceFailure = validateDeviceIdentity(device, context);
  if (deviceFailure) return rejected(deviceFailure.code, deviceFailure.label, authorization);

  const sameScope = authorization.tenantId === context.tenantId
    && authorization.operatorId === context.operatorId
    && authorization.assignmentId === context.assignmentId
    && authorization.equipmentId === context.equipmentId
    && authorization.shiftId === context.shiftId
    && authorization.deviceId === context.deviceId;
  if (!sameScope) return rejected('AUTHORIZATION_SCOPE_MISMATCH', 'Автономное разрешение выдано для другой смены, установки или назначения', authorization);
  if (authorization.rulesVersion !== context.rulesVersion) return rejected('AUTHORIZATION_RULES_CHANGED', 'Правила готовности изменились. Требуется новая проверка связи', authorization);
  if (!authorization.allowedCommands.includes(context.commandName)) return rejected('AUTHORIZATION_COMMAND_FORBIDDEN', 'Это действие не разрешено выполнять без связи', authorization);

  const issuedAt = validIsoTime(authorization.issuedAt);
  const expiresAt = validIsoTime(authorization.expiresAt);
  if (issuedAt === null || expiresAt === null || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_OFFLINE_AUTHORIZATION_MILLISECONDS) {
    return rejected('AUTHORIZATION_DURATION_INVALID', 'Срок автономного разрешения задан некорректно', authorization);
  }
  const serverTime = context.serverReceivedAt.getTime();
  if (!Number.isFinite(serverTime) || serverTime + ALLOWED_CLOCK_SKEW_MILLISECONDS < issuedAt) return rejected('AUTHORIZATION_NOT_YET_VALID', 'Срок автономного разрешения ещё не начался', authorization);
  if (serverTime > expiresAt) return rejected('AUTHORIZATION_EXPIRED', 'Срок работы без связи истёк. Безопасно остановите установку', authorization);

  const serverKey = resolveServerKey(authorization.keyId);
  if (!serverKey || serverKey.state !== 'ACTIVE' || serverKey.algorithm !== OFFLINE_AUTHORIZATION_ALGORITHM
    || (serverKey.tenantId !== null && serverKey.tenantId !== context.tenantId)) {
    return rejected('AUTHORIZATION_SIGNING_KEY_NOT_TRUSTED', 'Ключ подписи автономного разрешения не является доверенным серверным ключом', authorization);
  }

  let signatureValid = false;
  try {
    const signature = Buffer.from(authorization.signature, 'base64url');
    signatureValid = signature.length > 0 && verify(null, serializeOfflineAuthorizationClaims(offlineAuthorizationClaims(authorization)), createPublicKey(serverKey.publicKeyPem), signature);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) return rejected('AUTHORIZATION_SIGNATURE_INVALID', 'Подпись автономного разрешения недействительна', authorization);

  return {valid: true, code: 'AUTHORIZED', label: 'Предварительно разрешено без связи', preliminary: true, expiresAt: authorization.expiresAt};
}
