import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSamples} from './measurements.mjs';

test('10s preceding wait is not counted as the following 5s advisory hold', () => {
  const samples = Array.from({length: 17}, (_, i) => ({at: i * 1000, rows: i === 16 ? [] : [{
    pid: 1, xact_start_ms: '0', observed_ms: String(i * 1000), age_ms: String(i * 1000),
    state: i < 10 ? 'active' : 'idle in transaction', wait_event: i < 10 ? 'advisory' : 'ClientRead',
    owns_advisory: i >= 10,
  }]}));
  const result = summarizeSamples(samples);
  assert.equal(result.maxTransactionAgeWhileHoldingMs, 15000);
  assert.equal(result.maxAdvisoryHeldLowerMs, 5000);
  assert.equal(result.maxAdvisoryWaitLowerMs, 9000);
  assert.equal(result.transactions.length, 1);
});
test('reused backend PID with a new xact_start remains two transactions', () => {
  const samples = [{at: 0, rows: [{pid: 1, xact_start_ms: '0', observed_ms: '0', age_ms: '0', owns_advisory: true}]},
    {at: 100, rows: []},
    {at: 200, rows: [{pid: 1, xact_start_ms: '200', observed_ms: '200', age_ms: '0', owns_advisory: true}]}];
  const result = summarizeSamples(samples);
  assert.equal(result.transactions.length, 2);
  assert.equal(result.maxAdvisoryHeldLowerMs, 0);
});
