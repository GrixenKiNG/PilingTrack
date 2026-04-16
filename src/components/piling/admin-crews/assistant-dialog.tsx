'use client';

import { UserPlus, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import type { UserDTO } from '@/lib/types';

interface AssistantDialogProps {
  open: boolean;
  onClose: () => void;
  assistantUsers: UserDTO[];
  selectedNames: string[];
  onToggleName: (name: string) => void;
  onRemoveName: (name: string) => void;
  onConfirm: () => void;
  label: string;
}

export function AssistantDialog({ open, onClose, assistantUsers, selectedNames, onToggleName, onRemoveName, onConfirm, label }: AssistantDialogProps) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filtered = query ? assistantUsers.filter(u => u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)) : assistantUsers;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="h-4 w-4" />{label}</DialogTitle>
          <DialogDescription>Выберите помощников из списка доступных пользователей</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Поиск по имени или email..." value={search} onChange={e => setSearch(e.target.value)} className="h-10" />
          <div className="max-h-64 overflow-y-auto space-y-2">
            {filtered.map(u => (
              <label key={u.id} className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-slate-50 transition-colors">
                <Checkbox checked={selectedNames.includes(u.name)} onCheckedChange={() => onToggleName(u.name)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{u.name}</p>
                  <p className="text-xs text-slate-500">{u.email}</p>
                </div>
              </label>
            ))}
            {filtered.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Пользователи не найдены</p>}
          </div>
          {selectedNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              {selectedNames.map(name => (
                <span key={name} className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700">
                  {name}
                  <button type="button" onClick={() => onRemoveName(name)} className="rounded p-0.5 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700" title="Удалить">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-400">{selectedNames.length} помощник(ов) выбрано</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Отмена</Button>
          <Button onClick={onConfirm} className="bg-orange-500 text-white hover:bg-orange-600">Применить</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
