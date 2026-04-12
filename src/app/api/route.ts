import { NextResponse } from "next/server";
import { ensureHandlersRegistered } from "@/services/reports/domain-events";


export const runtime = 'nodejs';

// Initialize domain event handlers on first request
ensureHandlersRegistered();

export async function GET() {
  try {
    return NextResponse.json({ status: "ok", version: "1.0.0", timestamp: new Date().toISOString() });
  } catch {
    return NextResponse.json({ status: "error", message: "Health check failed" }, { status: 500 });
  }
}
