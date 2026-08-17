/**
 * GET /api/media/download-batch?ids=a,b,c&thumb=1
 *
 * Ссылки на несколько файлов одним запросом.
 *
 * Зачем: журнал отчётов рисует миниатюру в каждой строке, и каждая строка
 * ходила за своей ссылкой отдельно — на открытии экрана это было 14 запросов
 * из 39 (замер 17.08.2026), и растёт линейно с числом отчётов. Браузер держит
 * не больше шести соединений к одному хосту, так что список превращался в
 * несколько волн ожидания.
 *
 * Проверка доступа — тот же `assertCanAccessMedia(..., 'read')`, что и у
 * одиночного маршрута, через `filterReadableMedia`. Недоступные записи молча
 * выпадают из ответа: ронять весь список из-за одной чужой строки нельзя, а
 * сообщать о её существовании — не нужно.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { filterReadableMedia } from '@/core/media/media-auth';
import { withApi } from '@/core/api-wrapper';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';

export const runtime = 'nodejs';

/** Потолок на пачку: список отчётов грузится страницами, столько не бывает. */
const MAX_IDS = 100;
const URL_TTL_SECONDS = 3600;

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    const { searchParams } = new URL(request.url);
    const wantThumb = searchParams.get('thumb') === '1';
    const ids = [...new Set(
      (searchParams.get('ids') || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    )];

    if (ids.length === 0) {
      return NextResponse.json({ urls: {}, expiresIn: URL_TTL_SECONDS });
    }
    if (ids.length > MAX_IDS) {
      return NextResponse.json(
        { error: `Не больше ${MAX_IDS} идентификаторов за раз` },
        { status: 400 },
      );
    }

    const { db } = await import('@/lib/db');
    const rows = await db.media.findMany({
      where: { id: { in: ids } },
      select: {
        id: true, key: true, thumbnailKey: true, entityType: true, entityId: true,
        isDeleted: true, uploadStatus: true, userId: true, tenantId: true,
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const readable = filterReadableMedia(user!, rows);
    if (readable.length === 0) {
      return NextResponse.json({ urls: {}, expiresIn: URL_TTL_SECONDS });
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

    const entries = await Promise.all(readable.map(async (media) => {
      // Миниатюра предпочтительнее, но проверяем, что объект существует: есть
      // записи времён до sharp, где thumbnailKey в базе стоит, а файла нет.
      // Тот же откат к оригиналу, что и в одиночном маршруте.
      let key = media.key;
      if (wantThumb && media.thumbnailKey) {
        try {
          await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: media.thumbnailKey }));
          key = media.thumbnailKey;
        } catch {
          // миниатюры нет — отдаём оригинал
        }
      }

      try {
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: bucket, Key: key }),
          { expiresIn: URL_TTL_SECONDS },
        );
        return [media.id, url] as const;
      } catch {
        // Одна неподписавшаяся ссылка не должна ронять остальные миниатюры.
        return null;
      }
    }));

    const urls = Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null));

    return NextResponse.json({ urls, expiresIn: URL_TTL_SECONDS });
  },
  { domain: 'media.download' },
);
