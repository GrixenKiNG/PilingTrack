import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { listTemplates, createTemplate } from '@/modules/inspections';
import { withApi, withMutation } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';

export const runtime = 'nodejs';

const levelEnum = z.enum(['EO', 'TO1', 'TO2', 'TO3', 'SEASONAL']);
const blockEnum = z.enum(['BASE', 'HAMMER', 'ROTARY']);
const hammerEnum = z.enum(['HYDRAULIC', 'DIESEL', 'NONE']);
const answerEnum = z.enum(['YES_NO', 'STATUS4', 'DONE', 'MEASURE']);
const itemSchema = z.object({
  text: z.string().trim().min(1).max(500),
  answerType: answerEnum,
  unit: z.string().max(40).optional().nullable(),
  norm: z.string().max(300).optional().nullable(),
  provenance: z.string().max(120).optional().nullable(),
  photoRequired: z.boolean().default(false),
  required: z.boolean().default(true),
  order: z.number().int().min(0),
});
const sectionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  order: z.number().int().min(0),
  items: z.array(itemSchema),
});
const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  level: levelEnum,
  blockType: blockEnum.default('BASE'),
  appliesToModel: z.string().max(120).optional().nullable(),
  appliesToHammerKind: hammerEnum.optional().nullable(),
  sections: z.array(sectionSchema),
});

export const GET = withApi(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID ?? '';
    const level = request.nextUrl.searchParams.get('level') as never;
    const templates = await listTemplates(tenantId, level ? { level } : {});
    return NextResponse.json({ templates });
  },
  { domain: 'inspections' }
);

export const POST = withMutation(
  async (request: NextRequest) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    assertCan(user!, 'maintenance.manage');
    const tenantId = user!.tenantId ?? process.env.DEFAULT_TENANT_ID;
    if (!tenantId) return NextResponse.json({ error: 'Tenant context missing' }, { status: 400 });
    const parsed = createSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }
    try {
      const template = await createTemplate(parsed.data, { tenantId, createdById: user!.id });
      return NextResponse.json({ template }, { status: 201 });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'inspections' }
);
