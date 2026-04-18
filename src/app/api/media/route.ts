/**
 * Media API Routes
 *
 * POST   /api/media/upload-url  — Get presigned URL for upload
 * POST   /api/media/:id/confirm  — Confirm upload after S3 upload
 * GET    /api/media/:id/download — Get presigned download URL
 * GET    /api/media/:id          — Get media metadata
 * DELETE /api/media/:id          — Soft delete media
 * GET    /api/media              — List media by entity
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { getMediaService } from '@/core/media/media-service';
import { getRequestId } from '@/lib/request-context';
import { withApi, withMutation } from '@/core/api-wrapper';

// ============================================================
// POST /api/media/upload-url
// ============================================================

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const requestId = getRequestId(request);
  assertCan(user!, 'reports.manage_all');

  const body = await request.json();

  if (!body.fileName || !body.contentType) {
    return NextResponse.json(
      { error: 'fileName and contentType are required' },
      { status: 400 }
    );
  }

  const mediaService = getMediaService();
  const result = await mediaService.getPresignedUrl({
    fileName: body.fileName,
    contentType: body.contentType,
    fileSize: body.fileSize,
    tenantId: user!.tenantId || 'default',
    userId: user!.id,
    entityType: body.entityType,
    entityId: body.entityId,
  });

  return NextResponse.json(result, {
    headers: { 'X-Request-Id': requestId || '' },
  });
}, { domain: 'media.upload-url' });

// ============================================================
// GET /api/media (list by entity)
// ============================================================

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const requestId = getRequestId(request);
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get('entityType');
  const entityId = searchParams.get('entityId');

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: 'entityType and entityId are required' },
      { status: 400 }
    );
  }

  const mediaService = getMediaService();
  const media = await mediaService.listByEntity(
    entityType,
    entityId,
    user!.tenantId || 'default'
  );

  return NextResponse.json({ data: media }, {
    headers: { 'X-Request-Id': requestId || '' },
  });
}, { domain: 'media.list' });
