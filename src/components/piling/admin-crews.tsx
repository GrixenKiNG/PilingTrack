'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  HardHat,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Trash2,
  UserPlus,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Checkbox } from '@/components/ui/checkbox';
import { pluralizeRu } from '@/lib/format';
import type { CrewDTO, EquipmentDTO, SiteDTO, UserDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

type AssistantDialogMode = 'create' | 'edit' | null;

export function AdminCrews() {
  const [crews, setCrews] = useState<CrewDTO[]>([]);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [equipmentList, setEquipmentList] = useState<EquipmentDTO[]>([]);
  const [sites, setSites] = useState<SiteDTO[]>([]);
  const [loading, setLoading] = useState(true);

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newOperatorId, setNewOperatorId] = useState('');
  const [newEquipmentId, setNewEquipmentId] = useState('');
  const [newSiteId, setNewSiteId] = useState('');
  const [newName, setNewName] = useState('');
  const [newAssistantNames, setNewAssistantNames] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editItem, setEditItem] = useState<CrewDTO | null>(null);
  const [editOperatorId, setEditOperatorId] = useState('');
  const [editEquipmentId, setEditEquipmentId] = useState('');
  const [editSiteId, setEditSiteId] = useState('');
  const [editName, setEditName] = useState('');
  const [editAssistantNames, setEditAssistantNames] = useState<string[]>([]);
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteItem, setDeleteItem] = useState<CrewDTO | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const [assistantDialogMode, setAssistantDialogMode] = useState<AssistantDialogMode>(null);
  const [assistantSearch, setAssistantSearch] = useState('');

  const formatCrewCount = (count: number) =>
    `${count} ${pluralizeRu(count, ['бригада', 'бригады', 'бригад'])}`;

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [crewsRes, usersRes, equipmentRes, sitesRes] = await Promise.all([
        authFetch('/api/crews'),
        authFetch('/api/users'),
        authFetch('/api/equipment'),
        authFetch('/api/sites/all'),
      ]);

      if (crewsRes.ok) {
        const data = await crewsRes.json();
        setCrews(data.data || data.crews || []);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUsers(data.users || []);
      }
      if (equipmentRes.ok) {
        const data = await equipmentRes.json();
        setEquipmentList(data.data || data.equipment || []);
      }
      if (sitesRes.ok) {
        const data = await sitesRes.json();
        setSites(data.sites || []);
      }
    } catch {
      toast.error('Ошибка загрузки данных');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const getAssignedOperatorIds = useCallback(
    (excludeCrewId?: string) => {
      const ids = new Set<string>();
      crews
        .filter((crew) => crew.isActive && (!excludeCrewId || crew.id !== excludeCrewId))
        .forEach((crew) => {
          if (crew.operatorId) {
            ids.add(crew.operatorId);
          }
        });
      return ids;
    },
    [crews]
  );

  const availableOperators = useMemo(
    () => users.filter((user) => user.role === 'OPERATOR' && user.isActive),
    [users]
  );

  const assistantUsers = useMemo(
    () =>
      users
        .filter((user) => user.role === 'ASSISTANT' && user.isActive)
        .sort((left, right) => left.name.localeCompare(right.name, 'ru')),
    [users]
  );

  const activeEquipment = useMemo(
    () => equipmentList.filter((item) => item.isActive),
    [equipmentList]
  );

  const activeSites = useMemo(() => sites.filter((site) => site.isActive), [sites]);

  const selectedAssistantNames = assistantDialogMode === 'edit' ? editAssistantNames : newAssistantNames;

  const filteredAssistantUsers = useMemo(() => {
    const query = assistantSearch.trim().toLowerCase();
    if (!query) {
      return assistantUsers;
    }
    return assistantUsers.filter((assistant) => {
      return (
        assistant.name.toLowerCase().includes(query) ||
        assistant.email.toLowerCase().includes(query)
      );
    });
  }, [assistantSearch, assistantUsers]);

  const openAssistantDialog = (mode: Exclude<AssistantDialogMode, null>) => {
    setAssistantDialogMode(mode);
    setAssistantSearch('');
  };

  const closeAssistantDialog = () => {
    setAssistantDialogMode(null);
    setAssistantSearch('');
  };

  const setAssistantSelection = (names: string[]) => {
    if (assistantDialogMode === 'edit') {
      setEditAssistantNames(names);
      return;
    }
    setNewAssistantNames(names);
  };

  const toggleAssistantSelection = (name: string) => {
    if (selectedAssistantNames.includes(name)) {
      setAssistantSelection(selectedAssistantNames.filter((item) => item !== name));
      return;
    }
    setAssistantSelection([...selectedAssistantNames, name]);
  };

  const removeAssistantFromSelection = (mode: Exclude<AssistantDialogMode, null>, name: string) => {
    if (mode === 'edit') {
      setEditAssistantNames((prev) => prev.filter((item) => item !== name));
      return;
    }
    setNewAssistantNames((prev) => prev.filter((item) => item !== name));
  };

  const openCreateDialog = () => {
    setNewOperatorId('');
    setNewEquipmentId('');
    setNewSiteId('');
    setNewName('');
    setNewAssistantNames([]);
    setShowCreateDialog(true);
  };

  const openEditDialog = (crew: CrewDTO) => {
    setEditItem(crew);
    setEditOperatorId(crew.operatorId);
    setEditEquipmentId(crew.equipmentId);
    setEditSiteId(crew.siteId);
    setEditName(crew.name);
    setEditAssistantNames(crew.assistants?.map((assistant) => assistant.name) || []);
    setEditActive(crew.isActive);
    setShowEditDialog(true);
  };

  const handleCreate = async () => {
    if (!newOperatorId || !newEquipmentId || !newSiteId) {
      toast.error('Выберите оператора, установку и объект');
      return;
    }

    if (getAssignedOperatorIds().has(newOperatorId)) {
      const operator = users.find((user) => user.id === newOperatorId);
      toast.error(`Оператор ${operator?.name || ''} уже назначен в другую бригаду`);
      return;
    }

    setCreating(true);
    try {
      const res = await authFetch('/api/crews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: newOperatorId,
          equipmentId: newEquipmentId,
          siteId: newSiteId,
          name: newName.trim() || undefined,
          assistantNames: newAssistantNames,
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Ошибка создания');
      }

      const data = await res.json();
      setCrews((prev) => [...prev, data.crew]);
      setShowCreateDialog(false);
      toast.success('Бригада создана');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка создания бригады');
    } finally {
      setCreating(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editItem || !editOperatorId || !editEquipmentId || !editSiteId) {
      toast.error('Выберите оператора, установку и объект');
      return;
    }

    if (getAssignedOperatorIds(editItem.id).has(editOperatorId)) {
      const operator = users.find((user) => user.id === editOperatorId);
      toast.error(`Оператор ${operator?.name || ''} уже назначен в другую бригаду`);
      return;
    }

    setSaving(true);
    try {
      const res = await authFetch(`/api/crews/${editItem.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operatorId: editOperatorId,
          equipmentId: editEquipmentId,
          siteId: editSiteId,
          name: editName.trim() || undefined,
          assistantNames: editAssistantNames,
          isActive: editActive,
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Ошибка сохранения');
      }

      const data = await res.json();
      setCrews((prev) => prev.map((crew) => (crew.id === editItem.id ? data.crew : crew)));
      setShowEditDialog(false);
      toast.success('Бригада сохранена');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const openDeleteDialog = (crew: CrewDTO) => {
    setDeleteItem(crew);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteItem) return;

    setDeleting(true);
    try {
      const res = await authFetch(`/api/crews/${deleteItem.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Ошибка удаления');
      }

      setCrews((prev) => prev.filter((crew) => crew.id !== deleteItem.id));
      setDeleteItem(null);
      setShowDeleteDialog(false);
      toast.success('Бригада удалена');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка удаления бригады');
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (crew: CrewDTO) => {
    setTogglingId(crew.id);
    try {
      const res = await authFetch(`/api/crews/${crew.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !crew.isActive }),
      });

      if (!res.ok) {
        throw new Error();
      }

      const data = await res.json();
      setCrews((prev) => prev.map((item) => (item.id === crew.id ? data.crew : item)));
      toast.success(crew.isActive ? 'Бригада деактивирована' : 'Бригада активирована');
    } catch {
      toast.error('Ошибка изменения статуса');
    } finally {
      setTogglingId(null);
    }
  };

  const renderAssistantSelector = (
    label: string,
    names: string[],
    mode: Exclude<AssistantDialogMode, null>
  ) => (
    <div className="space-y-1.5">
      <Label className="flex items-center gap-1.5">
        <UserPlus className="h-3.5 w-3.5 text-slate-500" />
        {label}
      </Label>
      <Button
        type="button"
        variant="outline"
        onClick={() => openAssistantDialog(mode)}
        className="w-full justify-start gap-2"
      >
        <UserPlus className="h-4 w-4" />
        {names.length > 0 ? 'Изменить состав помощников' : 'Выбрать помощников'}
      </Button>
      {names.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-slate-200 bg-slate-50 p-2.5">
          {names.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-700"
            >
              {name}
              <button
                type="button"
                onClick={() => removeAssistantFromSelection(mode, name)}
                className="rounded p-0.5 text-amber-500 transition-colors hover:bg-amber-100 hover:text-amber-700"
                title="Удалить из бригады"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-400">Помощники не выбраны</p>
      )}
      <p className="text-xs text-slate-400">{names.length} помощник(ов) в составе бригады</p>
    </div>
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Users className="h-5 w-5 text-orange-500" />
          Бригады
          <Badge variant="secondary" className="ml-2 font-mono text-xs">
            {formatCrewCount(crews.length)}
          </Badge>
        </h1>
        <Button onClick={openCreateDialog} className="bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="mr-1 h-4 w-4" />
          Добавить
        </Button>
      </div>

      {crews.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">Нет бригад</p>
          <p className="mt-1 text-xs text-slate-400">Создайте первую бригаду для начала работы</p>
        </div>
      ) : (
        <div className="space-y-2">
          {crews.map((crew, index) => (
            <motion.div
              key={crew.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index < 20 ? index * 0.03 : 0 }}
            >
              <Card className={cn('transition-all', !crew.isActive && 'border-dashed border-slate-300 opacity-60')}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <div
                        className={cn(
                          'mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                          crew.isActive ? 'bg-emerald-100 text-emerald-600' : 'bg-slate-100 text-slate-400'
                        )}
                      >
                        <Users className="h-5 w-5" />
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className={cn('truncate text-sm font-semibold text-slate-900', !crew.isActive && 'line-through text-slate-400')}>
                            {crew.name || 'Бригада'}
                          </p>
                          <Badge
                            variant={crew.isActive ? 'default' : 'secondary'}
                            className={
                              crew.isActive
                                ? 'border-green-200 bg-green-100 text-green-700'
                                : 'border-slate-200 bg-slate-100 text-slate-500'
                            }
                          >
                            {crew.isActive ? 'Активна' : 'Неактивна'}
                          </Badge>
                        </div>

                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-slate-500">
                          {crew.operator && (
                            <span className="flex items-center gap-1">
                              <HardHat className="h-3 w-3" />
                              {crew.operator.name}
                            </span>
                          )}
                          {crew.equipment && (
                            <span className="flex items-center gap-1">
                              <Wrench className="h-3 w-3" />
                              {crew.equipment.name}
                            </span>
                          )}
                          {crew.site && (
                            <span className="flex items-center gap-1">
                              <MapPin className="h-3 w-3" />
                              {crew.site.name}
                            </span>
                          )}
                        </div>

                        {crew.assistants.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {crew.assistants.map((assistant) => (
                              <span
                                key={assistant.id}
                                className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
                              >
                                <HardHat className="h-3 w-3" />
                                {assistant.name}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      <button
                        onClick={() => openEditDialog(crew)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-orange-50 hover:text-orange-600"
                        title="Редактировать"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleToggleActive(crew)}
                        disabled={togglingId === crew.id}
                        className={cn(
                          'flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50',
                          crew.isActive
                            ? 'text-slate-400 hover:bg-amber-100 hover:text-amber-600'
                            : 'text-slate-400 hover:bg-green-100 hover:text-green-600'
                        )}
                        title={crew.isActive ? 'Деактивировать' : 'Активировать'}
                      >
                        {togglingId === crew.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : crew.isActive ? (
                          <PowerOff className="h-4 w-4" />
                        ) : (
                          <Power className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        onClick={() => openDeleteDialog(crew)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-50 hover:text-red-500"
                        title="Удалить"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Новая бригада
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Оператор <span className="text-red-500">*</span></Label>
              <Select value={newOperatorId} onValueChange={setNewOperatorId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите оператора" />
                </SelectTrigger>
                <SelectContent>
                  {availableOperators.map((user) => {
                    const isAssigned = getAssignedOperatorIds().has(user.id);
                    return (
                      <SelectItem key={user.id} value={user.id} disabled={isAssigned}>
                        {user.name}{isAssigned ? ' (уже в бригаде)' : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Установка <span className="text-red-500">*</span></Label>
              <Select value={newEquipmentId} onValueChange={setNewEquipmentId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите установку" />
                </SelectTrigger>
                <SelectContent>
                  {activeEquipment.map((equipment) => (
                    <SelectItem key={equipment.id} value={equipment.id}>
                      {equipment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Объект <span className="text-red-500">*</span></Label>
              <Select value={newSiteId} onValueChange={setNewSiteId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите объект" />
                </SelectTrigger>
                <SelectContent>
                  {activeSites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Название (необязательно)</Label>
              <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Бригада №1" className="h-11" />
            </div>

            {renderAssistantSelector('Помощники', newAssistantNames, 'create')}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleCreate}
              disabled={creating || !newOperatorId || !newEquipmentId || !newSiteId}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Редактировать бригаду
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Оператор <span className="text-red-500">*</span></Label>
              <Select value={editOperatorId} onValueChange={setEditOperatorId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите оператора" />
                </SelectTrigger>
                <SelectContent>
                  {availableOperators.map((user) => {
                    const isAssigned = editItem ? getAssignedOperatorIds(editItem.id).has(user.id) : false;
                    return (
                      <SelectItem key={user.id} value={user.id} disabled={isAssigned}>
                        {user.name}{isAssigned ? ' (уже в бригаде)' : ''}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Установка <span className="text-red-500">*</span></Label>
              <Select value={editEquipmentId} onValueChange={setEditEquipmentId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите установку" />
                </SelectTrigger>
                <SelectContent>
                  {activeEquipment.map((equipment) => (
                    <SelectItem key={equipment.id} value={equipment.id}>
                      {equipment.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Объект <span className="text-red-500">*</span></Label>
              <Select value={editSiteId} onValueChange={setEditSiteId}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue placeholder="Выберите объект" />
                </SelectTrigger>
                <SelectContent>
                  {activeSites.map((site) => (
                    <SelectItem key={site.id} value={site.id}>
                      {site.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Название (необязательно)</Label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Бригада №1" className="h-11" />
            </div>

            {renderAssistantSelector('Помощники', editAssistantNames, 'edit')}

            <div className="flex items-center justify-between rounded-lg bg-slate-50 p-3">
              <Label className="text-sm">Активна</Label>
              <button
                onClick={() => setEditActive((value) => !value)}
                className={cn('relative h-6 w-10 rounded-full transition-colors', editActive ? 'bg-green-500' : 'bg-slate-300')}
              >
                <div
                  className={cn(
                    'absolute top-1 h-4 w-4 rounded-full bg-white transition-transform',
                    editActive ? 'translate-x-5' : 'translate-x-1'
                  )}
                />
              </button>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleSaveEdit}
              disabled={saving || !editOperatorId || !editEquipmentId || !editSiteId}
              className="bg-orange-500 text-white hover:bg-orange-600"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">Удалить бригаду?</DialogTitle>
            <DialogDescription>
              Бригада «{deleteItem?.name || 'Бригада'}» будет удалена. Это действие нельзя отменить.
            </DialogDescription>
          </DialogHeader>

          {deleteItem?.assistants.length ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 text-xs font-medium text-amber-700">Помощники в бригаде:</p>
              <div className="flex flex-wrap gap-1">
                {deleteItem.assistants.map((assistant) => (
                  <span key={assistant.id} className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                    {assistant.name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            <p className="text-xs text-red-700">
              Все связанные данные бригады будут удалены. Оператор будет освобождён от назначения.
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDeleteDialog(false)}>
              Отмена
            </Button>
            <Button
              onClick={handleConfirmDelete}
              disabled={deleting}
              variant="destructive"
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить навсегда'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={assistantDialogMode !== null} onOpenChange={(open) => !open && closeAssistantDialog()}>
        <DialogContent className="max-h-[85vh] overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" />
              Выбор помощников
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                value={assistantSearch}
                onChange={(e) => setAssistantSearch(e.target.value)}
                placeholder="Поиск по имени или email"
                className="pl-9"
              />
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {filteredAssistantUsers.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">Помощники не найдены</p>
              ) : (
                filteredAssistantUsers.map((assistant) => {
                  const checked = selectedAssistantNames.includes(assistant.name);
                  return (
                    <label
                      key={assistant.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                        checked ? 'border-amber-300 bg-amber-50' : 'border-slate-200 hover:bg-slate-50'
                      )}
                    >
                      <Checkbox checked={checked} onCheckedChange={() => toggleAssistantSelection(assistant.name)} className="mt-0.5" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-slate-900">{assistant.name}</p>
                        <p className="text-xs text-slate-500">{assistant.email}</p>
                      </div>
                    </label>
                  );
                })
              )}
            </div>

            <div className="text-xs text-slate-500">
              Выбрано: <span className="font-semibold text-slate-700">{selectedAssistantNames.length}</span>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAssistantDialog}>
              Закрыть
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
