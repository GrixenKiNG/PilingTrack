export type TrustedOperatorDeviceState = 'ACTIVE' | 'REVOKED';

export interface TrustedOperatorDevice {
  id: string;
  tenantId: string;
  operatorId: string;
  keyId: string;
  publicKeyPem: string;
  state: TrustedOperatorDeviceState;
  registeredAt: string;
  revokedAt: string | null;
}

export type TrustedDeviceFailureCode =
  | 'DEVICE_NOT_TRUSTED'
  | 'DEVICE_REVOKED'
  | 'DEVICE_SCOPE_MISMATCH'
  | 'DEVICE_KEY_MISMATCH';

export class TrustedOperatorDeviceError extends Error {
  constructor(public readonly code: TrustedDeviceFailureCode, message: string) {
    super(message);
    this.name = 'TrustedOperatorDeviceError';
  }
}

export function assertTrustedOperatorDevice(
  device: TrustedOperatorDevice | null,
  scope: {tenantId: string; operatorId: string; deviceId: string; keyId: string},
): asserts device is TrustedOperatorDevice {
  if (!device || device.id !== scope.deviceId) {
    throw new TrustedOperatorDeviceError('DEVICE_NOT_TRUSTED', 'Телефон оператора не зарегистрирован для работы без связи');
  }
  if (device.state !== 'ACTIVE' || device.revokedAt) {
    throw new TrustedOperatorDeviceError('DEVICE_REVOKED', 'Разрешение устройства отозвано');
  }
  if (device.tenantId !== scope.tenantId || device.operatorId !== scope.operatorId) {
    throw new TrustedOperatorDeviceError('DEVICE_SCOPE_MISMATCH', 'Устройство зарегистрировано для другого оператора или организации');
  }
  if (device.keyId !== scope.keyId) {
    throw new TrustedOperatorDeviceError('DEVICE_KEY_MISMATCH', 'Ключ устройства не соответствует автономному разрешению');
  }
}
