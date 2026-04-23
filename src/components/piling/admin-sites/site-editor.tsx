'use client';

import { useState, useEffect } from 'react';
import {
  HardHat,
  Drill,
  Ruler,
  X,
  Plus,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { PileGradeDTO, SitePilePlanDTO, SiteDrillingPlanDTO } from '@/lib/types';
import type { PilePlanRow, DrillingPlanRow, SiteListItem } from './types';
import { AlertTriangle } from 'lucide-react';

// ============================================================
// Helpers
// ============================================================

const emptyPilePlanRow = (): PilePlanRow => ({
  tempId: crypto.randomUUID(),
  pileGradeId: '',
  count: 0,
  metersPerUnit: 0,
});

const emptyDrillingPlanRow = (): DrillingPlanRow => ({
  tempId: crypto.randomUUID(),
  diameter: 0,
  count: 0,
  metersPerUnit: 0,
});

const totalPileCount = (plans: PilePlanRow[]) =>
  plans.reduce((s, p) => s + (Number(p.count) || 0), 0);

const totalPileMeters = (plans: PilePlanRow[]) =>
  plans.reduce((s, p) => s + (Number(p.count) || 0) * (Number(p.metersPerUnit) || 0), 0);

const totalDrillingMeters = (plans: DrillingPlanRow[]) =>
  plans.reduce((s, p) => s + (Number(p.count) || 0) * (Number(p.metersPerUnit) || 0), 0);

// ============================================================
// Plan sub-components
// ============================================================

interface PilePlanSectionProps {
  plans: PilePlanRow[];
  setPlans: (plans: PilePlanRow[]) => void;
  pileGrades: PileGradeDTO[];
}

function PilePlanSection({ plans, setPlans, pileGrades }: PilePlanSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <HardHat className="w-4 h-4 text-orange-500" />
          План свай
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-orange-600 hover:text-orange-700 hover:bg-orange-50"
          onClick={() => setPlans([...plans, emptyPilePlanRow()])}
        >
          <Plus className="w-3 h-3 mr-1" />
          Добавить строку
        </Button>
      </div>

      {plans.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">Нет запланированных свай</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
          {plans.map((row, idx) => (
            <div key={row.tempId} className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-2">
              <span className="text-[10px] text-slate-400 w-4 text-center flex-shrink-0">{idx + 1}</span>
              <Select
                value={row.pileGradeId}
                onValueChange={(val) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, pileGradeId: val } : p)))
                }
              >
                <SelectTrigger className="h-8 text-xs flex-1 min-w-0">
                  <SelectValue placeholder="Марка сваи" />
                </SelectTrigger>
                <SelectContent>
                  {pileGrades.map((g) => (
                    <SelectItem key={g.id} value={g.id} className="text-xs">
                      {g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 flex-shrink-0">
                <Input
                  type="number"
                  min="0"
                  value={row.count || ''}
                  onChange={(e) =>
                    setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, count: Number(e.target.value) || 0 } : p)))
                  }
                  placeholder="шт"
                  className="h-8 w-16 text-xs font-mono text-center"
                />
                <Input
                  type="number"
                  min="0"
                  step="0.1"
                  value={row.metersPerUnit || ''}
                  onChange={(e) =>
                    setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, metersPerUnit: Number(e.target.value) || 0 } : p)))
                  }
                  placeholder="м/шт"
                  className="h-8 w-18 text-xs font-mono text-center"
                />
              </div>
              <span className="text-[10px] font-mono text-slate-500 w-14 text-right flex-shrink-0">
                {row.count * row.metersPerUnit > 0
                  ? `${(row.count * row.metersPerUnit).toFixed(1)} м`
                  : '—'}
              </span>
              <button
                type="button"
                onClick={() => setPlans(plans.filter((p) => p.tempId !== row.tempId))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-500 flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {plans.length > 0 && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-orange-50 rounded-lg text-xs">
          <span className="font-medium text-slate-600">Итого</span>
          <div className="flex items-center gap-3">
            <span className="text-slate-700">
              <span className="font-mono font-semibold">{totalPileCount(plans)}</span> свай
            </span>
            <span className="text-slate-700">
              <span className="font-mono font-semibold">{totalPileMeters(plans).toFixed(1)}</span> м
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface DrillingPlanSectionProps {
  plans: DrillingPlanRow[];
  setPlans: (plans: DrillingPlanRow[]) => void;
}

function DrillingPlanSection({ plans, setPlans }: DrillingPlanSectionProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-semibold flex items-center gap-1.5">
          <Drill className="w-4 h-4 text-blue-500" />
          План бурения
        </Label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-blue-600 hover:text-blue-700 hover:bg-blue-50"
          onClick={() => setPlans([...plans, emptyDrillingPlanRow()])}
        >
          <Plus className="w-3 h-3 mr-1" />
          Добавить строку
        </Button>
      </div>

      {plans.length === 0 ? (
        <p className="text-xs text-slate-400 py-1">Нет запланированного бурения</p>
      ) : (
        <div className="space-y-1.5 max-h-48 overflow-y-auto custom-scrollbar">
          {plans.map((row, idx) => (
            <div key={row.tempId} className="flex items-center gap-1.5 bg-slate-50 rounded-lg p-2">
              <span className="text-[10px] text-slate-400 w-4 text-center flex-shrink-0">{idx + 1}</span>
              <Input
                type="number"
                min="0"
                value={row.diameter || ''}
                onChange={(e) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, diameter: Number(e.target.value) || 0 } : p)))
                }
                placeholder={`\u2300 мм`}
                className="h-8 w-20 text-xs font-mono text-center"
              />
              <Input
                type="number"
                min="0"
                value={row.count || ''}
                onChange={(e) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, count: Number(e.target.value) || 0 } : p)))
                }
                placeholder="шт"
                className="h-8 w-16 text-xs font-mono text-center"
              />
              <Input
                type="number"
                min="0"
                step="0.1"
                value={row.metersPerUnit || ''}
                onChange={(e) =>
                  setPlans(plans.map((p) => (p.tempId === row.tempId ? { ...p, metersPerUnit: Number(e.target.value) || 0 } : p)))
                }
                placeholder="м/шт"
                className="h-8 w-18 text-xs font-mono text-center"
              />
              <span className="text-[10px] font-mono text-slate-500 w-14 text-right flex-shrink-0">
                {row.count * row.metersPerUnit > 0
                  ? `${(row.count * row.metersPerUnit).toFixed(1)} м`
                  : '—'}
              </span>
              <button
                type="button"
                onClick={() => setPlans(plans.filter((p) => p.tempId !== row.tempId))}
                className="w-6 h-6 rounded flex items-center justify-center hover:bg-red-50 text-slate-300 hover:text-red-500 flex-shrink-0"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {plans.length > 0 && (
        <div className="flex items-center justify-between px-2 py-1.5 bg-blue-50 rounded-lg text-xs">
          <span className="font-medium text-slate-600">Итого бурение</span>
          <span className="text-slate-700">
            <span className="font-mono font-semibold">{totalDrillingMeters(plans).toFixed(1)}</span> м
          </span>
        </div>
      )}
    </div>
  );
}

