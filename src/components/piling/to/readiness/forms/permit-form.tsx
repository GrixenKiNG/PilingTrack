'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  AlertTriangle, Flame, MoveUp, MoreHorizontal, Package, Shovel, Zap,
} from '@/components/piling/icons/unified-icons';
import { Button } from '@/components/ui/button';
import { authFetch } from '@/lib/api';
import { cn } from '@/lib/utils';
import { card } from '../settings/shared-ui';
import type { ReadinessBootstrap } from '../api/contracts';
import type { FleetCard } from '@/components/piling/admin-equipment/fleet-types';
import type { EquipmentOption } from '../../to-module-bits';
import { commandFailure } from '../screens/shared';
import {
  ChipList, CountedField, Field, FormPage, FormSection, PersonField,
  SuggestField, TileSelect, type PersonOption,
} from './form-kit';

/** Пределы совпадают с макетом; сервер держит свои, более широкие. */
const TITLE_LIMIT = 200;
const SCOPE_LIMIT = 300;

interface WorkTypeOption {
  id: string;
  name: string;
  hint: string;
  icon: string;
  defaultRisk: 'NORMAL' | 'ELEVATED';
  hazardPresets: string[];
  requiredApprovals: Array<'DISPATCHER' | 'ADMIN'>;
  allowAuthorApproval: boolean;
}

interface FormOptions {
  workTypes: WorkTypeOption[];
  people: PersonOption[];
  placePresets: Array<{ id: string; location: string; objectName: string }>;
  objectNames: string[];
}

/*
  Значок вида работ приходит слагом из справочника, а не именем компонента:
  справочник редактирует админ, и он не обязан знать про наши компоненты.
  Незнакомый слаг получает запасной значок, а не роняет экран.
*/
const WORK_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  flame: Flame,
  height: MoveUp,
  ground: Shovel,
  electric: Zap,
  crane: Package,
  other: MoreHorizontal,
};

/**
 * Сдвиг часового пояса организации в миллисекундах на заданный момент.
 *
 * Разбирает момент по частям через Intl, а НЕ через
 * `new Date(x.toLocaleString(...))`. Разбор строки идёт в поясе браузера, и
 * такой приём молча ломается ровно там, где ошибиться больнее всего: когда
 * пояс браузера совпадает с поясом организации, разница выходит нулевой, и
 * введённые 08:00 сохраняются как 08:00 UTC, то есть 11:00 по Москве.
 * Проверено вживую 16.08.2026 — наряд уехал на три часа вперёд.
 */
function tenantOffsetMs(instant: Date, timezone: string): number {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant).map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return asUtc - instant.getTime();
}

/**
 * Момент времени по стенным часам ОРГАНИЗАЦИИ, а не браузера.
 *
 * Поля даты и времени дают «08:00» без пояса. Взять из этого просто `new Date`
 * значило бы истолковать отметку в поясе того, кто заполняет, — и наряд,
 * выписанный из другого пояса, начал бы действовать не тогда, когда написано.
 * Ровно этот разрыв уже случался с периодом отчётов.
 *
 * Второй проход нужен на переходах зимнего и летнего времени: сдвиг там разный
 * до и после границы, и одной поправки не хватает.
 */
function instantInTenantTimezone(date: string, time: string, timezone: string): string | null {
  if (!date || !time) return null;
  const wallClockAsUtc = Date.parse(`${date}T${time}:00Z`);
  if (Number.isNaN(wallClockAsUtc)) return null;
  const firstGuess = wallClockAsUtc - tenantOffsetMs(new Date(wallClockAsUtc), timezone);
  const refined = wallClockAsUtc - tenantOffsetMs(new Date(firstGuess), timezone);
  return new Date(refined).toISOString();
}

const todayInTenant = (timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
  return parts;
};

interface PermitFormProps {
  equipment: EquipmentOption[];
  /** Карточки техники — единственный источник фотографии установки. */
  fleetCards: FleetCard[];
  selectedEquipmentId: string;
  bootstrap: ReadinessBootstrap | null;
  onCancel: () => void;
  onCreated: () => void;
}

