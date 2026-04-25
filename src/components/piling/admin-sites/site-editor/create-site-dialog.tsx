'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
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
import type { PileGradeDTO } from '@/lib/types';
import type { DrillingPlanRow, PilePlanRow } from '../types';
import { PilePlanSection } from './pile-plan-section';
import { DrillingPlanSection } from './drilling-plan-section';
import { PlanSummary } from './plan-summary';

interface CreateSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingPileGrades: boolean;
  pileGrades: PileGradeDTO[];
  onCreate: (
    name: string,
    pilePlans: PilePlanRow[],
    drillingPlans: DrillingPlanRow[]
  ) => Promise<void>;
}

export function CreateSiteDialog({
  open,
  onOpenChange,
  loadingPileGrades,
  pileGrades,
  onCreate,
}: CreateSiteDialogProps) {
  const [name, setName] = useState('');
  const [pilePlans, setPilePlans] = useState<PilePlanRow[]>([]);
  const [drillingPlans, setDrillingPlans] = useState<DrillingPlanRow[]>([]);
  const [creating, setCreating] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error('Введите название объекта');
      return;
    }
    setCreating(true);
    try {
      await onCreate(name.trim(), pilePlans, drillingPlans);
      setName('');
      setPilePlans([]);
      setDrillingPlans([]);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новый объект</DialogTitle>
        </DialogHeader>
        <ScrollArea className="max-h-[70vh] pr-2">
          {loadingPileGrades ? (
            <div className="space-y-3 pb-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
            <div className="space-y-4 pb-2">
              <div className="space-y-1.5">
                <Label>Название объекта</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Например: ЖК Солнечный"
                  className="h-11"
                  autoFocus
                />
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
            disabled={creating || loadingPileGrades || !name.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
