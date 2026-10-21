/*
  Поведение хранилища временных PDF (storage.ts).

  Модуль сохраняет готовый PDF по jobId задания, отдаёт его обратно и удаляет.
  Ключ — единственная защита от «не туда»: `pdf-results/<uuid v4>.pdf`. Ошибка
  здесь означала бы запись по пути вложения отчёта (`media/...`) или выдачу не
  того объекта по подставленному jobId.

  Границы замоканы: S3-сервис и клиент AWS (vi.mock). Redis/БД модуль не
  трогает. Локальная ветка проверяется на настоящей файловой системе во
  временном каталоге — пути и запись файла остаются настоящей логикой, а не
  заглушкой.
*/

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { isTemporaryPdfKey, savePdfBuffer, readPdfResult, deletePdfResult } from '../storage';

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  destroy: vi.fn(),
  uploadBuffer: vi.fn(),
  deleteFile: vi.fn(),
}));

vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return { ...actual, S3Client: class { send = mocks.send; destroy = mocks.destroy; } };
});

vi.mock('@/core/storage/s3-service', () => ({
  uploadBuffer: mocks.uploadBuffer,
  deleteFile: mocks.deleteFile,
}));

const WORKSPACE = process.cwd();
const JOB_ID = '3f1c2a54-9b7e-4c1d-8a2f-0d6b5e4c3a21';
const PDF_BYTES = Buffer.from('%PDF-1.7 test payload');

const S3_KEYS = ['S3_ENDPOINT', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'S3_BUCKET', 'S3_REGION'] as const;

/** Локальный режим: S3 выключен (пустые переменные — как в compose без ключей). */
function useLocalStorage(): void {
  for (const key of S3_KEYS) vi.stubEnv(key, '');
  vi.stubEnv('S3_BUCKET', 'test-bucket');
}

function useS3Storage(): void {
  vi.stubEnv('S3_ENDPOINT', 'http://mock-s3');
  vi.stubEnv('S3_ACCESS_KEY_ID', 'mock-key');
  vi.stubEnv('S3_SECRET_ACCESS_KEY', 'mock-secret');
  vi.stubEnv('S3_BUCKET', 'test-bucket');
}

let fixture: string;

function localPath(jobId: string): string {
  return join(fixture, 'storage', 'pdf-results', `${jobId}.pdf`);
}

beforeEach(async () => {
  mocks.send.mockReset();
  mocks.destroy.mockReset();
  mocks.uploadBuffer.mockReset();
  mocks.deleteFile.mockReset();
  useLocalStorage();
  fixture = join(WORKSPACE, '.tmp', 'codex-pdf-storage-' + randomUUID());
  await fs.mkdir(fixture, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fixture);
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  const allowed = resolve(WORKSPACE, '.tmp');
  const target = resolve(fixture);
  if (relative(allowed, target).startsWith('..') || !target.startsWith(allowed + sep)) {
    throw new Error('unsafe test cleanup');
  }
  await fs.rm(target, { recursive: true, force: true });
});

