'use client';

import {forwardRef, useEffect, useRef, useState} from 'react';
import Image from 'next/image';
import {PilingIcon} from '@/components/piling/icons/piling-icon';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {authFetch} from '@/lib/api';
import type {PhotoEvidence} from '../api/contracts';

export type OperatorEvidenceEntityType = 'equipment_defect' | 'safety_incident';

interface UploadContext {
  entityType: OperatorEvidenceEntityType;
  entityId: string;
}

interface PresignResponse {mediaId?: unknown; uploadUrl?: unknown}

async function russianError(response: Response, fallback: string): Promise<Error> {
  const body = await response.json().catch(() => null) as {message?: unknown; error?: unknown} | null;
  const text = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
  return new Error(/[А-Яа-яЁё]/.test(text) ? text : fallback);
}

export async function uploadOperatorPhoto(file: File, context: UploadContext): Promise<PhotoEvidence> {
  if (!file.type.startsWith('image/')) throw new Error('Можно выбрать только изображение');
  if (file.size > 10 * 1024 * 1024) throw new Error('Размер фотографии не должен превышать 10 МБ');

  const presign = await authFetch('/api/media', {
    method: 'POST', headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({fileName: file.name, contentType: file.type, fileSize: file.size, ...context}),
  });
  if (!presign.ok) throw await russianError(presign, 'Не удалось подготовить загрузку фотографии');
  const prepared = await presign.json() as PresignResponse;
  if (typeof prepared.mediaId !== 'string' || typeof prepared.uploadUrl !== 'string') {
    throw new Error('Сервер не подтвердил подготовку фотографии');
  }

  const upload = await fetch(prepared.uploadUrl, {method: 'PUT', body: file, headers: {'Content-Type': file.type}});
  if (!upload.ok) throw new Error('Не удалось передать фотографию');
  const confirm = await authFetch(`/api/media/${prepared.mediaId}/confirm`, {method: 'POST'});
  if (!confirm.ok) throw await russianError(confirm, 'Не удалось подтвердить фотографию');
  return {mediaId: prepared.mediaId, fileName: file.name, contentType: file.type, size: file.size};
}

export interface PhotoFormProps {
  label: string;
  required?: boolean;
  value: PhotoEvidence[];
  onChange: (value: PhotoEvidence[]) => void;
  upload?: (file: File) => Promise<PhotoEvidence>;
  entityType?: OperatorEvidenceEntityType;
  entityId?: string;
}

export const PhotoForm = forwardRef<HTMLInputElement, PhotoFormProps>(function PhotoForm({
  label, required = false, value, onChange, upload, entityType, entityId,
}, forwardedRef) {
  const internalRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(value.length > 0 ? 'Фотография подтверждена' : null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const setInputRef = (node: HTMLInputElement | null) => {
    internalRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (!file.type.startsWith('image/')) { setStatus(null); setError('Можно выбрать только изображение'); return; }
    if (file.size > 10 * 1024 * 1024) { setStatus(null); setError('Размер фотографии не должен превышать 10 МБ'); return; }
    const uploader = upload ?? (entityType && entityId ? (candidate: File) => uploadOperatorPhoto(candidate, {entityType, entityId}) : null);
    if (!uploader) { setError('Не удалось подготовить фотографию к сохранению'); return; }
    setStatus('Фотография загружается');
    try {
      const evidence = await uploader(file);
      if (preview) URL.revokeObjectURL(preview);
      setPreview(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(file) : null);
      onChange([...value.filter((item) => item.mediaId !== evidence.mediaId), evidence]);
      setStatus('Фотография подтверждена');
    } catch (cause) {
      setStatus(null);
      setError(cause instanceof Error && /[А-Яа-яЁё]/.test(cause.message) ? cause.message : 'Не удалось загрузить фотографию');
    }
  };

  return <div className="space-y-2">
    <Label htmlFor="operator-v3-evidence-photo">{label}{required ? ' — обязательно' : ''}</Label>
    <Input ref={setInputRef} id="operator-v3-evidence-photo" aria-label={label} type="file" accept="image/*,.heic,.heif" required={required && value.length === 0} onChange={(event) => {
      const file = event.currentTarget.files?.[0];
      if (file) void handleFile(file);
    }} />
    {preview && <div className="overflow-hidden rounded-lg border bg-muted"><Image src={preview} alt="Предварительный просмотр фотографии" width={640} height={480} unoptimized className="max-h-48 w-full object-contain" /></div>}
    {status && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><PilingIcon name="camera" size={16} decorative />{status}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {value.map((item) => <p key={item.mediaId} className="text-xs text-muted-foreground">{item.fileName}</p>)}
  </div>;
});