function PlanSummary({
  pilePlans,
  drillingPlans,
}: {
  pilePlans: PilePlanRow[];
  drillingPlans: DrillingPlanRow[];
}) {
  if (pilePlans.length === 0 && drillingPlans.length === 0) return null;

  return (
    <div className="bg-slate-100 rounded-lg p-3 space-y-1">
      <p className="text-xs font-semibold text-slate-700 mb-1">Сводка плана</p>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <HardHat className="w-3 h-3" />
          Всего свай:
        </span>
        <span className="font-mono font-semibold">{totalPileCount(pilePlans)}</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <Ruler className="w-3 h-3" />
          Всего метров свай:
        </span>
        <span className="font-mono font-semibold">{totalPileMeters(pilePlans).toFixed(1)} м</span>
      </div>
      <div className="flex items-center justify-between text-xs text-slate-600">
        <span className="flex items-center gap-1">
          <Drill className="w-3 h-3" />
          Всего бурения:
        </span>
        <span className="font-mono font-semibold">{totalDrillingMeters(drillingPlans).toFixed(1)} м</span>
      </div>
    </div>
  );
}

// ============================================================
// Create Site Dialog
// ============================================================

interface CreateSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingPileGrades: boolean;
  pileGrades: PileGradeDTO[];
  onCreate: (name: string, pilePlans: PilePlanRow[], drillingPlans: DrillingPlanRow[]) => Promise<void>;
}

