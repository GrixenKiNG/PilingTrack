'use client';

import { useEffect, useState } from 'react';
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
import type { DrillingPlanRow, PilePlanRow, SiteListItem } from '../types';
import { PilePlanSection } from './pile-plan-section';
import { DrillingPlanSection } from './drilling-plan-section';
import { PlanSummary } from './plan-summary';
import { planWipeRequiresConfirm } from './plan-helpers';

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
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  // Координаты держим строками, а не числами: пустое поле должно означать
  // «координат нет», а `Number('')` — это 0, то есть точка в Гвинейском заливе.
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [pilePlans, setPilePlans] = useState<PilePlanRow[]>([]);
  const [drillingPlans, setDrillingPlans] = useState<DrillingPlanRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [retryKey, setRetryKey] = useState(0);
  // Сколько строк плана реально лежало в БД на момент открытия — чтобы поймать
  // сохранение, которое молча стёрло бы существующий план (инцидент 2026-07-17).
  const [initialPileRows, setInitialPileRows] = useState(0);
  const [initialDrillingRows, setInitialDrillingRows] = useState(0);

  // Hydrate plans from API when dialog opens — they are not part of the
  // SiteListItem and need a separate fetch keyed off the site id.
  useEffect(() => {
    if (!open || !site) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs local state to the source prop/dependency when it changes
    setName(site.name);
    setActive(site.isActive);
    setPilePlans([]);
    setDrillingPlans([]);
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
        setLatitude(fullSite.latitude == null ? '' : String(fullSite.latitude));
        setLongitude(fullSite.longitude == null ? '' : String(fullSite.longitude));
        setPilePlans(
          (fullSite.pilePlans ?? []).map((p) => ({
              tempId: p.id,
              pileGradeId: p.pileGradeId,
              count: p.count,
              metersPerUnit: p.metersPerUnit,
            }))
        );
        setDrillingPlans(
          (fullSite.drillingPlans ?? []).map((p) => ({
              tempId: p.id,
              diameter: p.diameter,
              count: p.count,
              metersPerUnit: p.metersPerUnit,
            }))
        );
        setInitialPileRows((fullSite.pilePlans ?? []).length);
        setInitialDrillingRows((fullSite.drillingPlans ?? []).length);
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
    const text = raw.trim().replace(',', '.');
    if (text === '') return null;
    const value = Number(text);
    if (!Number.isFinite(value) || Math.abs(value) > limit) return undefined;
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
      const ok = window.confirm(
        `Вы сохраняете объект БЕЗ плана: все текущие строки плана (сваи: ${initialPileRows}, бурение: ${initialDrillingRows}) будут удалены, а плановые цифры обнулены.\n\nПродолжить?`,
      );
      if (!ok) return;
    }
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined} className="max-w-lg">
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
                <Label>Название объекта</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
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
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
    </Dialog>
  );
}
