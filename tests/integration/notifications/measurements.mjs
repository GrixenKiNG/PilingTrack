// Bounds are sampling estimates, not server-side lock timestamps.
export function summarizeSamples(samples) {
  const maxGapMs = Math.max(0, ...samples.slice(1).map((s, i) => s.at - samples[i].at));
  const groups = new Map();
  for (const sample of samples) for (const row of sample.rows) {
    const key = row.pid + ':' + row.xact_start_ms;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const interval = rows => rows.length ? Math.max(0, Number(rows.at(-1).observed_ms) - Number(rows[0].observed_ms)) : 0;
  const transactions = [...groups.values()].map(rows => {
    const held = rows.filter(r => r.owns_advisory);
    const waiting = rows.filter(r => r.wait_event === 'advisory');
    const heldLowerMs = interval(held);
    const waitLowerMs = interval(waiting);
    const connectionAgeLowerMs = Math.max(...rows.map(r => Number(r.age_ms)));
    return {
      pid: rows[0].pid, xactStartMs: rows[0].xact_start_ms,
      connectionAgeLowerMs, connectionAgeUpperEstimateMs: connectionAgeLowerMs + maxGapMs,
      heldLowerMs, heldUpperEstimateMs: heldLowerMs + 2 * maxGapMs,
      waitLowerMs, waitUpperEstimateMs: waitLowerMs + 2 * maxGapMs,
      heldSamples: held.length, waitSamples: waiting.length,
    };
  });
  return {
    sampleStepMaxMs: maxGapMs,
    maxTransactions: Math.max(0, ...samples.map(s => s.rows.length)),
    maxAdvisoryWaiters: Math.max(0, ...samples.map(s => s.rows.filter(r => r.wait_event === 'advisory').length)),
    maxOpenTransactionAgeMs: Math.max(0, ...transactions.map(t => t.connectionAgeLowerMs)),
    maxTransactionAgeWhileHoldingMs: Math.max(0, ...samples.flatMap(s => s.rows.filter(r => r.owns_advisory).map(r => Number(r.age_ms)))),
    maxAdvisoryHeldLowerMs: Math.max(0, ...transactions.map(t => t.heldLowerMs)),
    maxAdvisoryWaitLowerMs: Math.max(0, ...transactions.map(t => t.waitLowerMs)),
    transactions,
  };
}
