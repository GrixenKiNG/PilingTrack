import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma expands relation reads concurrently, including inside one transaction.
 * pg requires SQL on that transaction's connection to complete in order.
 */
export class SerializedPrismaPg extends PrismaPg {
  override async connect() {
    const adapter = await super.connect();
    const startTransaction = adapter.startTransaction.bind(adapter);

    adapter.startTransaction = async (isolationLevel) => {
      const transaction = await startTransaction(isolationLevel);
      const queryRaw = transaction.queryRaw.bind(transaction);
      const executeRaw = transaction.executeRaw.bind(transaction);
      const commit = transaction.commit.bind(transaction);
      const rollback = transaction.rollback.bind(transaction);
      let pending: Promise<unknown> = Promise.resolve();
      let finalization: Promise<void> | undefined;

      function enqueue<T>(execute: () => Promise<T>): Promise<T> {
        if (finalization) return Promise.reject(new Error('Transaction is closing'));
        const result = pending.then(execute);
        // A failed statement must still allow ROLLBACK to reach PostgreSQL.
        pending = result.catch(() => undefined);
        return result;
      }

      function finalize(release: () => Promise<void>): Promise<void> {
        // A timeout can race with completion. Release the borrowed client once.
        finalization ??= pending.then(release);
        return finalization;
      }

      transaction.queryRaw = (query) => enqueue(() => queryRaw(query));
      transaction.executeRaw = (query) => enqueue(() => executeRaw(query));
      transaction.commit = () => finalize(commit);
      transaction.rollback = () => finalize(rollback);
      return transaction;
    };

    return adapter;
  }
}
