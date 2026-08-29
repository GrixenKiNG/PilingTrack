import {createOfflineCommandEnvelope} from '../command-envelope';
import {createMemoryCrossTabQueueChannel} from '../cross-tab-channel';
import {OperatorV3LocalCrypto, createMemoryKeyVault} from '../local-crypto';
import {createMemoryOperatorV3Database} from '../operator-v3-db';
import {OperatorCommandQueue} from '../command-queue';
import {OperatorAttachmentStore} from '../attachment-store';

export function createOfflineTestContext(scope = 'организация:оператор') {
  const database = createMemoryOperatorV3Database();
  const vault = createMemoryKeyVault();
  const localCrypto = new OperatorV3LocalCrypto(scope, vault);
  const queue = new OperatorCommandQueue(database, localCrypto, createMemoryCrossTabQueueChannel());
  const attachments = new OperatorAttachmentStore(database, localCrypto);
  return {database, vault, localCrypto, queue, attachments};
}

export function testEnvelope(overrides: Partial<Parameters<typeof createOfflineCommandEnvelope>[0]> = {}) {
  return createOfflineCommandEnvelope({
    commandId: '11111111-1111-4111-8111-111111111111',
    route: '/api/operator/v3/commands/start-shift',
    expectedVersion: 7,
    deviceId: 'устройство-1',
    deviceSequence: 1,
    occurredAt: '2026-08-27T10:00:00.000Z',
    payload: {comment: 'секретная заметка'},
    ...overrides,
  });
}
