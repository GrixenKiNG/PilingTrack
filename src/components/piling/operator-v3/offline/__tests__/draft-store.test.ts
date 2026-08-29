import {describe, expect, it} from 'vitest';
import {OperatorDraftStore} from '../draft-store';
import {createOfflineTestContext} from './test-helpers';

describe('зашифрованные черновики', () => {
  it('восстанавливает черновик после создания нового экземпляра', async () => {
    const context = createOfflineTestContext();
    const first = new OperatorDraftStore(context.database, context.localCrypto);
    await first.save('осмотр-1', {answer: 'требуется ремонт'}, 100);
    const restarted = new OperatorDraftStore(context.database, context.localCrypto);

    await expect(restarted.get('осмотр-1')).resolves.toMatchObject({value: {answer: 'требуется ремонт'}, createdAt: 100});
    const raw = await context.database.getDraft('осмотр-1');
    expect(raw).not.toBeNull();
    if (!raw) throw new Error('Черновик не сохранён');
    expect(new TextDecoder().decode(raw.encrypted.ciphertext)).not.toContain('требуется ремонт');
  });

  it('не раскрывает черновик другому контексту оператора', async () => {
    const first = createOfflineTestContext('организация:оператор-1');
    await new OperatorDraftStore(first.database, first.localCrypto).save('осмотр-1', {answer: 'данные'});
    const foreign = new OperatorDraftStore(first.database, new (await import('../local-crypto')).OperatorV3LocalCrypto('организация:оператор-2', first.vault));
    await expect(foreign.get('осмотр-1')).resolves.toBeNull();
  });
});
