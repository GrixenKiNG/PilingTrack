/**
 * Происшествия на сменах — список для конторы и отметка о разборе.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫЙ МАРШРУТ. Происшествие заводит машинист с телефона, и до
 * этого экрана прочитать его было негде: запись ложилась в базу, красное
 * висело у машиниста, в чат уходило сообщение — и всё. Учёт происшествий без
 * места, где их разбирают, не учёт, а архив.
 *
 * ПОЧЕМУ РАЗБОР — ЭТО ЗАПИСЬ, А НЕ КНОПКА «ОК». У разбора есть автор, время и
 * вывод. Без вывода отметка означает только «я это видел», а через месяц никто
 * не вспомнит, чем кончилось и что поменяли.
 */

import {NextRequest, NextResponse} from 'next/server';
import {z} from 'zod';
import {withApi, withMutation} from '@/core/api-wrapper';
import {requireAuth} from '@/lib/auth';
import {assertCan} from '@/services/auth/authorization-service';
import {db} from '@/lib/db';

export const runtime = 'nodejs';

const PAGE_SIZE = 100;

export const GET = withApi(async (request: NextRequest) => {
  const {user, error} = await requireAuth(request);
  if (error || !user) return NextResponse.json({error: 'Войдите в систему'}, {status: 401});
  assertCan(user, 'incidents.read');
  if (!user.tenantId) return NextResponse.json({error: 'Организация не определена'}, {status: 400});

  // По умолчанию — только неразобранное: экран открывают, чтобы увидеть, что
  // требует решения, а не чтобы листать историю.
  const scope = request.nextUrl.searchParams.get('scope') ?? 'open';

  const rows = await db.safetyIncident.findMany({
    where: {
      tenantId: user.tenantId,
      ...(scope === 'open' ? {reviewedAt: null} : {}),
    },
    orderBy: [{reviewedAt: {sort: 'asc', nulls: 'first'}}, {occurredAt: 'desc'}],
    take: PAGE_SIZE,
    select: {
      id: true, category: true, severity: true, state: true, description: true,
      observedSigns: true, injured: true, stopRequired: true, occurredAt: true,
      evidenceMediaIds: true, reviewedAt: true, reviewNote: true,
      shiftId: true, reportedById: true, equipmentId: true, siteId: true,
    },
  });

  // Имена людей, машин и объектов подтягиваем одним запросом на вид, а не
  // связями: у SafetyIncident внешних ключей на них нет — таблица досталась от
  // прежнего модуля машиниста, где идентификаторы хранились как есть.
  const [people, equipment, sites] = await Promise.all([
    db.user.findMany({
      where: {tenantId: user.tenantId, id: {in: [...new Set(rows.flatMap(
        (row) => [row.reportedById],
      ))]}},
      select: {id: true, name: true},
    }),
    db.equipment.findMany({
      where: {tenantId: user.tenantId, id: {in: [...new Set(rows.map((row) => row.equipmentId).filter((id): id is string => Boolean(id)))]}},
      select: {id: true, name: true},
    }),
    db.site.findMany({
      where: {tenantId: user.tenantId, id: {in: [...new Set(rows.map((row) => row.siteId).filter((id): id is string => Boolean(id)))]}},
      select: {id: true, name: true},
    }),
  ]);
  const nameOf = new Map(people.map((person) => [person.id, person.name]));
  const rigOf = new Map(equipment.map((rig) => [rig.id, rig.name]));
  const siteOf = new Map(sites.map((site) => [site.id, site.name]));

  return NextResponse.json({
    data: rows.map((row) => ({
      id: row.id,
      category: row.category,
      severity: row.severity,
      state: row.state,
      description: row.description,
      signs: Array.isArray(row.observedSigns) ? row.observedSigns as string[] : [],
      injured: row.injured,
      stopRequired: row.stopRequired,
      occurredAt: row.occurredAt.toISOString(),
      photos: Array.isArray(row.evidenceMediaIds) ? row.evidenceMediaIds.length : 0,
      reviewedAt: row.reviewedAt?.toISOString() ?? null,
      reviewNote: row.reviewNote,
      shiftId: row.shiftId,
      reportedBy: nameOf.get(row.reportedById) ?? '—',
      equipmentName: row.equipmentId ? rigOf.get(row.equipmentId) ?? '—' : '—',
      siteName: row.siteId ? siteOf.get(row.siteId) ?? '—' : '—',
    })),
  });
}, {domain: 'admin-incidents'});

const reviewSchema = z.object({
  id: z.string().min(1),
  // Вывод обязателен и не может быть отпиской: разбор без вывода — это
  // отметка «прочитано», которая через месяц ничего не объяснит.
  note: z.string().min(10).max(4000),
});

export const POST = withMutation(async (request: NextRequest) => {
  const {user, error} = await requireAuth(request);
  if (error || !user) return NextResponse.json({error: 'Войдите в систему'}, {status: 401});
  assertCan(user, 'incidents.review');
  if (!user.tenantId) return NextResponse.json({error: 'Организация не определена'}, {status: 400});

  const parsed = reviewSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      {error: 'Опишите вывод разбора — не меньше 10 знаков', details: parsed.error.issues},
      {status: 400},
    );
  }

  // Повторный разбор не переписываем: первый вывод — тот, что был сделан по
  // свежим следам, и заменять его задним числом нельзя.
  const updated = await db.safetyIncident.updateMany({
    where: {tenantId: user.tenantId, id: parsed.data.id, reviewedAt: null},
    data: {
      reviewedAt: new Date(),
      reviewedById: user.id,
      reviewNote: parsed.data.note.trim(),
    },
  });
  if (updated.count === 0) {
    return NextResponse.json({error: 'Происшествие не найдено либо уже разобрано'}, {status: 409});
  }

  return NextResponse.json({data: {ok: true}});
}, {domain: 'admin-incidents'});
