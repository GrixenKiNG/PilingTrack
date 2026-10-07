'use client';

import { useEffect, useId, useState } from 'react';
import { Loader2 } from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type {
  PileGradeDTO,
  SitePilePlanDTO,
  SiteDrillingPlanDTO,
} from '@/lib/types';
import { cn } from '@/lib/utils';
import { parseDecimalInput } from '@/lib/parse-decimal';
import { ConfirmActionDialog } from '@/components/piling/confirm-action-dialog';
import type { DrillingPlanRow, PilePlanRow, SiteListItem } from '../types';
import { PilePlanSection } from './pile-plan-section';
import { DrillingPlanSection } from './drilling-plan-section';
import { PlanSummary } from './plan-summary';
import { planWipeRequiresConfirm } from './plan-helpers';

/** Предупреждение о закрытии окна с несохранёнными правками (R132 №3). */
const CONFIRM_LEAVE = 'Закрыть без сохранения? Введённые данные будут потеряны.';

interface EditSiteDialogProps {
  site: SiteListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingPileGrades: boolean;
  pileGrades: PileGradeDTO[];
  onSave: (
    siteId: string,
    name: string,
    isActive: boolean,
    pilePlans: PilePlanRow[],
    drillingPlans: DrillingPlanRow[],
    coordinates: { latitude: number | null; longitude: number | null }
  ) => Promise<void>;
}

