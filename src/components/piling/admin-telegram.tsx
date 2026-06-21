'use client';

import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Send,
  Plus,
  Trash2,
  Loader2,
  Bot,
  MessageSquare,
  ToggleLeft,
  ToggleRight,
  Pencil,
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
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import type { TelegramConfigDTO } from '@/lib/types';
import { cn } from '@/lib/utils';

export function AdminTelegram() {
  const [configs, setConfigs] = useState<TelegramConfigDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // Create / edit dialog (mode = 'create' | 'edit')
  const [dialogMode, setDialogMode] = useState<'create' | 'edit' | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState('');
  const [newBotToken, setNewBotToken] = useState('');
  const [newChatId, setNewChatId] = useState('');
  const [saving, setSaving] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const openCreate = () => {
    setDialogMode('create');
    setEditingId(null);
    setNewLabel('');
    setNewBotToken('');
    setNewChatId('');
  };

  const openEdit = (config: TelegramConfigDTO) => {
    setDialogMode('edit');
    setEditingId(config.id);
    setNewLabel(config.label);
    setNewBotToken(config.botToken);
    setNewChatId(config.chatId);
  };

  const closeDialog = () => {
    setDialogMode(null);
    setEditingId(null);
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      const res = await authFetch('/api/notifications/telegram/test', { method: 'POST' });
      const data = await res.json();
      if (res.ok && data.ok) {
        toast.success(
          data.chatTitle
            ? `Соединение установлено: ${data.chatTitle}`
            : 'Соединение установлено',
        );
      } else {
        toast.error(`Ошибка: ${data.error || 'Не удалось подключиться'}`);
      }
    } catch {
      toast.error('Ошибка тестирования');
    } finally {
      setTesting(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch('/api/telegram/configs');
      if (res.ok) {
        const data = await res.json();
        setConfigs(data.configs || []);
      }
    } catch {
      toast.error('Ошибка загрузки конфигураций');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleSave = async () => {
    if (!newLabel.trim() || !newBotToken.trim() || !newChatId.trim()) {
      toast.error('Заполните все поля');
      return;
    }
    setSaving(true);
    try {
      const isEdit = dialogMode === 'edit' && editingId;
      const res = await authFetch('/api/telegram/configs', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(isEdit ? { id: editingId } : {}),
          label: newLabel.trim(),
          botToken: newBotToken.trim(),
          chatId: newChatId.trim(),
        }),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      const data = await res.json();
      if (isEdit) {
        setConfigs((prev) => prev.map((c) => (c.id === editingId ? data.config : c)));
        toast.success('Конфигурация обновлена');
      } else {
        setConfigs((prev) => [...prev, data.config]);
        toast.success('Конфигурация добавлена');
      }
      closeDialog();
    } catch {
      toast.error('Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await authFetch('/api/telegram/configs', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) throw new Error('Ошибка удаления');
      setConfigs((prev) => prev.filter((c) => c.id !== id));
      toast.success('Конфигурация удалена');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  const handleToggle = async (config: TelegramConfigDTO) => {
    setTogglingId(config.id);
    try {
      const res = await authFetch('/api/telegram/configs', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: config.id,
          enabled: !config.enabled,
        }),
      });
      if (!res.ok) throw new Error('Ошибка');
      setConfigs((prev) =>
        prev.map((c) =>
          c.id === config.id ? { ...c, enabled: !c.enabled } : c
        )
      );
      toast.success(config.enabled ? 'Уведомления отключены' : 'Уведомления включены');
    } catch {
      toast.error('Ошибка переключения');
    } finally {
      setTogglingId(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Send className="w-5 h-5 text-orange-500" />
            Telegram
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Настройка уведомлений в Telegram
          </p>
        </div>
        <Button
          onClick={openCreate}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          <Plus className="w-4 h-4 mr-1" />
          Добавить
        </Button>
      </div>

      {/* Configs List */}
      {configs.length === 0 ? (
        <div className="text-center py-16">
          <MessageSquare className="w-12 h-12 text-slate-300 mx-auto mb-3" />
          <p className="text-sm text-slate-500">Нет конфигураций Telegram</p>
          <p className="text-xs text-slate-400 mt-1">
            Добавьте конфигурацию для получения уведомлений
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {configs.map((config, index) => (
            <motion.div
              key={config.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className={cn(
                          'w-10 h-10 rounded-xl flex items-center justify-center',
                          config.enabled
                            ? 'bg-sky-100 text-sky-600'
                            : 'bg-slate-100 text-slate-400'
                        )}
                      >
                        <Bot className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">
                          {config.label}
                        </p>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          Chat ID: {config.chatId}
                        </p>
                        <p className="text-3xs text-slate-400 font-mono">
                          Token: ••••{config.botToken.slice(-6)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={
                          config.enabled
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : 'bg-slate-100 text-slate-500 border-slate-200'
                        }
                      >
                        {config.enabled ? 'Включено' : 'Выключено'}
                      </Badge>
                    </div>
                  </div>
                  <div className="flex items-center justify-end gap-2 mt-3">
                    <button
                      onClick={handleTest}
                      disabled={testing || !config.enabled}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-sky-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-sky-50 disabled:opacity-50"
                    >
                      {testing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Send className="w-3.5 h-3.5" />
                      )}
                      Тест
                    </button>
                    <button
                      onClick={() => openEdit(config)}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-blue-600 transition-colors px-2 py-1.5 rounded-lg hover:bg-blue-50"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Редактировать
                    </button>
                    <button
                      onClick={() => handleToggle(config)}
                      disabled={togglingId === config.id}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-orange-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-orange-50 disabled:opacity-50"
                    >
                      {togglingId === config.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : config.enabled ? (
                        <ToggleRight className="w-4 h-4" />
                      ) : (
                        <ToggleLeft className="w-4 h-4" />
                      )}
                      {config.enabled ? 'Выключить' : 'Включить'}
                    </button>
                    <button
                      onClick={() => handleDelete(config.id)}
                      className="flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-red-500 transition-colors px-2 py-1.5 rounded-lg hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Удалить
                    </button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}

      {/* Create / Edit Dialog */}
      <Dialog open={dialogMode !== null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="w-4 h-4" />
              {dialogMode === 'edit' ? 'Редактировать конфигурацию' : 'Новая конфигурация Telegram'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Название</Label>
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                placeholder="Например: Основной чат"
                className="h-11"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Bot Token</Label>
              <Input
                value={newBotToken}
                onChange={(e) => setNewBotToken(e.target.value)}
                placeholder="123456:ABC-DEF..."
                className="h-11 font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Chat ID</Label>
              <Input
                value={newChatId}
                onChange={(e) => setNewChatId(e.target.value)}
                placeholder="-1001234567890"
                className="h-11 font-mono"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Отмена
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-orange-500 hover:bg-orange-600 text-white"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : dialogMode === 'edit' ? (
                'Сохранить'
              ) : (
                'Добавить'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
