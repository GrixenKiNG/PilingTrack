import { NextResponse } from "next/server";
import { registerAllEventHandlers } from "@/services/reports/event-handlers";
import { withApi } from "@/core/api-wrapper";

export const runtime = 'nodejs';

// Register synchronously at module load. on() dedupes by handler reference,
// so this is idempotent even if workers also register in the same process.
registerAllEventHandlers();

export const GET = withApi(async () => {
  return NextResponse.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
}, { domain: 'health' });
