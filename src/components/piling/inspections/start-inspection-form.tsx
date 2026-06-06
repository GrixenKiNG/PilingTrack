'use client';

/**
 * StartInspectionForm — форма запуска нового осмотра (/inspections/new).
 *
 * Загружает список техники и шаблонов, формирует заявку на создание осмотра
 * (POST /api/inspections), затем переходит на страницу заполнения.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';

interface EquipmentOption {
  id: string;
  name: string;
  model: string | null;
}

interface TemplateOption {
  id: string;
  name: string;
  level: string;
  appliesToModel: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export function StartInspectionForm() {
  const router = useRouter();

  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [equipmentId, setEquipmentId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [inspectionDate, setInspectionDate] = useState(today());
  const [shift, setShift] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eqRes, tplRes] = await Promise.all([
        authFetch('/api/equipment?limit=100'),
        authFetch('/api/checklist-templates?level=EO'),
      ]);
      if (eqRes.ok) setEquipment(((await eqRes.json()).data ?? []) as EquipmentOption[]);
      if (tplRes.ok) setTemplates(((await tplRes.json()).templates ?? []) as TemplateOption[]);
    } catch {
      toast.error('Не удалось загрузить справочники');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Reset template when equipment changes
  useEffect(() => { setTemplateId(''); }, [equipmentId]);

  const selectedEquipment = equipment.find((e) => e.id === equipmentId) ?? null;

  // Templates sorted: matching model first, then the rest
  const sortedTemplates = [...templates].sort((a, b) => {
    const modelMatch = selectedEquipment?.model;
    const aMatch = modelMatch && a.appliesToModel === modelMatch ? -1 : 0;
    const bMatch = modelMatch && b.appliesToModel === modelMatch ? -1 : 0;
    return aMatch - bMatch;
  });

  const submit = async () => {
    if (!equipmentId) { toast.error('Выберите установку'); return; }
    if (!templateId) { toast.error('Выберите шаблон осмотра'); return; }
    if (!inspectionDate) { toast.error('Укажите дату'); return; }
    setBusy(true);
    try {
      const res = await authFetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId,
          templateId,
          inspectionDate,
          shift: shift || undefined,
          engineHours: engineHours ? Number(engineHours) : undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Ошибка создания осмотра');
      }
      const { inspection } = await res.json();
      router.push(`/inspections/${inspection.id}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6">
      <div className="mb-5 flex items-center gap-2">
        <Link
          href="/inspections"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Осмотры
        </Link>
      </div>

      <h1 className="mb-5 text-lg font-semibold text-slate-800">Провести осмотр</h1>

      {loading ? (
        <p className="rounded-lg bg-slate-50 px-3 py-6 text-center text-sm text-slate-400">Загрузка…</p>
      ) : (
        <div className="space-y-4">
          <div>
            <Label htmlFor="si-equipment">Установка *</Label>
            <Select value={equipmentId} onValueChange={setEquipmentId}>
              <SelectTrigger id="si-equipment">
                <SelectValue placeholder="Выберите установку" />
              </SelectTrigger>
              <SelectContent>
                {equipment.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}{e.model ? ` (${e.model})` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="si-template">Шаблон осмотра *</Label>
            <Select value={templateId} onValueChange={setTemplateId} disabled={!equipmentId}>
              <SelectTrigger id="si-template">
                <SelectValue placeholder={equipmentId ? 'Выберите шаблон' : 'Сначала выберите установку'} />
              </SelectTrigger>
              <SelectContent>
                {sortedTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                    {selectedEquipment?.model && t.appliesToModel === selectedEquipment.model
                      ? ' ★'
                      : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="si-date">Дата *</Label>
              <Input
                id="si-date"
                type="date"
                value={inspectionDate}
                onChange={(e) => setInspectionDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="si-shift">Смена</Label>
              <Select value={shift || '__none__'} onValueChange={(v) => setShift(v === '__none__' ? '' : v)}>
                <SelectTrigger id="si-shift">
                  <SelectValue placeholder="— не указана —" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— не указана —</SelectItem>
                  <SelectItem value="День">День</SelectItem>
                  <SelectItem value="Ночь">Ночь</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="si-hours">Моточасы</Label>
            <Input
              id="si-hours"
              type="number"
              min={0}
              placeholder="Необязательно"
              value={engineHours}
              onChange={(e) => setEngineHours(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              variant="outline"
              asChild
              disabled={busy}
            >
              <Link href="/inspections">Отмена</Link>
            </Button>
            <Button
              onClick={submit}
              disabled={busy || loading}
              className="bg-orange-500 hover:bg-orange-600 text-white flex-1"
            >
              {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Начать осмотр
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
