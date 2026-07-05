export const MAX_EQUIPMENT_TILE_IMAGE_BYTES = 12 * 1024 * 1024;
export const EQUIPMENT_TILE_ASSET_DATABASE = 'monitoring-equipment-tile-assets-v1';
const EQUIPMENT_TILE_ASSET_STORE = 'assets';
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const EQUIPMENT_TILE_IMAGE_ASSET_PREFIX = 'equipment-tile-image:';

export function getEquipmentTileImageAssetId(equipmentId: string, blockId: string): string {
  return `${EQUIPMENT_TILE_IMAGE_ASSET_PREFIX}${encodeURIComponent(equipmentId)}:${encodeURIComponent(blockId)}`;
}

export function isEquipmentTileImageAssetId(assetId: string, blockId?: string): boolean {
  if (!assetId.startsWith(EQUIPMENT_TILE_IMAGE_ASSET_PREFIX)) return false;
  return blockId == null || assetId.endsWith(`:${encodeURIComponent(blockId)}`);
}

export interface EquipmentTileAssetRecord {
  id: string;
  blob: Blob;
  name: string;
  type: string;
  updatedAt: number;
}

export interface EquipmentTileAssetStorage {
  put(file: File, assetId?: string): Promise<string>;
  get(assetId: string): Promise<EquipmentTileAssetRecord | null>;
  list(): Promise<EquipmentTileAssetRecord[]>;
  delete(assetId: string): Promise<void>;
  clear(): Promise<void>;
}

export function validateEquipmentTileImageFile(file: Pick<File, 'type' | 'size'>): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return 'Поддерживаются только JPG, PNG и WebP';
  if (file.size > MAX_EQUIPMENT_TILE_IMAGE_BYTES) return 'Размер изображения не должен превышать 12 МБ';
  return null;
}

function createAssetId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `asset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createMemoryEquipmentTileAssetStorage(): EquipmentTileAssetStorage {
  const records = new Map<string, EquipmentTileAssetRecord>();
  return {
    async put(file, assetId = createAssetId()) {
      const error = validateEquipmentTileImageFile(file);
      if (error) throw new TypeError(error);
      records.set(assetId, { id: assetId, blob: file, name: file.name, type: file.type, updatedAt: Date.now() });
      return assetId;
    },
    async get(assetId) {
      return records.get(assetId) ?? null;
    },
    async list() {
      return [...records.values()];
    },
    async delete(assetId) {
      records.delete(assetId);
    },
    async clear() {
      records.clear();
    },
  };
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB request failed')), { once: true });
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), { once: true });
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('IndexedDB transaction aborted')), { once: true });
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('IndexedDB transaction failed')), { once: true });
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(EQUIPMENT_TILE_ASSET_DATABASE, 1);
    request.addEventListener('upgradeneeded', () => {
      if (!request.result.objectStoreNames.contains(EQUIPMENT_TILE_ASSET_STORE)) {
        request.result.createObjectStore(EQUIPMENT_TILE_ASSET_STORE, { keyPath: 'id' });
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error ?? new Error('IndexedDB open failed')), { once: true });
  });
}

export function createIndexedDbEquipmentTileAssetStorage(factory: IDBFactory): EquipmentTileAssetStorage {
  const withStore = async <T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const database = await openDatabase(factory);
    try {
      const transaction = database.transaction(EQUIPMENT_TILE_ASSET_STORE, mode);
      const result = await operation(transaction.objectStore(EQUIPMENT_TILE_ASSET_STORE));
      await transactionDone(transaction);
      return result;
    } finally {
      database.close();
    }
  };

  return {
    async put(file, assetId = createAssetId()) {
      const error = validateEquipmentTileImageFile(file);
      if (error) throw new TypeError(error);
      const record: EquipmentTileAssetRecord = {
        id: assetId,
        blob: file,
        name: file.name,
        type: file.type,
        updatedAt: Date.now(),
      };
      await withStore('readwrite', async (store) => {
        await requestResult(store.put(record));
      });
      return assetId;
    },
    async get(assetId) {
      return withStore('readonly', async (store) => {
        const result = await requestResult(store.get(assetId));
        return (result as EquipmentTileAssetRecord | undefined) ?? null;
      });
    },
    async list() {
      return withStore('readonly', async (store) => requestResult(store.getAll()) as Promise<EquipmentTileAssetRecord[]>);
    },
    async delete(assetId) {
      await withStore('readwrite', async (store) => {
        await requestResult(store.delete(assetId));
      });
    },
    async clear() {
      await withStore('readwrite', async (store) => {
        await requestResult(store.clear());
      });
    },
  };
}

let defaultAssetStorage: EquipmentTileAssetStorage | null = null;

export function getDefaultEquipmentTileAssetStorage(): EquipmentTileAssetStorage {
  if (!defaultAssetStorage) {
    defaultAssetStorage = typeof globalThis.indexedDB === 'undefined'
      ? createMemoryEquipmentTileAssetStorage()
      : createIndexedDbEquipmentTileAssetStorage(globalThis.indexedDB);
  }
  return defaultAssetStorage;
}
