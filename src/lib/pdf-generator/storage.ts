import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

// PDF storage: when S3_ENDPOINT (or AWS S3 creds) is configured, store in S3
// under the `pdf-results/` prefix; otherwise fall back to local filesystem at
// `storage/pdf-results/`. Local mode is fine for dev — files are short-lived
// (TTL ~1 hour) — but S3 is preferred for production so files survive
// container restarts and are available across multiple app replicas.
function isS3Enabled(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT && process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
  );
}

function pdfS3Key(jobId: string): string {
  return `pdf-results/${jobId}.pdf`;
}

export async function savePdfBuffer(jobId: string, pdfBuffer: Buffer): Promise<string> {
  if (isS3Enabled()) {
    const { uploadBuffer } = await import('@/core/storage/s3-service');
    return await uploadBuffer(pdfS3Key(jobId), pdfBuffer, 'application/pdf');
  }
  const dir = join(process.cwd(), 'storage', 'pdf-results');
  mkdirSync(dir, { recursive: true });
  const filePath = join(dir, `${jobId}.pdf`);
  writeFileSync(filePath, pdfBuffer);
  return filePath;
}

export async function readPdfResult(jobId: string): Promise<Buffer> {
  if (isS3Enabled()) {
    const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT,
      credentials: {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: env var is validated at startup (validate-env)
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: env var is validated at startup (validate-env)
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
    const res = await s3.send(new GetObjectCommand({
      Bucket: process.env.S3_BUCKET || 'pilingtrack-reports',
      Key: pdfS3Key(jobId),
    }));
    const chunks: Buffer[] = [];
    const stream = res.Body as NodeJS.ReadableStream;
    for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }
  const filePath = join(process.cwd(), 'storage', 'pdf-results', `${jobId}.pdf`);
  return readFileSync(filePath);
}

export async function deletePdfResult(jobId: string): Promise<void> {
  if (isS3Enabled()) {
    try {
      const { deleteFile } = await import('@/core/storage/s3-service');
      await deleteFile(pdfS3Key(jobId));
    } catch {
      // Object may already be gone (TTL or manual cleanup).
    }
    return;
  }
  try {
    const filePath = join(process.cwd(), 'storage', 'pdf-results', `${jobId}.pdf`);
    unlinkSync(filePath);
  } catch {
    // The result may already be removed by TTL cleanup or manual maintenance.
  }
}
