'use client';

import { Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UserRole } from '@/lib/types';

interface UserFiltersProps {
  search: string;
  roleFilter: 'ALL' | UserRole;
  onSearchChange: (value: string) => void;
  onRoleFilterChange: (value: 'ALL' | UserRole) => void;
}

export function UserFilters({
  search,
  roleFilter,
  onSearchChange,
  onRoleFilterChange,
}: UserFiltersProps) {
  return (
    <Card>
      <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Быстрый поиск по имени, email или роли"
            className="pl-9"
          />
        </div>
        <Select
          value={roleFilter}
          onValueChange={(value) => onRoleFilterChange(value as 'ALL' | UserRole)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Все роли" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Все роли</SelectItem>
            <SelectItem value="OPERATOR">Операторы</SelectItem>
            <SelectItem value="ASSISTANT">Помощники</SelectItem>
            <SelectItem value="DISPATCHER">Диспетчеры</SelectItem>
            <SelectItem value="ADMIN">Администраторы</SelectItem>
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  );
}
