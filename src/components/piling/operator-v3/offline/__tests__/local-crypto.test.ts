import {describe, expect, it} from 'vitest';
import {OperatorV3LocalCrypto, type LocalKeyVault, createMemoryKeyVault} from '../local-crypto';

describe('локальное шифрование оператора', () => {
  it('шифрует содержимое AES-GCM и использует неэкспортируемый ключ', async () => {
    const inner = createMemoryKeyVault();
    const storedKeys: CryptoKey[] = [];
    const vault: LocalKeyVault = {
      get: (id) => inner.get(id),
      async putIfAbsent(id, key) { storedKeys.push(key); return inner.putIfAbsent(id, key); },
    };
    const localCrypto = new OperatorV3LocalCrypto('организация:оператор', vault);
    const encrypted = await localCrypto.encryptJson({note: 'закрытая заметка'}, 'команда:1');

    expect(new TextDecoder().decode(encrypted.ciphertext)).not.toContain('закрытая заметка');
    const storedKey = storedKeys[0];
    expect(storedKey).toBeDefined();
    if (!storedKey) throw new Error('Ключ не создан');
    expect(storedKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('raw', storedKey)).rejects.toBeDefined();
    await expect(localCrypto.decryptJson(encrypted, 'команда:1')).resolves.toEqual({note: 'закрытая заметка'});
  });

  it('не позволяет перенести шифротекст в другой контекст', async () => {
    const localCrypto = new OperatorV3LocalCrypto('организация:оператор', createMemoryKeyVault());
    const encrypted = await localCrypto.encryptJson({value: 1}, 'команда:1');
    await expect(localCrypto.decryptJson(encrypted, 'команда:2')).rejects.toBeDefined();
  });
});
