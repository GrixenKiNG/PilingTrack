'use client';

/**
 * Создание смены — страница вместо молчаливого нажатия.
 *
 * Кнопка «+ Создать смену» заводила смену сразу и без вопросов: установку
 * брала ту, что выбрана на другой вкладке, тип — по текущему часу, дату — по
 * серверу. Запрос уходил и возвращал 201, но человек не видел ни формы, ни
 * результата (новая строка появлялась ниже графика), и делал вывод, что
 * ничего не произошло.
 *
 * ЧЕГО ЗДЕСЬ НЕТ И ПОЧЕМУ. В макете у смены есть название, бригадир, состав
 * бригады, план работ и особые отметки. В `Shift` таких полей нет: агрегат
 * хранит установку, тип, производственную дату, часовой пояс и плановое окно.
 * Бригада не выбирается здесь потому, что она уже закреплена за установкой —
 * выбор второй бригады на ту же машину создал бы два ответа на один вопрос.
 * Поэтому бригада показана как факт, а не как поле.
 */

import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  CreationForm, FormSection, FormLabel, TilePicker, type TileOption,
} from '@/components/piling/forms/creation-form';
import { getTodayInTimezone } from '@/lib/timezone';
import { isShiftTypeSelectable } from '@/modules/reports/domain/shift-types';

type ShiftType = 'DAY' | 'NIGHT';

// Ночная смена скрыта, пока организация работает в одну (SELECTABLE_SHIFT_TYPES).
// Окно ниже остаётся описанным для обеих: старые ночные смены рисуются по нему.
const ALL_SHIFT_TYPES: TileOption<ShiftType>[] = [
  { value: 'DAY', label: 'Дневная', hint: '08:00 – 20:00' },
  { value: 'NIGHT', label: 'Ночная', hint: '20:00 – 08:00' },
];

const SHIFT_TYPES = ALL_SHIFT_TYPES.filter((option) => isShiftTypeSelectable(option.value));

/** Плановое окно по типу смены — то же правило, что рисует график смен. */
const DEFAULT_WINDOW: Record<ShiftType, { start: string; end: string }> = {
  DAY: { start: '08:00', end: '20:00' },
  NIGHT: { start: '20:00', end: '08:00' },
};

interface EquipmentOption { id: string; name: string; model: string | null }
interface CrewOption {
  equipmentId: string;
  name: string;
  isActive: boolean;
  operator: { name: string } | null;
  site: { name: string } | null;
}

interface Props {
  /** Часовой пояс организации: производственные сутки считаются по нему. */
  timezone: string;
  /** Куда вернуться по «Отмена» и после создания. */
  backHref: string;
}

/**
 * Собирает момент времени из даты и часов в поясе организации.
 *
 * Наивная склейка `new Date(`${date}T${time}`)` берёт пояс браузера, а смена
 * живёт в поясе тенанта: у диспетчера из другого региона плановое окно
 * уехало бы на несколько часов. Смещение берётся у самого пояса на эту дату,
 * поэтому переход на летнее время (там, где он есть) учитывается сам.
 */
