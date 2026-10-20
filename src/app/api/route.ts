import { NextResponse } from "next/server";
import { registerAllEventHandlers } from "@/modules/reports/server";
import { registerReadinessProjectionHandler } from "@/workers/register-readiness-projection";
import { withApi } from "@/core/api-wrapper";

export const runtime = 'nodejs';

// Register synchronously at module load. on() dedupes by handler reference,
// so this is idempotent even if workers also register in the same process.
registerAllEventHandlers();
registerReadinessProjectionHandler();

export const GET = withApi(async () => {
  return NextResponse.json({ status: "ok", version: process.env.APP_VERSION || process.env.npm_package_version || 'unknown', timestamp: new Date().toISOString() });
}, { domain: 'health' });
