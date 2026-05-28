/**
 * EquipmentDocument CRUD.
 *
 * Tenant comes from the acting user via ctx.tenantId. Equipment existence checks
 * are scoped to the same tenant to prevent cross-tenant document attachment (IDOR fix).
 */

import { db } from '@/lib/db';
import { ServiceError } from '@/services/service-error';

export type EquipmentDocumentType =
  | 'PASSPORT' | 'OTS' | 'INSURANCE' | 'INSPECTION'
  | 'CERTIFICATE' | 'MAINTENANCE_LOG' | 'OTHER';

export interface EquipmentDocumentInput {
  type: EquipmentDocumentType;
  title: string;
  issuedAt?: string | Date | null;
  expiresAt?: string | Date | null;
  notes?: string;
  mediaId?: string | null;
}

const toDate = (v: string | Date | null | undefined): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

export async function createEquipmentDocument(
  equipmentId: string,
  input: EquipmentDocumentInput,
  ctx: { tenantId: string },
) {
  const equipment = await db.equipment.findUnique({
    where: { id: equipmentId, tenantId: ctx.tenantId },
    select: { id: true },
  });
  if (!equipment) throw new ServiceError('Equipment not found', 404);

  return db.equipmentDocument.create({
    data: {
      tenantId: ctx.tenantId,
      equipmentId: equipment.id,
      type: input.type,
      title: input.title.trim(),
      issuedAt: toDate(input.issuedAt),
      expiresAt: toDate(input.expiresAt),
      notes: input.notes?.trim() ?? '',
      mediaId: input.mediaId || null,
    },
  });
}

export async function updateEquipmentDocument(
  equipmentId: string,
  documentId: string,
  input: Partial<EquipmentDocumentInput>,
  ctx: { tenantId: string },
) {
  const doc = await db.equipmentDocument.findUnique({
    where: { id: documentId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!doc || doc.equipmentId !== equipmentId || doc.tenantId !== ctx.tenantId) {
    throw new ServiceError('Document not found', 404);
  }

  const data: Record<string, unknown> = {};
  if (input.type !== undefined) data.type = input.type;
  if (input.title !== undefined) data.title = input.title.trim();
  if (input.issuedAt !== undefined) data.issuedAt = toDate(input.issuedAt);
  if (input.expiresAt !== undefined) data.expiresAt = toDate(input.expiresAt);
  if (input.notes !== undefined) data.notes = input.notes?.trim() ?? '';
  if (input.mediaId !== undefined) data.mediaId = input.mediaId || null;

  return db.equipmentDocument.update({ where: { id: documentId }, data });
}

export async function deleteEquipmentDocument(
  equipmentId: string,
  documentId: string,
  ctx: { tenantId: string },
) {
  const doc = await db.equipmentDocument.findUnique({
    where: { id: documentId },
    select: { id: true, equipmentId: true, tenantId: true },
  });
  if (!doc || doc.equipmentId !== equipmentId || doc.tenantId !== ctx.tenantId) {
    throw new ServiceError('Document not found', 404);
  }
  await db.equipmentDocument.delete({ where: { id: documentId } });
}
