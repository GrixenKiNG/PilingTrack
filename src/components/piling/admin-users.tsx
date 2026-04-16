'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  Headset,
  HardHat,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Search,
  Shield,
  Trash2,
  UserCircle,
  UserCog,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePilingStore } from '@/lib/store';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { UserDTO, UserRole } from '@/lib/types';
import { ROLE_LABELS } from '@/lib/types';
import { cn } from '@/lib/utils';

const ROLE_CONFIG: Record<
  UserRole,
  {
    icon: typeof Shield;
    avatarBg: string;
    avatarText: string;
    badgeBg: string;
    badgeText: string;
    badgeBorder: string;
    shortLabel: string;
    order: number;
  }
> = {
  OPERATOR: {
    icon: HardHat,
    avatarBg: 'bg-orange-100',
    avatarText: 'text-orange-600',
    badgeBg: 'bg-orange-100',
    badgeText: 'text-orange-700',
    badgeBorder: 'border-orange-200',
    shortLabel: 'Оператор',
    order: 1,
  },
  ASSISTANT: {
    icon: UserCircle,
    avatarBg: 'bg-teal-100',
    avatarText: 'text-teal-600',
    badgeBg: 'bg-teal-100',
    badgeText: 'text-teal-700',
    badgeBorder: 'border-teal-200',
    shortLabel: 'Помощник',
    order: 2,
  },
  DISPATCHER: {
    icon: Headset,
    avatarBg: 'bg-blue-100',
    avatarText: 'text-blue-600',
    badgeBg: 'bg-blue-100',
    badgeText: 'text-blue-700',
    badgeBorder: 'border-blue-200',
    shortLabel: 'Диспетчер',
    order: 3,
  },
  ADMIN: {
    icon: Shield,
    avatarBg: 'bg-purple-100',
    avatarText: 'text-purple-600',
    badgeBg: 'bg-purple-100',
    badgeText: 'text-purple-700',
    badgeBorder: 'border-purple-200',
    shortLabel: 'Администратор',
    order: 4,
  },
};

