'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Pencil, UserCog } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { UserDTO, UserRole } from '@/lib/types';
import { cn } from '@/lib/utils';
import type { CreateUserInput, UpdateUserInput } from './use-users-list';

const RoleOptions = () => (
  <>
    <SelectItem value="OPERATOR">Оператор</SelectItem>
    <SelectItem value="ASSISTANT">Помощник</SelectItem>
    <SelectItem value="DISPATCHER">Диспетчер</SelectItem>
    <SelectItem value="ADMIN">Администратор</SelectItem>
  </>
);

interface CreateProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: CreateUserInput) => Promise<void>;
}

export function CreateUserDialog({ open, onOpenChange, onSubmit }: CreateProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('OPERATOR');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setName('');
      setEmail('');
      setPassword('');
      setRole('OPERATOR');
      setErrors({});
    }
  }, [open]);

  const submit = async () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Имя обязательно';
    if (!email.trim()) next.email = 'Email обязателен';
    else if (!/\S+@\S+\.\S+/.test(email)) next.email = 'Некорректный email';
    if (!password) next.password = 'Пароль обязателен';
    else if (password.length < 4) next.password = 'Минимум 4 символа';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), email: email.trim(), password, role });
      onOpenChange(false);
      toast.success('Пользователь создан');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка создания');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserCog className="h-4 w-4" />
            Новый пользователь
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField
            label="Имя"
            value={name}
            error={errors.name}
            onChange={(v) => {
              setName(v);
              setErrors((prev) => ({ ...prev, name: '' }));
            }}
            placeholder="Иванов Иван"
          />
          <FormField
            label="Email"
            type="email"
            value={email}
            error={errors.email}
            onChange={(v) => {
              setEmail(v);
              setErrors((prev) => ({ ...prev, email: '' }));
            }}
            placeholder="ivan@piling.ru"
          />
          <FormField
            label="Пароль"
            type="password"
            value={password}
            error={errors.password}
            onChange={(v) => {
              setPassword(v);
              setErrors((prev) => ({ ...prev, password: '' }));
            }}
            placeholder="Минимум 4 символа"
          />
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <RoleOptions />
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="bg-orange-500 text-white hover:bg-orange-600"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Создать'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface EditProps {
  open: boolean;
  user: UserDTO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: UpdateUserInput) => Promise<void>;
}

export function EditUserDialog({ open, user, onOpenChange, onSubmit }: EditProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('OPERATOR');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && user) {
      setName(user.name);
      setEmail(user.email);
      setRole(user.role);
      setPassword('');
      setErrors({});
    }
  }, [open, user]);

  const submit = async () => {
    if (!user) return;
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Имя обязательно';
    if (!email.trim()) next.email = 'Email обязателен';
    else if (!/\S+@\S+\.\S+/.test(email)) next.email = 'Некорректный email';
    if (password && password.length < 4) next.password = 'Минимум 4 символа';
    if (Object.keys(next).length > 0) {
      setErrors(next);
      return;
    }
    setErrors({});

    setSubmitting(true);
    try {
      await onSubmit({
        id: user.id,
        name: name.trim(),
        email: email.trim(),
        role,
        password: password || undefined,
      });
      onOpenChange(false);
      toast.success('Пользователь обновлён');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" />
            Редактировать пользователя
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <FormField
            label="Имя"
            value={name}
            error={errors.name}
            onChange={(v) => {
              setName(v);
              setErrors((prev) => ({ ...prev, name: '' }));
            }}
          />
          <FormField
            label="Email"
            type="email"
            value={email}
            error={errors.email}
            onChange={(v) => {
              setEmail(v);
              setErrors((prev) => ({ ...prev, email: '' }));
            }}
          />
          <FormField
            label="Новый пароль (оставьте пустым, чтобы не менять)"
            type="password"
            value={password}
            error={errors.password}
            onChange={(v) => {
              setPassword(v);
              setErrors((prev) => ({ ...prev, password: '' }));
            }}
            placeholder="••••••••"
          />
          <div className="space-y-1.5">
            <Label>Роль</Label>
            <Select value={role} onValueChange={(value) => setRole(value as UserRole)}>
              <SelectTrigger className="h-11 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <RoleOptions />
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={submitting}
            className="bg-orange-500 text-white hover:bg-orange-600"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Check className="mr-1 h-4 w-4" />
                Сохранить
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface DeleteProps {
  open: boolean;
  user: UserDTO | null;
  onOpenChange: (open: boolean) => void;
  onConfirm: (id: string) => Promise<void>;
}

export function DeleteUserDialog({ open, user, onOpenChange, onConfirm }: DeleteProps) {
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      await onConfirm(user.id);
      onOpenChange(false);
      toast.success('Пользователь удалён');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
          <AlertDialogDescription>
            Вы уверены, что хотите удалить пользователя <strong>{user?.name}</strong>?
            Это действие нельзя отменить.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction
            onClick={submit}
            disabled={submitting}
            className="bg-red-500 text-white hover:bg-red-600"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Удалить'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

interface FormFieldProps {
  label: string;
  value: string;
  type?: 'text' | 'email' | 'password';
  error?: string;
  placeholder?: string;
  onChange: (value: string) => void;
}

function FormField({ label, value, type = 'text', error, placeholder, onChange }: FormFieldProps) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={cn('h-11', error && 'border-red-500')}
      />
      {error && (
        <p className="mt-1 text-xs text-red-500" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
