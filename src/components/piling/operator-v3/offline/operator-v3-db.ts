import type {EncryptedPayload} from './local-crypto';

export const OPERATOR_V3_DATABASE_NAME = 'pilingtrack-operator-v3-offline-v1';
const DATABASE_VERSION = 1;
const COMMAND_STORE = 'commands';
const ATTACHMENT_STORE = 'attachments';
const DRAFT_STORE = 'drafts';
const SCOPE_INDEX = 'scopeHash';

export type OfflineCommandStatus = 'pending' | 'sending' | 'failed' | 'conflict';
export type OfflineAttachmentStatus = 'pending' | 'confirmed';

export interface StoredCommandRecord {
  id: string; scopeHash: string; encrypted: EncryptedPayload; status: OfflineCommandStatus;
  attempts: number; nextAttemptAt: number; leaseOwner: string | null; leaseExpiresAt: number | null;
  createdAt: number; updatedAt: number;
}
export interface StoredAttachmentRecord {
  id: string; commandId: string; scopeHash: string; encryptedMetadata: EncryptedPayload;
  encryptedContent: EncryptedPayload; status: OfflineAttachmentStatus; createdAt: number; updatedAt: number;
}
export interface StoredDraftRecord {id: string; scopeHash: string; encrypted: EncryptedPayload; createdAt: number; updatedAt: number;}

export interface OperatorV3Database {
  putCommand(record: StoredCommandRecord): Promise<void>;
  getCommand(id: string): Promise<StoredCommandRecord | null>;
  listCommands(scopeHash: string): Promise<StoredCommandRecord[]>;
  updateCommand(id: string, updater: (record: StoredCommandRecord) => StoredCommandRecord | null): Promise<StoredCommandRecord | null>;
  deleteCommand(id: string): Promise<void>;
  putAttachment(record: StoredAttachmentRecord): Promise<void>;
  getAttachment(id: string): Promise<StoredAttachmentRecord | null>;
  listAttachments(scopeHash: string): Promise<StoredAttachmentRecord[]>;
  deleteAttachment(id: string): Promise<void>;
  putDraft(record: StoredDraftRecord): Promise<void>;
  getDraft(id: string): Promise<StoredDraftRecord | null>;
  listDrafts(scopeHash: string): Promise<StoredDraftRecord[]>;
  deleteDraft(id: string): Promise<void>;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), {once: true});
    request.addEventListener('error', () => reject(request.error ?? new Error('Ошибка локального хранилища')), {once: true});
  });
}
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.addEventListener('complete', () => resolve(), {once: true});
    transaction.addEventListener('abort', () => reject(transaction.error ?? new Error('Операция локального хранилища прервана')), {once: true});
    transaction.addEventListener('error', () => reject(transaction.error ?? new Error('Ошибка локального хранилища')), {once: true});
  });
}
function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(OPERATOR_V3_DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(COMMAND_STORE)) database.createObjectStore(COMMAND_STORE, {keyPath: 'id'}).createIndex(SCOPE_INDEX, SCOPE_INDEX, {unique: false});
      if (!database.objectStoreNames.contains(ATTACHMENT_STORE)) {
        const store = database.createObjectStore(ATTACHMENT_STORE, {keyPath: 'id'});
        store.createIndex(SCOPE_INDEX, SCOPE_INDEX, {unique: false});
        store.createIndex('commandId', 'commandId', {unique: false});
      }
      if (!database.objectStoreNames.contains(DRAFT_STORE)) database.createObjectStore(DRAFT_STORE, {keyPath: 'id'}).createIndex(SCOPE_INDEX, SCOPE_INDEX, {unique: false});
    });
    request.addEventListener('success', () => resolve(request.result), {once: true});
    request.addEventListener('error', () => reject(request.error ?? new Error('Не удалось открыть локальное хранилище')), {once: true});
  });
}

