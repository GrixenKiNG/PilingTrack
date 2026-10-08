import { NextRequest, NextResponse } from 'next/server';
import { withApi } from '@/core/api-wrapper';
import { requireAuth } from '@/lib/auth';
import { requireTenantId } from '@/lib/tenant';
import { assertCan } from '@/services/auth/authorization-service';
import { rateLimiter, type RateLimitConfig } from '@/lib/rate-limiter';
import { exportPileJournalXlsx } from '@/modules/reports/application/queries/pile-passport.service';
import type { PileAcceptanceValue } from '@/modules/operator-mobile/domain/pile-passport';
import { getSettings } from '@/modules/settings';
import { getTodayInTimezone } from '@/lib/timezone';

export const runtime = 'nodejs';

const ACCEPTANCE_VALUES: PileAcceptanceValue[] = ['PENDING', 'ACCEPTED', 'NEEDS_REDRIVE'];
const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Ограничение частоты выгрузки журнала (W30, аудит W25 находка 1).
 *
 * ПОЧЕМУ ОТДЕЛЬНЫЙ ЛИМИТ. `withApi` (через который идёт эта GET-выгрузка) частоту
 * не ограничивает — она есть только у `withMutation` (CSRF+POST), а выгрузка
 * идёт GET-ом. Между тем каждый запрос собирает в памяти .xlsx до 20000 строк
 * плюс лист залогов, и право `piles.manage` есть у трёх ролей: цикл выгрузок
 * занимает процесс на всех. Приём тот же, что у PDF-выгрузок
 * (`reports/pdf`): ключ — пользователь, а не IP, потому что экраны бьют с
 * одного адреса за NAT. 6 выгрузок в минуту.
 */
const PILE_JOURNAL_EXPORT_RATE_LIMIT: RateLimitConfig = {
  maxAttempts: 6,
  windowMs: 60 * 1000,
  blockDurationMs: 60 * 1000,
};

/**
 * Выгрузка журнала забивки в .xlsx — то, что распечатывают и подшивают.
 *
 * ПРАВО ТО ЖЕ, ЧТО У ЭКРАНА (`piles.manage`), а не `reports.export`: журнал
 * забивки — документ по сваям, и открыт он тем же, кто по сваям решает.
 *
 * ПОЧЕМУ БЕЗ ОГРАНИЧЕНИЯ ПЕРИОДА В 92 ДНЯ, как у отчётов. Журнал ведётся на
 * объект целиком и подшивается по завершении свайного поля — квартальная
 * граница разрезала бы документ пополам. Размер держит высокий предел строк
 * выгрузки (`PILE_JOURNAL_EXPORT_LIMIT`, 20000) в самой выборке; титул при этом
 * считается по всему периоду и о срезе предупреждает отдельной строкой файла.
 */
export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;

    // Лимит — до любой работы: и до проверки права, и до сборки файла в памяти.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const rateLimit = await rateLimiter.check(`pile-export:get:${user!.id}`, PILE_JOURNAL_EXPORT_RATE_LIMIT);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Слишком много выгрузок. Подождите минуту.' },
        { status: 429, headers: { 'Retry-After': String(rateLimit.retryAfter || 60) } },
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'piles.manage');
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);

    const params = request.nextUrl.searchParams;
    const acceptanceParam = params.get('acceptance');
    if (acceptanceParam && !ACCEPTANCE_VALUES.includes(acceptanceParam as PileAcceptanceValue)) {
      return NextResponse.json({ error: 'Неизвестное решение по свае' }, { status: 400 });
    }
    const dateFrom = params.get('dateFrom') || undefined;
    const dateTo = params.get('dateTo') || undefined;
    if ((dateFrom && !YMD.test(dateFrom)) || (dateTo && !YMD.test(dateTo))) {
      return NextResponse.json({ error: 'Даты периода задаются как ГГГГ-ММ-ДД' }, { status: 400 });
    }

    const xlsx = await exportPileJournalXlsx({
      tenantId,
      siteId: params.get('siteId') || undefined,
      acceptance: (acceptanceParam as PileAcceptanceValue | null) ?? undefined,
      dateFrom,
      dateTo,
      pileNumber: params.get('pileNumber')?.trim() || undefined,
    });

    const { timezone } = await getSettings(tenantId);
    const today = getTodayInTimezone(timezone);
    return new NextResponse(new Uint8Array(xlsx), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="pile-driving-journal-${today}.xlsx"`,
      },
    });
  },
  { domain: 'piles' },
);
