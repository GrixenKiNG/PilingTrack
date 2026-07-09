import { authFetch } from '@/lib/api';
import { validateEquipmentTileImageFile } from './equipment-tile-asset-storage';

/**
 * Uploads an equipment photo through the existing /api/media presign→PUT→confirm
 * flow, gated to ADMIN by assertCanAccessMediaEntity (entityType: 'equipment').
 */
export async function uploadEquipmentPhoto(file: File, equipmentId: string): Promise<void> {
  const err = validateEquipmentTileImageFile(file);
  if (err) throw new TypeError(err);

  const presign = await authFetch('/api/media', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
      entityType: 'equipment',
      entityId: equipmentId,
    }),
  });
  if (!presign.ok) throw new Error(`Не удалось начать загрузку (${presign.status})`);
  // media-service.getPresignedUrl() returns { mediaId, uploadUrl, expiresAt, key }
  const { mediaId, uploadUrl } = await presign.json();

  const put = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file });
  if (!put.ok) throw new Error('Загрузка в хранилище не удалась');

  const confirm = await authFetch(`/api/media/${mediaId}/confirm`, { method: 'POST' });
  if (!confirm.ok) throw new Error('Не удалось подтвердить загрузку');
}