export function createIndexedDbOperatorV3Database(factory: IDBFactory): OperatorV3Database {
  const withStore = async <T>(storeName: string, mode: IDBTransactionMode, operation: (store: IDBObjectStore) => Promise<T>): Promise<T> => {
    const database = await openDatabase(factory);
    try {
      const transaction = database.transaction(storeName, mode);
      const completed = transactionDone(transaction);
      const result = await operation(transaction.objectStore(storeName));
      await completed;
      return result;
    } finally { database.close(); }
  };
  const get = async <T>(storeName: string, id: string): Promise<T | null> => withStore(storeName, 'readonly', async (store) => (await requestResult(store.get(id)) as T | undefined) ?? null);
  const list = async <T>(storeName: string, scopeHash: string): Promise<T[]> => withStore(storeName, 'readonly', async (store) => requestResult(store.index(SCOPE_INDEX).getAll(scopeHash)) as Promise<T[]>);
  const put = async <T>(storeName: string, value: T): Promise<void> => { await withStore(storeName, 'readwrite', async (store) => { await requestResult(store.put(value)); }); };
  const remove = async (storeName: string, id: string): Promise<void> => { await withStore(storeName, 'readwrite', async (store) => { await requestResult(store.delete(id)); }); };
  return {
    putCommand: (record) => put(COMMAND_STORE, record), getCommand: (id) => get(COMMAND_STORE, id), listCommands: (scopeHash) => list(COMMAND_STORE, scopeHash),
    updateCommand: (id, updater) => withStore(COMMAND_STORE, 'readwrite', async (store) => {
      const current = await requestResult(store.get(id)) as StoredCommandRecord | undefined;
      if (!current) return null;
      const updated = updater(current);
      if (updated) await requestResult(store.put(updated)); else await requestResult(store.delete(id));
      return updated;
    }),
    deleteCommand: (id) => remove(COMMAND_STORE, id),
    putAttachment: (record) => put(ATTACHMENT_STORE, record), getAttachment: (id) => get(ATTACHMENT_STORE, id), listAttachments: (scopeHash) => list(ATTACHMENT_STORE, scopeHash), deleteAttachment: (id) => remove(ATTACHMENT_STORE, id),
    putDraft: (record) => put(DRAFT_STORE, record), getDraft: (id) => get(DRAFT_STORE, id), listDrafts: (scopeHash) => list(DRAFT_STORE, scopeHash), deleteDraft: (id) => remove(DRAFT_STORE, id),
  };
}

export function createMemoryOperatorV3Database(): OperatorV3Database {
  const commands = new Map<string, StoredCommandRecord>(); const attachments = new Map<string, StoredAttachmentRecord>(); const drafts = new Map<string, StoredDraftRecord>();
  const clone = <T>(value: T): T => structuredClone(value);
  return {
    async putCommand(record) { commands.set(record.id, clone(record)); }, async getCommand(id) { const value = commands.get(id); return value ? clone(value) : null; },
    async listCommands(scopeHash) { return [...commands.values()].filter((record) => record.scopeHash === scopeHash).map(clone); },
    async updateCommand(id, updater) { const current = commands.get(id); if (!current) return null; const updated = updater(clone(current)); if (updated) commands.set(id, clone(updated)); else commands.delete(id); return updated ? clone(updated) : null; },
    async deleteCommand(id) { commands.delete(id); }, async putAttachment(record) { attachments.set(record.id, clone(record)); }, async getAttachment(id) { const value = attachments.get(id); return value ? clone(value) : null; },
    async listAttachments(scopeHash) { return [...attachments.values()].filter((record) => record.scopeHash === scopeHash).map(clone); }, async deleteAttachment(id) { attachments.delete(id); },
    async putDraft(record) { drafts.set(record.id, clone(record)); }, async getDraft(id) { const value = drafts.get(id); return value ? clone(value) : null; },
    async listDrafts(scopeHash) { return [...drafts.values()].filter((record) => record.scopeHash === scopeHash).map(clone); }, async deleteDraft(id) { drafts.delete(id); },
  };
}

let defaultDatabase: OperatorV3Database | null = null;
function isTestRuntime(): boolean { return typeof process !== 'undefined' && process.env.NODE_ENV === 'test'; }
export function getDefaultOperatorV3Database(): OperatorV3Database {
  if (!defaultDatabase) {
    if (typeof globalThis.indexedDB !== 'undefined') defaultDatabase = createIndexedDbOperatorV3Database(globalThis.indexedDB);
    else if (isTestRuntime()) defaultDatabase = createMemoryOperatorV3Database();
    else throw new Error('Надёжное локальное хранилище недоступно');
  }
  return defaultDatabase;
}