export function AdminUsers() {
  const currentUser = usePilingStore((state) => state.currentUser);
  const [users, setUsers] = useState<UserDTO[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'ALL' | UserRole>('ALL');

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<UserRole>('OPERATOR');
  const [creating, setCreating] = useState(false);

  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDTO | null>(null);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserRole>('OPERATOR');
  const [editPassword, setEditPassword] = useState('');
  const [saving, setSaving] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deletingUser, setDeletingUser] = useState<UserDTO | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // Load first page (50 users by default)
      const res = await authFetch('/api/users');
      if (res.ok) {
        const data = await res.json();
        let allUsers = data.users || [];
        // If there's a nextCursor, load remaining pages
        if (data.nextCursor) {
          let cursor = data.nextCursor;
          while (cursor) {
            const nextRes = await authFetch(`/api/users?cursor=${cursor}`);
            if (!nextRes.ok) break;
            const nextData = await nextRes.json();
            allUsers = allUsers.concat(nextData.users || []);
            cursor = nextData.nextCursor || null;
          }
        }
        setUsers(allUsers);
      }
    } catch {
      toast.error('Ошибка загрузки пользователей');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return [...users]
      .filter((user) => (roleFilter === 'ALL' ? true : user.role === roleFilter))
      .filter((user) => {
        if (!query) return true;
        return (
          user.name.toLowerCase().includes(query) ||
          user.email.toLowerCase().includes(query) ||
          ROLE_LABELS[user.role].toLowerCase().includes(query)
        );
      })
      .sort((left, right) => {
        const roleOrder = ROLE_CONFIG[left.role].order - ROLE_CONFIG[right.role].order;
        if (roleOrder !== 0) {
          return roleOrder;
        }
        return left.name.localeCompare(right.name, 'ru');
      });
  }, [roleFilter, search, users]);

  const isSelf = (user: UserDTO) => currentUser?.id === user.id;

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const handleCreateUser = async () => {
    const errors: Record<string, string> = {};
    if (!newName.trim()) errors.name = 'Имя обязательно';
    if (!newEmail.trim()) errors.email = 'Email обязателен';
    else if (!/\S+@\S+\.\S+/.test(newEmail)) errors.email = 'Некорректный email';
    if (!newPassword) errors.password = 'Пароль обязателен';
    else if (newPassword.length < 4) errors.password = 'Минимум 4 символа';

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    setCreating(true);
    try {
      const res = await authFetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Ошибка создания');
      }

      const data = await res.json();
      setUsers((prev) => [...prev, data.user]);
      setShowCreateDialog(false);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
      setNewRole('OPERATOR');
      toast.success('Пользователь создан');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка создания');
    } finally {
      setCreating(false);
    }
  };

  const openEditDialog = (user: UserDTO) => {
    setEditingUser(user);
    setEditName(user.name);
    setEditEmail(user.email);
    setEditRole(user.role);
    setEditPassword('');
    setShowEditDialog(true);
  };

  const handleSaveEdit = async () => {
    if (!editingUser) return;
    const errors: Record<string, string> = {};
    if (!editName.trim()) errors.editName = 'Имя обязательно';
    if (!editEmail.trim()) errors.editEmail = 'Email обязателен';
    else if (!/\S+@\S+\.\S+/.test(editEmail)) errors.editEmail = 'Некорректный email';
    if (editPassword && editPassword.length < 4) errors.editPassword = 'Минимум 4 символа';

    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors({});

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        id: editingUser.id,
        name: editName.trim(),
        email: editEmail.trim(),
        role: editRole,
      };
      if (editPassword) {
        body.password = editPassword;
      }

      const res = await authFetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Ошибка сохранения');
      }

      const data = await res.json();
      setUsers((prev) => prev.map((user) => (user.id === editingUser.id ? data.user : user)));
      setShowEditDialog(false);
      toast.success('Пользователь обновлён');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (user: UserDTO) => {
    try {
      const res = await authFetch('/api/users', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: user.id, isActive: !user.isActive }),
      });

      if (!res.ok) {
        throw new Error('Ошибка');
      }

      setUsers((prev) => prev.map((item) => (item.id === user.id ? { ...item, isActive: !item.isActive } : item)));
      toast.success(user.isActive ? 'Пользователь деактивирован' : 'Пользователь активирован');
    } catch {
      toast.error('Ошибка изменения статуса');
    }
  };

  const handleDeleteUser = async () => {
    if (!deletingUser) return;

    setDeleting(true);
    try {
      const res = await authFetch('/api/users', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: deletingUser.id }),
      });

      if (!res.ok) {
        const error = await res.json().catch(() => ({}));
        throw new Error(error.error || 'Ошибка удаления');
      }

      setUsers((prev) => prev.filter((user) => user.id !== deletingUser.id));
      setShowDeleteDialog(false);
      setDeletingUser(null);
      toast.success('Пользователь удалён');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Ошибка удаления');
    } finally {
      setDeleting(false);
    }
  };

  const renderRoleOptions = () => (
    <>
      <SelectItem value="OPERATOR">Оператор</SelectItem>
      <SelectItem value="ASSISTANT">Помощник</SelectItem>
      <SelectItem value="DISPATCHER">Диспетчер</SelectItem>
      <SelectItem value="ADMIN">Администратор</SelectItem>
    </>
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-bold text-slate-900">
          <Users className="h-5 w-5 text-orange-500" />
          Пользователи
        </h1>
        <Button onClick={() => setShowCreateDialog(true)} className="bg-orange-500 text-white hover:bg-orange-600">
          <Plus className="mr-1 h-4 w-4" />
          Новый пользователь
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-[1fr_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Быстрый поиск по имени, email или роли"
              className="pl-9"
            />
          </div>
          <Select value={roleFilter} onValueChange={(value) => setRoleFilter(value as 'ALL' | UserRole)}>
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

      {filteredUsers.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="mx-auto mb-3 h-12 w-12 text-slate-300" />
          <p className="text-sm text-slate-500">Пользователи не найдены</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredUsers.map((user, index) => {
            const RoleIcon = ROLE_CONFIG[user.role].icon;
            return (
              <motion.div
                key={user.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index < 20 ? index * 0.03 : 0 }}
              >
                <Card className={cn('card-hover', !user.isActive && 'opacity-60')}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', ROLE_CONFIG[user.role].avatarBg, ROLE_CONFIG[user.role].avatarText)}>
                          <RoleIcon className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-slate-900">
                            {user.name}
                            {isSelf(user) && <span className="ml-1.5 text-xs text-slate-400">(вы)</span>}
                          </p>
                          <p className="truncate text-xs text-slate-500">{user.email}</p>
                        </div>
                      </div>
                      <div className="ml-2 flex shrink-0 items-center gap-1.5">
                        <Badge variant="secondary" className={cn('hidden gap-1 sm:inline-flex', ROLE_CONFIG[user.role].badgeBg, ROLE_CONFIG[user.role].badgeText, ROLE_CONFIG[user.role].badgeBorder)}>
                          <RoleIcon className="h-3 w-3" />
                          {ROLE_CONFIG[user.role].shortLabel}
                        </Badge>
                        <Badge variant={user.isActive ? 'default' : 'secondary'} className={user.isActive ? 'border-green-200 bg-green-100 text-green-700' : 'border-slate-200 bg-slate-100 text-slate-500'}>
                          {user.isActive ? 'Активен' : 'Неактивен'}
                        </Badge>
                        <button
                          onClick={() => openEditDialog(user)}
                          className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-orange-500"
                          title="Редактировать"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        {!isSelf(user) && (
                          <button
                            onClick={() => handleToggleActive(user)}
                            className={cn(
                              'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                              user.isActive
                                ? 'text-slate-400 hover:bg-amber-100 hover:text-amber-600'
                                : 'text-slate-400 hover:bg-green-100 hover:text-green-600'
                            )}
                            title={user.isActive ? 'Деактивировать' : 'Активировать'}
                          >
                            {user.isActive ? <PowerOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                          </button>
                        )}
                        {!isSelf(user) && (
                          <button
                            onClick={() => {
                              setDeletingUser(user);
                              setShowDeleteDialog(true);
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-red-100 hover:text-red-500"
                            title="Удалить"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </div>
      )}

      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserCog className="h-4 w-4" />
              Новый пользователь
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Имя</Label>
              <Input value={newName} onChange={(e) => { setNewName(e.target.value); setFormErrors(prev => ({ ...prev, name: '' })); }} placeholder="Иванов Иван" className={cn('h-11', formErrors.name && 'border-red-500')} />
              {formErrors.name && <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.name}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={newEmail} onChange={(e) => { setNewEmail(e.target.value); setFormErrors(prev => ({ ...prev, email: '' })); }} placeholder="ivan@piling.ru" className={cn('h-11', formErrors.email && 'border-red-500')} />
              {formErrors.email && <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Пароль</Label>
              <Input type="password" value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setFormErrors(prev => ({ ...prev, password: '' })); }} placeholder="Минимум 4 символа" className={cn('h-11', formErrors.password && 'border-red-500')} />
              {formErrors.password && <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.password}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={newRole} onValueChange={(value) => setNewRole(value as UserRole)}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{renderRoleOptions()}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>Отмена</Button>
            <Button onClick={handleCreateUser} disabled={creating} className="bg-orange-500 text-white hover:bg-orange-600">
              {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Создать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" />
              Редактировать пользователя
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Имя</Label>
              <Input value={editName} onChange={(e) => { setEditName(e.target.value); setFormErrors(prev => ({ ...prev, editName: '' })); }} className={cn('h-11', formErrors.editName && 'border-red-500')} />
              {formErrors.editName && <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.editName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={editEmail} onChange={(e) => { setEditEmail(e.target.value); setFormErrors(prev => ({ ...prev, editEmail: '' })); }} className={cn('h-11', formErrors.editEmail && 'border-red-500')} />
              {formErrors.editEmail && <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.editEmail}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Новый пароль (оставьте пустым, чтобы не менять)</Label>
              <Input type="password" value={editPassword} onChange={(e) => { setEditPassword(e.target.value); setFormErrors(prev => ({ ...prev, editPassword: '' })); }} placeholder="••••••••" className={cn('h-11', formErrors.editPassword && 'border-red-500')} />
              {formErrors.editPassword && <p className="text-red-500 text-xs mt-1" role="alert">{formErrors.editPassword}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Роль</Label>
              <Select value={editRole} onValueChange={(value) => setEditRole(value as UserRole)}>
                <SelectTrigger className="h-11 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>{renderRoleOptions()}</SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>Отмена</Button>
            <Button onClick={handleSaveEdit} disabled={saving} className="bg-orange-500 text-white hover:bg-orange-600">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Check className="mr-1 h-4 w-4" />Сохранить</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы уверены, что хотите удалить пользователя <strong>{deletingUser?.name}</strong>? Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeleteUser} disabled={deleting} className="bg-red-500 text-white hover:bg-red-600">
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
