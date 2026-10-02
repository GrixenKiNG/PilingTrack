import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { cleanupTemporaryPdfs } from '../cleanup';
import { isTemporaryPdfKey, savePdfBuffer, readPdfResult, deletePdfResult } from '../storage';
import { buildMediaKey } from '@/core/media/media-content';
const mocks = vi.hoisted(() => ({ send: vi.fn(), destroy: vi.fn(), info: vi.fn() }));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.info } }));
vi.mock('@aws-sdk/client-s3', async () => {
  const actual = await vi.importActual<typeof import('@aws-sdk/client-s3')>('@aws-sdk/client-s3');
  return { ...actual, S3Client: class { send = mocks.send; destroy = mocks.destroy; } };
});
const workspace = process.cwd();
const now = new Date('2026-10-02T12:00:00Z');
const old = new Date(now.getTime() - 31 * 86400000);
const uuid = (n: number) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
let fixture: string;
let root: string;
async function file(name: string, date = old, content = '%PDF-1.7') {
  const path = join(root, name); await fs.writeFile(path, content); await fs.utimes(path, date, date); return path;
}
beforeEach(async () => {
  vi.clearAllMocks(); mocks.info.mockReset(); mocks.send.mockReset();
  vi.stubEnv('S3_ENDPOINT', ''); vi.stubEnv('S3_ACCESS_KEY_ID', ''); vi.stubEnv('S3_SECRET_ACCESS_KEY', '');
  fixture = join(workspace, '.tmp', 'codex-pdf-cleanup-' + randomUUID()); root = join(fixture, 'storage', 'pdf-results');
  await fs.mkdir(root, { recursive: true });
  vi.spyOn(process, 'cwd').mockReturnValue(fixture);
});
afterEach(async () => {
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  const allowed = resolve(workspace, '.tmp'); const target = resolve(fixture);
  if (relative(allowed, target).startsWith('..') || !target.startsWith(allowed + sep)) throw new Error('unsafe test cleanup');
  await fs.rm(target, { recursive: true, force: true });
});
describe('I11 temporary PDF cleanup', () => {
  it('defaults to dry-run and deletes only old UUID PDF results after logging the plan', async () => {
    const removable = await file(uuid(1) + '.pdf');
    const recent = await file(uuid(2) + '.pdf', new Date(now.getTime() - 29 * 86400000));
    const boundary = await file(uuid(3) + '.pdf', new Date(now.getTime() - 30 * 86400000));
    const photo = await file(uuid(4) + '.jpg');
    const disguisedPhoto = await file(uuid(5) + '.pdf', old, 'JPEG-photo');
    const unknown = await file('attachment.pdf');
    const nested = join(root, 'reports'); await fs.mkdir(nested); await fs.writeFile(join(nested, uuid(6) + '.pdf'), '%PDF-attachment');
    const media = join(fixture, 'storage', buildMediaKey('orion', 'report', 'r1', uuid(7), '.pdf'));
    await fs.mkdir(resolve(media, '..'), { recursive: true }); await fs.writeFile(media, '%PDF-attachment');
    expect(await cleanupTemporaryPdfs({ now })).toEqual({ dryRun: true, candidates: 1, deleted: 0 });
    expect(existsSync(removable)).toBe(true);
    mocks.info.mockImplementation((message, detail) => {
      if (message === 'Temporary PDF cleanup plan') {
        expect(existsSync(removable)).toBe(true);
        expect(detail).toMatchObject({ count: 1, keys: ['pdf-results/' + uuid(1) + '.pdf'], dryRun: false });
      }
    });
    expect(await cleanupTemporaryPdfs({ now, dryRun: false })).toEqual({ dryRun: false, candidates: 1, deleted: 1 });
    expect(existsSync(removable)).toBe(false);
    for (const path of [recent, boundary, photo, disguisedPhoto, unknown, media, join(nested, uuid(6) + '.pdf')]) expect(existsSync(path)).toBe(true);
  });
  it('cannot delete report photos or PDF attachments through Media keys, traversal, a junction or a hard link', async () => {
    for (const extension of ['.jpg', '.png', '.pdf']) expect(isTemporaryPdfKey(buildMediaKey('orion', 'report', 'r1', uuid(1), extension))).toBe(false);
    for (const key of ['media/report/a.pdf', 'pdf-results/../media/a.pdf', 'pdf-results/nested/' + uuid(1) + '.pdf', 'pdf-results/' + uuid(1) + '.jpg']) expect(isTemporaryPdfKey(key)).toBe(false);
    const media = join(fixture, 'storage', 'media'); await fs.mkdir(media);
    const attachment = join(media, uuid(1) + '.pdf'); await fs.writeFile(attachment, '%PDF-attachment'); await fs.utimes(attachment, old, old);
    await fs.link(attachment, join(root, uuid(1) + '.pdf'));
    expect((await cleanupTemporaryPdfs({ now, dryRun: false })).deleted).toBe(0);
    await fs.unlink(join(root, uuid(1) + '.pdf')); await fs.rmdir(root);
    await fs.symlink(media, root, 'junction');
    await expect(cleanupTemporaryPdfs({ now, dryRun: false })).rejects.toThrow('real directory');
    expect(existsSync(attachment)).toBe(true);
    for (const operation of [() => savePdfBuffer('../media/a', Buffer.from('%PDF')), () => readPdfResult('../media/a'), () => deletePdfResult('../media/a')]) await expect(operation()).rejects.toThrow('Invalid temporary PDF');
  });
  it('S3 paginates only the temporary prefix and requires a PDF type and age before any delete', async () => {
    vi.stubEnv('S3_ENDPOINT', 'http://mock-s3'); vi.stubEnv('S3_ACCESS_KEY_ID', 'mock'); vi.stubEnv('S3_SECRET_ACCESS_KEY', 'mock');
    const key = 'pdf-results/' + uuid(1) + '.pdf'; const photo = 'pdf-results/' + uuid(2) + '.pdf';
    const attachment = buildMediaKey('orion', 'report', 'r1', uuid(3), '.pdf');
    const order: string[] = [];
    mocks.info.mockImplementation(message => { if (message === 'Temporary PDF cleanup plan') order.push('plan'); });
    mocks.send.mockImplementation(async command => {
      if (command instanceof ListObjectsV2Command) {
        expect(command.input.Prefix).toBe('pdf-results/');
        if (!command.input.ContinuationToken) return { Contents: [{ Key: attachment, LastModified: old }], IsTruncated: true, NextContinuationToken: 'next' };
        return { Contents: [{ Key: key, LastModified: old }, { Key: photo, LastModified: old }] };
      }
      if (command instanceof HeadObjectCommand) {
        expect(command.input.Key).not.toBe(attachment);
        return { ContentType: command.input.Key === photo ? 'image/jpeg' : 'application/pdf', LastModified: old };
      }
      if (command instanceof DeleteObjectCommand) { order.push('delete'); expect(command.input.Key).toBe(key); return {}; }
      throw new Error('unexpected command');
    });
    expect(await cleanupTemporaryPdfs({ now })).toEqual({ dryRun: true, candidates: 1, deleted: 0 });
    expect(order).toEqual(['plan']); order.length = 0;
    expect(await cleanupTemporaryPdfs({ now, dryRun: false })).toEqual({ dryRun: false, candidates: 1, deleted: 1 });
    expect(order).toEqual(['plan', 'delete']);
  });
  it('preserves an S3 result refreshed after the logged cleanup plan', async () => {
    vi.stubEnv('S3_ENDPOINT', 'http://mock-s3'); vi.stubEnv('S3_ACCESS_KEY_ID', 'mock'); vi.stubEnv('S3_SECRET_ACCESS_KEY', 'mock');
    const key = 'pdf-results/' + uuid(1) + '.pdf'; let heads = 0;
    mocks.send.mockImplementation(async command => {
      if (command instanceof ListObjectsV2Command) return { Contents: [{ Key: key, LastModified: old }] };
      if (command instanceof HeadObjectCommand) return { ContentType: 'application/pdf', LastModified: heads++ === 0 ? old : now };
      throw new Error('must not delete refreshed result');
    });
    expect((await cleanupTemporaryPdfs({ now, dryRun: false })).deleted).toBe(0);
  });
});
