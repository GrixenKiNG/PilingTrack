import { NextRequest, NextResponse } from 'next/server';
import { requireTenantId } from '@/lib/tenant';
import { z } from 'zod';
import { requireAuth } from '@/lib/auth';
import { assertCan } from '@/services/auth/authorization-service';
import { updateEquipmentDocument, deleteEquipmentDocument } from '@/modules/equipment';
import { withMutation, readJsonBody } from '@/core/api-wrapper';
import { ServiceError } from '@/services/service-error';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { recordAuditEvent } from '@/services/audit/audit-service';

export const runtime = 'nodejs';

const documentTypeEnum = z.enum([
  'PASSPORT', 'OTS', 'INSURANCE', 'INSPECTION',
  'CERTIFICATE', 'MAINTENANCE_LOG', 'OTHER',
]);

const emptyToUndef = (v: unknown) => (v === '' || v === null ? undefined : v);

const updateSchema = z.object({
  type: documentTypeEnum.optional(),
  title: z.string().trim().min(1).max(200).optional(),
  issuedAt:  z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  expiresAt: z.preprocess(emptyToUndef, z.coerce.date()).optional().nullable(),
  notes: z.string().max(2000).optional(),
  mediaId: z.string().optional().nullable(),
});

export const PUT = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');

    const { id, docId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const tenantId = requireTenantId(user!);
    const body = await readJsonBody(request);
    const parsed = updateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Некорректные данные', details: parsed.error.issues.map((e) => ({ field: e.path.join('.'), message: e.message })) },
        { status: 400 }
      );
    }

    try {
      const doc = await updateEquipmentDocument(id, docId, parsed.data, { tenantId });
      return NextResponse.json({ document: doc });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
  },
  { domain: 'equipment.documents' }
);

export const DELETE = withMutation(
  async (request: NextRequest, { params }: { params: Promise<{ id: string; docId: string }> }) => {
    const { user, error } = await requireAuth(request);
    if (error) return error;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    assertCan(user!, 'equipment.manage');

    const { id, docId } = await params;
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- non-null: requireAuth guarantees the user once the error guard above returned
    const actor = user!;
    const tenantId = requireTenantId(actor);

    // Снимок документа читается ДО удаления (F-R39-3): для проверок ОТ и
    // страхования важен сам факт, что документ прикладывали и до какого срока
    // он действовал, — после `delete` этого не восстановить. Строго по тенанту.
    const snapshot = await db.equipmentDocument.findFirst({
      where: { id: docId, equipmentId: id, tenantId },
      select: {
        type: true,
        title: true,
        expiresAt: true,
        equipment: { select: { name: true } },
      },
    });

    try {
      await deleteEquipmentDocument(id, docId, { tenantId });
    } catch (err) {
      if (err instanceof ServiceError) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }

    // Best-effort (F-R39-3): документ уже удалён — сбой записи следа не должен
    // превращать успешное удаление в 500 (как в reports/delete).
    try {
      await recordAuditEvent({
        action: 'equipment.document.deleted',
        scope: 'equipment',
        actorId: actor.id,
        targetId: docId,
        tenantId,
        metadata: snapshot
          ? {
              name: snapshot.equipment.name,
              before: {
                type: snapshot.type,
                title: snapshot.title,
                expiresAt: snapshot.expiresAt,
              },
            }
          : undefined,
      });
    } catch (err) {
      logger.error('Equipment document delete: audit write failed', err, { docId });
    }

    return NextResponse.json({ ok: true });
  },
  { domain: 'equipment.documents' }
);
