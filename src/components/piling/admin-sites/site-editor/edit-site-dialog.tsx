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
    drillingPlans: DrillingPlanRow[]
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
  const [pilePlans, setPilePlans] = useState<PilePlanRow[]>([]);
  const [drillingPlans, setDrillingPlans] = useState<DrillingPlanRow[]>([]);
  const [saving, setSaving] = useState(false);
  const [detailState, setDetailState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [retryKey, setRetryKey] = useState(0);

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
        };
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
        setDetailState('ready');
      })
      .catch(() => setDetailState('error'));
  }, [open, site, retryKey]);

  const submit = async () => {
    if (!site || !name.trim()) {
      toast.error('Введите название');
      return;
    }
    setSaving(true);
    try {
      await onSave(site.id, name.trim(), active, pilePlans, drillingPlans);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
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
            <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700">
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

              <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <Label className="text-sm">Активен</Label>
                <button
                  onClick={() => setActive(!active)}
                  className={cn(
                    'w-10 h-6 rounded-full transition-colors relative',
                    active ? 'bg-green-500' : 'bg-slate-300'
                  )}
                >
                  <div
                    className={cn(
                      'w-4 h-4 rounded-full bg-white absolute top-1 transition-transform',
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
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
