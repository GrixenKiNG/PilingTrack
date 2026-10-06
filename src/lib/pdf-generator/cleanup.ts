import { lstat, readdir, realpath, open, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { S3Client, ListObjectsV2Command, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { logger } from '@/lib/logger';
import { isS3Enabled, isTemporaryPdfKey, TEMPORARY_PDF_PREFIX } from './storage';

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
interface Candidate { key: string; modified: number }

function isMissing(error: unknown): boolean {
  return (error as { code?: string })?.code === 'ENOENT';
}

async function localPdfModified(path: string): Promise<number | null> {
  const stat = await lstat(path);
  // No directories, symlinks/junctions or hard links to report attachments.
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) return null;
  const file = await open(path, 'r');
  try {
    const opened = await file.stat();
    if (opened.ino !== stat.ino || opened.dev !== stat.dev || opened.mtimeMs !== stat.mtimeMs) return null;
    const header = Buffer.alloc(5);
    await file.read(header, 0, 5, 0);
    return header.toString('ascii') === '%PDF-' ? stat.mtimeMs : null;
  } finally { await file.close(); }
}

/** Only temporary UUID PDF results; default is read-only. Never scans Media. */
export async function cleanupTemporaryPdfs(options: { dryRun?: boolean; now?: Date; signal?: AbortSignal } = {}) {
  const signal = options.signal;
  signal?.throwIfAborted();
  const dryRun = options.dryRun ?? true;
  const cutoff = (options.now ?? new Date()).getTime() - RETENTION_MS;
  if (!Number.isFinite(cutoff)) throw new Error('Invalid PDF cleanup time');
  const candidates: Candidate[] = [];
  let deleted = 0;

  if (isS3Enabled()) {
    const s3 = new S3Client({ region: process.env.S3_REGION || 'auto', endpoint: process.env.S3_ENDPOINT,
      credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' }, forcePathStyle: true });
    const Bucket = process.env.S3_BUCKET || 'pilingtrack-reports';
    try {
      let token: string | undefined;
      do {
        const page = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: TEMPORARY_PDF_PREFIX, ContinuationToken: token }), { abortSignal: signal });
        for (const object of page.Contents ?? []) {
          signal?.throwIfAborted();
          if (!object.Key || !isTemporaryPdfKey(object.Key) || !object.LastModified || object.LastModified.getTime() >= cutoff) continue;
          const meta = await s3.send(new HeadObjectCommand({ Bucket, Key: object.Key }), { abortSignal: signal });
          if (meta.ContentType !== 'application/pdf' || !meta.LastModified || meta.LastModified.getTime() >= cutoff) continue;
          candidates.push({ key: object.Key, modified: meta.LastModified.getTime() });
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
        if (page.IsTruncated && !token) throw new Error('Truncated PDF cleanup listing without continuation token');
      } while (token);
      logger.info('Temporary PDF cleanup plan', { backend: 's3', dryRun, retentionDays: 30, count: candidates.length, keys: candidates.map(row => row.key) });
      if (!dryRun) for (const row of candidates) {
        signal?.throwIfAborted();
        // Recheck type/age immediately before deleting; refreshed results are preserved.
        const meta = await s3.send(new HeadObjectCommand({ Bucket, Key: row.key }), { abortSignal: signal });
        if (!isTemporaryPdfKey(row.key) || meta.ContentType !== 'application/pdf' || meta.LastModified?.getTime() !== row.modified || row.modified >= cutoff) continue;
        await s3.send(new DeleteObjectCommand({ Bucket, Key: row.key }), { abortSignal: signal });
        deleted++;
      }
    } finally { s3.destroy(); }
  } else {
    const root = resolve(process.cwd(), 'storage', 'pdf-results');
    try {
      for (const directory of [resolve(process.cwd(), 'storage'), root]) {
        const stat = await lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('PDF cleanup root must be a real directory');
      }
      const expected = join(await realpath(process.cwd()), 'storage', 'pdf-results');
      if (await realpath(root) !== expected) throw new Error('PDF cleanup root escapes temporary storage');
      for (const name of await readdir(root)) {
        signal?.throwIfAborted();
        const key = TEMPORARY_PDF_PREFIX + name;
        if (!isTemporaryPdfKey(key)) continue;
        const modified = await localPdfModified(join(root, name));
        if (modified !== null && modified < cutoff) candidates.push({ key, modified });
      }
      logger.info('Temporary PDF cleanup plan', { backend: 'local', dryRun, retentionDays: 30, count: candidates.length, keys: candidates.map(row => row.key) });
      if (!dryRun) for (const row of candidates) {
        signal?.throwIfAborted();
        if (!isTemporaryPdfKey(row.key)) continue;
        const path = join(root, row.key.slice(TEMPORARY_PDF_PREFIX.length));
        try {
          if (await localPdfModified(path) !== row.modified || row.modified >= cutoff) continue;
          signal?.throwIfAborted();
          await unlink(path); deleted++;
        } catch (error) { if (!isMissing(error)) throw error; }
      }
    } catch (error) { if (!isMissing(error)) throw error; }
  }
  logger.info('Temporary PDF cleanup complete', { dryRun, candidates: candidates.length, deleted });
  return { dryRun, candidates: candidates.length, deleted };
}
