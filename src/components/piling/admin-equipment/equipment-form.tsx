'use client';

/**
 * Equipment form body — used inside both create and edit dialogs.
 * Three tabs follow the agreed template layout:
 *   Основное          → identification (A)
 *   Тех. характеристики → technical specs (B)
 *   Эксплуатация       → operation (C)
 *
 * All metadata fields are optional. Empty inputs serialize to `null`
 * in the payload so the server clears stale values instead of keeping
 * the previous string.
 */

import type { EquipmentKindDTO } from '@/lib/types';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';

export interface EquipmentFormState {
  // core
  name: string;
  model: string;
  description: string;
  isActive: boolean;
  // A
  inventoryNumber: string;
  registrationNumber: string;
  kind: EquipmentKindDTO;
  baseVehicle: string;
  serialNumber: string;
  manufactureYear: string; // text in the form, parsed on submit
  vin: string;
  // B
  weightTons: string;
  weightWithEquipmentTons: string;
  heightMm: string;
  lengthMm: string;
  widthMm: string;
  engineBrand: string;
  engineSerialNumber: string;
  enginePower: string;
  maxPileLength: string;
  maxDrillingDepth: string;
  hammerType: string;
  hammerSerialNumber: string;
  hammerEnergyKj: string;
  hammerKind: HammerKindDTO;   // подбор блока МОЛОТ чек-листа
  isCombined: boolean;         // есть вращатель → подбор блока ВРАЩАТЕЛЬ
  // C
  purchaseDate: string;        // YYYY-MM-DD
  purchasePrice: string;
  engineHoursTotal: string;
  nextMaintenanceAtHours: string;
  nextMaintenanceDate: string; // YYYY-MM-DD
  homeBaseLocation: string;
}

export const EMPTY_EQUIPMENT_FORM: EquipmentFormState = {
  name: '', model: '', description: '', isActive: true,
  inventoryNumber: '', registrationNumber: '', kind: 'OTHER', baseVehicle: '',
  serialNumber: '', manufactureYear: '', vin: '',
  weightTons: '', weightWithEquipmentTons: '',
  heightMm: '', lengthMm: '', widthMm: '',
  engineBrand: '', engineSerialNumber: '', enginePower: '',
  maxPileLength: '', maxDrillingDepth: '',
  hammerType: '', hammerSerialNumber: '', hammerEnergyKj: '',
  hammerKind: 'NONE', isCombined: false,
  purchaseDate: '', purchasePrice: '',
  engineHoursTotal: '', nextMaintenanceAtHours: '', nextMaintenanceDate: '',
  homeBaseLocation: '',
};

const KIND_LABELS: Record<EquipmentKindDTO, string> = {
  PILE_DRIVER: 'Забивной копёр',
  DRILLING_RIG: 'Буровая установка',
  VIBRO_HAMMER: 'Вибропогружатель',
  HYBRID: 'Гибрид (забивка + бурение)',
  OTHER: 'Другое',
};

type HammerKindDTO = 'HYDRAULIC' | 'DIESEL' | 'NONE';
const HAMMER_KIND_LABELS: Record<HammerKindDTO, string> = {
  HYDRAULIC: 'Гидравлический',
  DIESEL: 'Дизельный',
  NONE: 'Нет молота',
};

interface Props {
  state: EquipmentFormState;
  onChange: (patch: Partial<EquipmentFormState>) => void;
  /** When true, only the "Основное" tab is shown (used in create mode). */
  compact?: boolean;
}

