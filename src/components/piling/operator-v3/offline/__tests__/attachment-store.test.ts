import {describe, expect, it} from 'vitest';
import {createOfflineTestContext} from './test-helpers';

describe('зашифрованные вложения', () => {
  it('хранит байты зашифрованно и не подтверждает вложение без ответа сервера', async () => {
    const context = createOfflineTestContext();
    const blob = new Blob([new TextEncoder().encode('содержимое фотографии')], {type: 'image/jpeg'});
    const saved = await context.attachments.save('команда-1', blob, 'осмотр.jpg', 'вложение-1');
    const raw = await context.database.getAttachment(saved.attachmentId);

    expect(raw).not.toBeNull();
    if (!raw) throw new Error('Вложение не сохранено');
    expect(new TextDecoder().decode(raw.encryptedContent.ciphertext)).not.toContain('содержимое фотографии');
    expect((await context.attachments.get(saved.attachmentId))?.serverConfirmed).toBe(false);
    expect(await context.attachments.areAllServerConfirmed('команда-1', [saved.attachmentId])).toBe(false);
  });

  it('сохраняет неподтверждённые вложения при частичном подтверждении', async () => {
    const context = createOfflineTestContext();
    const blob = new Blob([new Uint8Array([1, 2, 3])], {type: 'image/png'});
    await context.attachments.save('команда-1', blob, 'один.png', 'вложение-1');
    await context.attachments.save('команда-1', blob, 'два.png', 'вложение-2');
    await context.attachments.confirmServerAcceptance('команда-1', ['вложение-1']);
    await context.attachments.removeConfirmedForCommand('команда-1');

    expect(await context.attachments.get('вложение-1')).toBeNull();
    expect((await context.attachments.get('вложение-2'))?.serverConfirmed).toBe(false);
  });
});
