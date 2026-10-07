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

import { cloneElement, isValidElement, useId } from 'react';
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
import { Activity, Gauge, Info, Wrench } from '@/components/piling/icons/unified-icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { EquipmentToTab } from './equipment-to-tab';
import { KIND_LABEL } from './equipment-status';

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
  fuelTankLiters: string;
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
  engineHoursTotal: '', fuelTankLiters: '', nextMaintenanceAtHours: '', nextMaintenanceDate: '',
  homeBaseLocation: '',
};

// Названия типа техники берём из общего словаря карточки и списка
// (F-R138-TOP №1): свой список в форме разошёлся с ним, и «Копёр» в списке
// не совпадал с «Забивная установка» в шапке карточки.
const KIND_LABELS = KIND_LABEL;

type HammerKindDTO = 'HYDRAULIC' | 'DIESEL' | 'NONE';
const HAMMER_KIND_LABELS: Record<HammerKindDTO, string> = {
  HYDRAULIC: 'Гидравлический',
  DIESEL: 'Дизельный',
  NONE: 'Нет молота',
};

/**
 * Пределы полей карточки техники — ровно как в zod-схеме маршрута
 * (`src/lib/validation-schemas.ts`: `createEquipmentSchema` +
 * `equipmentMetadataSchema`). Схему не меняем: если серверный лимит правят,
 * правим и здесь, иначе форма отправляет заведомо отклоняемый запрос, а
 * человек видит только «Некорректные данные» без имени поля и предела.
 */
const TEXT_LIMITS = {
  name: 200,
  model: 200,
  description: 2000,
  inventoryNumber: 100,
  registrationNumber: 50,
  baseVehicle: 200,
  serialNumber: 100,
  vin: 50,
  engineBrand: 200,
  engineSerialNumber: 100,
  hammerType: 200,
  hammerSerialNumber: 100,
  homeBaseLocation: 200,
} as const;

const NUM_LIMITS = {
  manufactureYear: { min: 1950, max: 2100 },
  weightTons: { min: 0, max: 2000 },
  weightWithEquipmentTons: { min: 0, max: 2000 },
  heightMm: { min: 0, max: 100_000 },
  lengthMm: { min: 0, max: 100_000 },
  widthMm: { min: 0, max: 100_000 },
  enginePower: { min: 0, max: 10_000 },
  maxPileLength: { min: 0, max: 200 },
  maxDrillingDepth: { min: 0, max: 500 },
  hammerEnergyKj: { min: 0, max: 10_000 },
  purchasePrice: { min: 0, max: 1_000_000_000 },
  engineHoursTotal: { min: 0, max: 1_000_000 },
  fuelTankLiters: { min: 0, max: 100_000 },
  nextMaintenanceAtHours: { min: 0, max: 1_000_000 },
} as const;

interface Props {
  state: EquipmentFormState;
  onChange: (patch: Partial<EquipmentFormState>) => void;
  /** When true, only the "Основное" tab is shown (used in create mode). */
  compact?: boolean;
  /** Set in edit mode → enables the read-only «ТО» journal tab. */
  equipmentId?: string;
}