export function EditSiteDialog({
  site,
  open,
  onOpenChange,
  loadingPileGrades,
  pileGrades,
  onSave,
}: EditSiteDialogProps) {
  const uid = useId();
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  // Координаты держим строками, а не числами: пустое поле должно означать
  // «координат нет», а `Number('')` — это 0, то есть точка в Гвинейском заливе.
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [pilePlans, setPilePlans] = useState<PilePlanRow[]>([]);
  const [drillingPlans, setDrillingPlans] = useState<DrillingPlanRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [planWipeConfirmOpen, setPlanWipeConfirmOpen] = useState(false);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [retryKey, setRetryKey] = useState(0);
  // Сколько строк плана реально лежало в БД на момент открытия — чтобы поймать
  // сохранение, которое молча стёрло бы существующий план (инцидент 2026-07-17).
  const [initialPileRows, setInitialPileRows] = useState(0);
  const [initialDrillingRows, setInitialDrillingRows] = useState(0);
  // Снимок состояния на момент загрузки планов: по нему видно, есть ли
  // несохранённые правки, когда окно закрывают (R132 №3).
  const [baseline, setBaseline] = useState<string | null>(null);

  // Hydrate plans from API when dialog opens — they are not part of the
  // SiteListItem and need a separate fetch keyed off the site id.
  useEffect(() => {
    if (!open || !site) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    setName(site.name);
    setActive(site.isActive);
    setPilePlans([]);
    setDrillingPlans([]);
    setBaseline(null);
    setDetailState('loading');

    authFetch(`/api/sites/${site.id}`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load site plans');
        const data = await res.json();
        const fullSite = data.site as {
          pilePlans?: SitePilePlanDTO[];
          drillingPlans?: SiteDrillingPlanDTO[];
          latitude?: number | null;
          longitude?: number | null;
        };
        const lat = fullSite.latitude == null ? '' : String(fullSite.latitude);
        const lon = fullSite.longitude == null ? '' : String(fullSite.longitude);
        const pileRows = (fullSite.pilePlans ?? []).map((p) => ({
          tempId: p.id,
          pileGradeId: p.pileGradeId,
          count: p.count,
          metersPerUnit: p.metersPerUnit,
        }));
        const drillRows = (fullSite.drillingPlans ?? []).map((p) => ({
          tempId: p.id,
          diameter: p.diameter,
          count: p.count,
          metersPerUnit: p.metersPerUnit,
        }));
        setLatitude(lat);
        setLongitude(lon);
        setPilePlans(pileRows);
        setDrillingPlans(drillRows);
        setInitialPileRows(pileRows.length);
        setInitialDrillingRows(drillRows.length);
        // Снимок берётся только после загрузки планов: пустые планы в момент
        // открытия дали бы ложное «есть правки» (R132 №3).
        setBaseline(JSON.stringify({
          name: site.name,
          active: site.isActive,
          latitude: lat,
          longitude: lon,
          pilePlans: pileRows,
          drillingPlans: drillRows,
        }));
        setDetailState('ready');
      })
      .catch(() => setDetailState('error'));
  }, [open, site, retryKey]);

  /**
   * Разбор координаты из поля.
   *
   * `null` — поле пустое, координату надо стереть. `undefined` — введено
   * что-то, что числом не является: сохранять нельзя, иначе объект уедет
   * непонятно куда. Запятую принимаем: на русской раскладке её набирают чаще
   * точки, и отказывать из-за этого было бы придиркой.
   */
  const parseCoordinate = (raw: string, limit: number): number | null | undefined => {
    if (raw.trim() === '') return null;
    const value = parseDecimalInput(raw);
    if (value === null || Math.abs(value) > limit) return undefined;
    return value;
  };

  const parsedLatitude = parseCoordinate(latitude, 90);
  const parsedLongitude = parseCoordinate(longitude, 180);
  const coordinatesError = parsedLatitude === undefined
    ? 'Широта должна быть числом от −90 до 90'
    : parsedLongitude === undefined
      ? 'Долгота должна быть числом от −180 до 180'
      // Одна координата без второй бесполезна: точки из этого не получится.
      : (parsedLatitude === null) !== (parsedLongitude === null)
        ? 'Укажите обе координаты или оставьте оба поля пустыми'
        : null;

  const save = async () => {
    if (!site) return;
    setSaving(true);
    try {
      await onSave(site.id, name.trim(), active, pilePlans, drillingPlans, {
        latitude: parsedLatitude ?? null,
        longitude: parsedLongitude ?? null,
      });
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    if (!site || !name.trim()) {
      toast.error('Введите название');
      return;
    }
    if (coordinatesError) {
      toast.error(coordinatesError);
      return;
    }
    if (planWipeRequiresConfirm(initialPileRows, initialDrillingRows, pilePlans, drillingPlans)) {
      setPlanWipeConfirmOpen(true);
      return;
    }
    await save();
  };

  // Несохранённые правки: снимок загруженного состояния против текущего.
  const dirty = baseline !== null && baseline !== JSON.stringify({
    name, active, latitude, longitude, pilePlans, drillingPlans,
  });

  /** Закрытие по Esc/клику вне окна/«Отмена» — с вопросом, если есть правки. */
  const handleOpenChange = (next: boolean) => {
    if (!next && dirty && !window.confirm(CONFIRM_LEAVE)) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Редактировать объект</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-2">
          {loadingPileGrades || detailState === 'loading' ? (
            <div className="space-y-3 pb-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : detailState === 'error' ? (
            <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive-strong">
              <p>Не удалось загрузить планы объекта</p>
              <Button type="button" variant="outline" onClick={() => setRetryKey((value) => value + 1)}>Повторить</Button>
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              <div className="space-y-1.5">
                <Label htmlFor={`${uid}-name`}>Название объекта</Label>
                <Input
                  id={`${uid}-name`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={200}
                  className="h-11"
                  autoFocus
                />
              </div>

              {/*
                Координаты площадки. Нужны погоде на экране оператора: когда
                телефон не отдал геопозицию, взять ветер и температуру больше
                неоткуда. Оба поля необязательные — объект без координат это
                нормально, просто у него не будет погоды.
              */}
              <div className="space-y-1.5">
                <Label>Координаты площадки</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    inputMode="decimal"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    placeholder="Широта, напр. 57.5833"
                    aria-label="Широта"
                    className="h-11"
                  />
                  <Input
                    inputMode="decimal"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    placeholder="Долгота, напр. 34.5667"
                    aria-label="Долгота"
                    className="h-11"
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Нужны для погоды на экране оператора, когда телефон не даёт геопозицию.
                  Можно оставить пустыми.
                </p>
                {coordinatesError && (
                  <p className="text-xs text-destructive-strong">{coordinatesError}</p>
                )}
              </div>

              <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                <Label className="text-sm">Активен</Label>
                <button
                  onClick={() => setActive(!active)}
                  className={cn(
                    'w-10 h-6 rounded-full transition-colors relative',
                    active ? 'bg-success-strong' : 'bg-slate-300'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full bg-card absolute top-1 transition-transform',
                      active ? 'translate-x-5' : 'translate-x-1'
                    )}
                  />
                </button>
              </div>

              <Separator />

              <PilePlanSection
                plans={pilePlans}
                setPlans={setPilePlans}
                pileGrades={pileGrades}
              />

              <Separator />

              <DrillingPlanSection plans={drillingPlans} setPlans={setDrillingPlans} />

              <PlanSummary pilePlans={pilePlans} drillingPlans={drillingPlans} />
            </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={saving || loadingPileGrades || detailState !== 'ready' || !name.trim()}
            className="bg-signal hover:bg-signal-strong text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
      <ConfirmActionDialog
        open={planWipeConfirmOpen}
        onOpenChange={setPlanWipeConfirmOpen}
        title="Сохранить объект без плана?"
        description={`Все текущие строки плана (сваи: ${initialPileRows}, бурение: ${initialDrillingRows}) будут удалены, а плановые цифры обнулены. Это действие нельзя отменить.`}
        confirmLabel="Сохранить без плана"
        busy={saving}
        onConfirm={save}
      />
    </Dialog>
  );
}
