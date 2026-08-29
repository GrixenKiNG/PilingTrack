import type {OfflineCommandEnvelope} from './command-envelope';
import type {CrossTabQueueChannel} from './cross-tab-channel';
import {createCrossTabQueueChannel} from './cross-tab-channel';
import type {OperatorV3LocalCrypto} from './local-crypto';
import type {OfflineCommandStatus, OperatorV3Database, StoredCommandRecord} from './operator-v3-db';

interface StoredCommandContent {
  envelope: OfflineCommandEnvelope;
  issue: {code: string; message: string; occurredAt: string} | null;
}

export interface QueuedCommand {
  envelope: OfflineCommandEnvelope;
  status: OfflineCommandStatus;
  attempts: number;
  issue: StoredCommandContent['issue'];
  createdAt: number;
  updatedAt: number;
}

export interface QueueSummary {pending: number; sending: number; failed: number; conflicts: number; total: number;}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value);
}

function eligible(record: StoredCommandRecord, now: number): boolean {
  if (record.status === 'pending' || record.status === 'failed') return record.nextAttemptAt <= now;
  return record.status === 'sending' && (record.leaseExpiresAt ?? 0) <= now;
}

export class OperatorCommandQueue {
  private readonly scopeHashPromise: Promise<string>;
  private readonly channel: CrossTabQueueChannel;

  constructor(private readonly database: OperatorV3Database, private readonly localCrypto: OperatorV3LocalCrypto, channel?: CrossTabQueueChannel) {
    this.scopeHashPromise = localCrypto.scopeHash();
    this.channel = channel ?? createCrossTabQueueChannel();
  }

  subscribe(listener: () => void): () => void { return this.channel.subscribe(listener); }

  async enqueue(envelope: OfflineCommandEnvelope, now = Date.now()): Promise<QueuedCommand> {
    const existing = await this.database.getCommand(envelope.commandId);
    if (existing) {
      const current = await this.decrypt(existing);
      if (canonical(current.envelope) !== canonical(envelope)) throw new Error('Идентификатор команды уже связан с другим содержимым');
      return current;
    }
    const scopeHash = await this.scopeHashPromise;
    const content: StoredCommandContent = {envelope: structuredClone(envelope), issue: null};
    const record: StoredCommandRecord = {
      id: envelope.commandId, scopeHash, encrypted: await this.localCrypto.encryptJson(content, `command:${envelope.commandId}`),
      status: 'pending', attempts: 0, nextAttemptAt: now, leaseOwner: null, leaseExpiresAt: null, createdAt: now, updatedAt: now,
    };
    await this.database.putCommand(record);
    try { this.channel.publish(); } catch { /* Запись уже надёжно сохранена; другая вкладка увидит её при следующем чтении. */ }
    return {
      envelope: structuredClone(content.envelope), status: 'pending', attempts: 0,
      issue: null, createdAt: now, updatedAt: now,
    };
  }

  async list(): Promise<QueuedCommand[]> {
    const records = await this.database.listCommands(await this.scopeHashPromise);
    records.sort((a, b) => a.createdAt - b.createdAt);
    return Promise.all(records.map((record) => this.decrypt(record)));
  }

  async summary(): Promise<QueueSummary> {
    const entries = await this.list();
    return entries.reduce<QueueSummary>((result, entry) => {
      result.total += 1;
      if (entry.status === 'pending') result.pending += 1;
      else if (entry.status === 'sending') result.sending += 1;
      else if (entry.status === 'failed') result.failed += 1;
      else result.conflicts += 1;
      return result;
    }, {pending: 0, sending: 0, failed: 0, conflicts: 0, total: 0});
  }

  async claimNext(leaseOwner: string, now = Date.now(), leaseDurationMs = 30_000): Promise<QueuedCommand | null> {
    const records = await this.database.listCommands(await this.scopeHashPromise);
    records.sort((a, b) => a.createdAt - b.createdAt);
    for (const candidate of records) {
      if (!eligible(candidate, now)) continue;
      const current = await this.decrypt(candidate);
      const claimed = await this.database.updateCommand(candidate.id, (current) => eligible(current, now) ? {
        ...current, status: 'sending', attempts: current.attempts + 1, leaseOwner, leaseExpiresAt: now + leaseDurationMs, updatedAt: now,
      } : current);
      if (claimed?.leaseOwner === leaseOwner && claimed.status === 'sending') {
        this.channel.publish();
        return {...current, status: 'sending', attempts: claimed.attempts, updatedAt: claimed.updatedAt};
      }
    }
    return null;
  }

  async markFailed(commandId: string, leaseOwner: string, code: string, message: string, retryAt: number): Promise<void> {
    await this.updateIssue(commandId, leaseOwner, 'failed', code, message, retryAt);
  }

  async markConflict(commandId: string, leaseOwner: string, code: string, message: string): Promise<void> {
    await this.updateIssue(commandId, leaseOwner, 'conflict', code, message, Number.MAX_SAFE_INTEGER);
  }

  async removeConfirmed(commandId: string, leaseOwner: string): Promise<boolean> {
    const updated = await this.database.updateCommand(commandId, (current) => current.status === 'sending' && current.leaseOwner === leaseOwner ? null : current);
    const removed = updated === null && await this.database.getCommand(commandId) === null;
    if (removed) this.channel.publish();
    return removed;
  }

  async release(commandId: string, leaseOwner: string, now = Date.now()): Promise<void> {
    await this.database.updateCommand(commandId, (current) => current.status === 'sending' && current.leaseOwner === leaseOwner ? {...current, status: 'pending', leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: now, updatedAt: now} : current);
    this.channel.publish();
  }

  private async updateIssue(commandId: string, leaseOwner: string, status: 'failed' | 'conflict', code: string, message: string, retryAt: number): Promise<void> {
    const record = await this.database.getCommand(commandId);
    if (!record || record.status !== 'sending' || record.leaseOwner !== leaseOwner) return;
    const content = await this.localCrypto.decryptJson<StoredCommandContent>(record.encrypted, `command:${commandId}`);
    content.issue = {code, message, occurredAt: new Date().toISOString()};
    const encrypted = await this.localCrypto.encryptJson(content, `command:${commandId}`);
    await this.database.updateCommand(commandId, (current) => current.status === 'sending' && current.leaseOwner === leaseOwner ? {
      ...current, encrypted, status, leaseOwner: null, leaseExpiresAt: null, nextAttemptAt: retryAt, updatedAt: Date.now(),
    } : current);
    this.channel.publish();
  }

  private async decrypt(record: StoredCommandRecord): Promise<QueuedCommand> {
    const content = await this.localCrypto.decryptJson<StoredCommandContent>(record.encrypted, `command:${record.id}`);
    return {envelope: content.envelope, status: record.status, attempts: record.attempts, issue: content.issue, createdAt: record.createdAt, updatedAt: record.updatedAt};
  }
}
