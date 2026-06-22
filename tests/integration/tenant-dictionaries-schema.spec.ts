import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const schemaPath = resolve(process.cwd(), 'prisma/schema.prisma');

function modelBlock(schema: string, model: string): string {
  const match = schema.match(new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`));
  if (!match?.[1]) throw new Error(`Model ${model} not found`);
  return match[1];
}

describe('tenant dictionary schema contract', () => {
  it.each(['PileGrade', 'DrillingType', 'DowntimeReason'])(
    '%s belongs to a tenant with normalized tenant-local uniqueness',
    async (model) => {
      const schema = await readFile(schemaPath, 'utf8');
      const block = modelBlock(schema, model);

      expect(block).toMatch(/tenantId\s+String\b/);
      expect(block).toMatch(/tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Cascade\)/);
      expect(block).toMatch(/normalizedName\s+String\b/);
      expect(block).toContain('@@unique([tenantId, normalizedName])');
      expect(block).toContain('@@index([tenantId, isActive])');
    }
  );

  it('keeps lengthMm as the only pile length source', async () => {
    const schema = await readFile(schemaPath, 'utf8');
    const block = modelBlock(schema, 'PileGrade');

    expect(block).toMatch(/lengthMm\s+Int\?/);
    expect(block).not.toContain('lengthMeters');
    expect(block).toMatch(/code\s+String\b/);
    expect(block).toMatch(/sectionOrDiameter\s+String\?/);
    expect(block).toMatch(/notes\s+String\s+@default\(""\)/);
  });
});
