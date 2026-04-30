'use client';

import { AnimatePresence } from 'framer-motion';
import {
  MapPin,
  Plus,
  Trash2,
  Pencil,
  ChevronDown,
  ChevronRight,
  HardHat,
  Drill,
  Users,
  Loader2,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { SiteListItem, SiteFullData } from './types';
import { ExpandedTreeContent } from './hierarchy-tree';

interface SiteListProps {
  sites: SiteListItem[];
  expandedSiteId: string | null;
  siteTree: Record<string, SiteFullData>;
  togglingId: string | null;
  onToggleExpand: (siteId: string) => void;
  onToggleActive: (site: SiteListItem) => void;
  onEdit: (site: SiteListItem) => void;
  onDelete: (site: SiteListItem) => void;
  onAssign: (siteId: string) => void;
  onAddHierarchy: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDeleteHierarchy: (siteId: string, type: string, itemId: string) => void;
}

export function SiteList({
  sites,
  expandedSiteId,
  siteTree,
  togglingId,
  onToggleExpand,
  onToggleActive,
  onEdit,
  onDelete,
  onAssign,
  onAddHierarchy,
  onDeleteHierarchy,
}: SiteListProps) {
  if (sites.length === 0) {
    return (
      <div className="text-center py-16">
        <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-3" />
        <p className="text-sm text-slate-500">Нет объектов</p>
        <p className="text-xs text-slate-400 mt-1">
          Создайте первый объект для начала работы
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {sites.map((site) => (
        <div key={site.id}>
          <Card
            className={cn(
              'transition-all',
              !site.isActive && 'opacity-60 border-dashed border-slate-300'
            )}
          >
            <CardContent className="p-4">
              {/* Site Row */}
              <div className="flex items-center justify-between">
                <div
                  className="flex items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => onToggleExpand(site.id)}
                >
                  {expandedSiteId === site.id ? (
                    <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="w-4 h-4 text-slate-400 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className={cn(
                        'text-sm font-semibold text-slate-900 truncate',
                        !site.isActive && 'text-slate-400 line-through'
                      )}>
                        {site.name}
                      </p>
                      {!site.isActive && (
                        <Badge variant="secondary" className="text-xs bg-slate-200 text-slate-500">
                          Неактивен
                        </Badge>
                      )}
                      {site._count && (site._count.pilePlans > 0 || site._count.drillingPlans > 0) && (
                        <div className="flex items-center gap-1.5 ml-1">
                          {site._count.pilePlans > 0 && (
                            <Badge variant="outline" className="text-xs text-orange-600 border-orange-200 bg-orange-50">
                              {site._count.pilePlans} план{site._count.pilePlans > 1 ? 'а' : ''} свай
                            </Badge>
                          )}
                          {site._count.drillingPlans > 0 && (
                            <Badge variant="outline" className="text-xs text-blue-600 border-blue-200 bg-blue-50">
                              {site._count.drillingPlans} план{site._count.drillingPlans > 1 ? 'а' : ''} бурения
                            </Badge>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <HardHat className="w-3 h-3" />
                        <span className="font-mono">{site.plannedPiles}</span> свай
                      </span>
                      <span className="flex items-center gap-1">
                        <Drill className="w-3 h-3" />
                        <span className="font-mono">{site.plannedDrilling}</span> м
                      </span>
                    </div>
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-0.5 ml-2 flex-shrink-0">
                  <button
                    onClick={() => onAssign(site.id)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                    title="Назначить оператора"
                  >
                    <Users className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onEdit(site)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-orange-50 text-slate-400 hover:text-orange-600 transition-colors"
                    title="Редактировать"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => onToggleActive(site)}
                    disabled={togglingId === site.id}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors disabled:opacity-50"
                    title={site.isActive ? 'Деактивировать' : 'Активировать'}
                  >
                    {togglingId === site.id ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : site.isActive ? (
                      <ToggleRight className="w-4 h-4 text-green-500" />
                    ) : (
                      <ToggleLeft className="w-4 h-4" />
                    )}
                  </button>
                  <button
                    onClick={() => onDelete(site)}
                    className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-red-50 text-slate-400 hover:text-red-500 transition-colors"
                    title="Удалить объект"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Expanded Tree + Plans */}
              <AnimatePresence>
                {expandedSiteId === site.id && siteTree[site.id] && (
                  <ExpandedTreeContent
                    siteId={site.id}
                    tree={siteTree[site.id]}
                    onAdd={onAddHierarchy}
                    onDelete={onDeleteHierarchy}
                  />
                )}
              </AnimatePresence>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
