/**
 * Media API
 *
 * POST /api/media        — request a presigned upload URL
 * GET  /api/media        — list media for an entity (?entityType=&entityId=)
 *
 * Per-id endpoints live in /api/media/[id]/(confirm|download|route).
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getMediaService } from '@/core/media/media-service';
import { assertCanAccessMediaEntity } from '@/core/media/media-auth';
import { getRequestId } from '@/lib/request-context';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const POST = withMutation(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const requestId = getRequestId(request);
  const body = await request.json();

  if (!body.fileName || !body.contentType) {
    return NextResponse.json({ error: 'fileName and contentType are required' }, { status: 400 });
  }

  try {
    await assertCanAccessMediaEntity(user!, body.entityType, body.entityId);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
  const result = await getMediaService().getPresignedUrl({
    fileName: body.fileName,
    contentType: body.contentType,
    fileSize: body.fileSize,
    tenantId,
    userId: user!.id,
    entityType: body.entityType,
    entityId: body.entityId,
  });

  return NextResponse.json(result, { headers: { 'X-Request-Id': requestId || '' } });
}, { domain: 'media.upload-url' });

export const GET = withApi(async (request: NextRequest) => {
  const { user, error } = await requireAuth(request);
  if (error) return error;

  const requestId = getRequestId(request);
  const { searchParams } = new URL(request.url);
  const entityType = searchParams.get('entityType');
  const entityId = searchParams.get('entityId');

  if (!entityType || !entityId) {
    return NextResponse.json({ error: 'entityType and entityId are required' }, { status: 400 });
  }

  try {
    await assertCanAccessMediaEntity(user!, entityType, entityId);
  } catch (err) {
    if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
    throw err;
  }

  const tenantId = user!.tenantId || process.env.DEFAULT_TENANT_ID || 'default';
  const media = await getMediaService().listByEntity(entityType, entityId, tenantId);

  return NextResponse.json({ data: media }, { headers: { 'X-Request-Id': requestId || '' } });
}, { domain: 'media.list' });
