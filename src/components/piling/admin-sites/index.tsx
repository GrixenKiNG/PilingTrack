'use client';

import { useEffect, useState } from 'react';
import { MapPin, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { authFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { SiteList } from './site-list';
import {
  AddHierarchyDialog,
  CreateSiteDialog,
  DeleteSiteDialog,
  EditSiteDialog,
} from './site-editor';
import type { SiteFullData, SiteListItem } from './types';
import { UserAssignmentDialog } from './user-assignment';
import { useSiteMutations } from './use-site-mutations';
import { useSitesData } from './use-sites-data';

export function AdminSites() {
  const {
    sites,
    setSites,
    users,
    pileGrades,
    loading,
    loadingUsers,
    loadingPileGrades,
    loadUsers,
    loadPileGrades,
  } = useSitesData();

  const [expandedSiteId, setExpandedSiteId] = useState<string | null>(null);
  const [siteTree, setSiteTree] = useState<Record<string, SiteFullData>>({});

  const {
    togglingId,
    handleCreateSite,
    handleSaveEdit,
    handleConfirmDelete,
    handleToggleActive,
    handleAddHierarchy,
    handleDeleteHierarchy,
  } = useSiteMutations({ setSites, setSiteTree, setExpandedSiteId });

  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editSite, setEditSite] = useState<SiteListItem | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteSite, setDeleteSite] = useState<SiteListItem | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [addType, setAddType] = useState<'field' | 'cluster' | 'picket'>('field');
  const [addSiteId, setAddSiteId] = useState('');
  const [addParentId, setAddParentId] = useState('');
  const [showAssignDialog, setShowAssignDialog] = useState(false);
  const [assignSiteId, setAssignSiteId] = useState('');

  useEffect(() => {
    if (showCreateDialog || showEditDialog) {
      void loadPileGrades();
    }
  }, [showCreateDialog, showEditDialog, loadPileGrades]);

  useEffect(() => {
    if (showAssignDialog) {
      void loadUsers();
    }
  }, [showAssignDialog, loadUsers]);

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

      <SiteList
        sites={sites}
        expandedSiteId={expandedSiteId}
        siteTree={siteTree}
        togglingId={togglingId}
        onToggleExpand={toggleExpand}
        onToggleActive={handleToggleActive}
        onEdit={(site) => {
          setEditSite(site);
          setShowEditDialog(true);
        }}
        onDelete={(site) => {
          setDeleteSite(site);
          setShowDeleteDialog(true);
        }}
        onAssign={(siteId) => {
          setAssignSiteId(siteId);
          setShowAssignDialog(true);
        }}
        onAddHierarchy={(type, siteId, parentId) => {
          setAddType(type);
          setAddSiteId(siteId);
          setAddParentId(parentId);
          setShowAddDialog(true);
        }}
        onDeleteHierarchy={handleDeleteHierarchy}
      />

      <CreateSiteDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        loadingPileGrades={loadingPileGrades}
        pileGrades={pileGrades}
        onCreate={async (name, pilePlans, drillingPlans) => {
          const ok = await handleCreateSite(name, pilePlans, drillingPlans);
          if (ok) setShowCreateDialog(false);
        }}
      />

      <EditSiteDialog
        site={editSite}
        open={showEditDialog}
        onOpenChange={setShowEditDialog}
        loadingPileGrades={loadingPileGrades}
        pileGrades={pileGrades}
        onSave={async (siteId, name, isActive, pilePlans, drillingPlans) => {
          const ok = await handleSaveEdit(siteId, name, isActive, pilePlans, drillingPlans);
          if (ok) {
            setShowEditDialog(false);
            setEditSite(null);
          }
        }}
      />

      <DeleteSiteDialog
        site={deleteSite}
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        onConfirm={async () => {
          if (!deleteSite) return;
          const ok = await handleConfirmDelete(deleteSite.id);
          if (ok) {
            setShowDeleteDialog(false);
            setDeleteSite(null);
          }
        }}
      />

      <AddHierarchyDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        type={addType}
        onAdd={async (name) => {
          const ok = await handleAddHierarchy(addSiteId, addParentId, addType, name);
          if (ok) setShowAddDialog(false);
        }}
      />

      <Dialog open={showAssignDialog} onOpenChange={setShowAssignDialog}>
        <UserAssignmentDialog
          siteId={assignSiteId}
          onOpenChange={setShowAssignDialog}
          loadingUsers={loadingUsers}
          users={users}
        />
      </Dialog>
    </div>
  );
}
