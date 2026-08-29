import type {OperatorV3LocalCrypto} from './local-crypto';
import type {OperatorV3Database, StoredAttachmentRecord} from './operator-v3-db';

export const MAX_OFFLINE_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

interface AttachmentMetadata {name: string; type: string; size: number; lastModified: number | null;}
export interface OfflineAttachment extends AttachmentMetadata {attachmentId: string; commandId: string; content: Blob; serverConfirmed: boolean;}

function newAttachmentId(): string {
  if (!globalThis.crypto?.randomUUID) throw new Error('Не удалось создать безопасный идентификатор вложения');
  return globalThis.crypto.randomUUID();
}

export function validateOfflineAttachment(file: Blob): void {
  if (!ALLOWED_TYPES.has(file.type)) throw new TypeError('Поддерживаются только фотографии JPEG, PNG, WebP, HEIC и HEIF');
  if (file.size <= 0) throw new TypeError('Нельзя сохранить пустое вложение');
  if (file.size > MAX_OFFLINE_ATTACHMENT_BYTES) throw new TypeError('Размер вложения не должен превышать 20 МБ');
}

export class OperatorAttachmentStore {
  private readonly scopeHashPromise: Promise<string>;
  constructor(private readonly database: OperatorV3Database, private readonly localCrypto: OperatorV3LocalCrypto) { this.scopeHashPromise = localCrypto.scopeHash(); }

  async save(commandId: string, file: Blob, name = 'фотография', requestedId = newAttachmentId()): Promise<OfflineAttachment> {
    validateOfflineAttachment(file);
    const metadata: AttachmentMetadata = {name: name.trim() || 'фотография', type: file.type, size: file.size, lastModified: file instanceof File ? file.lastModified : null};
    const now = Date.now();
    await this.database.putAttachment({
      id: requestedId, commandId, scopeHash: await this.scopeHashPromise,
      encryptedMetadata: await this.localCrypto.encryptJson(metadata, `attachment:${requestedId}:metadata`),
      encryptedContent: await this.localCrypto.encryptBytes(await file.arrayBuffer(), `attachment:${requestedId}:content`),
      status: 'pending', createdAt: now, updatedAt: now,
    });
    return {...metadata, attachmentId: requestedId, commandId, content: file, serverConfirmed: false};
  }

  async get(id: string): Promise<OfflineAttachment | null> {
    const record = await this.database.getAttachment(id);
    if (!record || record.scopeHash !== await this.scopeHashPromise) return null;
    return this.decrypt(record);
  }

  async listForCommand(commandId: string): Promise<OfflineAttachment[]> {
    const records = await this.database.listAttachments(await this.scopeHashPromise);
    return Promise.all(records.filter((record) => record.commandId === commandId).sort((a, b) => a.createdAt - b.createdAt).map((record) => this.decrypt(record)));
  }

  async confirmServerAcceptance(commandId: string, confirmedIds: readonly string[]): Promise<void> {
    const accepted = new Set(confirmedIds);
    const records = await this.database.listAttachments(await this.scopeHashPromise);
    await Promise.all(records.filter((record) => record.commandId === commandId && accepted.has(record.id)).map((record) => this.database.putAttachment({...record, status: 'confirmed', updatedAt: Date.now()})));
  }

  async areAllServerConfirmed(commandId: string, expectedIds: readonly string[]): Promise<boolean> {
    if (expectedIds.length === 0) return true;
    const expected = new Set(expectedIds);
    const records = (await this.database.listAttachments(await this.scopeHashPromise)).filter((record) => record.commandId === commandId && expected.has(record.id));
    return records.length === expected.size && records.every((record) => record.status === 'confirmed');
  }

  async removeConfirmedForCommand(commandId: string): Promise<void> {
    const records = await this.database.listAttachments(await this.scopeHashPromise);
    await Promise.all(records.filter((record) => record.commandId === commandId && record.status === 'confirmed').map((record) => this.database.deleteAttachment(record.id)));
  }

  private async decrypt(record: StoredAttachmentRecord): Promise<OfflineAttachment> {
    const metadata = await this.localCrypto.decryptJson<AttachmentMetadata>(record.encryptedMetadata, `attachment:${record.id}:metadata`);
    const content = await this.localCrypto.decryptBytes(record.encryptedContent, `attachment:${record.id}:content`);
    return {...metadata, attachmentId: record.id, commandId: record.commandId, content: new Blob([content], {type: metadata.type}), serverConfirmed: record.status === 'confirmed'};
  }
}