export function EquipmentForm({ state, onChange, compact = false, equipmentId }: Props) {
  const showTo = !compact && !!equipmentId;
  const uid = useId();
  return (
    <Tabs defaultValue="basic" className="w-full">
      <TabsList className={cn('grid w-full', showTo ? 'grid-cols-4' : 'grid-cols-3')}>
        <TabsTrigger value="basic" className="gap-1.5"><Info className="h-4 w-4" />Основное</TabsTrigger>
        <TabsTrigger value="tech" disabled={compact} className="gap-1.5"><Gauge className="h-4 w-4" />Тех. характеристики</TabsTrigger>
        {showTo && <TabsTrigger value="to" className="gap-1.5"><Wrench className="h-4 w-4" />Обслуживание ТО</TabsTrigger>}
        <TabsTrigger value="ops" disabled={compact} className="gap-1.5"><Activity className="h-4 w-4" />Эксплуатация</TabsTrigger>
      </TabsList>

      {showTo && equipmentId && (
        <TabsContent value="to" className="mt-4">
          <EquipmentToTab equipmentId={equipmentId} />
        </TabsContent>
      )}

      {/* ---------- Tab 1: identification + core ---------- */}
      <TabsContent value="basic" className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Название *" full>
            <Input
              value={state.name}
              onChange={(e) => onChange({ name: e.target.value })}
              placeholder="Например: Liebherr LRH 100 №1"
              maxLength={TEXT_LIMITS.name}
              className="h-11"
            />
          </Field>
          <Field label="Модель">
            <Input value={state.model} onChange={(e) => onChange({ model: e.target.value })} maxLength={TEXT_LIMITS.model} className="h-11" />
          </Field>
          <Field label="Тип машины" id={`${uid}-kind`}>
            <Select value={state.kind} onValueChange={(v) => onChange({ kind: v as EquipmentKindDTO })}>
              <SelectTrigger id={`${uid}-kind`} className="h-11"><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(KIND_LABELS) as EquipmentKindDTO[]).map((k) => (
                  <SelectItem key={k} value={k}>{KIND_LABELS[k]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Инвентарный номер">
            <Input value={state.inventoryNumber} onChange={(e) => onChange({ inventoryNumber: e.target.value })} maxLength={TEXT_LIMITS.inventoryNumber} className="h-11" />
          </Field>
          <Field label="Госномер">
            <Input value={state.registrationNumber} onChange={(e) => onChange({ registrationNumber: e.target.value })} maxLength={TEXT_LIMITS.registrationNumber} className="h-11" />
          </Field>
          <Field label="Базовая машина / носитель">
            <Input
              value={state.baseVehicle}
              onChange={(e) => onChange({ baseVehicle: e.target.value })}
              placeholder='напр. "Volvo EC360BLC"'
              maxLength={TEXT_LIMITS.baseVehicle}
              className="h-11"
            />
          </Field>
          <Field label="Серийный номер">
            <Input value={state.serialNumber} onChange={(e) => onChange({ serialNumber: e.target.value })} maxLength={TEXT_LIMITS.serialNumber} className="h-11" />
          </Field>
          <Field label="Год выпуска">
            <Input
              type="number" step={1} {...NUM_LIMITS.manufactureYear}
              value={state.manufactureYear}
              onChange={(e) => onChange({ manufactureYear: e.target.value })}
              className="h-11"
            />
          </Field>
          <Field label="VIN">
            <Input value={state.vin} onChange={(e) => onChange({ vin: e.target.value })} maxLength={TEXT_LIMITS.vin} className="h-11" />
          </Field>
          <Field label="Описание" full>
            <Textarea
              value={state.description}
              onChange={(e) => onChange({ description: e.target.value })}
              placeholder="Необязательное описание"
              maxLength={TEXT_LIMITS.description}
              className="min-h-[72px] resize-none"
            />
          </Field>
          <ActiveToggle value={state.isActive} onChange={(v) => onChange({ isActive: v })} />
        </div>
      </TabsContent>

      {/* ---------- Tab 2: technical specs ---------- */}
      <TabsContent value="tech" className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField label="Вес (т)" value={state.weightTons} onChange={(v) => onChange({ weightTons: v })} step="0.1" {...NUM_LIMITS.weightTons} />
          <NumberField label="Вес с оборудованием (т)" value={state.weightWithEquipmentTons} onChange={(v) => onChange({ weightWithEquipmentTons: v })} step="0.1" {...NUM_LIMITS.weightWithEquipmentTons} />
          <SectionTitle>Габариты для логистики</SectionTitle>
          <NumberField label="Высота (мм)" value={state.heightMm} onChange={(v) => onChange({ heightMm: v })} step="1" {...NUM_LIMITS.heightMm} />
          <NumberField label="Длина (мм)" value={state.lengthMm} onChange={(v) => onChange({ lengthMm: v })} step="1" {...NUM_LIMITS.lengthMm} />
          <NumberField label="Ширина (мм)" value={state.widthMm} onChange={(v) => onChange({ widthMm: v })} step="1" {...NUM_LIMITS.widthMm} />
          <SectionTitle>Двигатель</SectionTitle>
          <Field label="Марка двигателя">
            <Input value={state.engineBrand} onChange={(e) => onChange({ engineBrand: e.target.value })} maxLength={TEXT_LIMITS.engineBrand} className="h-11" />
          </Field>
          <Field label="Номер двигателя">
            <Input value={state.engineSerialNumber} onChange={(e) => onChange({ engineSerialNumber: e.target.value })} maxLength={TEXT_LIMITS.engineSerialNumber} className="h-11" />
          </Field>
          <NumberField label="Мощность двигателя (кВт)" value={state.enginePower} onChange={(v) => onChange({ enginePower: v })} step="1" {...NUM_LIMITS.enginePower} />
          <SectionTitle>Свайные / буровые параметры</SectionTitle>
          <NumberField label="Макс. длина сваи (м)" value={state.maxPileLength} onChange={(v) => onChange({ maxPileLength: v })} step="0.1" {...NUM_LIMITS.maxPileLength} />
          <NumberField label="Макс. глубина бурения (м)" value={state.maxDrillingDepth} onChange={(v) => onChange({ maxDrillingDepth: v })} step="0.1" {...NUM_LIMITS.maxDrillingDepth} />
          <SectionTitle>Молот</SectionTitle>
          <Field label="Вид молота (для чек-листа)" id={`${uid}-hammer-kind`}>
            <Select value={state.hammerKind} onValueChange={(v) => onChange({ hammerKind: v as HammerKindDTO })}>
              <SelectTrigger id={`${uid}-hammer-kind`} className="h-11"><SelectValue /></SelectTrigger>
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
            <Input value={state.hammerType} onChange={(e) => onChange({ hammerType: e.target.value })} placeholder='напр. "Junttan HHK-5/7"' maxLength={TEXT_LIMITS.hammerType} className="h-11" />
          </Field>
          <Field label="Серийник молота">
            <Input value={state.hammerSerialNumber} onChange={(e) => onChange({ hammerSerialNumber: e.target.value })} maxLength={TEXT_LIMITS.hammerSerialNumber} className="h-11" />
          </Field>
          <NumberField label="Энергия удара (кДж)" value={state.hammerEnergyKj} onChange={(v) => onChange({ hammerEnergyKj: v })} step="0.1" {...NUM_LIMITS.hammerEnergyKj} />
        </div>
      </TabsContent>

      {/* ---------- Tab 3: operation ---------- */}
      <TabsContent value="ops" className="mt-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label="Дата покупки">
            <Input type="date" value={state.purchaseDate} onChange={(e) => onChange({ purchaseDate: e.target.value })} className="h-11" />
          </Field>
          <NumberField label="Стоимость покупки (₽)" value={state.purchasePrice} onChange={(v) => onChange({ purchasePrice: v })} step="0.01" {...NUM_LIMITS.purchasePrice} />
          <NumberField label="Наработка моточасов" value={state.engineHoursTotal} onChange={(v) => onChange({ engineHoursTotal: v })} step="1" {...NUM_LIMITS.engineHoursTotal} />
          <NumberField label="Объём бака (л)" value={state.fuelTankLiters} onChange={(v) => onChange({ fuelTankLiters: v })} step="1" {...NUM_LIMITS.fuelTankLiters} />
          <NumberField label="След. ТО по моточасам" value={state.nextMaintenanceAtHours} onChange={(v) => onChange({ nextMaintenanceAtHours: v })} step="1" {...NUM_LIMITS.nextMaintenanceAtHours} />
          <Field label="След. ТО по дате">
            <Input type="date" value={state.nextMaintenanceDate} onChange={(e) => onChange({ nextMaintenanceDate: e.target.value })} className="h-11" />
          </Field>
          <Field label="Место базирования">
            <Input value={state.homeBaseLocation} onChange={(e) => onChange({ homeBaseLocation: e.target.value })} maxLength={TEXT_LIMITS.homeBaseLocation} className="h-11" />
          </Field>
        </div>
      </TabsContent>
    </Tabs>
  );
}

// --------------------------------------------------------------------------

function Field({ label, full = false, id: idProp, children }: {
  label: string; full?: boolean; id?: string; children: React.ReactNode;
}) {
  const generatedId = useId();
  const id = idProp ?? generatedId;
  return (
    <div className={cn('space-y-1.5', full && 'sm:col-span-2')}>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      {isValidElement(children) ? cloneElement(children as React.ReactElement<{ id?: string }>, { id }) : children}
    </div>
  );
}

function NumberField({
  label, value, onChange, step, min, max,
}: { label: string; value: string; onChange: (v: string) => void; step?: string; min?: number; max?: number }) {
  return (
    <Field label={label}>
      <Input
        type="number" inputMode="decimal" step={step} min={min} max={max}
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
    <div className="sm:col-span-2 flex items-center justify-between rounded-lg bg-muted p-3">
      <Label className="text-sm">Активна</Label>
      {/* Зона касания ≥44px на телефоне: растёт сам <button> (min-h-11), а
          видимая дорожка остаётся 40×24 — палец попадает, вид не меняется.
          `sm:min-h-0` возвращает на десктопе прежнюю высоту. */}
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="grid min-h-11 w-11 shrink-0 place-items-center sm:min-h-0"
      >
        <span className={cn(
          'relative block w-10 h-6 rounded-full transition-colors',
          value ? 'bg-success-strong' : 'bg-slate-300',
        )}>
          <span className={cn(
            'absolute top-1 w-4 h-4 rounded-full bg-card transition-transform',
            value ? 'translate-x-5' : 'translate-x-1',
          )} />
        </span>
      </button>
    </div>
  );
}

// --------------------------------------------------------------------------
// Helpers exposed to dialog wrappers
// --------------------------------------------------------------------------

/** Build a payload suitable for POST /api/equipment or PUT /api/equipment/[id]. */
/**
 * Наработку отправляем только тогда, когда её изменили.
 *
 * Форма карточки держит число, снятое в момент открытия. Пока диалог открыт,
 * оператор может внести свежее показание, и без этой проверки любое другое
 * сохранение откатывало бы наработку к старому числу — «моточасы заново
 * появляются» (владелец 07.10.2026). `original` — значение, с которым открыли
 * карточку.
 */
export function withoutUnchangedHours(
  payload: Record<string, unknown>,
  original: unknown,
): Record<string, unknown> {
  const before = typeof original === 'number' ? original : null;
  if (payload.engineHoursTotal !== before) return payload;
  const rest = { ...payload };
  delete rest.engineHoursTotal;
  return rest;
}

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
    fuelTankLiters: num(state.fuelTankLiters),
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
    fuelTankLiters: s('fuelTankLiters'),
    nextMaintenanceAtHours: s('nextMaintenanceAtHours'),
    nextMaintenanceDate: dateOnly('nextMaintenanceDate'),
    homeBaseLocation: s('homeBaseLocation'),
  };
}

export { KIND_LABELS };