export function EquipmentForm({ state, onChange, compact = false }: Props) {
  return (
    <Tabs defaultValue="basic" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="basic">Основное</TabsTrigger>
        <TabsTrigger value="tech" disabled={compact}>Тех. характеристики</TabsTrigger>
        <TabsTrigger value="ops" disabled={compact}>Эксплуатация</TabsTrigger>
      </TabsList>

      {/* ---------- Tab 1: identification + core ---------- */}
      <TabsContent value="basic" className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Название *" full>
            <Input
              value={state.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Например: Liebherr LRH 100 №1"
              className="h-11"
            />
          </Field>
          <Field label="Модель">
            <Input value={state.model} onChange={(e) => onChange({ model: e.target.value })} className="h-11" />
          </Field>
          <Field label="Тип машины">
            <Select value={state.kind} onValueChange={(v) => onChange({ kind: v as EquipmentKindDTO })}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABELS) as EquipmentKindDTO[]).map((k) => (
                  <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Инвентарный номер">
            <Input value={state.inventoryNumber} onChange={(e) => onChange({ inventoryNumber: e.target.value })} className="h-11" />
          </Field>
          <Field label="Госномер">
            <Input value={state.registrationNumber} onChange={(e) => onChange({ registrationNumber: e.target.value })} className="h-11" />
          </Field>
          <Field label="Базовая машина / носитель">
            <Input
              value={state.baseVehicle}
              onChange={(e) => onChange({ baseVehicle: e.target.value })}
              placeholder='напр. "Volvo EC360BLC"'
              className="h-11"
            />
          </Field>
          <Field label="Серийный номер">
            <Input value={state.serialNumber} onChange={(e) => onChange({ serialNumber: e.target.value })} className="h-11" />
          </Field>
          <Field label="Год выпуска">
            <Input
              type="number" min={1950} max={2100}
              value={state.manufactureYear}
              onChange={(e) => onChange({ manufactureYear: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="VIN">
            <Input value={state.vin} onChange={(e) => onChange({ vin: e.target.value })} className="h-11" />
          </Field>
          <Field label="Описание" full>
            <Textarea
              value={state.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Необязательное описание"
              className="min-h-[72px] resize-none"
            />
          </Field>
          <ActiveToggle value={state.isActive} onChange={(v) => onChange({ isActive: v })} />
        </div>
      </TabsContent>

      {/* ---------- Tab 2: technical specs ---------- */}
      <TabsContent value="tech" className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField label="Вес (т)" value={state.weightTons} onChange={(v) => onChange({ weightTons: v })} step="0.1" />
          <NumberField label="Вес с оборудованием (т)" value={state.weightWithEquipmentTons} onChange={(v) => onChange({ weightWithEquipmentTons: v })} step="0.1" />
          <SectionTitle>Габариты для логистики</SectionTitle>
          <NumberField label="Высота (мм)" value={state.heightMm} onChange={(v) => onChange({ heightMm: v })} step="1" />
          <NumberField label="Длина (мм)" value={state.lengthMm} onChange={(v) => onChange({ lengthMm: v })} step="1" />
          <NumberField label="Ширина (мм)" value={state.widthMm} onChange={(v) => onChange({ widthMm: v })} step="1" />
          <SectionTitle>Двигатель</SectionTitle>
          <Field label="Марка двигателя">
            <Input value={state.engineBrand} onChange={(e) => onChange({ engineBrand: e.target.value })} className="h-11" />
          </Field>
          <Field label="Номер двигателя">
            <Input value={state.engineSerialNumber} onChange={(e) => onChange({ engineSerialNumber: e.target.value })} className="h-11" />
          </Field>
          <NumberField label="Мощность двигателя (кВт)" value={state.enginePower} onChange={(v) => onChange({ enginePower: v })} step="1" />
          <SectionTitle>Свайные / буровые параметры</SectionTitle>
          <NumberField label="Макс. длина сваи (м)" value={state.maxPileLength} onChange={(v) => onChange({ maxPileLength: v })} step="0.1" />
          <NumberField label="Макс. глубина бурения (м)" value={state.maxDrillingDepth} onChange={(v) => onChange({ maxDrillingDepth: v })} step="0.1" />
          <SectionTitle>Молот</SectionTitle>
          <Field label="Вид молота (для чек-листа)">
            <Select value={state.hammerKind} onValueChange={(v) => onChange({ hammerKind: v as HammerKindDTO })}>
              <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(HAMMER_KIND_LABELS) as HammerKindDTO[]).map((k) => (
                  <SelectItem key={k} value={k}>{HAMMER_KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Комбинированная (есть вращатель)">
            <label className="flex h-11 cursor-pointer items-center gap-2 text-sm select-none">
              <input
                type="checkbox"
                checked={state.isCombined}
                onChange={(e) => onChange({ isCombined: e.target.checked })}
                className="h-4 w-4 rounded"
              />
              Да, добавлять блок вращателя
            </label>
          </Field>
          <Field label="Тип молота">
            <Input value={state.hammerType} onChange={(e) => onChange({ hammerType: e.target.value })} placeholder='напр. "Junttan HHK-5/7"' className="h-11" />
          </Field>
          <Field label="Серийник молота">
            <Input value={state.hammerSerialNumber} onChange={(e) => onChange({ hammerSerialNumber: e.target.value })} className="h-11" />
          </Field>
          <NumberField label="Энергия удара (кДж)" value={state.hammerEnergyKj} onChange={(v) => onChange({ hammerEnergyKj: v })} step="0.1" />
        </div>
      </TabsContent>

      {/* ---------- Tab 3: operation ---------- */}
      <TabsContent value="ops" className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Дата покупки">
            <Input type="date" value={state.purchaseDate} onChange={(e) => onChange({ purchaseDate: e.target.value })} className="h-11" />
          </Field>
          <NumberField label="Стоимость покупки (₽)" value={state.purchasePrice} onChange={(v) => onChange({ purchasePrice: v })} step="0.01" />
          <NumberField label="Наработка моточасов" value={state.engineHoursTotal} onChange={(v) => onChange({ engineHoursTotal: v })} step="1" />
          <NumberField label="След. ТО по моточасам" value={state.nextMaintenanceAtHours} onChange={(v) => onChange({ nextMaintenanceAtHours: v })} step="1" />
          <Field label="След. ТО по дате">
            <Input type="date" value={state.nextMaintenanceDate} onChange={(e) => onChange({ nextMaintenanceDate: e.target.value })} className="h-11" />
          </Field>
          <Field label="Место базирования">
            <Input value={state.homeBaseLocation} onChange={(e) => onChange({ homeBaseLocation: e.target.value })} className="h-11" />
          </Field>
        </div>
      </TabsContent>
    </Tabs>
  );
}

// --------------------------------------------------------------------------

function Field({ label, full = false, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn('space-y-1.5', full && 'sm:col-span-2')}>
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

function NumberField({
  label, value, onChange, step,
}: { label: string; value: string; onChange: (v: string) => void; step?: string }) {
  return (
    <Field label={label}>
      <Input
        type="number" inputMode="decimal" step={step}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 font-mono tabular-nums"
      />
    </Field>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="sm:col-span-2 mt-1 text-2xs uppercase tracking-wide text-muted-foreground">
      {children}
    </div>
  );
}

function ActiveToggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="sm:col-span-2 flex items-center justify-between rounded-lg bg-slate-50 p-3">
      <Label className="text-sm">Активна</Label>
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          'relative w-10 h-6 rounded-full transition-colors',
          value ? 'bg-green-500' : 'bg-slate-300',
        )}
      >
        <span className={cn(
          'absolute top-1 w-4 h-4 rounded-full bg-white transition-transform',
          value ? 'translate-x-5' : 'translate-x-1',
        )} />
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers exposed to dialog wrappers
// --------------------------------------------------------------------------

/** Build a payload suitable for POST /api/equipment or PUT /api/equipment/[id]. */
export function formStateToPayload(state: EquipmentFormState): Record<string, unknown> {
  const num = (s: string) => (s.trim() === '' ? null : Number(s));
  const str = (s: string) => (s.trim() === '' ? null : s.trim());

  return {
    name: state.name.trim(),
    model: str(state.model),
    description: str(state.description),
    isActive: state.isActive,
    // A
    inventoryNumber: str(state.inventoryNumber),
    registrationNumber: str(state.registrationNumber),
    kind: state.kind,
    baseVehicle: str(state.baseVehicle),
    serialNumber: str(state.serialNumber),
    manufactureYear: num(state.manufactureYear),
    vin: str(state.vin),
    // B
    weightTons: num(state.weightTons),
    weightWithEquipmentTons: num(state.weightWithEquipmentTons),
    heightMm: num(state.heightMm),
    lengthMm: num(state.lengthMm),
    widthMm: num(state.widthMm),
    engineBrand: str(state.engineBrand),
    engineSerialNumber: str(state.engineSerialNumber),
    enginePower: num(state.enginePower),
    maxPileLength: num(state.maxPileLength),
    maxDrillingDepth: num(state.maxDrillingDepth),
    hammerType: str(state.hammerType),
    hammerSerialNumber: str(state.hammerSerialNumber),
    hammerEnergyKj: num(state.hammerEnergyKj),
    hammerKind: state.hammerKind,
    isCombined: state.isCombined,
    // C
    purchaseDate: str(state.purchaseDate),
    purchasePrice: num(state.purchasePrice),
    engineHoursTotal: num(state.engineHoursTotal),
    nextMaintenanceAtHours: num(state.nextMaintenanceAtHours),
    nextMaintenanceDate: str(state.nextMaintenanceDate),
    homeBaseLocation: str(state.homeBaseLocation),
  };
}

/** Load existing equipment into form state for the edit dialog. */
export function equipmentToFormState(item: Record<string, unknown> | null): EquipmentFormState {
  if (!item) return EMPTY_EQUIPMENT_FORM;
  const s = (k: string) => {
    const v = item[k];
    return v === null || v === undefined ? '' : String(v);
  };
  const dateOnly = (k: string) => {
    const v = item[k];
    if (!v) return '';
    const str = typeof v === 'string' ? v : String(v);
    return str.slice(0, 10); // ISO date → YYYY-MM-DD
  };
  return {
    name: s('name'),
    model: s('model'),
    description: s('description'),
    isActive: item.isActive !== false,
    inventoryNumber: s('inventoryNumber'),
    registrationNumber: s('registrationNumber'),
    kind: (item.kind as EquipmentKindDTO) || 'OTHER',
    baseVehicle: s('baseVehicle'),
    serialNumber: s('serialNumber'),
    manufactureYear: s('manufactureYear'),
    vin: s('vin'),
    weightTons: s('weightTons'),
    weightWithEquipmentTons: s('weightWithEquipmentTons'),
    heightMm: s('heightMm'),
    lengthMm: s('lengthMm'),
    widthMm: s('widthMm'),
    engineBrand: s('engineBrand'),
    engineSerialNumber: s('engineSerialNumber'),
    enginePower: s('enginePower'),
    maxPileLength: s('maxPileLength'),
    maxDrillingDepth: s('maxDrillingDepth'),
    hammerType: s('hammerType'),
    hammerSerialNumber: s('hammerSerialNumber'),
    hammerEnergyKj: s('hammerEnergyKj'),
    hammerKind: (item.hammerKind as HammerKindDTO) || 'NONE',
    isCombined: item.isCombined === true,
    purchaseDate: dateOnly('purchaseDate'),
    purchasePrice: s('purchasePrice'),
    engineHoursTotal: s('engineHoursTotal'),
    nextMaintenanceAtHours: s('nextMaintenanceAtHours'),
    nextMaintenanceDate: dateOnly('nextMaintenanceDate'),
    homeBaseLocation: s('homeBaseLocation'),
  };
}

export { KIND_LABELS };
