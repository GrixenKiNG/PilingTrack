import { NextResponse } from "next/server";
import { ensureHandlersRegistered } from "@/services/reports/domain-events";
import { withApi } from "@/core/api-wrapper";

export const runtime = 'nodejs';

// Initialize domain event handlers on first request
ensureHandlersRegistered();

export const GET = withApi(async () => {
  return NextResponse.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
}, { domain: 'health' });
