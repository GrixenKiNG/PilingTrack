/**
 * S3 Storage Service — Production File Storage
 *
 * Stores PDF reports, attachments, and exports in S3-compatible storage.
 * Supports: AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces.
 *
 * Features:
 * - Presigned URLs for secure upload/download
 * - Organized folder structure: tenant/site/year/month/
 * - Automatic cleanup of expired uploads
 */

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { logger } from '@/lib/logger';

// ============================================================
// S3 Client (lazy init)
// ============================================================

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    const endpoint = process.env.S3_ENDPOINT;
    const region = process.env.S3_REGION || 'auto';
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;

    if (!accessKeyId || !secretAccessKey) {
      throw new Error('S3 credentials not configured');
    }

    _s3Client = new S3Client({
      region,
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: !!endpoint, // Required for MinIO
    });
  }

  return _s3Client;
}

function getBucket(): string {
  return process.env.S3_BUCKET || 'pilingtrack-reports';
}

// ============================================================
// Storage Operations
// ============================================================

/**
 * Generate presigned upload URL.
 * Client uploads directly to S3 using this URL.
 */
export async function generateUploadUrl(
  key: string,
  contentType: string,
  expiresIn = 3600 // 1 hour
): Promise<string> {
  const s3 = getS3Client();
  const bucket = getBucket();

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    ContentType: contentType,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Generate presigned download URL.
 */
export async function generateDownloadUrl(
  key: string,
  expiresIn = 3600
): Promise<string> {
  const s3 = getS3Client();
  const bucket = getBucket();

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, { expiresIn });
}

/**
 * Upload a buffer directly (server-side upload).
 */
export async function uploadBuffer(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const s3 = getS3Client();
  const bucket = getBucket();

  await s3.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  }));

  return `s3://${bucket}/${key}`;
}

/**
 * Delete a file from S3.
 */
export async function deleteFile(key: string): Promise<void> {
  const s3 = getS3Client();
  const bucket = getBucket();

  await s3.send(new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  }));
}

/**
 * List files in a prefix.
 */
export async function listFiles(prefix: string): Promise<string[]> {
  const s3 = getS3Client();
  const bucket = getBucket();

  const response = await s3.send(new ListObjectsV2Command({
    Bucket: bucket,
    Prefix: prefix,
  }));

  return (response.Contents || []).map(c => c.Key || '').filter(Boolean);
}

// ============================================================
// Report-Specific Helpers
// ============================================================

/**
 * Generate S3 key for a report PDF.
 * Pattern: {tenantId}/{siteId}/{year}/{month}/{reportId}.pdf
 */
export function reportPdfKey(reportId: string, siteId: string, tenantId: string | null, date: string): string {
  const [year, month] = date.split('-');
  const prefix = tenantId || 'default';
  return `${prefix}/${siteId}/${year}/${month}/${reportId}.pdf`;
}

/**
 * Generate S3 key for a CSV export.
 */
export function exportCsvKey(siteId: string, tenantId: string | null, dateRange: string): string {
  const prefix = tenantId || 'default';
  const now = new Date().toISOString().split('T')[0];
  return `${prefix}/${siteId}/exports/${now}_${dateRange}.csv`;
}
