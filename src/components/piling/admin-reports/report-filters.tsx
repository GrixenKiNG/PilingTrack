'use client';

import { Filter } from '@/components/piling/icons/unified-icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { SiteFlatDTO } from '@/lib/types';

interface OperatorOption {
  id: string;
  name: string;
}

interface EquipmentOption {
  id: string;
  name: string;
}

interface ReportFiltersProps {
  sites: SiteFlatDTO[];
  filterSiteId: string;
  onFilterSiteChange: (v: string) => void;
  equipment: EquipmentOption[];
  filterEquipmentId: string;
  onFilterEquipmentChange: (v: string) => void;
  operators: OperatorOption[];
  filterUserId: string;
  onFilterUserChange: (v: string) => void;
}

export function ReportFilters({
  sites, filterSiteId, onFilterSiteChange,
  equipment, filterEquipmentId, onFilterEquipmentChange,
  operators, filterUserId, onFilterUserChange,
}: ReportFiltersProps) {
  if (sites.length === 0 && equipment.length === 0 && operators.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Filter className="hidden h-4 w-4 flex-shrink-0 text-slate-400 sm:block" />
      {sites.length > 0 && (
        <Select value={filterSiteId} onValueChange={onFilterSiteChange}>
          <SelectTrigger className="h-10 w-full sm:max-w-xs">
            <SelectValue placeholder="Все объекты" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все объекты</SelectItem>
            {sites.map((site) => (
              <SelectItem key={site.id} value={site.id}>{site.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {equipment.length > 0 && (
        <Select value={filterEquipmentId} onValueChange={onFilterEquipmentChange}>
          <SelectTrigger className="h-10 w-full sm:max-w-xs">
            <SelectValue placeholder="Все установки" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все установки</SelectItem>
            {equipment.map((item) => (
              <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {operators.length > 0 && (
        <Select value={filterUserId} onValueChange={onFilterUserChange}>
          <SelectTrigger className="h-10 w-full sm:max-w-xs">
            <SelectValue placeholder="Все операторы" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все операторы</SelectItem>
            {operators.map((op) => (
              <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
