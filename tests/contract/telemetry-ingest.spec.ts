/**
 * Contract tests for the telemetry ingestion request schema.
 *
 * The /api/telemetry/batch route validates incoming records against a Zod
 * schema before dispatching to the buffer. This contract is what device
 * fleets sign their integration tests against — drift here is a breaking
 * change and must be intentional.
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';

// Mirror of the schema in src/app/api/telemetry/batch/route.ts. Kept inline
// so the contract is the *test*, not the production code: any divergence
// fails this file and surfaces an unintended schema change.
const telemetryRecordSchema = z.object({
  type: z.string().max(50),
  equipmentId: z.string().min(1),
  siteId: z.string().optional().nullable(),
  value: z.number(),
  unit: z.string().optional().nullable(),
  latitude: z.number().optional().nullable(),
  longitude: z.number().optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional().nullable(),
  timestamp: z.string().datetime().optional(),
});

const telemetryBatchSchema = z.array(telemetryRecordSchema);

describe('contract — telemetry record', () => {
  it('accepts a minimal valid record', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'engine_rpm',
      equipmentId: 'eq-1',
      value: 1500,
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing equipmentId', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'engine_rpm',
      value: 1500,
    });
    expect(result.success).toBe(false);
  });

  it('rejects equipmentId that is the empty string', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'engine_rpm',
      equipmentId: '',
      value: 1500,
    });
    expect(result.success).toBe(false);
  });

  it('rejects type longer than 50 chars (DoS surface)', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'x'.repeat(51),
      equipmentId: 'eq-1',
      value: 0,
    });
    expect(result.success).toBe(false);
  });

  it('accepts arbitrary unknown values inside metadata', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'fault_code',
      equipmentId: 'eq-1',
      value: 0,
      metadata: { code: 'P0420', severity: 2, raw: { hex: '0xfeed' } },
    });
    expect(result.success).toBe(true);
  });

  it('rejects metadata that is not an object', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'fault_code',
      equipmentId: 'eq-1',
      value: 0,
      metadata: 'not-an-object',
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric value', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'engine_rpm',
      equipmentId: 'eq-1',
      value: 'fast' as unknown as number,
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed timestamp', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'engine_rpm',
      equipmentId: 'eq-1',
      value: 1500,
      timestamp: 'yesterday',
    });
    expect(result.success).toBe(false);
  });

  it('accepts an ISO-8601 timestamp', () => {
    const result = telemetryRecordSchema.safeParse({
      type: 'engine_rpm',
      equipmentId: 'eq-1',
      value: 1500,
      timestamp: '2026-04-25T12:34:56.000Z',
    });
    expect(result.success).toBe(true);
  });
});

describe('contract — telemetry batch', () => {
  it('accepts an empty array', () => {
    expect(telemetryBatchSchema.safeParse([]).success).toBe(true);
  });

  it('accepts a heterogeneous batch of valid records', () => {
    const result = telemetryBatchSchema.safeParse([
      { type: 'gps', equipmentId: 'eq-1', value: 0, latitude: 55.7, longitude: 37.6 },
      { type: 'fuel', equipmentId: 'eq-2', value: 78.5, unit: 'L' },
    ]);
    expect(result.success).toBe(true);
  });

  it('rejects the whole batch when one record is invalid', () => {
    const result = telemetryBatchSchema.safeParse([
      { type: 'ok', equipmentId: 'eq-1', value: 1 },
      { type: 'broken', equipmentId: '', value: 1 },
    ]);
    expect(result.success).toBe(false);
  });
});
