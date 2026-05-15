import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getMediaService } from '@/core/media/media-service';
import { assertCanAccessMedia } from '@/core/media/media-auth';
import { withApi } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const GET = withApi(
  async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const wantThumb = searchParams.get('thumb') === '1';

    const { db } = await import('@/lib/db');
    const media = await db.media.findUnique({
      where: { id },
      select: { key: true, thumbnailKey: true, entityType: true, entityId: true, isDeleted: true, uploadStatus: true, userId: true },
    });
    if (!media || media.isDeleted) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    if (media.uploadStatus !== 'completed') return NextResponse.json({ error: 'Upload not completed' }, { status: 409 });

    try {
      assertCanAccessMedia(user!, media);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    const s3 = new S3Client({
      region: process.env.S3_REGION || 'auto',
      endpoint: process.env.S3_ENDPOINT || undefined,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
      },
      forcePathStyle: !!process.env.S3_ENDPOINT,
    });
    const bucket = process.env.S3_BUCKET || 'pilingtrack';

    // Prefer the thumbnail when asked for, but verify it actually exists —
    // we have legacy records from before the sharp integration where the
    // DB has a thumbnailKey but the object was never uploaded. Falling
    // back silently keeps the UI working.
    let key = media.key;
    if (wantThumb && media.thumbnailKey) {
      try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: media.thumbnailKey }));
        key = media.thumbnailKey;
      } catch {
        // thumb missing — serve original
      }
    }

    const url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: 3600 },
    );

    return NextResponse.json({ url, expiresIn: 3600 });
  },
  { domain: 'media.download' },
);

void getMediaService;
