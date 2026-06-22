'use client';

/**
 * StartInspectionForm — запуск ЕО/ТО (/inspections/new).
 *
 * Пользователь выбирает установку и уровень (ЕО/ТО-1/2/3/сезонное); чек-лист
 * собирается сервером из блоков (БАЗА + МОЛОТ + ВРАЩАТЕЛЬ) по атрибутам машины.
 * Показывает предпросмотр состава блоков. Создаёт запись ТО + осмотр и переходит
 * на страницу заполнения.
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Layers, Hammer, RotateCw, ShoppingCart, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { LEVEL_LABEL, type InspectionLevel } from './inspection-labels';
import { getConsumables } from '@/modules/inspections/domain/consumables';
import { LubricationMap } from './lubrication-map';

type HammerKind = 'HYDRAULIC' | 'DIESEL' | 'NONE';

interface EquipmentOption {
  id: string;
  name: string;
  model: string | null;
  hammerKind: HammerKind;
  isCombined: boolean;
}

interface TemplateLite {
  blockType: 'BASE' | 'HAMMER' | 'ROTARY';
  appliesToModel: string | null;
  appliesToHammerKind: HammerKind | null;
}

const HAMMER_LABEL: Record<HammerKind, string> = {
  HYDRAULIC: 'Гидравлический',
  DIESEL: 'Дизельный',
  NONE: 'Нет',
};

const today = () => new Date().toISOString().slice(0, 10);

export function StartInspectionForm() {
  const router = useRouter();

  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [templates, setTemplates] = useState<TemplateLite[]>([]);
  const [loading, setLoading] = useState(true);

  const [equipmentId, setEquipmentId] = useState('');
  const [level, setLevel] = useState<InspectionLevel>('EO');
  const [inspectionDate, setInspectionDate] = useState(today());
  const [shift, setShift] = useState('');
  const [engineHours, setEngineHours] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const eqRes = await authFetch('/api/equipment?limit=100');
      if (eqRes.ok) setEquipment(((await eqRes.json()).data ?? []) as EquipmentOption[]);
    } catch {
      toast.error('Не удалось загрузить технику');
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
  useEffect(() => { void load(); }, [load]);

  // Load templates for the chosen level to show which blocks really exist.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await authFetch(`/api/checklist-templates?level=${level}`);
        if (res.ok && active) setTemplates(((await res.json()).templates ?? []) as TemplateLite[]);
      } catch { /* preview only */ }
    })();
    return () => { active = false; };
  }, [level]);

  const selected = equipment.find((e) => e.id === equipmentId) ?? null;

  const hasBase = !!selected && templates.some(
    (t) => t.blockType === 'BASE' && (t.appliesToModel === selected.model || !t.appliesToModel),
  );
  const hasHammer = !!selected && templates.some(
    (t) => t.blockType === 'HAMMER' && t.appliesToHammerKind === selected.hammerKind,
  );
  const hasRotary = templates.some((t) => t.blockType === 'ROTARY');

  // Which blocks the server will assemble, and whether a template exists for each.
  const blocks = selected
    ? [
        { key: 'BASE', label: `База · ${selected.model || selected.name}`, icon: Layers, show: true, ok: hasBase },
        { key: 'HAMMER', label: `Молот · ${HAMMER_LABEL[selected.hammerKind].toLowerCase()}`, icon: Hammer, show: selected.hammerKind !== 'NONE', ok: hasHammer },
        { key: 'ROTARY', label: 'Вращатель', icon: RotateCw, show: selected.isCombined, ok: hasRotary },
      ].filter((b) => b.show)
    : [];

  // Расходники к заказу для выбранной модели и уровня ТО: база + молот + вращатель.
  const consumables = selected
    ? getConsumables(selected.model, level, { hammerKind: selected.hammerKind, isCombined: selected.isCombined })
    : [];

  const copyConsumables = async () => {
    const text = [
      `Расходники к ТО (${LEVEL_LABEL[level]}) — ${selected?.name ?? ''}${selected?.model ? ` (${selected.model})` : ''}`,
      ...consumables.map((c) => `• ${c.name} — ${c.marking} — ${c.qty}${c.note ? ` (${c.note})` : ''}`),
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Список расходников скопирован');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const submit = async () => {
    if (!equipmentId) { toast.error('Выберите установку'); return; }
    if (!inspectionDate) { toast.error('Укажите дату'); return; }
    setBusy(true);
    try {
      const res = await authFetch('/api/inspections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          equipmentId,
          level,
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
        <Link href="/inspections" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700">
          <ArrowLeft className="w-3.5 h-3.5" /> Осмотры
        </Link>
      </div>

      <h1 className="mb-5 text-lg font-semibold text-slate-800">Провести осмотр / ТО</h1>

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
            <Label htmlFor="si-level">Уровень *</Label>
            <Select value={level} onValueChange={(v) => setLevel(v as InspectionLevel)}>
              <SelectTrigger id="si-level"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(LEVEL_LABEL) as InspectionLevel[]).map((k) => (
                  <SelectItem key={k} value={k}>{LEVEL_LABEL[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Block composition preview */}
          {selected && (
            <div className="rounded-lg border bg-slate-50 p-3">
              <div className="mb-2 text-xs font-medium text-slate-500">Чек-лист соберётся из блоков:</div>
              <div className="space-y-1.5">
                {blocks.map((b) => (
                  <div key={b.key} className="flex items-center gap-2 rounded-md bg-white px-2.5 py-1.5 text-sm">
                    <b.icon className="w-3.5 h-3.5 text-orange-500" />
                    <span className="flex-1">{b.label}</span>
                    {b.ok
                      ? <span className="text-2xs text-emerald-600">✓ шаблон есть</span>
                      : <span className="text-2xs text-rose-600">нет шаблона</span>}
                  </div>
                ))}
              </div>
              {!hasBase && (
                <p className="mt-2 rounded bg-rose-50 px-2 py-1.5 text-2xs text-rose-700">
                  Нет блока «База» для модели «{selected.model || '—'}». Создайте его в разделе{' '}
                  <Link href="/admin/checklists" className="underline">Чек-листы</Link>{' '}
                  (тип «База», применимость «{selected.model || '—'}» или без модели — общий для всех).
                </p>
              )}
              <p className="mt-2 text-2xs text-slate-400">
                Молот: {HAMMER_LABEL[selected.hammerKind]} · {selected.isCombined ? 'комбинированная (есть вращатель)' : 'без вращателя'}.
                Атрибуты меняются в карточке техники.
              </p>
            </div>
          )}

          {/* Расходники к заказу (для уровней ТО) */}
          {selected && consumables.length > 0 && (
            <div className="rounded-lg border border-teal-200 bg-teal-50/60 p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-teal-800">
                  <ShoppingCart className="h-4 w-4" /> Заказать перед ТО
                </div>
                <Button type="button" variant="outline" size="sm" onClick={copyConsumables} className="h-7 gap-1 px-2 text-xs">
                  <Copy className="h-3 w-3" /> Скопировать
                </Button>
              </div>
              <div className="overflow-hidden rounded-md border border-teal-100 bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-2xs uppercase tracking-wide text-slate-400">
                      <th className="px-2 py-1.5 font-medium">Материал</th>
                      <th className="px-2 py-1.5 font-medium">Маркировка</th>
                      <th className="px-2 py-1.5 font-medium">Кол-во</th>
                    </tr>
                  </thead>
                  <tbody>
                    {consumables.map((c, i) => (
                      <tr key={i} className="border-t border-slate-100 align-top">
                        <td className="px-2 py-1.5 text-slate-800">
                          {c.name}
                          {c.note && <span className="block text-2xs text-slate-400">{c.note}</span>}
                        </td>
                        <td className="px-2 py-1.5 font-medium text-teal-700">{c.marking}</td>
                        <td className="whitespace-nowrap px-2 py-1.5 font-semibold text-slate-900">{c.qty}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-2xs text-slate-400">
                Полный комплект расходников (база + молот + вращатель) — механик отмечает нужное при заказе. Интервал каждой позиции — в примечании. Где марка/объём не заданы производителем — «по руководству».
              </p>
            </div>
          )}

          {/* Карта смазки (если для модели есть) */}
          {selected && <LubricationMap model={selected.model} />}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="si-date">Дата *</Label>
              <Input id="si-date" type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="si-shift">Смена</Label>
              <Select value={shift || '__none__'} onValueChange={(v) => setShift(v === '__none__' ? '' : v)}>
                <SelectTrigger id="si-shift"><SelectValue placeholder="— не указана —" /></SelectTrigger>
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
            <Input id="si-hours" type="number" min={0} placeholder="Необязательно" value={engineHours} onChange={(e) => setEngineHours(e.target.value)} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" asChild disabled={busy}>
              <Link href="/inspections">Отмена</Link>
            </Button>
            <Button onClick={submit} disabled={busy || loading || (!!selected && !hasBase)} className="bg-orange-500 hover:bg-orange-600 text-white flex-1">
              {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              Начать осмотр
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
