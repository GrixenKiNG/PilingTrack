import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getMediaService } from '@/core/media/media-service';
import { assertCanAccessMedia } from '@/core/media/media-auth';
import { withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const DELETE = withMutation(
  async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { id } = await ctx.params;
    const { db } = await import('@/lib/db');
    const media = await db.media.findUnique({
      where: { id },
      select: { entityType: true, entityId: true, isDeleted: true, userId: true },
    });
    if (!media) return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    if (media.isDeleted) return NextResponse.json({ ok: true });

    try {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
      assertCanAccessMedia(user!, media);
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    await getMediaService().softDelete(id, user!.id);
    return NextResponse.json({ ok: true });
  },
  { domain: 'media.delete' },
);
