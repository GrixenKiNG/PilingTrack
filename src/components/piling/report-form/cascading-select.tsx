'use client';

import { MapPin } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SiteWithTreeDTO } from '@/lib/types';

interface CascadingSelectProps {
  siteTree: SiteWithTreeDTO | null;
  selectedFieldId: string;
  selectedClusterId: string;
  selectedPicketId: string;
  onFieldChange: (v: string) => void;
  onClusterChange: (v: string) => void;
  onPicketChange: (v: string) => void;
}

export function CascadingSelect({
  siteTree, selectedFieldId, selectedClusterId, selectedPicketId,
  onFieldChange, onClusterChange, onPicketChange,
}: CascadingSelectProps) {
  if (!siteTree || !siteTree.fields.length) return null;
  const fields = siteTree.fields;
  const selectedField = fields.find((f) => f.id === selectedFieldId);
  const clusters = selectedField?.clusters || [];
  const selectedCluster = clusters.find((c) => c.id === selectedClusterId);
  const pickets = selectedCluster?.pickets || [];

  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 flex items-center gap-2">
          <MapPin className="w-4 h-4 text-orange-500" />Привязка к объекту
        </h3>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-slate-600">Свайное поле</Label>
          <Select value={selectedFieldId} onValueChange={onFieldChange}>
            <SelectTrigger className="w-full h-11"><SelectValue placeholder="Выберите свайное поле..." /></SelectTrigger>
            <SelectContent>{fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-slate-600">Куст</Label>
          <Select value={selectedClusterId} onValueChange={onClusterChange} disabled={!selectedFieldId}>
            <SelectTrigger className="w-full h-11"><SelectValue placeholder={!selectedFieldId ? 'Сначала выберите поле' : 'Выберите куст...'} /></SelectTrigger>
            <SelectContent>{clusters.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-slate-600">Пикет</Label>
          <Select value={selectedPicketId} onValueChange={onPicketChange} disabled={!selectedClusterId}>
            <SelectTrigger className="w-full h-11"><SelectValue placeholder={!selectedClusterId ? 'Сначала выберите куст' : 'Выберите пикет...'} /></SelectTrigger>
            <SelectContent>{pickets.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