describe('временные PDF: локальный диск', () => {
  it('сохраняет файл в storage/pdf-results и возвращает абсолютный путь', async () => {
    const saved = await savePdfBuffer(JOB_ID, PDF_BYTES);

    expect(isAbsolute(saved)).toBe(true);
    expect(saved).toBe(localPath(JOB_ID));
    expect(existsSync(saved)).toBe(true);
    expect(readFileSync(saved)).toEqual(PDF_BYTES);
    // Временный PDF не попадает во вложения отчётов.
    expect(existsSync(join(fixture, 'storage', 'media'))).toBe(false);
  });

  it('отдаёт сохранённый PDF по ключу задания байт в байт', async () => {
    await savePdfBuffer(JOB_ID, PDF_BYTES);

    expect(await readPdfResult(JOB_ID)).toEqual(PDF_BYTES);
  });

  it('удаляет PDF по ключу задания, повторное удаление не падает', async () => {
    const saved = await savePdfBuffer(JOB_ID, PDF_BYTES);
    expect(existsSync(saved)).toBe(true);

    await expect(deletePdfResult(JOB_ID)).resolves.toBeUndefined();
    expect(existsSync(saved)).toBe(false);

    // Уборка идемпотентна: файла уже нет — это штатный случай, а не ошибка.
    await expect(deletePdfResult(JOB_ID)).resolves.toBeUndefined();
  });

  it('отклоняет ключ чужой организации и любой не-временный ключ во всех операциях', async () => {
    const foreignKeys = [
      `media/orion/report/r1/${JOB_ID}.pdf`,
      `orion/site-1/2026/10/${JOB_ID}.pdf`,
      `pdf-results/${JOB_ID}.jpg`,
      `pdf-results/../media/orion/${JOB_ID}.pdf`,
    ];
    for (const key of foreignKeys) expect(isTemporaryPdfKey(key)).toBe(false);

    const foreignIds = [
      `../media/orion/${JOB_ID}`,
      `${JOB_ID}/../other`,
      `orion/${JOB_ID}`,
      'not-a-uuid',
    ];
    for (const jobId of foreignIds) {
      expect(isTemporaryPdfKey(`pdf-results/${jobId}.pdf`)).toBe(false);
      await expect(savePdfBuffer(jobId, PDF_BYTES)).rejects.toThrow('Invalid temporary PDF job id');
      await expect(readPdfResult(jobId)).rejects.toThrow('Invalid temporary PDF job id');
      await expect(deletePdfResult(jobId)).rejects.toThrow('Invalid temporary PDF job id');
    }

    // Ни один подставленный путь не создал файл вне pdf-results.
    expect(existsSync(join(fixture, 'storage', 'media'))).toBe(false);
    expect(existsSync(join(fixture, 'storage', 'pdf-results', 'other.pdf'))).toBe(false);
    expect(mocks.uploadBuffer).not.toHaveBeenCalled();
    expect(mocks.deleteFile).not.toHaveBeenCalled();
  });
});

describe('временные PDF: S3', () => {
  it('пишет PDF под ключом pdf-results/<jobId>.pdf с типом application/pdf', async () => {
    useS3Storage();
    mocks.uploadBuffer.mockResolvedValue(`s3://test-bucket/pdf-results/${JOB_ID}.pdf`);

    const saved = await savePdfBuffer(JOB_ID, PDF_BYTES);

    expect(saved).toBe(`s3://test-bucket/pdf-results/${JOB_ID}.pdf`);
    expect(mocks.uploadBuffer).toHaveBeenCalledWith(`pdf-results/${JOB_ID}.pdf`, PDF_BYTES, 'application/pdf');
    // При включённом S3 локальная копия не создаётся.
    expect(existsSync(join(fixture, 'storage'))).toBe(false);
  });

  it('читает PDF из того же ключа и склеивает поток в буфер', async () => {
    useS3Storage();
    mocks.send.mockImplementation(async (command: GetObjectCommand) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect(command.input).toEqual({ Bucket: 'test-bucket', Key: `pdf-results/${JOB_ID}.pdf` });
      return { Body: Readable.from([Buffer.from('%PDF-1.7 '), Buffer.from('test payload')]) };
    });

    expect(await readPdfResult(JOB_ID)).toEqual(PDF_BYTES);
  });

  // дефект: удаление из S3 глушит любую ошибку (W133-EMPTY-CATCH-BLOCKS #8), а
  // не только «объекта уже нет»: отказ доступа к бакету остаётся незамеченным
  // и вызывающим, и логом — файл живёт в S3 дальше.
  it.fails('сбой удаления в S3 не проходит молча', async () => {
    useS3Storage();
    mocks.deleteFile.mockRejectedValue(new Error('Access Denied'));

    await expect(deletePdfResult(JOB_ID)).rejects.toThrow('Access Denied');
    expect(mocks.deleteFile).toHaveBeenCalledWith(`pdf-results/${JOB_ID}.pdf`);
  });
});