export function CreateSiteDialog({ open, onOpenChange, loadingPileGrades, pileGrades, onCreate }: CreateSiteDialogProps) {
  const [newSiteName, setNewSiteName] = useState('');
  const [newPilePlans, setNewPilePlans] = useState<PilePlanRow[]>([]);
  const [newDrillingPlans, setNewDrillingPlans] = useState<DrillingPlanRow[]>([]);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!newSiteName.trim()) {
      toast.error('Введите название объекта');
      return;
    }
    setCreating(true);
    try {
      await onCreate(newSiteName.trim(), newPilePlans, newDrillingPlans);
      setNewSiteName('');
      setNewPilePlans([]);
      setNewDrillingPlans([]);
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
                value={newSiteName}
                onChange={(e) => setNewSiteName(e.target.value)}
                placeholder="Например: ЖК Солнечный"
                className="h-11"
                autoFocus
              />
            </div>

            <Separator />

            <PilePlanSection plans={newPilePlans} setPlans={setNewPilePlans} pileGrades={pileGrades} />

            <Separator />

            <DrillingPlanSection plans={newDrillingPlans} setPlans={setNewDrillingPlans} />

            <PlanSummary pilePlans={newPilePlans} drillingPlans={newDrillingPlans} />
          </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={handleCreate}
            disabled={creating || loadingPileGrades || !newSiteName.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Edit Site Dialog
// ============================================================

interface EditSiteDialogProps {
  site: SiteListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadingPileGrades: boolean;
  pileGrades: PileGradeDTO[];
  onSave: (siteId: string, name: string, isActive: boolean, pilePlans: PilePlanRow[], drillingPlans: DrillingPlanRow[]) => Promise<void>;
}

export function EditSiteDialog({ site, open, onOpenChange, loadingPileGrades, pileGrades, onSave }: EditSiteDialogProps) {
  const [editName, setEditName] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editPilePlans, setEditPilePlans] = useState<PilePlanRow[]>([]);
  const [editDrillingPlans, setEditDrillingPlans] = useState<DrillingPlanRow[]>([]);
  const [saving, setSaving] = useState(false);

  // Load site plans when dialog opens
  useEffect(() => {
    if (open && site) {
      setEditName(site.name);
      setEditActive(site.isActive);
      setEditPilePlans([]);
      setEditDrillingPlans([]);

      authFetch(`/api/sites/${site.id}`)
        .then(async (res) => {
          if (res.ok) {
            const data = await res.json();
            const fullSite = data.site as { pilePlans?: SitePilePlanDTO[]; drillingPlans?: SiteDrillingPlanDTO[] };
            if (fullSite.pilePlans && fullSite.pilePlans.length > 0) {
              setEditPilePlans(
                fullSite.pilePlans.map((p: SitePilePlanDTO) => ({
                  tempId: p.id,
                  pileGradeId: p.pileGradeId,
                  count: p.count,
                  metersPerUnit: p.metersPerUnit,
                }))
              );
            }
            if (fullSite.drillingPlans && fullSite.drillingPlans.length > 0) {
              setEditDrillingPlans(
                fullSite.drillingPlans.map((p: SiteDrillingPlanDTO) => ({
                  tempId: p.id,
                  diameter: p.diameter,
                  count: p.count,
                  metersPerUnit: p.metersPerUnit,
                }))
              );
            }
          }
        })
        .catch(() => {});
    }
  }, [open, site]);

  const handleSave = async () => {
    if (!site || !editName.trim()) {
      toast.error('Введите название');
      return;
    }
    setSaving(true);
    try {
      await onSave(site.id, editName.trim(), editActive, editPilePlans, editDrillingPlans);
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
          {loadingPileGrades ? (
            <div className="space-y-3 pb-2">
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-24 w-full" />
            </div>
          ) : (
          <div className="space-y-4 pb-2">
            <div className="space-y-1.5">
              <Label>Название объекта</Label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-11"
                autoFocus
              />
            </div>

            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
              <Label className="text-sm">Активен</Label>
              <button
                onClick={() => setEditActive(!editActive)}
                className={cn(
                  'w-10 h-6 rounded-full transition-colors relative',
                  editActive ? 'bg-green-500' : 'bg-slate-300'
                )}
              >
                <div
                  className={cn(
                    'w-4 h-4 rounded-full bg-white absolute top-1 transition-transform',
                    editActive ? 'translate-x-5' : 'translate-x-1'
                  )}
                />
              </button>
            </div>

            <Separator />

            <PilePlanSection plans={editPilePlans} setPlans={setEditPilePlans} pileGrades={pileGrades} />

            <Separator />

            <DrillingPlanSection plans={editDrillingPlans} setPlans={setEditDrillingPlans} />

            <PlanSummary pilePlans={editPilePlans} drillingPlans={editDrillingPlans} />
          </div>
          )}
        </ScrollArea>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={handleSave}
            disabled={saving || loadingPileGrades || !editName.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Сохранить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Delete Confirmation Dialog
// ============================================================

interface DeleteSiteDialogProps {
  site: SiteListItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => Promise<void>;
}

export function DeleteSiteDialog({ site, open, onOpenChange, onConfirm }: DeleteSiteDialogProps) {
  const [deleting, setDeleting] = useState(false);

  const handleConfirm = async () => {
    setDeleting(true);
    try {
      await onConfirm();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="text-red-600">Удалить объект?</DialogTitle>
          <DialogDescription>
            Объект «{site?.name}» будет удалён вместе со всеми отчётами, иерархией, планами и назначениями. Это действие нельзя отменить.
          </DialogDescription>
        </DialogHeader>
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-red-700">
            Все отчёты, планы свай и бурения, привязанные к этому объекту, будут безвозвратно удалены.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={handleConfirm}
            disabled={deleting}
            variant="destructive"
            className="bg-red-500 hover:bg-red-600 text-white"
          >
            {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Удалить навсегда'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ============================================================
// Add Hierarchy Dialog
// ============================================================

interface AddHierarchyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  type: 'field' | 'cluster' | 'picket';
  onAdd: (name: string) => Promise<void>;
}

const typeLabels: Record<string, string> = {
  field: 'Свайное поле',
  cluster: 'Куст',
  picket: 'Пикет',
};

export function AddHierarchyDialog({ open, onOpenChange, type, onAdd }: AddHierarchyDialogProps) {
  const [addName, setAddName] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!addName.trim()) {
      toast.error('Введите название');
      return;
    }
    setAdding(true);
    try {
      await onAdd(addName.trim());
      setAddName('');
    } finally {
      setAdding(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Добавить {typeLabels[type]}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Название</Label>
            <Input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={`Название ${typeLabels[type].toLowerCase()}`}
              className="h-11"
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button
            onClick={handleAdd}
            disabled={adding || !addName.trim()}
            className="bg-orange-500 hover:bg-orange-600 text-white"
          >
            {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Добавить'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
