/**
 * runRetention() — фото «хранятся навсегда» (решение владельца 02.10.2026).
 *
 * Готовое фото, которое пользователь только скрыл кнопкой «удалить», стирать
 * нельзя ни через 90 дней, ни позже: на нём держатся доказательства по дефектам,
 * происшествиям и осмотрам. Очистка вправе убирать только брошенные загрузки
 * (`pending`, `failed`), у которых файла-доказательства нет.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { sendMock } = vi.hoisted(() => ({ sendMock: vi.fn() }));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function S3ClientMock() {
    return { send: sendMock };
  }),
  PutObjectCommand: vi.fn(),
  GetObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn().mockImplementation(function (input: unknown) {
    return { __type: 'DeleteObjectCommand', input };
  }),
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({ getSignedUrl: vi.fn() }));
vi.mock('sharp', () => ({ default: vi.fn() }));

interface Row { id: string; key: string; thumbnailKey: string | null; isDeleted: boolean; deletedAt: Date | null; uploadStatus: string }
const table = new Map<string, Row>();

type Condition = unknown;
function matches(row: Row, where: Record<string, Condition>): boolean {
  return Object.entries(where).every(([field, condition]) => {
    const value = (row as unknown as Record<string, unknown>)[field];
    if (condition && typeof condition === 'object') {
      const c = condition as { lt?: Date; not?: unknown };
      if (c.lt !== undefined) return value instanceof Date && value < c.lt;
      if (c.not !== undefined) return value !== c.not;
    }
    return value === condition;
  });
}

vi.mock('@/lib/db', () => ({
  db: {
    media: {
      findMany: vi.fn(({ where }: { where: Record<string, Condition> }) =>
        Promise.resolve([...table.values()].filter((row) => matches(row, where)).map(({ id }) => ({ id })))),
      findUnique: vi.fn(({ where: { id } }: { where: { id: string } }) => Promise.resolve(table.get(id) ?? null)),
      delete: vi.fn(({ where: { id } }: { where: { id: string } }) => { table.delete(id); return Promise.resolve({}); }),
    },
  },
}));

import { MediaService } from '../media-service';

const DAY = 24 * 60 * 60 * 1000;
const seed = (id: string, over: Partial<Row>) =>
  table.set(id, { id, key: `media/${id}.jpg`, thumbnailKey: null, isDeleted: true, deletedAt: new Date(Date.now() - 100 * DAY), uploadStatus: 'completed', ...over });

describe('MediaService.runRetention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sendMock.mockResolvedValue({});
    table.clear();
  });

  const service = () => new MediaService({
    bucket: 'test-bucket', region: 'us-east-1', accessKeyId: 'test', secretAccessKey: 'test',
    maxFileSize: 10 * 1024 * 1024, allowedContentTypes: ['image/jpeg'], thumbnailWidth: 400, urlExpiresIn: 3600,
  });

  it('не стирает скрытое готовое фото, даже старше срока', async () => {
    seed('hidden-photo', { uploadStatus: 'completed' });

    expect(await service().runRetention(90)).toBe(0);

    expect(table.has('hidden-photo')).toBe(true);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('убирает только брошенные загрузки старше срока: строку и файл', async () => {
    seed('hidden-photo', { uploadStatus: 'completed' });
    seed('abandoned-failed', { uploadStatus: 'failed' });
    seed('abandoned-pending', { uploadStatus: 'pending' });
    seed('failed-recent', { uploadStatus: 'failed', deletedAt: new Date(Date.now() - 10 * DAY) });
    seed('failed-not-hidden', { uploadStatus: 'failed', isDeleted: false, deletedAt: null });
    seed('visible-photo', { uploadStatus: 'completed', isDeleted: false, deletedAt: null });

    expect(await service().runRetention(90)).toBe(2);

    expect([...table.keys()].sort()).toEqual(['failed-not-hidden', 'failed-recent', 'hidden-photo', 'visible-photo']);
    expect(sendMock).toHaveBeenCalledTimes(2);
  });
});
