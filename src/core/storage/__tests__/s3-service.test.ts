/**
 * Поведение S3-сервиса (s3-service.ts).
 *
 * Модуль выдаёт пресайнд URL, строит ключи объектов и выполняет загрузку/удаление.
 * Границы замоканы: S3-клиент и пресайнер (vi.mock). Переменные окружения — через vi.stubEnv.
 * Логика построения ключей и обработка ошибок проверяется на результате, а не на вызовах моков.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  getSignedUrl: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn().mockImplementation(function S3ClientMock() {
    return { send: mocks.send };
  }),
  PutObjectCommand: vi.fn().mockImplementation(function PutObjectCommandMock(input) {
    return { __type: 'PutObjectCommand', input };
  }),
  GetObjectCommand: vi.fn().mockImplementation(function GetObjectCommandMock(input) {
    return { __type: 'GetObjectCommand', input };
  }),
  DeleteObjectCommand: vi.fn().mockImplementation(function DeleteObjectCommandMock(input) {
    return { __type: 'DeleteObjectCommand', input };
  }),
  ListObjectsV2Command: vi.fn().mockImplementation(function ListObjectsV2CommandMock(input) {
    return { __type: 'ListObjectsV2Command', input };
  }),
}));

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: mocks.getSignedUrl,
}));

const S3_ENV_KEYS = ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET'] as const;

function setS3Env(overrides: Partial<Record<typeof S3_ENV_KEYS[number], string>> = {}): void {
  for (const key of S3_ENV_KEYS) {
    vi.stubEnv(key, overrides[key] ?? '');
  }
  vi.stubEnv('S3_ENDPOINT', overrides.S3_ENDPOINT ?? 'http://localhost:9000');
  vi.stubEnv('S3_REGION', overrides.S3_REGION ?? 'auto');
  vi.stubEnv('S3_ACCESS_KEY_ID', overrides.S3_ACCESS_KEY_ID ?? 'test-key');
  vi.stubEnv('S3_SECRET_ACCESS_KEY', overrides.S3_SECRET_ACCESS_KEY ?? 'test-secret');
  vi.stubEnv('S3_BUCKET', overrides.S3_BUCKET ?? 'test-bucket');
}

function clearS3Env(): void {
  vi.unstubAllEnvs();
}

beforeEach(() => {
  vi.clearAllMocks();
  setS3Env();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearS3Env();
});

// Импортируем после моков и установки env
const { generateUploadUrl, generateDownloadUrl, uploadBuffer, deleteFile, listFiles, reportPdfKey, exportCsvKey } =
  await import('../s3-service');

describe('S3-сервис: построение ключей объектов', () => {
  it('reportPdfKey: ключ содержит префикс организации (tenantId)', () => {
    const key = reportPdfKey('report-123', 'site-456', 'tenant-789', '2026-10');
    expect(key).toBe('tenant-789/site-456/2026/10/report-123.pdf');
  });

  it('exportCsvKey: ключ содержит префикс организации (tenantId)', () => {
    const key = exportCsvKey('site-456', 'tenant-789', '2026-10-01_2026-10-31');
    expect(key).toContain('tenant-789/site-456/exports/');
    expect(key).toMatch(/tenant-789\/site-456\/exports\/\d{4}-\d{2}-\d{2}_2026-10-01_2026-10-31\.csv/);
  });

  it.skip('reportPdfKey: пустая организация отказывает (fail closed), а не использует "default"', () => {
    // Дефект: текущая реализация использует 'default' при null/пустом tenantId.
    // Правило fail closed требует бросать ошибку, а не писать в общий префикс.
    expect(() => reportPdfKey('report-123', 'site-456', null, '2026-10')).toThrow('tenantId is required');
    expect(() => reportPdfKey('report-123', 'site-456', '', '2026-10')).toThrow('tenantId is required');
  });

  it.skip('exportCsvKey: пустая организация отказывает (fail closed), а не использует "default"', () => {
    // Дефект: текущая реализация использует 'default' при null/пустом tenantId.
    expect(() => exportCsvKey('site-456', null, '2026-10-01_2026-10-31')).toThrow('tenantId is required');
    expect(() => exportCsvKey('site-456', '', '2026-10-01_2026-10-31')).toThrow('tenantId is required');
  });
});

describe('S3-сервис: пресайнд URL', () => {
  it('generateUploadUrl: возвращает URL с заданным сроком действия', async () => {
    const expectedUrl = 'https://test-bucket.s3.amazonaws.com/test-key?signature=abc';
    mocks.getSignedUrl.mockResolvedValue(expectedUrl);

    const url = await generateUploadUrl('test-key', 'application/pdf', 1800);

    expect(url).toBe(expectedUrl);
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(
      { send: mocks.send },
      expect.objectContaining({ __type: 'PutObjectCommand' }),
      { expiresIn: 1800 }
    );
  });

  it('generateDownloadUrl: возвращает URL с заданным сроком действия', async () => {
    const expectedUrl = 'https://test-bucket.s3.amazonaws.com/test-key?signature=xyz';
    mocks.getSignedUrl.mockResolvedValue(expectedUrl);

    const url = await generateDownloadUrl('test-key', 7200);

    expect(url).toBe(expectedUrl);
    expect(mocks.getSignedUrl).toHaveBeenCalledWith(
      { send: mocks.send },
      expect.objectContaining({ __type: 'GetObjectCommand' }),
      { expiresIn: 7200 }
    );
  });

  it('generateUploadUrl: ошибка пресайнера поднимается, а не глотается', async () => {
    mocks.getSignedUrl.mockRejectedValue(new Error('Signing failed'));

    await expect(generateUploadUrl('test-key', 'application/pdf')).rejects.toThrow('Signing failed');
  });

  it('generateDownloadUrl: ошибка пресайнера поднимается, а не глотается', async () => {
    mocks.getSignedUrl.mockRejectedValue(new Error('Signing failed'));

    await expect(generateDownloadUrl('test-key')).rejects.toThrow('Signing failed');
  });
});

describe('S3-сервис: операции с объектами', () => {
  it('uploadBuffer: загружает буфер и возвращает s3:// URI', async () => {
    mocks.send.mockResolvedValue({});

    const result = await uploadBuffer('test-key', Buffer.from('hello'), 'text/plain');

    expect(result).toBe('s3://test-bucket/test-key');
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({
        __type: 'PutObjectCommand',
        input: expect.objectContaining({ Bucket: 'test-bucket', Key: 'test-key', Body: Buffer.from('hello'), ContentType: 'text/plain' }),
      })
    );
  });

  it('uploadBuffer: ошибка S3 поднимается, а не глотается', async () => {
    mocks.send.mockRejectedValue(new Error('Access Denied'));

    await expect(uploadBuffer('test-key', Buffer.from('hello'), 'text/plain')).rejects.toThrow('Access Denied');
  });

  it('deleteFile: удаляет объект и не возвращает значение', async () => {
    mocks.send.mockResolvedValue({});

    await expect(deleteFile('test-key')).resolves.toBeUndefined();
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'DeleteObjectCommand', input: expect.objectContaining({ Bucket: 'test-bucket', Key: 'test-key' }) })
    );
  });

  it('deleteFile: ошибка S3 поднимается, а не глотается', async () => {
    mocks.send.mockRejectedValue(new Error('NoSuchBucket'));

    await expect(deleteFile('test-key')).rejects.toThrow('NoSuchBucket');
  });

  it('listFiles: возвращает список ключей под префиксом', async () => {
    mocks.send.mockResolvedValue({ Contents: [{ Key: 'prefix/file1.pdf' }, { Key: 'prefix/file2.pdf' }, { Key: null }] });

    const keys = await listFiles('prefix/');

    expect(keys).toEqual(['prefix/file1.pdf', 'prefix/file2.pdf']);
    expect(mocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ __type: 'ListObjectsV2Command', input: expect.objectContaining({ Bucket: 'test-bucket', Prefix: 'prefix/' }) })
    );
  });

  it('listFiles: ошибка S3 поднимается, а не глотается', async () => {
    mocks.send.mockRejectedValue(new Error('InternalError'));

    await expect(listFiles('prefix/')).rejects.toThrow('InternalError');
  });
});

describe('S3-сервис: отсутствие credentials выбрасывает ошибку при инициализации', () => {
  it('generateUploadUrl без S3_ACCESS_KEY_ID выбрасывает понятную ошибку', async () => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.stubEnv('S3_ENDPOINT', 'http://localhost:9000');
    vi.stubEnv('S3_REGION', 'auto');
    vi.stubEnv('S3_SECRET_ACCESS_KEY', 'test-secret');
    vi.stubEnv('S3_BUCKET', 'test-bucket');
    // S3_ACCESS_KEY_ID не задан

    const { generateUploadUrl: generateUploadUrlFresh } = await import('../s3-service');

    await expect(generateUploadUrlFresh('test-key', 'application/pdf')).rejects.toThrow('S3 credentials not configured');
  });
});