function instantInTimezone(date: string, time: string, timezone: string): string | null {
  if (!date || !time) return null;
  const naive = new Date(`${date}T${time}:00Z`);
  if (Number.isNaN(naive.getTime())) return null;
  const shown = new Date(naive.toLocaleString('en-US', { timeZone: timezone }));
  const utc = new Date(naive.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(naive.getTime() + (utc.getTime() - shown.getTime())).toISOString();
}

export function ShiftCreateForm({ timezone, backHref }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const [equipment, setEquipment] = useState<EquipmentOption[]>([]);
  const [crews, setCrews] = useState<CrewOption[]>([]);
  const [equipmentId, setEquipmentId] = useState(params.get('equipmentId') ?? '');
  const [type, setType] = useState<ShiftType>('DAY');
  const [date, setDate] = useState('');
  const [start, setStart] = useState(DEFAULT_WINDOW.DAY.start);
  const [end, setEnd] = useState(DEFAULT_WINDOW.DAY.end);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- дата в поясе тенанта известна только после гидратации
    setDate(getTodayInTimezone(timezone));
  }, [timezone]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [equipmentRes, crewRes] = await Promise.all([
        authFetch('/api/equipment?limit=100'),
        authFetch('/api/crews'),
      ]);
      if (cancelled) return;
      if (equipmentRes.ok) setEquipment(((await equipmentRes.json()).data ?? []) as EquipmentOption[]);
      if (crewRes.ok) {
        const body = await crewRes.json();
        setCrews((body.data ?? body.crews ?? []) as CrewOption[]);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Смена типа переставляет окно, но только пока его не правили руками. */
  const applyType = (next: ShiftType) => {
    const current = DEFAULT_WINDOW[type];
    const untouched = start === current.start && end === current.end;
    setType(next);
    if (untouched) {
      setStart(DEFAULT_WINDOW[next].start);
      setEnd(DEFAULT_WINDOW[next].end);
    }
  };

  const selected = equipment.find((item) => item.id === equipmentId) ?? null;
  // Только действующая бригада: расформированная закреплена за машиной в
  // истории, но работать в смене ей уже некем.
  const crew = useMemo(
    () => crews.find((item) => item.equipmentId === equipmentId && item.isActive) ?? null,
    [crews, equipmentId],
  );

  const submit = async () => {
    if (!equipmentId) return toast.error('Выберите установку');
    if (!date) return toast.error('Укажите дату смены');

    setBusy(true);
    try {
      const response = await authFetch('/api/readiness/shifts', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify({
          equipmentId,
          type,
          plannedStartAt: instantInTimezone(date, start, timezone),
          // Ночная смена заканчивается на следующие сутки — иначе окончание
          // оказалось бы раньше начала, и команда справедливо отказала бы.
          plannedEndAt: instantInTimezone(
            type === 'NIGHT'
              ? new Date(new Date(`${date}T00:00:00Z`).getTime() + 86_400_000).toISOString().slice(0, 10)
              : date,
            end, timezone,
          ),
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Не удалось создать смену');
      }
      toast.success('Смена создана');
      router.push(backHref);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось создать смену');
    } finally {
      setBusy(false);
    }
  };

  return (
    <CreationForm
      title="Создание смены"
      subtitle="Новая рабочая смена на установке"
      backHref={backHref}
      submitLabel="Создать смену"
      onSubmit={() => void submit()}
      busy={busy}
    >
      <FormSection title="Тип смены">
        <TilePicker name="Тип смены" value={type} options={SHIFT_TYPES} onChange={applyType} />
      </FormSection>

      <FormSection title="Установка и место работы">
        <div>
          <FormLabel htmlFor="shift-equipment" required>Установка</FormLabel>
          <Select value={equipmentId} onValueChange={setEquipmentId}>
            <SelectTrigger id="shift-equipment" className="h-11 w-full">
              <SelectValue placeholder="Выберите установку" />
            </SelectTrigger>
            <SelectContent>
              {equipment.map((item) => (
                <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selected && (
            <p className="mt-1.5 text-xs text-muted-foreground">{selected.model ?? 'модель не указана'}</p>
          )}
        </div>

        {/*
          Бригада и объект — не поля, а следствие выбора машины. Показываем их
          сразу, чтобы ошибка в установке была видна здесь, а не после пуска
          смены не на том объекте.
        */}
        {equipmentId && (
          <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
            <p className="text-xs font-medium text-muted-foreground">Кто и где работает</p>
            {crew ? (
              <p className="mt-1 text-sm text-foreground">
                {crew.name}
                {crew.operator && ` · ${crew.operator.name}`}
                {crew.site && <span className="text-muted-foreground"> · {crew.site.name}</span>}
              </p>
            ) : (
              <p className="mt-1 text-sm text-warning-strong">
                За установкой не закреплена активная бригада — смену открыть можно,
                но работать на ней будет некому
              </p>
            )}
          </div>
        )}
      </FormSection>

      <FormSection title="Дата и время">
        <div className="grid gap-3.5 sm:grid-cols-3">
          <div>
            <FormLabel htmlFor="shift-date" required>Дата</FormLabel>
            <Input
              id="shift-date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="h-11"
            />
          </div>
          <div>
            <FormLabel htmlFor="shift-start">Время начала</FormLabel>
            <Input
              id="shift-start"
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
              className="h-11"
            />
          </div>
          <div>
            <FormLabel htmlFor="shift-end">Время окончания</FormLabel>
            <Input
              id="shift-end"
              type="time"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              className="h-11"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Производственные сутки считаются в поясе организации: {timezone}.
          {type === 'NIGHT' && ' Ночная смена заканчивается на следующие сутки.'}
        </p>
      </FormSection>
    </CreationForm>
  );
}
