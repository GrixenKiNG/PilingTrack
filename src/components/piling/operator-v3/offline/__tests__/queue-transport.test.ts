import {describe, expect, it, vi} from 'vitest';
import {createFetchQueueTransport} from '../queue-synchronizer';
import {testEnvelope} from './test-helpers';

describe('сетевой транспорт локальной очереди', () => {
  it('передаёт тот же commandId в заголовке и теле', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data: {confirmedAttachmentIds: []}}), {status: 200, headers: {'Content-Type': 'application/json'}}));
    await createFetchQueueTransport(fetcher).send(testEnvelope({commandId: 'команда-один'}), []);

    expect(fetcher).toHaveBeenCalledOnce();
    const [route, init] = fetcher.mock.calls[0] ?? [];
    expect(route).toBe('/api/operator/v3/commands/start-shift');
    expect(new Headers(init?.headers).get('Idempotency-Key')).toBe('команда-один');
    expect(JSON.parse(String(init?.body))).toMatchObject({commandId: 'команда-один'});
  });

  it('отправляет вложения только в маршрут синхронизации и ждёт подтверждённые идентификаторы', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({data: {confirmedAttachmentIds: ['вложение-1']}}), {status: 200, headers: {'Content-Type': 'application/json'}}));
    const attachment = {attachmentId: 'вложение-1', commandId: 'команда-один', name: 'фото.jpg', type: 'image/jpeg', size: 1, lastModified: null, content: new Blob(['x'], {type: 'image/jpeg'}), serverConfirmed: false};
    const result = await createFetchQueueTransport(fetcher).send(testEnvelope({commandId: 'команда-один', attachmentIds: ['вложение-1']}), [attachment]);

    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/operator/v3/sync');
    expect(fetcher.mock.calls[0]?.[1]?.body).toBeInstanceOf(FormData);
    expect(result).toMatchObject({kind: 'confirmed', confirmedAttachmentIds: ['вложение-1']});
  });
});
