const KEY_DATABASE_NAME = 'pilingtrack-operator-v3-key-vault-v1';
const KEY_STORE_NAME = 'keys';
const KEY_DATABASE_VERSION = 1;
const ALGORITHM = 'AES-GCM';
const FORMAT_VERSION = 1;

export interface EncryptedPayload {
  formatVersion: 1;
  algorithm: 'AES-GCM';
  iv: Uint8Array;
  ciphertext: ArrayBuffer;
}

export interface LocalKeyVault {
  get(keyId: string): Promise<CryptoKey | null>;
  putIfAbsent(keyId: string, key: CryptoKey): Promise<CryptoKey>;
}

interface StoredKey {
  id: string;
  key: CryptoKey;
  createdAt: number;
}

function cryptoApi(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Безопасное локальное шифрование недоступно в этом браузере');
  }
  return globalThis.crypto;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {once: true});
    request.addEventListener('error', () => reject(request.error ?? new Error('Не удалось обратиться к хранилищу ключей')), {once: true});
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), {once: true});
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Операция с хранилищем ключей прервана')), {once: true});
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Ошибка хранилища ключей')), {once: true});
  });
}

function openKeyDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(KEY_DATABASE_NAME, KEY_DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(KEY_STORE_NAME)) {
        request.result.createObjectStore(KEY_STORE_NAME, {keyPath: 'id'});
      }
    });
    request.addEventListener('success', () => resolve(request.result), {once: true});
    request.addEventListener('error', () => reject(request.error ?? new Error('Не удалось открыть хранилище ключей')), {once: true});
  });
}

export function createIndexedDbKeyVault(factory: IDBFactory): LocalKeyVault {
  return {
    async get(keyId) {
      const database = await openKeyDatabase(factory);
      try {
        const transaction = database.transaction(KEY_STORE_NAME, 'readonly');
        const completed = transactionDone(transaction);
        const value = await requestResult(transaction.objectStore(KEY_STORE_NAME).get(keyId)) as StoredKey | undefined;
        await completed;
        return value?.key ?? null;
      } finally {
        database.close();
      }
    },
    async putIfAbsent(keyId, key) {
      if (key.extractable) throw new TypeError('Ключ локального шифрования не должен быть экспортируемым');
      const database = await openKeyDatabase(factory);
      try {
        const transaction = database.transaction(KEY_STORE_NAME, 'readwrite');
        const completed = transactionDone(transaction);
        const store = transaction.objectStore(KEY_STORE_NAME);
        const existing = await requestResult(store.get(keyId)) as StoredKey | undefined;
        if (existing) {
          await completed;
          return existing.key;
        }
        await requestResult(store.put({id: keyId, key, createdAt: Date.now()} satisfies StoredKey));
        await completed;
        return key;
      } finally {
        database.close();
      }
    },
  };
}

export function createMemoryKeyVault(): LocalKeyVault {
  const keys = new Map<string, CryptoKey>();
  return {
    async get(keyId) { return keys.get(keyId) ?? null; },
    async putIfAbsent(keyId, key) {
      if (key.extractable) throw new TypeError('Ключ локального шифрования не должен быть экспортируемым');
      const existing = keys.get(keyId);
      if (existing) return existing;
      keys.set(keyId, key);
      return key;
    },
  };
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function scopeKeyId(scope: string): Promise<string> {
  if (!scope.trim()) throw new TypeError('Не задан контекст локального шифрования');
  const digest = await cryptoApi().subtle.digest('SHA-256', new TextEncoder().encode(scope));
  return bytesToBase64Url(new Uint8Array(digest));
}

async function getOrCreateKey(vault: LocalKeyVault, keyId: string): Promise<CryptoKey> {
  const existing = await vault.get(keyId);
  if (existing) return existing;
  const generated = await cryptoApi().subtle.generateKey({name: ALGORITHM, length: 256}, false, ['encrypt', 'decrypt']);
  return vault.putIfAbsent(keyId, generated);
}

export class OperatorV3LocalCrypto {
  private readonly keyIdPromise: Promise<string>;

  constructor(scope: string, private readonly vault: LocalKeyVault) {
    this.keyIdPromise = scopeKeyId(scope);
  }

  async scopeHash(): Promise<string> { return this.keyIdPromise; }

  async encryptBytes(value: BufferSource, purpose: string): Promise<EncryptedPayload> {
    const keyId = await this.keyIdPromise;
    const key = await getOrCreateKey(this.vault, keyId);
    const iv = cryptoApi().getRandomValues(new Uint8Array(12));
    const ciphertext = await cryptoApi().subtle.encrypt({name: ALGORITHM, iv, additionalData: new TextEncoder().encode(`${keyId}:${purpose}`), tagLength: 128}, key, value);
    return {formatVersion: FORMAT_VERSION, algorithm: ALGORITHM, iv, ciphertext};
  }

  async decryptBytes(payload: EncryptedPayload, purpose: string): Promise<ArrayBuffer> {
    if (payload.formatVersion !== FORMAT_VERSION || payload.algorithm !== ALGORITHM) throw new Error('Формат зашифрованных данных не поддерживается');
    const keyId = await this.keyIdPromise;
    const key = await this.vault.get(keyId);
    if (!key) throw new Error('Ключ локального шифрования не найден');
    const iv = new Uint8Array(payload.iv);
    return cryptoApi().subtle.decrypt({name: ALGORITHM, iv, additionalData: new TextEncoder().encode(`${keyId}:${purpose}`), tagLength: 128}, key, payload.ciphertext);
  }

  async encryptJson<T>(value: T, purpose: string): Promise<EncryptedPayload> {
    return this.encryptBytes(new TextEncoder().encode(JSON.stringify(value)), purpose);
  }

  async decryptJson<T>(payload: EncryptedPayload, purpose: string): Promise<T> {
    const decoded = new TextDecoder('utf-8', {fatal: true}).decode(await this.decryptBytes(payload, purpose));
    return JSON.parse(decoded) as T;
  }
}

let defaultVault: LocalKeyVault | null = null;

function isTestRuntime(): boolean { return typeof process !== 'undefined' && process.env.NODE_ENV === 'test'; }

export function getDefaultLocalCrypto(scope: string): OperatorV3LocalCrypto {
  if (!defaultVault) {
    if (typeof globalThis.indexedDB !== 'undefined') defaultVault = createIndexedDbKeyVault(globalThis.indexedDB);
    else if (isTestRuntime()) defaultVault = createMemoryKeyVault();
    else throw new Error('Защищённое локальное хранилище недоступно');
  }
  return new OperatorV3LocalCrypto(scope, defaultVault);
}
