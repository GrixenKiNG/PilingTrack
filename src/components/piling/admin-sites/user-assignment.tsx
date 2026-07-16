'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  X,
  Loader2,
  CheckCircle2,
} from '@/components/piling/icons/unified-icons';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { AssignedUser, SiteFullData } from './types';

interface UserAssignmentDialogProps {
  siteId: string;
  onOpenChange: (open: boolean) => void;
  loadingUsers: boolean;
  users: { id: string; email: string; name: string; role: string; isActive: boolean }[];
}

export function UserAssignmentDialog({ siteId, loadingUsers, users }: UserAssignmentDialogProps) {
  const [assignedUsers, setAssignedUsers] = useState<AssignedUser[]>([]);
  const [loadingAssign, setLoadingAssign] = useState(false);

  const loadAssignedUsers = useCallback(async (targetSiteId: string) => {
    setLoadingAssign(true);
    setAssignedUsers([]);
    try {
      const res = await authFetch(`/api/sites/${targetSiteId}`);
      if (res.ok) {
        const data = await res.json();
        const tree = data.site as SiteFullData;
        setAssignedUsers(tree.users || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingAssign(false);
    }
  }, []);

  useEffect(() => {
    if (siteId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loads data on mount / dependency change; the async loader sets state
      void loadAssignedUsers(siteId);
    }
  }, [loadAssignedUsers, siteId]);

  const handleAssignUser = async (userId: string) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        toast.success('Оператор назначен');
        await loadAssignedUsers(siteId);
      }
    } catch {
      toast.error('Ошибка назначения');
    }
  };

  const handleUnassignUser = async (userId: string) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}/assign?userId=${userId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        toast.success('Назначение снято');
        await loadAssignedUsers(siteId);
      }
    } catch {
      toast.error('Ошибка');
    }
  };

  const operators = users.filter((u) => u.role === 'OPERATOR');
  const assignedIds = new Set(assignedUsers.map((a) => a.userId));

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Операторы на объекте</DialogTitle>
      </DialogHeader>
      {loadingAssign || loadingUsers ? (
        <div className="py-8 flex justify-center">
          <Loader2 className="w-6 h-6 animate-spin text-orange-500" />
        </div>
      ) : (
        <div className="space-y-3">
          {/* Currently assigned */}
          {assignedUsers.length > 0 && (
            <div>
              <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
                Назначены
              </p>
              <div className="space-y-1">
                {assignedUsers.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-green-50 border border-green-200"
                  >
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-green-500" />
                      <div>
                        <p className="text-sm font-medium text-slate-900">{a.user.name}</p>
                        <p className="text-3xs text-slate-500">{a.user.email}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleUnassignUser(a.userId)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-red-100 text-slate-400 hover:text-red-500 transition-colors"
                      title="Снять назначение"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Available to assign */}
          <div>
            <p className="text-xs font-medium text-slate-500 mb-2 uppercase tracking-wide">
              Доступные операторы
            </p>
            <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
              {operators
                .filter((u) => u.isActive && !assignedIds.has(u.id))
                .map((user) => (
                  <div
                    key={user.id}
                    className="flex items-center justify-between p-2 rounded-lg hover:bg-slate-50"
                  >
                    <div>
                      <p className="text-sm font-medium">{user.name}</p>
                      <p className="text-xs text-slate-500">{user.email}</p>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleAssignUser(user.id)}
                      className="h-7 text-xs"
                    >
                      <Plus className="w-3 h-3 mr-1" />
                      Назначить
                    </Button>
                  </div>
                ))}
              {operators.filter((u) => u.isActive && !assignedIds.has(u.id)).length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4">
                  {assignedUsers.length > 0
                    ? 'Все операторы уже назначены'
                    : 'Нет активных операторов'}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </DialogContent>
  );
}
