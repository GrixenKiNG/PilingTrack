import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

// Execute the actual seed configuration prefix, stopping before any DB work.
// Inject only the wall clock; no Prisma, SQL or application service is mocked.
const source = fs.readFileSync('output/perf-1023/seed.mjs', 'utf8');
const prefix = source.split('const url = new URL(')[0].replace(/^import .*;\r?\n/gm, '');
const configure = new Function('Date', 'process', 'readFileSync', `${prefix}\nreturn config;`);
const capture = JSON.parse(fs.readFileSync('output/perf-1023/config-x20.json', 'utf8'));
const reportQuery = JSON.parse(fs.readFileSync('output/perf-1023/queries-x20-getFleetSnapshot.json', 'utf8'))
  .find(q => q.query.includes('FROM "public"."Report"'));
const cutoff = JSON.parse(reportQuery.params).find(p => typeof p === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p));
assert.equal(cutoff, new Date(new Date(capture.today + 'T12:00:00Z').getTime() - 7 * 86400000).toISOString().slice(0, 10));
const nextDay = new Date(new Date(capture.today + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10);
const expectedReports = capture.equipment * Math.min(capture.days, 8);
function configuration(day, replay = true, env = {}, stored = capture) {
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [`${day}T12:00:00Z`])); }
    static now() { return new Date(`${day}T12:00:00Z`).getTime(); }
  }
  return configure(Clock, { argv: ['node', 'seed.mjs', '20', ...(replay ? ['explain-replay'] : [])], env }, () => JSON.stringify(stored));
}
function fleetReportCount(config) {
  let days = 0;
  for (let d = 0; d < config.days; d++) {
    const date = new Date(new Date(config.today + 'T12:00:00Z').getTime() - d * 86400000).toISOString().slice(0, 10);
    if (date >= cutoff) days++;
  }
  return days * config.equipment;
}
test('replay on capture day matches stored fixture date and report set', () => {
  const config = configuration(capture.today);
  assert.equal(config.today, capture.today);
  assert.equal(fleetReportCount(config), expectedReports);
});
test('replay next day keeps capture date and the captured report set', () => {
  const config = configuration(nextDay);
  assert.equal(config.today, capture.today);
  assert.equal(config.dateFrom, capture.dateFrom);
  assert.equal(fleetReportCount(config), expectedReports);
});
test('replay uses captured dimensions despite unrelated current seed environment', () => {
  const config = configuration(nextDay, true, { PERF_BASE_EQUIPMENT: '7', PERF_HISTORY_DAYS: '45' });
  for (const field of ['equipment', 'sites', 'days', 'pilesPerReport', 'photosPerEquipment']) assert.equal(config[field], capture[field]);
});
test('normal benchmark seed still follows today', () => {
  assert.equal(configuration(nextDay, false).today, nextDay);
});
test('invalid captured date range fails before any database work', () => {
  assert.throws(() => configuration('2026-10-24', true, {}, { ...capture, dateFrom: '2026-09-01' }), /Replay date range mismatch/);
});
test('invalid captured fixture dimensions fail before any database work', () => {
  assert.throws(() => configuration('2026-10-24', true, {}, { ...capture, equipment: 999999 }), /Invalid replay equipment/);
});
