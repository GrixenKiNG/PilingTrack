'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar } from 'lucide-react';
import type { ReportFilters } from './types';

interface ReportFiltersProps {
  filters: ReportFilters;
  onFiltersChange: (filters: ReportFilters) => void;
  sites: Array<{ id: string; name: string }>;
  users: Array<{ id: string; name: string }>;
}

export function ReportFilters({ filters, onFiltersChange, sites, users }: ReportFiltersProps) {
  const updateFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => {
    onFiltersChange({ ...filters, [key]: value });
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3 p-4 bg-white rounded-lg border">
      {/* Date From */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5" />
          Дата от
        </Label>
        <Input
          type="date"
          value={filters.dateFrom || ''}
          onChange={(e) => updateFilter('dateFrom', e.target.value || undefined)}
          className="h-10"
        />
      </div>

      {/* Date To */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5" />
          Дата до
        </Label>
        <Input
          type="date"
          value={filters.dateTo || ''}
          onChange={(e) => updateFilter('dateTo', e.target.value || undefined)}
          className="h-10"
        />
      </div>

      {/* Site */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-slate-600">Объект</Label>
        <Select
          value={filters.siteId || 'all'}
          onValueChange={(val) => updateFilter('siteId', val === 'all' ? undefined : val)}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Все объекты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все объекты</SelectItem>
            {sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* User */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-slate-600">Оператор</Label>
        <Select
          value={filters.userId || 'all'}
          onValueChange={(val) => updateFilter('userId', val === 'all' ? undefined : val)}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Все операторы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все операторы</SelectItem>
            {users.map((user) => (
              <SelectItem key={user.id} value={user.id}>{user.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Status */}
      <div className="space-y-1.5">
        <Label className="text-xs font-medium text-slate-600">Статус</Label>
        <Select
          value={filters.status || 'all'}
          onValueChange={(val) => updateFilter('status', val === 'all' ? undefined : val)}
        >
          <SelectTrigger className="h-10">
            <SelectValue placeholder="Все статусы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="draft">Черновик</SelectItem>
            <SelectItem value="submitted">Отправлен</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
