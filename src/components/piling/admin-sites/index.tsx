'use client';

import { useEffect, useState } from 'react';
import {
  MapPin,
  Plus,
} from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog } from '@/components/ui/dialog';
import type { PileGradeDTO } from '@/lib/types';
import type { SiteListItem, SiteFullData, PilePlanRow, DrillingPlanRow } from './types';
import { SiteList } from './site-list';
import {
  CreateSiteDialog,
  EditSiteDialog,
  DeleteSiteDialog,
  AddHierarchyDialog,
} from './site-editor';
import { UserAssignmentDialog } from './user-assignment';

export function AdminSites() {
  const [sites, setSites] = useState<SiteListItem[]>([]);
  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [siteTree, setSiteTree] = useState<Record<string, SiteFullData>>({});
  const [users, setUsers] = useState<{ id: string; email: string; name: string; role: string; isActive: boolean }[]>([]);
  const [pileGrades, setPileGrades] = useState<PileGradeDTO[]>([]);
  const [loading, setLoading] = useState(true);

  // Create site dialog
  const [showCreateDialog, setShowCreateDialog] = useState(false);

  // Edit site dialog
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editSite, setEditSite] = useState<SiteListItem | null>(null);

  // Delete confirmation dialog
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteSite, setDeleteSite] = useState<SiteListItem | null>(null);

  // Add hierarchy item dialog
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addType, setAddType] = useState<'field' | 'cluster' | 'picket'>('field');
  const [addSiteId, setAddSiteId] = useState('');
  const [addParentId, setAddParentId] = useState('');

  // Assign user dialog
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignSiteId, setAssignSiteId] = useState('');

  // Active toggle
  const [togglingId, setTogglingId] = useState<string | null>(null);

  // ============================================================
  // Data loading
  // ============================================================

  useEffect(() => {
    const abortController = new AbortController();
    let isMounted = true;

    const loadData = async () => {
      if (!isMounted) return;
      setLoading(true);
      try {
        const [usersRes, sitesRes, dictRes] = await Promise.all([
          authFetch('/api/users', { signal: abortController.signal }),
          authFetch('/api/sites/all', { signal: abortController.signal }),
          authFetch('/api/dictionary/all', { signal: abortController.signal }),
        ]);
        
        if (!isMounted) return;

        if (usersRes.ok) {
          const data = await usersRes.json();
          setUsers(data.data || data.users || []);
        }
        if (sitesRes.ok) {
          const data = await sitesRes.json();
          setSites(data.sites || []);
        }
        if (dictRes.ok) {
          const data = await dictRes.json();
          setPileGrades(data.pileGrades || []);
        }
      } catch (error: unknown) {
        if (isMounted && !(error instanceof Error && error.name === 'AbortError')) {
          toast.error('Ошибка загрузки данных');
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadData();

    return () => {
      isMounted = false;
      abortController.abort();
    };
  }, []);

  // ============================================================
  // Expand / collapse site tree
  // ============================================================

  const toggleExpand = async (siteId: string) => {
    if (expandedSiteId === siteId) {
      setExpandedSiteId(null);
      return;
    }
    setExpandedSiteId(siteId);
    if (!siteTree[siteId]) {
      try {
        const res = await authFetch(`/api/sites/${siteId}`);
        if (res.ok) {
          const data = await res.json();
          setSiteTree((prev) => ({ ...prev, [siteId]: data.site }));
        }
      } catch {
        toast.error('Ошибка загрузки иерархии');
      }
    }
  };

  // ============================================================
  // CREATE
  // ============================================================

  const handleCreateSite = async (name: string, pilePlans: PilePlanRow[], drillingPlans: DrillingPlanRow[]) => {
    try {
      const payload: Record<string, unknown> = { name };
      if (pilePlans.length > 0) {
        payload.pilePlans = pilePlans
          .filter((p) => p.pileGradeId && p.count > 0)
          .map((p) => ({
            pileGradeId: p.pileGradeId,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
      }
      if (drillingPlans.length > 0) {
        payload.drillingPlans = drillingPlans
          .filter((p) => p.count > 0)
          .map((p) => ({
            diameter: p.diameter,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
      }

      const res = await authFetch('/api/sites/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Ошибка создания');
      const data = await res.json();
      setSites((prev) => [...prev, data.site]);
      setShowCreateDialog(false);
      toast.success('Объект создан');
    } catch {
      toast.error('Ошибка создания объекта');
    }
  };

  // ============================================================
  // EDIT
  // ============================================================

  const openEditDialog = (site: SiteListItem) => {
    setEditSite(site);
    setShowEditDialog(true);
  };

  const handleSaveEdit = async (
    siteId: string,
    name: string,
    isActive: boolean,
    pilePlans: PilePlanRow[],
    drillingPlans: DrillingPlanRow[]
  ) => {
    try {
      const payload: Record<string, unknown> = { name, isActive };

      const validPilePlans = pilePlans.filter((p) => p.pileGradeId && p.count > 0);
      const validDrillingPlans = drillingPlans.filter((p) => p.count > 0);

      if (validPilePlans.length > 0 || validDrillingPlans.length > 0) {
        if (validPilePlans.length > 0) {
          payload.pilePlans = validPilePlans.map((p) => ({
            pileGradeId: p.pileGradeId,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
        }
        if (validDrillingPlans.length > 0) {
          payload.drillingPlans = validDrillingPlans.map((p) => ({
            diameter: p.diameter,
            count: p.count,
            metersPerUnit: p.metersPerUnit,
          }));
        }
      } else {
        payload.pilePlans = [];
        payload.drillingPlans = [];
      }

      const res = await authFetch(`/api/sites/${siteId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('Ошибка сохранения');
      const data = await res.json();

      setSites((prev) =>
        prev.map((s) =>
          s.id === siteId
            ? { ...s, name: data.site.name, isActive: data.site.isActive, plannedPiles: data.site.plannedPiles, plannedDrilling: data.site.plannedDrilling }
            : s
        )
      );
      // Clear cached tree
      setSiteTree((prev) => {
        const next = { ...prev };
        delete next[siteId];
        return next;
      });
      setShowEditDialog(false);
      setEditSite(null);
      toast.success('Объект сохранён');
    } catch {
      toast.error('Ошибка сохранения');
    }
  };

  // ============================================================
  // DELETE
  // ============================================================

  const openDeleteDialog = (site: SiteListItem) => {
    setDeleteSite(site);
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = async () => {
    if (!deleteSite) return;
    try {
      const res = await authFetch(`/api/sites/${deleteSite.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Ошибка удаления');
      setSites((prev) => prev.filter((s) => s.id !== deleteSite.id));
      setSiteTree((prev) => {
        const next = { ...prev };
        delete next[deleteSite.id];
        return next;
      });
      if (expandedSiteId === deleteSite.id) setExpandedSiteId(null);
      setShowDeleteDialog(false);
      setDeleteSite(null);
      toast.success('Объект удалён');
    } catch {
      toast.error('Ошибка удаления объекта');
    }
  };

  // ============================================================
  // TOGGLE ACTIVE
  // ============================================================

  const handleToggleActive = async (site: SiteListItem) => {
    setTogglingId(site.id);
    try {
      const res = await authFetch(`/api/sites/${site.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !site.isActive }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSites((prev) =>
        prev.map((s) => (s.id === site.id ? data.site : s))
      );
      toast.success(site.isActive ? 'Объект деактивирован' : 'Объект активирован');
    } catch {
      toast.error('Ошибка');
    } finally {
      setTogglingId(null);
    }
  };

  // ============================================================
  // HIERARCHY
  // ============================================================

  const openAddDialog = (
    type: 'field' | 'cluster' | 'picket',
    siteId: string,
    parentId: string
  ) => {
    setAddType(type);
    setAddSiteId(siteId);
    setAddParentId(parentId);
    setShowAddDialog(true);
  };

  const handleAddHierarchy = async (name: string) => {
    try {
      const res = await authFetch(`/api/sites/${addSiteId}/hierarchy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: addType, name, parentId: addParentId }),
      });
      if (!res.ok) throw new Error('Ошибка добавления');
      const treeRes = await authFetch(`/api/sites/${addSiteId}`);
      if (treeRes.ok) {
        const data = await treeRes.json();
        setSiteTree((prev) => ({ ...prev, [addSiteId]: data.site }));
      }
      setShowAddDialog(false);
      toast.success('Элемент добавлен');
    } catch {
      toast.error('Ошибка добавления');
    }
  };

  const handleDeleteHierarchy = async (siteId: string, type: string, itemId: string) => {
    try {
      const res = await authFetch(`/api/sites/${siteId}/hierarchy`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, itemId }),
      });
      if (!res.ok) throw new Error('Ошибка удаления');
      const treeRes = await authFetch(`/api/sites/${siteId}`);
      if (treeRes.ok) {
        const data = await treeRes.json();
        setSiteTree((prev) => ({ ...prev, [siteId]: data.site }));
      }
      toast.success('Элемент удалён');
    } catch {
      toast.error('Ошибка удаления');
    }
  };

  // ============================================================
  // ASSIGN USERS
  // ============================================================

  const openAssignDialog = (siteId: string) => {
    setAssignSiteId(siteId);
    setShowAssignDialog(true);
  };

  // ============================================================
  // Loading state
  // ============================================================

  if (loading) {
    return (
      <div className="space-y-4 p-4 lg:p-6">
        <Skeleton className="h-8 w-48" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <MapPin className="w-5 h-5 text-orange-500" />
          Объекты
          <Badge variant="secondary" className="ml-2 font-mono text-xs">
            {sites.length}
          </Badge>
        </h1>
        <Button
          onClick={() => setShowCreateDialog(true)}
          className="bg-orange-500 hover:bg-orange-600 text-white"
        >
          <Plus className="w-4 h-4 mr-1" />
          Новый объект
        </Button>
      </div>

      {/* Sites List */}
      <SiteList
        sites={sites}
        expandedSiteId={expandedSiteId}
        siteTree={siteTree}
        togglingId={togglingId}
        onToggleExpand={toggleExpand}
        onToggleActive={handleToggleActive}
        onEdit={openEditDialog}
        onDelete={openDeleteDialog}
        onAssign={openAssignDialog}
        onAddHierarchy={openAddDialog}
        onDeleteHierarchy={handleDeleteHierarchy}
      />

      {/* ====== DIALOGS ====== */}

      {/* Create Site Dialog */}
      <CreateSiteDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        pileGrades={pileGrades}
        onCreate={handleCreateSite}
      />

      {/* Edit Site Dialog */}
      <EditSiteDialog
        site={editSite}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        pileGrades={pileGrades}
        onSave={handleSaveEdit}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteSiteDialog
        site={deleteSite}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={handleConfirmDelete}
      />

      {/* Add Hierarchy Dialog */}
      <AddHierarchyDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        type={addType}
        onAdd={handleAddHierarchy}
      />

      {/* Assign User Dialog */}
      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <UserAssignmentDialog
          siteId={assignSiteId}
          onOpenChange={setShowAssignDialog}
          users={users}
        />
      </Dialog>
    </div>
  );
}
