/**
 * GET /api/liveness
 *
 * Liveness probe — checks if the process is alive.
 * Used by orchestrators to detect deadlocks / crashes.
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(_request: NextRequest) {
  // Публичная проба: отдаём только признак живости процесса.
  // Детали процесса (pid, память, версия, платформа) — материал для фингерпринтинга.
  return NextResponse.json({ status: 'alive' }, { status: 200 });
}
