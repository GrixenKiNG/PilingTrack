'use client';

import { motion } from 'framer-motion';
import {
  Plus,
  Trash2,
  FolderTree,
} from '@/components/piling/icons/unified-icons';
import type { SiteFullData } from './types';

interface HierarchyTreeProps {
  siteId: string;
  tree: SiteFullData;
  onAdd: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDelete: (siteId: string, type: string, itemId: string) => void;
}

export function HierarchyTree({ siteId, tree, onAdd, onDelete }: HierarchyTreeProps) {
  return (
    <div className="pl-4 border-l-2 border-signal/30 space-y-2">
      {/* Fields */}
      {tree.fields.length === 0 ? (
        <p className="text-xs text-muted-foreground py-2">
          Нет свайных полей. Нажмите + чтобы добавить.
        </p>
      ) : (
        tree.fields.map((field) => (
          <div key={field.id}>
            <div className="flex items-center justify-between py-1">
              <div className="flex items-center gap-2">
                <FolderTree className="w-3.5 h-3.5 text-signal-strong" />
                <span className="text-sm font-medium text-foreground">
                  {field.name}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onAdd('cluster', siteId, field.id)}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-signal/10 text-muted-foreground hover:text-signal-strong"
                  title="Добавить куст"
                >
                  <Plus className="w-3 h-3" />
                </button>
                <button
                  onClick={() => onDelete(siteId, 'field', field.id)}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive-strong"
                  title="Удалить поле"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
            {/* Clusters */}
            <div className="pl-4 border-l border-border space-y-1">
              {field.clusters.length === 0 ? (
                <p className="text-3xs text-muted-foreground py-0.5">Нет кустов</p>
              ) : (
                field.clusters.map((cluster) => (
                  <div key={cluster.id}>
                    <div className="flex items-center justify-between py-0.5">
                      <span className="text-xs text-foreground">{cluster.name}</span>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => onAdd('picket', siteId, cluster.id)}
                          className="w-5 h-5 rounded flex items-center justify-center hover:bg-signal/10 text-muted-foreground hover:text-signal-strong"
                        >
                          <Plus className="w-2.5 h-2.5" />
                        </button>
                        <button
                          onClick={() => onDelete(siteId, 'cluster', cluster.id)}
                          className="w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive-strong"
                        >
                          <Trash2 className="w-2.5 h-2.5" />
                        </button>
                      </div>
                    </div>
                    {/* Pickets */}
                    <div className="pl-3 space-y-0.5">
                      {cluster.pickets.length === 0 ? (
                        <p className="text-3xs text-muted-foreground py-0.5">Нет пикетов</p>
                      ) : (
                        cluster.pickets.map((picket) => (
                          <div
                            key={picket.id}
                            className="flex items-center justify-between py-0.5"
                          >
                            <span className="text-2xs text-muted-foreground">
                              {'\ud83d\udccd'} {picket.name}
                            </span>
                            <button
                              onClick={() => onDelete(siteId, 'picket', picket.id)}
                              className="w-5 h-5 rounded flex items-center justify-center hover:bg-destructive/10 text-muted-foreground hover:text-destructive-strong"
                            >
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        ))
      )}
      <button
        onClick={() => onAdd('field', siteId, siteId)}
        className="flex items-center gap-1.5 text-xs text-signal-strong hover:text-signal-strong font-medium py-1"
      >
        <Plus className="w-3 h-3" />
        Добавить свайное поле
      </button>
    </div>
  );
}

// Plans summary sub-component
interface PlansSummaryProps {
  tree: SiteFullData;
}

export function PlansSummary({ tree }: PlansSummaryProps) {
  if (
    (!tree.pilePlans || tree.pilePlans.length === 0) &&
    (!tree.drillingPlans || tree.drillingPlans.length === 0)
  ) {
    return null;
  }

  return (
    <div className="mt-3 mb-2 space-y-2">
      {/* Pile Plans */}
      {tree.pilePlans && tree.pilePlans.length > 0 && (
        <div className="bg-signal/10 border border-signal/30 rounded-lg p-3">
          <p className="text-xs font-semibold text-signal-strong mb-1.5 flex items-center gap-1">
            План свай
          </p>
          <div className="space-y-1">
            {tree.pilePlans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{plan.pileGrade.name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground font-mono">
                    {plan.count} шт × {plan.metersPerUnit} м
                  </span>
                  <span className="font-mono font-semibold text-signal-strong">
                    {(plan.count * plan.metersPerUnit).toFixed(1)} м
                  </span>
                </div>
              </div>
            ))}
            <div className="border-t border-signal/30 pt-1 flex items-center justify-between text-xs font-semibold">
              <span className="text-signal-strong">Итого</span>
              <div className="flex items-center gap-3 text-signal-strong">
                <span className="font-mono">
                  {tree.pilePlans.reduce((s, p) => s + p.count, 0)} свай
                </span>
                <span className="font-mono">
                  {tree.pilePlans.reduce((s, p) => s + p.count * p.metersPerUnit, 0).toFixed(1)} м
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Drilling Plans */}
      {tree.drillingPlans && tree.drillingPlans.length > 0 && (
        <div className="bg-info/10 border border-info/30 rounded-lg p-3">
          <p className="text-xs font-semibold text-info-strong mb-1.5 flex items-center gap-1">
            План бурения
          </p>
          <div className="space-y-1">
            {tree.drillingPlans.map((plan) => (
              <div key={plan.id} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{'\u2300'}{plan.diameter} мм</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground font-mono">
                    {plan.count} шт × {plan.metersPerUnit} м
                  </span>
                  <span className="font-mono font-semibold text-info-strong">
                    {(plan.count * plan.metersPerUnit).toFixed(1)} м
                  </span>
                </div>
              </div>
            ))}
            <div className="border-t border-info/30 pt-1 flex items-center justify-between text-xs font-semibold">
              <span className="text-info-strong">Итого бурение</span>
              <span className="font-mono text-info-strong">
                {tree.drillingPlans.reduce((s, p) => s + p.count * p.metersPerUnit, 0).toFixed(1)} м
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Expanded tree content (plans + hierarchy) with animation wrapper
interface ExpandedTreeContentProps {
  siteId: string;
  tree: SiteFullData;
  onAdd: (type: 'field' | 'cluster' | 'picket', siteId: string, parentId: string) => void;
  onDelete: (siteId: string, type: string, itemId: string) => void;
}

export function ExpandedTreeContent({ siteId, tree, onAdd, onDelete }: ExpandedTreeContentProps) {
  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: 'auto' }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <PlansSummary tree={tree} />
      <HierarchyTree siteId={siteId} tree={tree} onAdd={onAdd} onDelete={onDelete} />
    </motion.div>
  );
}
