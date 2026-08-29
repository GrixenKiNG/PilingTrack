import {OperatorAttachmentStore} from './attachment-store';
import {OperatorCommandQueue} from './command-queue';
import {createCrossTabQueueChannel, type CrossTabQueueChannel} from './cross-tab-channel';
import {getDefaultLocalCrypto} from './local-crypto';
import {getDefaultOperatorV3Database} from './operator-v3-db';
import {createFetchQueueTransport, OperatorQueueSynchronizer} from './queue-synchronizer';

export interface OperatorOfflineServices {
  queue: OperatorCommandQueue;
  synchronizer: OperatorQueueSynchronizer;
  channel: CrossTabQueueChannel;
  close(): void;
}

export function createOperatorOfflineServices(scope: string): OperatorOfflineServices {
  const database = getDefaultOperatorV3Database();
  const localCrypto = getDefaultLocalCrypto(scope);
  const channel = createCrossTabQueueChannel();
  const queue = new OperatorCommandQueue(database, localCrypto, channel);
  const attachments = new OperatorAttachmentStore(database, localCrypto);
  const synchronizer = new OperatorQueueSynchronizer(queue, attachments, createFetchQueueTransport());
  return {queue, synchronizer, channel, close: () => channel.close()};
}
