import type {OperatorV3LocalCrypto} from './local-crypto';
import type {OperatorV3Database} from './operator-v3-db';

export interface OfflineDraft<T> {draftId: string; value: T; createdAt: number; updatedAt: number;}

export class OperatorDraftStore {
  private readonly scopeHashPromise: Promise<string>;
  constructor(private readonly database: OperatorV3Database, private readonly localCrypto: OperatorV3LocalCrypto) { this.scopeHashPromise = localCrypto.scopeHash(); }

  async save<T>(draftId: string, value: T, now = Date.now()): Promise<OfflineDraft<T>> {
    if (!draftId.trim()) throw new TypeError('Не задан идентификатор черновика');
    const scopeHash = await this.scopeHashPromise;
    const existing = await this.database.getDraft(draftId);
    const createdAt = existing?.scopeHash === scopeHash ? existing.createdAt : now;
    await this.database.putDraft({id: draftId, scopeHash, encrypted: await this.localCrypto.encryptJson(value, `draft:${draftId}`), createdAt, updatedAt: now});
    return {draftId, value: structuredClone(value), createdAt, updatedAt: now};
  }

  async get<T>(draftId: string): Promise<OfflineDraft<T> | null> {
    const record = await this.database.getDraft(draftId);
    if (!record || record.scopeHash !== await this.scopeHashPromise) return null;
    return {draftId, value: await this.localCrypto.decryptJson<T>(record.encrypted, `draft:${draftId}`), createdAt: record.createdAt, updatedAt: record.updatedAt};
  }

  async list<T>(): Promise<OfflineDraft<T>[]> {
    const records = await this.database.listDrafts(await this.scopeHashPromise);
    records.sort((a, b) => b.updatedAt - a.updatedAt);
    return Promise.all(records.map(async (record) => ({draftId: record.id, value: await this.localCrypto.decryptJson<T>(record.encrypted, `draft:${record.id}`), createdAt: record.createdAt, updatedAt: record.updatedAt})));
  }

  async remove(draftId: string): Promise<void> {
    const record = await this.database.getDraft(draftId);
    if (record?.scopeHash === await this.scopeHashPromise) await this.database.deleteDraft(draftId);
  }
}
