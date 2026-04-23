'use client';

import { useEffect, useState } from 'react';
import {
  Loader2,
  Pencil,
  Plus,
  Users,
  UserPlus,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { CrewDTO, EquipmentDTO, SiteDTO, UserDTO } from '@/lib/types';

interface CrewFormDialogProps {
  open: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  editItem: CrewDTO | null;
  operators: UserDTO[];
  equipment: EquipmentDTO[];
  sites: SiteDTO[];
  assistants: UserDTO[];
  assignedOperatorIds: Set<string>;
  excludeCrewId?: string;
  loadingReferenceData: boolean;
  onSubmit: (data: {
    operatorId: string;
    equipmentId: string;
    siteId: string;
    name?: string;
    assistantNames?: string[];
    isActive: boolean;
  }) => Promise<void>;
  submitting: boolean;
}

function AssistantSelector({
  label,
  names,
  onOpen,
}: {
  label: string;
  names: string[];
  onOpen: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <UserPlus className="h-3.5 w-3.5 text-slate-500" />
        {label}
      </Label>
      <Button
        type="button"
        variant="outline"
        onClick={onOpen}
        className="w-full justify-start gap-2"
      >
        <UserPlus className="h-4 w-4" />
        {names.length > 0 ? 'Изменить состав помощников' : 'Выбрать помощников'}
      </Button>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          {names.map(name => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
            >
              {name}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Помощники не выбраны</p>
      )}
      <p className="text-xs text-slate-400">
        {names.length} помощник(ов) в составе бригады
      </p>
    </div>
  );
}

export function CrewFormDialog({
  open,
  onClose,
  mode,
  editItem,
  operators,
  equipment,
  sites,
  assistants,
  assignedOperatorIds,
  loadingReferenceData,
  onSubmit,
  submitting,
}: CrewFormDialogProps) {
  const [operatorId, setOperatorId] = useState(editItem?.operatorId || '');
  const [equipmentId, setEquipmentId] = useState(editItem?.equipmentId || '');
  const [siteId, setSiteId] = useState(editItem?.siteId || '');
  const [name, setName] = useState(editItem?.name || '');
  const [assistantNames, setAssistantNames] = useState<string[]>(
    editItem?.assistants?.map(assistant => assistant.name) || [],
  );
  const [active, setActive] = useState(editItem?.isActive ?? true);
  const [showAssistantDialog, setShowAssistantDialog] = useState(false);

  useEffect(() => {
    if (open) {
      setOperatorId(editItem?.operatorId || '');
      setEquipmentId(editItem?.equipmentId || '');
      setSiteId(editItem?.siteId || '');
      setName(editItem?.name || '');
      setAssistantNames(editItem?.assistants?.map(assistant => assistant.name) || []);
      setActive(editItem?.isActive ?? true);
      setShowAssistantDialog(false);
    } else if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }, [open, editItem]);

  const availableOps = operators.filter(
    operator => !assignedOperatorIds.has(operator.id) || operator.id === editItem?.operatorId,
  );

  const handleSubmit = async () => {
    if (!operatorId || !equipmentId || !siteId) {
      toast.error('Выберите оператора, установку и объект');
      return;
    }

    await onSubmit({
      operatorId,
      equipmentId,
      siteId,
      name: name.trim() || undefined,
      assistantNames,
      isActive: mode === 'edit' ? active : true,
    });
  };

  const handleClose = () => {
    onClose();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {mode === 'edit'
                ? <Pencil className="h-4 w-4" />
                : <Users className="h-4 w-4" />}
              {mode === 'edit' ? 'Редактировать бригаду' : 'Новая бригада'}
            </DialogTitle>
          </DialogHeader>

          {loadingReferenceData ? (
            <div className="space-y-3 py-2">
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-11 w-full" />
              </div>
              <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin" />
                Загрузка справочников формы...
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>
                  Оператор <span className="text-red-500">*</span>
                </Label>
                <Select value={operatorId} onValueChange={setOperatorId}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue placeholder="Выберите оператора" />
                  </SelectTrigger>
                  <SelectContent>
                    {availableOps.map(user => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>
                  Установка <span className="text-red-500">*</span>
                </Label>
                <Select value={equipmentId} onValueChange={setEquipmentId}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue placeholder="Выберите установку" />
                  </SelectTrigger>
                  <SelectContent>
                    {equipment.map(item => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>
                  Объект <span className="text-red-500">*</span>
                </Label>
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger className="h-11 w-full">
                    <SelectValue placeholder="Выберите объект" />
                  </SelectTrigger>
                  <SelectContent>
                    {sites.map(site => (
                      <SelectItem key={site.id} value={site.id}>
                        {site.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Название (необязательно)</Label>
                <Input
                  value={name}
                  onChange={event => setName(event.target.value)}
                  placeholder="Бригада №1"
                  className="h-11"
                />
              </div>

              <AssistantSelector
                label="Помощники"
                names={assistantNames}
                onOpen={() => setShowAssistantDialog(true)}
              />

              {mode === 'edit' && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={active}
                    onCheckedChange={value => setActive(!!value)}
                    id="active-check"
                  />
                  <Label htmlFor="active-check" className="cursor-pointer">
                    Активна
                  </Label>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={handleClose}>
              Отмена
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={submitting || loadingReferenceData || !operatorId || !equipmentId || !siteId}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {submitting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Plus className="h-4 w-4" />}
              {mode === 'edit' ? 'Сохранить' : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AssistantSelectorModal
        open={showAssistantDialog}
        onClose={() => setShowAssistantDialog(false)}
        assistantUsers={assistants}
        selectedNames={assistantNames}
        onToggleName={(selectedName) => setAssistantNames(prev => (
          prev.includes(selectedName)
            ? prev.filter(nameItem => nameItem !== selectedName)
            : [...prev, selectedName]
        ))}
        onRemoveName={(removedName) => setAssistantNames(prev => (
          prev.filter(nameItem => nameItem !== removedName)
        ))}
        onConfirm={() => setShowAssistantDialog(false)}
      />
    </>
  );
}

function AssistantSelectorModal({
  open,
  onClose,
  assistantUsers,
  selectedNames,
  onToggleName,
  onRemoveName,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  assistantUsers: UserDTO[];
  selectedNames: string[];
  onToggleName: (name: string) => void;
  onRemoveName: (name: string) => void;
  onConfirm: () => void;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const filteredUsers = query
    ? assistantUsers.filter(user => (
      user.name.toLowerCase().includes(query)
      || user.email.toLowerCase().includes(query)
    ))
    : assistantUsers;

  const handleClose = () => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }

    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) handleClose(); }}>
      <DialogContent className="max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" />
            Выбрать помощников
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <Input
            placeholder="Поиск по имени или email..."
            value={search}
            onChange={event => setSearch(event.target.value)}
            className="h-10"
          />

          <div className="max-h-64 space-y-2 overflow-y-auto">
            {filteredUsers.map(user => (
              <label
                key={user.id}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-slate-50"
              >
                <Checkbox
                  checked={selectedNames.includes(user.name)}
                  onCheckedChange={() => onToggleName(user.name)}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{user.name}</p>
                  <p className="text-xs text-slate-500">{user.email}</p>
                </div>
              </label>
            ))}

            {filteredUsers.length === 0 && (
              <p className="py-4 text-center text-sm text-slate-500">
                Пользователи не найдены
              </p>
            )}
          </div>

          {selectedNames.length > 0 && (
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
              {selectedNames.map(name => (
                <span
                  key={name}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
                >
                  {name}
                  <button
                    type="button"
                    onClick={() => onRemoveName(name)}
                    className="rounded p-0.5 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-3 w-3"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </span>
              ))}
            </div>
          )}

          <p className="text-xs text-slate-400">
            {selectedNames.length} помощник(ов) выбрано
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={onConfirm} className="bg-orange-500 text-white hover:bg-orange-600">
            Применить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
