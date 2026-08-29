'use client';

import {useRef, useState} from 'react';
import {Alert, AlertDescription, AlertTitle} from '@/components/ui/alert';
import {Button} from '@/components/ui/button';
import {Checkbox} from '@/components/ui/checkbox';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {Textarea} from '@/components/ui/textarea';
import type {OperatorAction, PhotoEvidence} from '../api/contracts';
import {PhotoForm} from './photo-form';

const incidentSigns = [
  ['LEAK', 'Утечка'], ['PRESSURE_LOSS', 'Потеря давления'],
  ['PROTECTIVE_SYSTEM_FAILURE', 'Отказ защитной системы'], ['SMOKE', 'Дым'],
  ['ODOR', 'Запах'], ['UNUSUAL_NOISE', 'Необычный шум'],
  ['UNCONTROLLED_MOVEMENT', 'Самопроизвольное движение'], ['EMERGENCY_STOP', 'Аварийная остановка'],
  ['OTHER', 'Другой наблюдаемый признак'],
] as const;

export interface SafetyIncidentFormProps {
  action: OperatorAction;
  commandId?: string;
  busy: boolean;
  initialEvidence?: PhotoEvidence[];
  onCancel: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
  upload?: (file: File) => Promise<PhotoEvidence>;
}

export function SafetyIncidentForm({action, commandId, busy, initialEvidence = [], onCancel, onSubmit, upload}: SafetyIncidentFormProps) {
  const [category, setCategory] = useState('TECHNICAL_HAZARD');
  const [description, setDescription] = useState('');
  const [observedSigns, setObservedSigns] = useState<string[]>([]);
  const [injuredAnswer, setInjuredAnswer] = useState('');
  const [emergencyStopAnswer, setEmergencyStopAnswer] = useState('');
  const [safeStateDescription, setSafeStateDescription] = useState('');
  const [location, setLocation] = useState('');
  const [evidence, setEvidence] = useState(initialEvidence);
  const [error, setError] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);
  const photoRequired = action.requiresEvidence.some((item) => item.toLocaleLowerCase('ru').includes('фотограф'));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!description.trim() || observedSigns.length === 0) { setError('Опишите событие и выберите хотя бы один наблюдаемый признак'); return; }
    if (!injuredAnswer || !emergencyStopAnswer) { setError('Ответьте, есть ли пострадавшие и применена ли аварийная остановка'); return; }
    if (photoRequired && evidence.length === 0) { setError('Добавьте обязательную фотографию'); photoRef.current?.focus(); return; }
    setError(null);
    onSubmit({category, description: description.trim(), observedSigns, injured: injuredAnswer === 'YES', emergencyStopApplied: emergencyStopAnswer === 'YES', safeStateDescription: safeStateDescription.trim() || undefined, evidenceMediaIds: evidence.map((item) => item.mediaId), location: location.trim() || undefined});
  };

  return <form className="space-y-5" onSubmit={submit} noValidate>
    <Alert variant="destructive"><AlertTitle>Сначала обеспечьте безопасность людей</AlertTitle><AlertDescription>При угрозе немедленно остановите установку, предупредите находящихся рядом и следуйте аварийному порядку объекта. Заполнить сведения можно после безопасных действий.</AlertDescription></Alert>
    <div className="space-y-2"><Label htmlFor="incident-category">Категория события</Label><select id="incident-category" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={category} onChange={(event) => setCategory(event.target.value)}><option value="TECHNICAL_HAZARD">Техническая опасность</option><option value="PEOPLE">Событие с человеком</option><option value="WORKSITE">Рабочая зона</option><option value="ORGANIZATION">Организация работ</option><option value="EQUIPMENT_DEFECT">Дефект установки</option><option value="OTHER">Другое</option></select></div>
    <div className="space-y-2"><Label htmlFor="incident-description">Что произошло</Label><Textarea id="incident-description" value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></div>
    <fieldset className="space-y-3"><legend className="text-sm font-medium">Наблюдаемые признаки</legend><div className="grid gap-3 sm:grid-cols-2">{incidentSigns.map(([code, label]) => <label key={code} className="flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm"><Checkbox checked={observedSigns.includes(code)} onCheckedChange={(checked) => setObservedSigns((current) => checked ? [...current, code] : current.filter((item) => item !== code))} />{label}</label>)}</div></fieldset>
    <div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="incident-injured">Есть ли пострадавшие</Label><select id="incident-injured" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={injuredAnswer} onChange={(event) => setInjuredAnswer(event.target.value)}><option value="">Выберите ответ</option><option value="NO">Нет</option><option value="YES">Да</option></select></div><div className="space-y-2"><Label htmlFor="incident-emergency-stop">Применена ли аварийная остановка</Label><select id="incident-emergency-stop" className="flex min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={emergencyStopAnswer} onChange={(event) => setEmergencyStopAnswer(event.target.value)}><option value="">Выберите ответ</option><option value="NO">Нет</option><option value="YES">Да</option></select></div></div>
    <div className="space-y-2"><Label htmlFor="incident-safe-state">Текущее безопасное состояние</Label><Textarea id="incident-safe-state" value={safeStateDescription} onChange={(event) => setSafeStateDescription(event.target.value)} rows={2} /></div>
    <div className="space-y-2"><Label htmlFor="incident-location">Место события</Label><Input id="incident-location" value={location} onChange={(event) => setLocation(event.target.value)} /></div>
    <PhotoForm ref={photoRef} label="Фотография доказательства" required={photoRequired} value={evidence} onChange={setEvidence} upload={upload} entityType="safety_incident" entityId={commandId} />
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button type="button" variant="outline" onClick={onCancel}>Отмена</Button><Button type="submit" variant="destructive" disabled={busy}>{busy ? 'Сохраняем событие' : 'Сохранить опасное событие'}</Button></div>
  </form>;
}
