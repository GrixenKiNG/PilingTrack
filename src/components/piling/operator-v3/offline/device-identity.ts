import {createOperatorCommandId} from '../api/action-registry';

const DEVICE_ID_STORAGE_KEY = 'pilingtrack-operator-v3-device';

export function getOperatorDeviceId(): string {
  if (typeof window === 'undefined') return 'сервер';
  const existing = window.localStorage.getItem(DEVICE_ID_STORAGE_KEY)?.trim();
  if (existing) return existing;
  const created = createOperatorCommandId();
  window.localStorage.setItem(DEVICE_ID_STORAGE_KEY, created);
  return created;
}