export function PermitForm({
  equipment, fleetCards, selectedEquipmentId, bootstrap, onCancel, onCreated,
}: PermitFormProps) {
  const timezone = bootstrap?.tenant.timezone ?? 'Europe/Moscow';
  const [options, setOptions] = useState<FormOptions | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [workTypeId, setWorkTypeId] = useState<string | null>(null);
  const [risk, setRisk] = useState<'NORMAL' | 'ELEVATED'>('NORMAL');
  const [equipmentId, setEquipmentId] = useState(selectedEquipmentId);
  const [location, setLocation] = useState('');
  const [objectName, setObjectName] = useState('');
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [hazards, setHazards] = useState<string[]>([]);
  const [dateFrom, setDateFrom] = useState(() => todayInTenant(timezone));
  const [timeFrom, setTimeFrom] = useState('08:00');
  const [dateTo, setDateTo] = useState(() => todayInTenant(timezone));
  const [timeTo, setTimeTo] = useState('17:00');
  const [producer, setProducer] = useState<{ userId: string | null; name: string }>({ userId: null, name: '' });
  const [observer, setObserver] = useState<{ userId: string | null; name: string }>({ userId: null, name: '' });
  const [safety, setSafety] = useState<{ userId: string | null; name: string }>({ userId: null, name: '' });

  useEffect(() => {
    let cancelled = false;
    void authFetch('/api/readiness/permit-form-options')
      .then(async (response) => {
        if (!response.ok) {
          if (!cancelled) setOptionsError(await commandFailure(response));
          return;
        }
        const body = await response.json() as FormOptions;
        if (!cancelled) setOptions(body);
      })
      .catch(() => { if (!cancelled) setOptionsError('Не удалось загрузить справочники формы.'); });
    return () => { cancelled = true; };
  }, []);

  const workType = options?.workTypes.find((item) => item.id === workTypeId) ?? null;

  /*
    Выбор вида работ подставляет его риск по умолчанию. Именно подставляет:
    поднять или опустить категорию потом можно руками — состав согласующих
    задаёт админ на самом виде работ, а не эта форма.
  */
  const chooseWorkType = (id: string) => {
    setWorkTypeId(id);
    const chosen = options?.workTypes.find((item) => item.id === id);
    if (chosen) setRisk(chosen.defaultRisk);
  };

  const placeSuggestions = useMemo(
    () => Array.from(new Set((options?.placePresets ?? []).map((item) => item.location))),
    [options],
  );
  const objectSuggestions = useMemo(() => Array.from(new Set([
    ...(options?.objectNames ?? []),
    ...(options?.placePresets ?? []).map((item) => item.objectName).filter(Boolean),
  ])), [options]);

  const validFrom = instantInTenantTimezone(dateFrom, timeFrom, timezone);
  const validTo = instantInTenantTimezone(dateTo, timeTo, timezone);
  const periodInvalid = Boolean(validFrom && validTo && validTo <= validFrom);

  const ready = Boolean(
    workTypeId && equipmentId
    && title.trim().length >= 3 && title.length <= TITLE_LIMIT
    && scope.trim().length >= 3 && scope.length <= SCOPE_LIMIT
    && location.trim().length >= 2
    && producer.name.trim().length > 0
    && validFrom && validTo && !periodInvalid,
  );

  const savePlacePreset = async () => {
    const response = await authFetch('/api/readiness/place-presets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ location: location.trim(), objectName: objectName.trim() }),
    });
    if (!response.ok) { toast.error(await commandFailure(response)); return; }
    toast.success('Место сохранено в ваши подсказки');
    setOptions((current) => current && {
      ...current,
      placePresets: [{ id: crypto.randomUUID(), location: location.trim(), objectName: objectName.trim() },
        ...current.placePresets],
    });
  };

  const submit = async (alsoSubmitForApproval: boolean) => {
    if (!ready) { setError('Заполните обязательные поля, отмеченные звёздочкой.'); return; }
    setPending(true);
    setError(null);
    const actingHeader: Record<string, string> = bootstrap?.actor.actingAs
      ? { 'x-readiness-acting-as': bootstrap.actor.actingAs } : {};
    const created = await authFetch('/api/readiness/work-permits', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...actingHeader },
      body: JSON.stringify({
        equipmentId, shiftId: null, workTypeId, risk,
        title: title.trim(), scope: scope.trim(),
        location: location.trim(), objectName: objectName.trim(),
        hazards,
        producerUserId: producer.userId, producerName: producer.name.trim(),
        observerUserId: observer.userId, observerName: observer.name.trim(),
        safetyUserId: safety.userId, safetyName: safety.name.trim(),
        validFrom, validTo,
      }),
    });
    if (!created.ok) { setPending(false); setError(await commandFailure(created)); return; }
    if (!alsoSubmitForApproval) {
      setPending(false);
      toast.success('Черновик наряда сохранён');
      onCreated();
      return;
    }
    /*
      «Создать наряд» — это два шага: создать черновик и отправить его на
      согласование. Отдельной команды «создать сразу на согласовании» на
      сервере нет, и выдумывать её ради одной кнопки незачем. Если второй шаг
      не пройдёт, черновик уже сохранён и виден в реестре — работа не пропадёт,
      о чём и сообщаем прямо.
    */
    const body = await created.json() as { data: { id: string; version: number } };
    const permit = body.data;
    const sent = await authFetch(`/api/readiness/work-permits/${permit.id}/submit`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'if-match': `"work-permit-${permit.id}-v${permit.version}"`,
        ...actingHeader,
      },
      body: JSON.stringify({ expectedVersion: permit.version }),
    });
    setPending(false);
    if (!sent.ok) {
      setError(`Наряд сохранён как черновик, но отправить на согласование не удалось: ${await commandFailure(sent)}`);
      onCreated();
      return;
    }
    toast.success('Наряд создан и отправлен на согласование');
    onCreated();
  };

  const tiles = (options?.workTypes ?? []).map((item) => {
    const Icon = WORK_TYPE_ICONS[item.icon] ?? MoreHorizontal;
    return { id: item.id, title: item.name, hint: item.hint, icon: <Icon className="h-4 w-4" /> };
  });

  const chosenEquipment = equipment.find((item) => item.id === equipmentId) ?? null;
  const chosenPhotoUrl = fleetCards.find((item) => item.id === equipmentId)?.photoUrl ?? null;

  return (
    <FormPage
      title="Создание наряда-допуска"
      subtitle="Оформите наряд-допуск на выполнение работ"
      onBack={onCancel}
      footer={<>
        <Button type="button" variant="ghost" className="min-h-11" disabled={pending} onClick={onCancel}>
          Отмена
        </Button>
        <Button type="button" variant="outline" className="min-h-11" disabled={pending || !ready}
          onClick={() => void submit(false)}>
          Сохранить черновик
        </Button>
        <Button type="button" className="min-h-11 bg-signal-strong hover:bg-signal-strong"
          disabled={pending || !ready} onClick={() => void submit(true)}>
          {pending ? 'Сохраняем…' : 'Создать наряд'}
        </Button>
      </>}
    >
      {optionsError && (
        <p role="alert" className={cn(card, 'border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-strong')}>
          {optionsError}
        </p>
      )}

      <FormSection title="Тип работ">
        {tiles.length > 0
          ? <TileSelect options={tiles} value={workTypeId} onChange={chooseWorkType} ariaLabel="Тип работ" />
          : <p className="text-xs text-muted-foreground">Виды работ загружаются…</p>}
        {/*
          Плашка-последствие вместо поля «риск». Она называет то, что реально
          произойдёт — сколько подписей потребует наряд, — а не термин.
          Значения приходят из справочника: их задаёт админ, а не код.
        */}
        {workType && (
          <div className={cn(
            'flex items-start gap-2 rounded-lg border p-2.5 text-3xs',
            risk === 'ELEVATED'
              ? 'border-signal/40 bg-signal/10 text-signal-strong'
              : 'border-border bg-muted text-muted-foreground',
          )}>
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span>
              <b>{workType.name}</b> — {workType.requiredApprovals.length === 0
                ? 'согласующие не настроены, наряд нельзя будет согласовать. Настройте вид работ в справочнике.'
                : `требуется ${workType.requiredApprovals.length === 1 ? 'одна подпись' : `${workType.requiredApprovals.length} подписи`}: ${workType.requiredApprovals.map((role) => role === 'ADMIN' ? 'администратор' : 'диспетчер').join(' и ')}.`}
              {workType.requiredApprovals.length > 0 && (workType.allowAuthorApproval
                ? ' Автор может согласовать свой наряд.'
                : ' Автор свой наряд согласовать не может.')}
            </span>
          </div>
        )}
      </FormSection>

      <FormSection title="Объект и установка">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
          <div className="space-y-3">
            <Field label="Установка" required htmlFor="permit-equipment">
              <select
                id="permit-equipment"
                value={equipmentId}
                onChange={(event) => setEquipmentId(event.target.value)}
                className="min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs"
              >
                <option value="">Выберите установку</option>
                {equipment.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Место работы" required htmlFor="permit-location"
              hint="Площадка, участок, отметка — то, где именно ведутся работы">
              <SuggestField
                id="permit-location" value={location} onChange={setLocation}
                suggestions={placeSuggestions} placeholder="Например: Площадка 3, ось 12–14"
              />
            </Field>
            <Field label="Объект" htmlFor="permit-object">
              <SuggestField
                id="permit-object" value={objectName} onChange={setObjectName}
                suggestions={objectSuggestions} placeholder="Например: Промышленный комплекс"
                savable={location.trim().length >= 2}
                onSave={() => void savePlacePreset()}
              />
            </Field>
          </div>
          {/*
            Фотография установки — из карточки техники. У людей фотографий в
            системе нет вовсе, поэтому ответственные ниже показаны инициалами:
            рисовать чужие лица неоткуда.
          */}
          <div className={cn(card, 'grid min-h-[120px] place-items-center overflow-hidden bg-muted p-2')}>
            {chosenPhotoUrl
               
              ? <img src={chosenPhotoUrl} alt={`Фото установки ${chosenEquipment?.name ?? ''}`}
                  className="max-h-[120px] w-full object-contain" />
              : <span className="text-center text-3xs text-muted-foreground">
                  {chosenEquipment ? 'Фото установки не загружено' : 'Установка не выбрана'}
                </span>}
          </div>
        </div>
      </FormSection>

      <FormSection title="Работы">
        <Field label="Наименование работ" required htmlFor="permit-title">
          <CountedField id="permit-title" value={title} onChange={setTitle} limit={TITLE_LIMIT}
            placeholder="Например: Сварочные работы по ремонту гидравлики" />
        </Field>
        <Field label="Описание работ" required htmlFor="permit-scope">
          <CountedField id="permit-scope" value={scope} onChange={setScope} limit={SCOPE_LIMIT} multiline
            placeholder="Состав и границы работ: что именно делается и где заканчивается" />
        </Field>
        <Field label="Опасные факторы"
          hint="Типовые подставляются по виду работ. Свой фактор можно запомнить в шаблон вида работ.">
          <ChipList
            ariaLabel="Опасные факторы"
            values={hazards}
            onChange={setHazards}
            suggestions={workType?.hazardPresets ?? []}
            placeholder="Например: Открытый огонь"
          />
        </Field>
      </FormSection>

      <FormSection title="Сроки выполнения">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Дата начала" required htmlFor="permit-date-from">
            <input id="permit-date-from" type="date" value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs" />
          </Field>
          <Field label="Время начала" required htmlFor="permit-time-from">
            <input id="permit-time-from" type="time" value={timeFrom}
              onChange={(event) => setTimeFrom(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs" />
          </Field>
          <Field label="Дата окончания" required htmlFor="permit-date-to">
            <input id="permit-date-to" type="date" value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs" />
          </Field>
          <Field label="Время окончания" required htmlFor="permit-time-to">
            <input id="permit-time-to" type="time" value={timeTo}
              onChange={(event) => setTimeTo(event.target.value)}
              className="min-h-11 w-full rounded-md border border-input bg-background px-2.5 text-xs" />
          </Field>
        </div>
        <p className="text-3xs text-muted-foreground">
          Время указывается по часовому поясу организации ({timezone}). По истечении срока наряд
          сам переходит в «просрочен».
        </p>
        {periodInvalid && (
          <p role="alert" className="text-3xs font-semibold text-destructive-strong">
            Окончание должно быть позже начала.
          </p>
        )}
      </FormSection>

      <FormSection title="Ответственные лица">
        <div className="grid gap-3 lg:grid-cols-3">
          <PersonField id="permit-producer" label="Производитель работ" required
            people={options?.people ?? []} userId={producer.userId} name={producer.name}
            onChange={setProducer} />
          <PersonField id="permit-observer" label="Наблюдающий"
            people={options?.people ?? []} userId={observer.userId} name={observer.name}
            onChange={setObserver} />
          <PersonField id="permit-safety" label="Ответственный за безопасность"
            people={options?.people ?? []} userId={safety.userId} name={safety.name}
            onChange={setSafety} />
        </div>
        <p className="text-3xs text-muted-foreground">
          Обязателен производитель работ. Наблюдающего и ответственного за безопасность назначайте,
          когда этого требуют условия работ. Если человека нет в системе — впишите ФИО вручную.
        </p>
      </FormSection>

      {error && (
        <p role="alert" className={cn(card, 'border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive-strong')}>
          {error}
        </p>
      )}
    </FormPage>
  );
}
