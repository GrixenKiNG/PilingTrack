'use client';

import {useRef, useState} from 'react';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction, PhotoEvidence} from '../api/contracts';
import {PhotoForm, type OperatorEvidenceEntityType} from './photo-form';

const signs = [
  ['LEAK', 'Утечка'], ['PRESSURE_LOSS', 'Потеря давления'],
  ['PROTECTIVE_SYSTEM_FAILURE', 'Отказ защитной системы'], ['SMOKE', 'Дым'],
  ['ODOR', 'Запах'], ['UNUSUAL_NOISE', 'Необычный шум'],
  ['UNCONTROLLED_MOVEMENT', 'Самопроизвольное движение'], ['EMERGENCY_STOP', 'Аварийная остановка'],
  ['OTHER', 'Другой признак'],
] as const;

export interface DefectFormProps {
  action: OperatorAction;
  commandId?: string;
  busy: boolean;
  initialEvidence?: PhotoEvidence[];
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  upload?: (file: File) => Promise<PhotoEvidence>;
}

export function DefectForm({action, commandId, busy, initialEvidence = [], onCancel, onSubmit, upload}: DefectFormProps) {
  const [node, setNode] = useState('');
  const [description, setDescription] = useState('');
  const [observedSigns, setObservedSigns] = useState<string[]>([]);
  const [safeStopApplied, setSafeStopApplied] = useState(false);
  const [evidence, setEvidence] = useState(initialEvidence);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoRequired = action.requiresEvidence.some((item) => item.toLocaleLowerCase('ru').includes('фотограф'));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!node.trim() || !description.trim() || observedSigns.length === 0) {
      setError('Укажите узел, наблюдаемое состояние и хотя бы один признак');
      return;
    }
    if (photoRequired && evidence.length === 0) {
      setError('Добавьте обязательную фотографию');
      photoRef.current?.focus();
      return;
    }
    setError(null);
    onSubmit({node: node.trim(), description: description.trim(), observedSigns, safeStopApplied, evidenceMediaIds: evidence.map((item) => item.mediaId)});
  };

  const entityType: OperatorEvidenceEntityType = 'equipment_defect';
  return <form className="space-y-5" onSubmit={submit} noValidate>
    <div className="space-y-2"><Label htmlFor="defect-node">Узел установки</Label><Input id="defect-node" value={node} onChange={(event) => setNode(event.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="defect-description">Что наблюдается</Label><Textarea id="defect-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={3} /></div>
    <fieldset className="space-y-3"><legend className="text-sm font-medium">Наблюдаемые признаки</legend><div className="grid gap-3 sm:grid-cols-2">{signs.map(([code, label]) => <label key={code} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm"><Checkbox checked={observedSigns.includes(code)} onCheckedChange={(checked) => setObservedSigns((current) => checked ? [...current, code] : current.filter((item) => item !== code))} />{label}</label>)}</div></fieldset>
    <label className="flex min-h-11 items-center gap-3 text-sm"><Checkbox checked={safeStopApplied} onCheckedChange={(checked) => setSafeStopApplied(checked === true)} />Установка уже безопасно остановлена</label>
    <PhotoForm ref={photoRef} label="Фотография доказательства" required={photoRequired} value={evidence} onChange={setEvidence} upload={upload} entityType={entityType} entityId={commandId} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={onCancel}>Отмена</Button><Button type="submit" disabled={busy}>{busy ? 'Сохраняем дефект' : 'Сохранить дефект'}</Button></div>
  </form>;
}
