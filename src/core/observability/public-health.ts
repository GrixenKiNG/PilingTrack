/** Public probes expose only status and latency; internal diagnostics keep details. */
export function sanitizeChecks(checks: Record<string, { name: string; status: string; latencyMs?: number }>) {
  return Object.fromEntries(
    Object.values(checks).map(({ name, status, latencyMs }) =>
      latencyMs === undefined ? [name, { name, status }] : [name, { name, status, latencyMs }]
    )
  );
}
