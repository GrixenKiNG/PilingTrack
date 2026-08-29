import type {SignedOfflineWorkAuthorization} from '@/modules/operator-v3/domain/offline-work-authorization';

const MAX_DURATION_MS = 8 * 60 * 60 * 1000;
const CLOCK_SKEW_MS = 5 * 60 * 1000;

export interface BrowserTrustedServerAuthorizationKey {
  keyId: string;
  algorithm: 'Ed25519';
  publicKeySpki: string;
  state: 'ACTIVE' | 'REVOKED';
  tenantId: string | null;
}

export interface BrowserOfflineAuthorityContext {
  tenantId: string;
  operatorId: string;
  assignmentId: string;
  equipmentId: string;
  shiftId: string;
  deviceId: string;
  rulesVersion: string;
  commandName: string;
  trustedServerTime: Date;
}

export type BrowserOfflineAuthorityDecision =
  | {valid: true; code: 'AUTHORIZED'; label: 'Предварительно разрешено без связи'; preliminary: true; expiresAt: string}
  | {valid: false; code: string; label: string; preliminary: true; expiresAt: string | null};

function base64UrlBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function signedClaims(value: SignedOfflineWorkAuthorization) {
  return {
    authorizationId: value.authorizationId,
    authorizationVersion: value.authorizationVersion,
    tenantId: value.tenantId,
    operatorId: value.operatorId,
    assignmentId: value.assignmentId,
    equipmentId: value.equipmentId,
    shiftId: value.shiftId,
    deviceId: value.deviceId,
    rulesVersion: value.rulesVersion,
    readinessSnapshotId: value.readinessSnapshotId,
    readinessDecision: value.readinessDecision,
    allowedCommands: [...value.allowedCommands],
    issuedAt: value.issuedAt,
    expiresAt: value.expiresAt,
  };
}

function rejected(code: string, label: string, authorization: SignedOfflineWorkAuthorization): BrowserOfflineAuthorityDecision {
  return {valid: false, code, label, preliminary: true, expiresAt: authorization.expiresAt || null};
}

export async function verifyBrowserOfflineAuthorization(
  authorization: SignedOfflineWorkAuthorization,
  resolveServerKey: (keyId: string) => BrowserTrustedServerAuthorizationKey | null,
  context: BrowserOfflineAuthorityContext,
): Promise<BrowserOfflineAuthorityDecision> {
  if (authorization.authorizationVersion !== 1 || authorization.algorithm !== 'Ed25519' || authorization.allowedCommands.length === 0) {
    return rejected('AUTHORIZATION_FORMAT_INVALID', 'Автономное разрешение имеет неподдерживаемый формат', authorization);
  }
  const sameScope = authorization.tenantId === context.tenantId && authorization.operatorId === context.operatorId
    && authorization.assignmentId === context.assignmentId && authorization.equipmentId === context.equipmentId
    && authorization.shiftId === context.shiftId && authorization.deviceId === context.deviceId;
  if (!sameScope) return rejected('AUTHORIZATION_SCOPE_MISMATCH', 'Автономное разрешение выдано для другой смены, установки или назначения', authorization);
  if (authorization.rulesVersion !== context.rulesVersion) return rejected('AUTHORIZATION_RULES_CHANGED', 'Правила готовности изменились. Требуется новая проверка связи', authorization);
  if (!authorization.allowedCommands.includes(context.commandName)) return rejected('AUTHORIZATION_COMMAND_FORBIDDEN', 'Это действие не разрешено выполнять без связи', authorization);

  const issuedAt = Date.parse(authorization.issuedAt);
  const expiresAt = Date.parse(authorization.expiresAt);
  const trustedNow = context.trustedServerTime.getTime();
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_DURATION_MS) {
    return rejected('AUTHORIZATION_DURATION_INVALID', 'Срок автономного разрешения задан некорректно', authorization);
  }
  if (!Number.isFinite(trustedNow) || trustedNow + CLOCK_SKEW_MS < issuedAt) return rejected('AUTHORIZATION_NOT_YET_VALID', 'Срок автономного разрешения ещё не начался', authorization);
  if (trustedNow > expiresAt) return rejected('AUTHORIZATION_EXPIRED', 'Срок работы без связи истёк. Безопасно остановите установку', authorization);

  const key = resolveServerKey(authorization.keyId);
  if (!key || key.state !== 'ACTIVE' || key.algorithm !== 'Ed25519' || (key.tenantId !== null && key.tenantId !== context.tenantId)) {
    return rejected('AUTHORIZATION_SIGNING_KEY_NOT_TRUSTED', 'Ключ подписи автономного разрешения не является доверенным серверным ключом', authorization);
  }
  try {
    const publicKey = await crypto.subtle.importKey('spki', base64UrlBytes(key.publicKeySpki), {name: 'Ed25519'}, false, ['verify']);
    const valid = await crypto.subtle.verify({name: 'Ed25519'}, publicKey, base64UrlBytes(authorization.signature), new TextEncoder().encode(canonical(signedClaims(authorization))));
    if (!valid) return rejected('AUTHORIZATION_SIGNATURE_INVALID', 'Подпись автономного разрешения недействительна', authorization);
  } catch {
    return rejected('AUTHORIZATION_SIGNATURE_INVALID', 'Подпись автономного разрешения недействительна', authorization);
  }
  return {valid: true, code: 'AUTHORIZED', label: 'Предварительно разрешено без связи', preliminary: true, expiresAt: authorization.expiresAt};
}
